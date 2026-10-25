import { resolveDay } from "@/lib/calendar";
import { loadCalendar } from "@/lib/calendar-db";
import { prisma } from "@/lib/db";
import { classesHit, type Attendance, type ClassHit } from "@/lib/placements";
import { buildProblem } from "@/lib/solver/lessons";
import type { Assignment, InstituteInput, Problem } from "@/lib/solver/types";

const iso = (d: Date) => d.toISOString().slice(0, 10);

export interface ImpactContext {
  versionId: string;
  snapshot: InstituteInput;
  problem: Problem;
  assignment: Assignment;
  calendar: Awaited<ReturnType<typeof loadCalendar>>;
}

export async function loadImpactContext(institutionId: string): Promise<ImpactContext | null> {
  const version = await prisma.timetableVersion.findFirst({
    where: { institutionId, status: "PUBLISHED" },
    include: { placements: true },
    orderBy: { publishedAt: "desc" },
  });
  if (!version) return null;
  const snapshot = version.snapshot as unknown as InstituteInput;
  const assignment: Assignment = {};
  for (const p of version.placements) assignment[p.lessonId] = { day: p.day, period: p.period, roomId: p.roomId };
  return { versionId: version.id, snapshot, problem: buildProblem(snapshot), assignment, calendar: await loadCalendar(institutionId) };
}

export interface RoundLike {
  id: string;
  date: Date;
  startPeriod: number;
  endPeriod: number;
}

/** Classes each round takes students from (after the calendar and cancelled classes). */
export async function roundHits(institutionId: string, ctx: ImpactContext, rounds: (RoundLike & { attending: Attendance[] })[]): Promise<Map<string, ClassHit[]>> {
  const dates = [...new Set(rounds.map((r) => iso(r.date)))];
  const cancelled = await prisma.cover.findMany({
    where: { institutionId, versionId: ctx.versionId, action: "CANCEL", date: { in: dates.map((d) => new Date(`${d}T00:00:00Z`)) } },
    select: { date: true, lessonId: true },
  });
  const out = new Map<string, ClassHit[]>();
  for (const r of rounds) {
    const date = iso(r.date);
    const plan = resolveDay(date, ctx.calendar);
    if (plan.kind !== "classes") {
      out.set(r.id, []);
      continue;
    }
    const off = new Set(cancelled.filter((c) => iso(c.date) === date).map((c) => c.lessonId));
    out.set(r.id, classesHit(ctx.problem, ctx.assignment, plan.dayIndex, r.startPeriod, r.endPeriod, r.attending, off));
  }
  return out;
}

/** For the Today view: per date, classes that lose students to a drive round. */
export async function loadDriveAway(institutionId: string, ctx: ImpactContext) {
  const rounds = await prisma.placementRound.findMany({
    where: { drive: { institutionId }, date: { gte: new Date(Date.now() - 31 * 86400_000), lte: new Date(Date.now() + 92 * 86400_000) } },
    include: { drive: { select: { company: true, attending: true } } },
  });
  const hits = await roundHits(institutionId, ctx, rounds.map((r) => ({ ...r, attending: r.drive.attending as unknown as Attendance[] })));
  const out: Record<string, { lessonId: string; away: number; size: number; company: string }[]> = {};
  for (const r of rounds) {
    for (const h of hits.get(r.id) ?? []) (out[iso(r.date)] ??= []).push({ lessonId: h.lessonId, away: h.away, size: h.size, company: r.drive.company });
  }
  return out;
}
