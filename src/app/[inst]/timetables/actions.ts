"use server";

import { revalidatePath } from "next/cache";
import { sweepAppointments } from "@/lib/appointments-db";
import { prisma } from "@/lib/db";
import { AccessError, requireAction } from "@/lib/access";
import type { Action } from "@/lib/permissions";
import { withLock } from "@/lib/locks";
import { sharedEntityName, type ShareView } from "@/lib/share-view";
import { buildProblem, score, validate } from "@/lib/solver";
import type { Assignment, InstituteInput } from "@/lib/solver";

export type EditResult = { ok: true; quality: number } | { ok: false; error: string };

/** Permission check that turns access problems into a returned error message. */
async function allowed(slug: string, action: Action) {
  try {
    return { access: await requireAction(slug, action) };
  } catch (e) {
    if (e instanceof AccessError) return { error: e.message };
    throw e;
  }
}

/**
 * Save manual edits to a draft. Re-validated on the server against the data the version was
 * solved from (its snapshot), so a hand edit can never introduce a clash.
 */
export async function saveEdits(
  slug: string,
  versionId: string,
  assignment: Assignment,
  pinnedLessonIds: string[],
): Promise<EditResult> {
  const check = await allowed(slug, "timetable.editDraft");
  if (!check.access) return { ok: false, error: check.error! };
  const inst = check.access.inst;
  const version = await prisma.timetableVersion.findFirst({ where: { id: versionId, institutionId: inst.id } });
  if (!version) return { ok: false, error: "This timetable no longer exists." };
  if (version.status !== "DRAFT") return { ok: false, error: "Only drafts can be edited. Send it back to draft first." };

  const problem = buildProblem(version.snapshot as unknown as InstituteInput);
  const known = new Set(problem.lessons.map((l) => l.id));
  const clean: Assignment = {};
  for (const [id, a] of Object.entries(assignment)) if (known.has(id)) clean[id] = a;

  const { violations, unscheduled } = validate(problem, clean);
  if (violations.length) return { ok: false, error: `Not saved: ${violations[0].message}` };
  const before = (version.stats as { unscheduled?: number }).unscheduled ?? 0;
  if (unscheduled.length > before) {
    return { ok: false, error: `Not saved: ${unscheduled.length - before} class(es) would be left without a slot.` };
  }

  const breakdown = score(problem, clean);
  const pinned = new Set(pinnedLessonIds);
  await prisma.$transaction([
    prisma.placement.deleteMany({ where: { versionId } }),
    prisma.placement.createMany({
      data: Object.entries(clean).map(([lessonId, a]) => ({
        versionId,
        lessonId,
        day: a.day,
        period: a.period,
        roomId: a.roomId,
        pinned: pinned.has(lessonId),
      })),
    }),
    prisma.timetableVersion.update({
      where: { id: versionId },
      data: {
        quality: breakdown.quality,
        stats: { ...(version.stats as object), ...breakdown, unscheduled: unscheduled.length, edited: true },
      },
    }),
  ]);
  revalidatePath(`/${slug}`, "layout");
  return { ok: true, quality: breakdown.quality };
}

// ---------------------------------------------------------------- Share links

const SHARE_VIEWS = new Set(["section", "teacher", "room"]);

function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Buffer.from(bytes).toString("base64url");
}

export type ShareResult = { ok: true; token: string } | { ok: false; error: string };

/**
 * Public read-only link to one section/teacher/room timetable (or the whole college when
 * `view` is null). With `followPublished` the link always shows the latest published
 * timetable instead of this version. Re-sharing the same thing returns the existing link.
 */
export async function createShareLink(
  slug: string,
  versionId: string,
  view: string | null,
  entityId: string | null,
  followPublished = false,
): Promise<ShareResult> {
  const check = await allowed(slug, "timetable.share");
  if (!check.access) return { ok: false, error: check.error! };
  const inst = check.access.inst;
  const version = await prisma.timetableVersion.findFirst({ where: { id: versionId, institutionId: inst.id } });
  if (!version) return { ok: false, error: "This timetable no longer exists." };
  // HODs and the Head of Institute share only what is published; a draft is the admin's to share.
  if (!followPublished && version.status !== "PUBLISHED" && !check.access.can("timetable.editDraft")) {
    return { ok: false, error: "Only published timetables can be shared. Ask the admin to share this draft." };
  }
  if (view !== null && (!SHARE_VIEWS.has(view) || !entityId)) return { ok: false, error: "Pick what to share." };
  if (view !== null && !sharedEntityName(version.snapshot as unknown as InstituteInput, view as ShareView, entityId!)) {
    return { ok: false, error: "That section, teacher or room isn't in this timetable." };
  }
  const where = { institutionId: inst.id, versionId: followPublished ? null : versionId, view, entityId: view ? entityId : null };
  const existing = await prisma.shareLink.findFirst({ where });
  if (existing) return { ok: true, token: existing.token };
  const link = await prisma.shareLink.create({ data: { ...where, token: newToken() } });
  return { ok: true, token: link.token };
}

/** Stop a share link from working. */
export async function revokeShareLink(slug: string, token: string): Promise<{ ok: boolean }> {
  const check = await allowed(slug, "timetable.share");
  if (!check.access) return { ok: false };
  const res = await prisma.shareLink.deleteMany({ where: { token, institutionId: check.access.inst.id } });
  return { ok: res.count > 0 };
}

// ---------------------------------------------------------------- Review & publish workflow
//
// DRAFT --(admin: send for review)--> REVIEW --(every HOD approves)--> APPROVED --(HOI: publish)--> PUBLISHED
// An HOD requesting changes sends it back to DRAFT with their comment. Publishing archives the
// previously published version. Departments without an HOD account don't need to sign off.

