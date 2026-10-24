"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getInstitution } from "@/lib/inst";
import { isReadOnly } from "@/lib/setup/load";
import { buildProblem, score, validate } from "@/lib/solver";
import type { Assignment, InstituteInput } from "@/lib/solver";

export type EditResult = { ok: true; quality: number } | { ok: false; error: string };

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
  const inst = await getInstitution(slug);
  if (isReadOnly(inst)) return { ok: false, error: "The shared demo is read-only. Make your own copy to edit timetables." };
  const version = await prisma.timetableVersion.findFirst({ where: { id: versionId, institutionId: inst.id } });
  if (!version) return { ok: false, error: "This timetable no longer exists." };
  if (version.status !== "DRAFT") return { ok: false, error: "Only drafts can be edited. Duplicate it as a new draft first." };

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
 * `view` is null). Re-sharing the same thing returns the existing link.
 */
export async function createShareLink(
  slug: string,
  versionId: string,
  view: string | null,
  entityId: string | null,
): Promise<ShareResult> {
  const inst = await getInstitution(slug);
  const version = await prisma.timetableVersion.findFirst({ where: { id: versionId, institutionId: inst.id } });
  if (!version) return { ok: false, error: "This timetable no longer exists." };
  if (view !== null && (!SHARE_VIEWS.has(view) || !entityId)) return { ok: false, error: "Pick what to share." };
  const where = { institutionId: inst.id, versionId, view, entityId: view ? entityId : null };
  const existing = await prisma.shareLink.findFirst({ where });
  if (existing) return { ok: true, token: existing.token };
  const link = await prisma.shareLink.create({ data: { ...where, token: newToken() } });
  return { ok: true, token: link.token };
}

/** Stop a share link from working. */
export async function revokeShareLink(slug: string, token: string): Promise<{ ok: boolean }> {
  const inst = await getInstitution(slug);
  const res = await prisma.shareLink.deleteMany({ where: { token, institutionId: inst.id } });
  return { ok: res.count > 0 };
}
