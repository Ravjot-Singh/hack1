"use server";

import { revalidatePath } from "next/cache";
import { sweepAppointments } from "@/lib/appointments-db";
import { prisma } from "@/lib/db";
import { AccessError, requireAction } from "@/lib/access";
import type { Action } from "@/lib/permissions";
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
  if (view !== null && (!SHARE_VIEWS.has(view) || !entityId)) return { ok: false, error: "Pick what to share." };
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

async function versionFor(institutionId: string, versionId: string) {
  return prisma.timetableVersion.findFirst({ where: { id: versionId, institutionId } });
}

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
  const version = await versionFor(inst.id, versionId);
  if (!version) return { ok: false, error: "This timetable no longer exists." };
  if (version.status !== "DRAFT") return { ok: false, error: "Only drafts can be sent for review." };
  const depts = await reviewingDepartments(inst.id);
  await prisma.$transaction([
    prisma.deptSignoff.deleteMany({ where: { versionId } }),
    prisma.timetableVersion.update({
      where: { id: versionId },
      // With no HODs to ask, it is ready for the Head of Institute straight away.
      data: { status: depts.length ? "REVIEW" : "APPROVED", submittedAt: new Date() },
    }),
  ]);
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
  const version = await versionFor(inst.id, versionId);
  if (!version || version.status !== "REVIEW") return { ok: false, error: "This timetable isn't waiting for review." };
  const note = comment.trim().slice(0, 1000);
  if (decision === "CHANGES_REQUESTED" && !note) return { ok: false, error: "Say what needs to change." };

  await prisma.deptSignoff.upsert({
    where: { versionId_departmentId: { versionId, departmentId } },
    create: { versionId, departmentId, status: decision, comment: note || null, userId: user!.id },
    update: { status: decision, comment: note || null, userId: user!.id, createdAt: new Date() },
  });
  if (decision === "CHANGES_REQUESTED") {
    await prisma.timetableVersion.update({ where: { id: versionId }, data: { status: "DRAFT" } });
  } else {
    const [needed, approvals] = await Promise.all([
      reviewingDepartments(inst.id),
      prisma.deptSignoff.findMany({ where: { versionId, status: "APPROVED" }, select: { departmentId: true } }),
    ]);
    const approved = new Set(approvals.map((a) => a.departmentId));
    if (needed.every((d) => approved.has(d))) {
      await prisma.timetableVersion.update({ where: { id: versionId }, data: { status: "APPROVED" } });
    }
  }
  revalidatePath(`/${slug}`, "layout");
  return { ok: true };
}

/** Admin pulls a version back to draft (e.g. to make more changes). */
export async function returnToDraft(slug: string, versionId: string): Promise<WorkflowResult> {
  const check = await allowed(slug, "timetable.submit");
  if (!check.access) return { ok: false, error: check.error! };
  const version = await versionFor(check.access.inst.id, versionId);
  if (!version || (version.status !== "REVIEW" && version.status !== "APPROVED")) {
    return { ok: false, error: "Only timetables in review or approved can go back to draft." };
  }
  await prisma.timetableVersion.update({ where: { id: versionId }, data: { status: "DRAFT" } });
  revalidatePath(`/${slug}`, "layout");
  return { ok: true };
}

export async function publish(slug: string, versionId: string): Promise<WorkflowResult> {
  const check = await allowed(slug, "timetable.publish");
  if (!check.access) return { ok: false, error: check.error! };
  const { inst, user } = check.access;
  const version = await versionFor(inst.id, versionId);
  if (!version) return { ok: false, error: "This timetable no longer exists." };
  if (version.status !== "APPROVED") return { ok: false, error: "Only approved timetables can be published." };
  await prisma.$transaction([
    prisma.timetableVersion.updateMany({ where: { institutionId: inst.id, status: "PUBLISHED" }, data: { status: "ARCHIVED" } }),
    prisma.timetableVersion.update({
      where: { id: versionId },
      data: { status: "PUBLISHED", publishedAt: new Date(), publishedBy: user!.id },
    }),
  ]);
  // A new timetable can take away free periods students had booked.
  await sweepAppointments(inst.id, slug);
  revalidatePath(`/${slug}`, "layout");
  return { ok: true };
}
