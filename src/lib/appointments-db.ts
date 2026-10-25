import { addDays, resolveDay, todayIso, type DayPlan } from "@/lib/calendar";
import { loadCalendar } from "@/lib/calendar-db";
import { toDate } from "@/lib/cover-db";
import { prisma } from "@/lib/db";
import { buildProblem } from "@/lib/solver/lessons";
import type { Assignment, InstituteInput, Problem } from "@/lib/solver/types";
import { busyPeriods, slotProblem, subSlots, type BookedSlot, type DateInfo, type OfficeHoursConfig } from "@/lib/appointments";
import type { AbsenceInfo, CoverInfo } from "@/lib/cover";

const iso = (d: Date) => d.toISOString().slice(0, 10);

export interface AppointmentWorld {
  snapshot: InstituteInput;
  problem: Problem;
  assignment: Assignment;
  dates: { date: string; plan: DayPlan }[];
  duties: Map<string, { absences: AbsenceInfo[]; covers: CoverInfo[] }>;
}

/** Published timetable, calendar and leave/cover for `count` days from `from`. Null if nothing is published. */
export async function loadWorld(institutionId: string, from: string, count: number): Promise<AppointmentWorld | null> {
  const version = await prisma.timetableVersion.findFirst({
    where: { institutionId, status: "PUBLISHED" },
    include: { placements: true },
    orderBy: { publishedAt: "desc" },
  });
  if (!version) return null;
  const to = addDays(from, count - 1);
  const [calendar, absences, covers] = await Promise.all([
    loadCalendar(institutionId),
    prisma.absence.findMany({ where: { institutionId, date: { gte: toDate(from), lte: toDate(to) } } }),
    prisma.cover.findMany({ where: { institutionId, versionId: version.id, date: { gte: toDate(from), lte: toDate(to) } } }),
  ]);
  const snapshot = version.snapshot as unknown as InstituteInput;
  const assignment: Assignment = {};
  for (const p of version.placements) assignment[p.lessonId] = { day: p.day, period: p.period, roomId: p.roomId };
  const dates = Array.from({ length: count }, (_, i) => addDays(from, i)).map((date) => ({ date, plan: resolveDay(date, calendar) }));
  const duties = new Map<string, { absences: AbsenceInfo[]; covers: CoverInfo[] }>();
  for (const { date } of dates) duties.set(date, { absences: [], covers: [] });
  for (const a of absences) duties.get(iso(a.date))?.absences.push({ teacherId: a.teacherId, periods: a.periods as number[] });
  for (const c of covers) duties.get(iso(c.date))?.covers.push({ lessonId: c.lessonId, action: c.action, substituteId: c.substituteId });
  return { snapshot, problem: buildProblem(snapshot), assignment, dates, duties };
}

/** The teacher's free/busy picture for each date in the world. */
export function dateInfos(world: AppointmentWorld, teacherId: string): DateInfo[] {
  const P = world.snapshot.periods.length;
  return world.dates.map(({ date, plan }) => ({
    date,
    plan,
    busy:
      plan.kind === "classes"
        ? busyPeriods(world.problem, world.assignment, { dayIndex: plan.dayIndex, ...world.duties.get(date)! }, teacherId, P)
        : new Set<number>(),
  }));
}

export const toConfig = (o: { teacherId: string; slots: unknown; slotMinutes: number; perStudentWeek: number; location: string }): OfficeHoursConfig => ({
  teacherId: o.teacherId,
  slots: o.slots as [number, number][],
  slotMinutes: o.slotMinutes,
  perStudentWeek: o.perStudentWeek,
  location: o.location,
});

export const toBooked = (a: { id: string; teacherId: string; studentId: string; date: Date; period: number; offset: number }): BookedSlot => ({
  id: a.id,
  teacherId: a.teacherId,
  studentId: a.studentId,
  date: iso(a.date),
  period: a.period,
  offset: a.offset,
});

/** How far ahead students can book, in days. */
export const BOOKING_WINDOW = 14;

/**
 * Flag upcoming appointments whose slot stopped being free (new timetable, leave, cover duty,
 * changed office hours) and tell the student and the teacher. Run after anything that changes those.
 */
export async function sweepAppointments(institutionId: string, slug: string): Promise<number> {
  const from = todayIso();
  const rows = await prisma.appointment.findMany({ where: { institutionId, status: "BOOKED", date: { gte: toDate(from) } } });
  if (!rows.length) return 0;
  const last = rows.reduce((m, r) => (iso(r.date) > m ? iso(r.date) : m), from);
  const count = Math.round((toDate(last).getTime() - toDate(from).getTime()) / 86400_000) + 1;
  const [world, configs] = await Promise.all([
    loadWorld(institutionId, from, count),
    prisma.officeHours.findMany({ where: { institutionId, teacherId: { in: [...new Set(rows.map((r) => r.teacherId))] } } }),
  ]);
  const teacherUsers = await prisma.membership.findMany({ where: { institutionId, teacherId: { in: rows.map((r) => r.teacherId) } }, select: { userId: true, teacherId: true } });
  let flagged = 0;
  for (const r of rows) {
    const cfg = configs.find((c) => c.teacherId === r.teacherId);
    const info = world && dateInfos(world, r.teacherId).find((d) => d.date === iso(r.date));
    // The booking keeps its own length; only "is the teacher still free in office hours" matters.
    let reason = !world
      ? "No timetable is published."
      : !cfg || !info
        ? "The teacher no longer offers office hours."
        : slotProblem({ date: iso(r.date), period: r.period, offset: 0 }, { ...toConfig(cfg), slotMinutes: r.minutes }, info, world.snapshot.periods, []);
    if (!reason) continue;
    flagged++;
    // Say which duty took the slot when we can tell.
    const duty = world?.duties.get(iso(r.date));
    const plan = world?.dates.find((d) => d.date === iso(r.date))?.plan;
    if (duty && plan?.kind === "classes" && info?.busy.has(r.period)) {
      const absent = duty.absences.find((a) => a.teacherId === r.teacherId && (!a.periods.length || a.periods.includes(r.period)));
      const covering = duty.covers.some(
        (c) => c.action === "SUBSTITUTE" && c.substituteId === r.teacherId && world!.assignment[c.lessonId]?.day === plan.dayIndex &&
          r.period >= world!.assignment[c.lessonId].period && r.period < world!.assignment[c.lessonId].period + (world!.problem.lessons.find((l) => l.id === c.lessonId)?.duration ?? 1),
      );
      reason = absent ? "The teacher is on leave then." : covering ? "The teacher has to cover a class then." : "The teacher now has a class then.";
    }
    await prisma.appointment.update({ where: { id: r.id }, data: { status: "INVALID", note: reason } });
    const p = world?.snapshot.periods[r.period];
    const start = p ? subSlots(p, r.minutes).find((s) => s.offset === r.offset)?.start ?? p.start : `P${r.period + 1}`;
    const teacherName = world?.snapshot.teachers.find((t) => t.id === r.teacherId)?.name ?? "your teacher";
    const when = `${iso(r.date)} at ${start}`;
    const link = `/${slug}/appointments`;
    await prisma.notification.createMany({
      data: [
        { institutionId, userId: r.studentId, link, text: `Your appointment with ${teacherName} on ${when} can't go ahead: ${reason} Please book another slot.` },
        ...teacherUsers.filter((m) => m.teacherId === r.teacherId).map((m) => ({ institutionId, userId: m.userId, link, text: `An appointment on ${when} ("${r.topic}") was called off: ${reason}` })),
      ],
    });
  }
  return flagged;
}
