import { prisma } from "@/lib/db";
import { resolveDay } from "@/lib/calendar";
import { loadCalendar } from "@/lib/calendar-db";
import type { DayContext } from "@/lib/cover";
import { buildProblem } from "@/lib/solver/lessons";
import type { Assignment, InstituteInput } from "@/lib/solver/types";

export const toDate = (iso: string) => new Date(`${iso}T00:00:00Z`);

/** Everything needed to arrange cover on one date, based on the published timetable. */
export async function loadDay(institutionId: string, date: string) {
  const version = await prisma.timetableVersion.findFirst({
    where: { institutionId, status: "PUBLISHED" },
    include: { placements: true },
    orderBy: { publishedAt: "desc" },
  });
  if (!version) return { kind: "unpublished" as const };
  const calendar = await loadCalendar(institutionId);
  const plan = resolveDay(date, calendar);
  const snapshot = version.snapshot as unknown as InstituteInput;
  const problem = buildProblem(snapshot);
  const assignment: Assignment = {};
  for (const p of version.placements) assignment[p.lessonId] = { day: p.day, period: p.period, roomId: p.roomId };

  const monthStart = toDate(`${date.slice(0, 7)}-01`);
  const [absences, covers, monthCovers] = await Promise.all([
    prisma.absence.findMany({ where: { institutionId, date: toDate(date) }, orderBy: { createdAt: "asc" } }),
    prisma.cover.findMany({ where: { institutionId, date: toDate(date), versionId: version.id } }),
    prisma.cover.groupBy({
      by: ["substituteId"],
      where: { institutionId, action: "SUBSTITUTE", date: { gte: monthStart, lte: toDate(date) } },
      _count: true,
    }),
  ]);
  const ctx: DayContext | null =
    plan.kind === "classes"
      ? {
          problem,
          assignment,
          dayIndex: plan.dayIndex,
          absences: absences.map((a) => ({ teacherId: a.teacherId, periods: a.periods as number[] })),
          covers: covers.map((c) => ({ lessonId: c.lessonId, action: c.action, substituteId: c.substituteId })),
          coversThisMonth: Object.fromEntries(monthCovers.filter((c) => c.substituteId).map((c) => [c.substituteId!, c._count])),
        }
      : null;
  return { kind: "ok" as const, version, snapshot, problem, assignment, plan, absences, covers, ctx };
}

/** Substitutions/cancellations from a month ago onwards, keyed by date, for the Today view. */
export async function loadRecentCovers(institutionId: string, versionId: string, snapshot: InstituteInput) {
  const since = new Date(Date.now() - 31 * 86400_000);
  const rows = await prisma.cover.findMany({ where: { institutionId, versionId, date: { gte: since } } });
  const out: Record<string, { lessonId: string; action: "SUBSTITUTE" | "CANCEL"; substituteId: string | null; substituteName: string | null }[]> = {};
  for (const c of rows) {
    (out[c.date.toISOString().slice(0, 10)] ??= []).push({
      lessonId: c.lessonId,
      action: c.action,
      substituteId: c.substituteId,
      substituteName: snapshot.teachers.find((t) => t.id === c.substituteId)?.name ?? null,
    });
  }
  return out;
}
