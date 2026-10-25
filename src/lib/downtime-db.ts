import { addDays, resolveDay, todayIso } from "@/lib/calendar";
import { toDate } from "@/lib/cover-db";
import { prisma } from "@/lib/db";
import { clashes, downMap, replacementRooms, type Downtime } from "@/lib/downtime";
import type { ImpactContext } from "@/lib/placements-db";
import { classUse, overlaps } from "@/lib/venues";

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Downtime overlapping [from, to] ("YYYY-MM-DD"). */
export async function loadDowntimes(institutionId: string, from: string, to: string = from): Promise<Downtime[]> {
  const rows = await prisma.roomDowntime.findMany({
    where: { institutionId, fromDate: { lte: toDate(to) }, toDate: { gte: toDate(from) } },
    orderBy: { fromDate: "asc" },
  });
  return rows.map((r) => ({ id: r.id, roomId: r.roomId, from: iso(r.fromDate), to: iso(r.toDate), periods: r.periods as number[], reason: r.reason }));
}

/** lessonId -> room it moved to on `date`. */
export async function loadMoves(institutionId: string, versionId: string, date: string): Promise<Map<string, string>> {
  const rows = await prisma.roomMove.findMany({ where: { institutionId, versionId, date: toDate(date) } });
  return new Map(rows.map((r) => [r.lessonId, r.roomId]));
}

export interface DayConflicts {
  date: string;
  /** Classes whose room is out of service and that haven't moved yet, with free rooms that fit. */
  open: (ReturnType<typeof clashes>[number] & { options: { id: string; name: string; capacity: number }[] })[];
  /** Classes already moved: lessonId -> new room id. */
  moved: { lessonId: string; roomId: string }[];
}

/**
 * For each date from `from` for `days` days on which a room is out of service: the classes
 * affected (after the calendar and cancellations) and where they could go instead.
 */
export async function loadConflicts(institutionId: string, ctx: ImpactContext, from = todayIso(), days = 21): Promise<DayConflicts[]> {
  const to = addDays(from, days - 1);
  const [downtimes, moves] = await Promise.all([
    loadDowntimes(institutionId, from, to),
    prisma.roomMove.findMany({ where: { institutionId, versionId: ctx.versionId, date: { gte: toDate(from), lte: toDate(to) } } }),
  ]);
  if (!downtimes.length && !moves.length) return [];
  const [rooms, cancelled, bookings] = await Promise.all([
    prisma.room.findMany({ where: { institutionId } }),
    prisma.cover.findMany({ where: { institutionId, versionId: ctx.versionId, action: "CANCEL", date: { gte: toDate(from), lte: toDate(to) } } }),
    prisma.venueBooking.findMany({ where: { institutionId, status: "APPROVED", date: { gte: toDate(from), lte: toDate(to) } } }),
  ]);
  const P = ctx.snapshot.periods.length;
  const out: DayConflicts[] = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(from, i);
    const down = downMap(downtimes, date, P);
    if (!down.size && !moves.some((m) => iso(m.date) === date)) continue;
    const plan = resolveDay(date, ctx.calendar);
    if (plan.kind !== "classes") continue;
    const dayMoves = new Map(moves.filter((m) => iso(m.date) === date).map((m) => [m.lessonId, m.roomId]));
    const off = new Set(cancelled.filter((c) => iso(c.date) === date).map((c) => c.lessonId));
    const use = classUse(ctx.problem, ctx.assignment, plan.dayIndex, off, dayMoves);
    const booked = bookings.filter((b) => iso(b.date) === date);
    const busy = (roomId: string, p: number) =>
      !!use.get(roomId)?.has(p) || !!down.get(roomId)?.has(p) || booked.some((b) => b.roomId === roomId && overlaps({ start: b.startPeriod, end: b.endPeriod }, { start: p, end: p }));
    const open = clashes(ctx.problem, ctx.assignment, plan.dayIndex, down, { cancelled: off, moves: dayMoves }).map((c) => ({ ...c, options: replacementRooms(c, rooms, busy) }));
    const moved = [...dayMoves].filter(([lessonId]) => ctx.assignment[lessonId]?.day === plan.dayIndex).map(([lessonId, roomId]) => ({ lessonId, roomId }));
    if (open.length || moved.length) out.push({ date, open, moved });
  }
  return out;
}

/** For the Today view: per date, classes moved out of (or still stuck in) rooms out of service. */
export async function loadRoomNotes(institutionId: string, ctx: ImpactContext) {
  const out: Record<string, { lessonId: string; roomId: string | null; reason: string }[]> = {};
  for (const d of await loadConflicts(institutionId, ctx, addDays(todayIso(), -7), 67)) {
    out[d.date] = [...d.open.map((c) => ({ lessonId: c.lessonId, roomId: null, reason: c.reason })), ...d.moved.map((x) => ({ lessonId: x.lessonId, roomId: x.roomId, reason: "" }))];
  }
  return out;
}