export type WorkflowResult = { ok: true } | { ok: false; error: string };

/** Every status change of a college's timetables takes this lock (see withLock). */
const workflowKey = (institutionId: string) => `timetable-workflow:${institutionId}`;

/** Departments whose HOD must sign off: those with at least one HOD account. */
async function reviewingDepartments(institutionId: string): Promise<string[]> {
  const hods = await prisma.membership.findMany({
    where: { institutionId, role: "HOD", departmentId: { not: null } },
    select: { departmentId: true },
  });
  return [...new Set(hods.map((h) => h.departmentId!))];
}

export async function submitForReview(slug: string, versionId: string): Promise<WorkflowResult> {
  const check = await allowed(slug, "timetable.submit");
  if (!check.access) return { ok: false, error: check.error! };
  const inst = check.access.inst;
  const depts = await reviewingDepartments(inst.id);
  const error = await withLock(workflowKey(inst.id), async (tx) => {
    const version = await tx.timetableVersion.findFirst({ where: { id: versionId, institutionId: inst.id } });
    if (!version) return "This timetable no longer exists.";
    if (version.status !== "DRAFT") return "Only drafts can be sent for review.";
    await tx.deptSignoff.deleteMany({ where: { versionId } });
    // With no HODs to ask, it is ready for the Head of Institute straight away.
    await tx.timetableVersion.update({ where: { id: versionId }, data: { status: depts.length ? "REVIEW" : "APPROVED", submittedAt: new Date() } });
    return null;
  });
  if (error) return { ok: false, error };
  revalidatePath(`/${slug}`, "layout");
  return { ok: true };
}

export async function signOff(
  slug: string,
  versionId: string,
  decision: "APPROVED" | "CHANGES_REQUESTED",
  comment: string,
): Promise<WorkflowResult> {
  const check = await allowed(slug, "timetable.signoff");
  if (!check.access) return { ok: false, error: check.error! };
  const { inst, member, user } = check.access;
  const departmentId = member?.departmentId;
  if (!departmentId) return { ok: false, error: "Your HOD account isn't linked to a department; ask the admin." };
  if (decision !== "APPROVED" && decision !== "CHANGES_REQUESTED") return { ok: false, error: "Approve or ask for changes." };
  const note = String(comment ?? "").trim().slice(0, 1000);
  if (decision === "CHANGES_REQUESTED" && !note) return { ok: false, error: "Say what needs to change." };

  // Read the status and every sign-off under the college's lock, so a change request and the
  // last approval arriving together can't leave it APPROVED with changes outstanding.
  const error = await withLock(workflowKey(inst.id), async (tx) => {
    const version = await tx.timetableVersion.findFirst({ where: { id: versionId, institutionId: inst.id } });
    if (!version || version.status !== "REVIEW") return "This timetable isn't waiting for review.";
    await tx.deptSignoff.upsert({
      where: { versionId_departmentId: { versionId, departmentId } },
      create: { versionId, departmentId, status: decision, comment: note || null, userId: user!.id },
      update: { status: decision, comment: note || null, userId: user!.id, createdAt: new Date() },
    });
    if (decision === "CHANGES_REQUESTED") {
      await tx.timetableVersion.update({ where: { id: versionId }, data: { status: "DRAFT" } });
      return null;
    }
    const [needed, approvals] = await Promise.all([
      reviewingDepartments(inst.id),
      tx.deptSignoff.findMany({ where: { versionId, status: "APPROVED" }, select: { departmentId: true } }),
    ]);
    const approved = new Set(approvals.map((a) => a.departmentId));
    if (needed.every((d) => approved.has(d))) await tx.timetableVersion.update({ where: { id: versionId }, data: { status: "APPROVED" } });
    return null;
  });
  if (error) return { ok: false, error };
  revalidatePath(`/${slug}`, "layout");
  return { ok: true };
}

/** Admin pulls a version back to draft (e.g. to make more changes). */
export async function returnToDraft(slug: string, versionId: string): Promise<WorkflowResult> {
  const check = await allowed(slug, "timetable.submit");
  if (!check.access) return { ok: false, error: check.error! };
  const institutionId = check.access.inst.id;
  const moved = await withLock(workflowKey(institutionId), (tx) =>
    tx.timetableVersion.updateMany({ where: { id: versionId, institutionId, status: { in: ["REVIEW", "APPROVED"] } }, data: { status: "DRAFT" } }),
  );
  if (!moved.count) return { ok: false, error: "Only timetables in review or approved can go back to draft." };
  revalidatePath(`/${slug}`, "layout");
  return { ok: true };
}

export async function publish(slug: string, versionId: string): Promise<WorkflowResult> {
  const check = await allowed(slug, "timetable.publish");
  if (!check.access) return { ok: false, error: check.error! };
  const { inst, user } = check.access;
  // One status change per college at a time, so two publishes can't both win.
  const error = await withLock(workflowKey(inst.id), async (tx) => {
    const version = await tx.timetableVersion.findFirst({ where: { id: versionId, institutionId: inst.id } });
    if (!version) return "This timetable no longer exists.";
    if (version.status !== "APPROVED") return "Only approved timetables can be published.";
    await tx.timetableVersion.updateMany({ where: { institutionId: inst.id, status: "PUBLISHED" }, data: { status: "ARCHIVED" } });
    await tx.timetableVersion.update({ where: { id: versionId }, data: { status: "PUBLISHED", publishedAt: new Date(), publishedBy: user!.id } });
    return null;
  });
  if (error) return { ok: false, error };
  // A new timetable can take away free periods students had booked.
  await sweepAppointments(inst.id, slug);
  revalidatePath(`/${slug}`, "layout");
  return { ok: true };
}
