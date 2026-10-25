import { resolveDay, type DayPlan } from "@/lib/calendar";
import { loadCalendar } from "@/lib/calendar-db";
import { toDate } from "@/lib/cover-db";
import { prisma } from "@/lib/db";
import { buildProblem } from "@/lib/solver/lessons";
import type { Assignment, InstituteInput } from "@/lib/solver/types";
import { downMap } from "@/lib/downtime";
import { loadDowntimes, loadMoves } from "@/lib/downtime-db";
import { classUse, periodRange, type Booking, type Room } from "@/lib/venues";

export const toBooking = (b: { id: string; roomId: string; startPeriod: number; endPeriod: number; priority: Booking["priority"]; status: Booking["status"]; title: string }): Booking => ({
  id: b.id,
  roomId: b.roomId,
  start: b.startPeriod,
  end: b.endPeriod,
  priority: b.priority,
  status: b.status,
  title: b.title,
});

/** Rooms, class use (published timetable after the calendar and cancellations) and bookings on a date. */
export async function loadVenueDay(institutionId: string, date: string) {
  const [inst, rooms, version, calendar, rows, downtimes] = await Promise.all([
    prisma.institution.findUniqueOrThrow({ where: { id: institutionId }, select: { days: true, periods: true } }),
    prisma.room.findMany({ where: { institutionId }, orderBy: [{ isEventVenue: "desc" }, { type: "asc" }, { name: "asc" }] }),
    prisma.timetableVersion.findFirst({ where: { institutionId, status: "PUBLISHED" }, include: { placements: true }, orderBy: { publishedAt: "desc" } }),
    loadCalendar(institutionId),
    prisma.venueBooking.findMany({ where: { institutionId, date: toDate(date) }, orderBy: { createdAt: "asc" } }),
    loadDowntimes(institutionId, date),
  ]);
  const plan: DayPlan = resolveDay(date, calendar);
  let use = new Map<string, Map<number, string>>();
  if (version && plan.kind === "classes") {
    const problem = buildProblem(version.snapshot as unknown as InstituteInput);
    const assignment: Assignment = {};
    for (const p of version.placements) assignment[p.lessonId] = { day: p.day, period: p.period, roomId: p.roomId };
    const cancelled = await prisma.cover.findMany({ where: { institutionId, date: toDate(date), versionId: version.id, action: "CANCEL" }, select: { lessonId: true } });
    use = classUse(problem, assignment, plan.dayIndex, new Set(cancelled.map((c) => c.lessonId)), await loadMoves(institutionId, version.id, date));
  }
  const roomList: (Room & { buildingId: string | null })[] = rooms.map((r) => ({
    id: r.id,
    name: r.name,
    type: r.type,
    capacity: r.capacity,
    ownerDeptId: r.ownerDeptId,
    isEventVenue: r.isEventVenue,
    buildingId: r.buildingId,
  }));
  return {
    days: inst.days as string[],
    periods: inst.periods as { start: string; end: string }[],
    plan,
    published: !!version,
    rooms: roomList,
    use,
    /** Rooms out of service that day. */
    down: downMap(downtimes, date, (inst.periods as unknown[]).length),
    rows,
    bookings: rows.map(toBooking),
  };
}

/** Approved bookings from a month ago to three months ahead, keyed by date, for the Today view. */
export async function loadEvents(institutionId: string, periods: { start: string; end: string }[]) {
  const rows = await prisma.venueBooking.findMany({
    where: { institutionId, status: "APPROVED", date: { gte: new Date(Date.now() - 31 * 86400_000), lte: new Date(Date.now() + 92 * 86400_000) } },
    include: { room: { select: { name: true } } },
    orderBy: { startPeriod: "asc" },
  });
  const out: Record<string, { id: string; title: string; room: string; when: string; attendees: number }[]> = {};
  for (const b of rows) {
    (out[b.date.toISOString().slice(0, 10)] ??= []).push({ id: b.id, title: b.title, room: b.room.name, when: periodRange(b.startPeriod, b.endPeriod, periods), attendees: b.attendees });
  }
  return out;
}
