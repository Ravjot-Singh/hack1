// Teacher office hours and student appointments. Pure: no DB or framework imports.
// Office hours are set on the weekly timetable (day index, period); bookings are on real
// dates, resolved through the academic calendar, so day swaps and holidays apply.

import type { DayPlan } from "./calendar";
import type { AbsenceInfo, CoverInfo } from "./cover";
import type { Assignment, Problem } from "./solver/types";

export const SLOT_LENGTHS = [10, 15, 20] as const;

export interface OfficeHoursConfig {
  teacherId: string;
  /** [dayIndex, period] pairs on the weekly timetable. */
  slots: [number, number][];
  slotMinutes: number;
  /** Bookings one student may hold with this teacher per week. */
  perStudentWeek: number;
  location: string;
}

export interface BookedSlot {
  id?: string;
  teacherId: string;
  studentId: string;
  date: string;
  period: number;
  /** Minutes after the period starts. */
  offset: number;
}

const minutesOf = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};
const hhmm = (mins: number) => `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;

/** A period cut into equal sub-slots (a short remainder at the end is dropped). */
export function subSlots(period: { start: string; end: string }, minutes: number): { offset: number; start: string; end: string }[] {
  const from = minutesOf(period.start);
  const length = minutesOf(period.end) - from;
  const out: { offset: number; start: string; end: string }[] = [];
  for (let off = 0; off + minutes <= length; off += minutes) out.push({ offset: off, start: hhmm(from + off), end: hhmm(from + off + minutes) });
  return out;
}

/** Weekly (day:period) keys where the teacher teaches in the timetable. */
export function teachingSlots(problem: Problem, assignment: Assignment, teacherId: string): Set<string> {
  const out = new Set<string>();
  for (const l of problem.lessons) {
    const a = assignment[l.id];
    if (!a || !l.teacherIds.includes(teacherId)) continue;
    for (let k = 0; k < l.duration; k++) out.add(`${a.day}:${a.period + k}`);
  }
  return out;
}

export interface DayDuties {
  dayIndex: number;
  absences: AbsenceInfo[];
  covers: CoverInfo[];
}

/** Periods the teacher can't meet students on a timetable day: their classes (unless cancelled), cover duties and absence. */
export function busyPeriods(problem: Problem, assignment: Assignment, duty: DayDuties, teacherId: string, periodCount: number): Set<number> {
  const busy = new Set<number>();
  const absence = duty.absences.find((a) => a.teacherId === teacherId);
  if (absence && !absence.periods.length) return new Set(Array.from({ length: periodCount }, (_, p) => p));
  for (const p of absence?.periods ?? []) busy.add(p);
  for (const l of problem.lessons) {
    const a = assignment[l.id];
    if (!a || a.day !== duty.dayIndex) continue;
    const cover = duty.covers.find((c) => c.lessonId === l.id);
    const mine = l.teacherIds.includes(teacherId) && cover?.action !== "CANCEL";
    const covering = cover?.action === "SUBSTITUTE" && cover.substituteId === teacherId;
    if (mine || covering) for (let k = 0; k < l.duration; k++) busy.add(a.period + k);
  }
  return busy;
}

/** Monday of the date's week ("YYYY-MM-DD"). */
export function weekStart(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

export interface DateInfo {
  date: string;
  plan: DayPlan;
  /** Busy periods for this teacher on that date (only when plan.kind === "classes"). */
  busy: Set<number>;
}

/** Why a booking at (date, period, offset) is not possible, or null if it is. */
export function slotProblem(
  slot: { date: string; period: number; offset: number },
  config: OfficeHoursConfig,
  info: DateInfo,
  periods: { start: string; end: string }[],
  booked: BookedSlot[],
  ignoreId?: string,
): string | null {
  if (info.plan.kind !== "classes") return `No classes that day (${info.plan.reason}).`;
  const dayIndex = info.plan.dayIndex;
  if (!config.slots.some(([d, p]) => d === dayIndex && p === slot.period)) return "That isn't one of the teacher's office hours.";
  if (info.busy.has(slot.period)) return "The teacher is busy then (a class, cover duty or leave).";
  const period = periods[slot.period];
  if (!period || !subSlots(period, config.slotMinutes).some((s) => s.offset === slot.offset)) return "That time isn't a valid slot.";
  if (booked.some((b) => b.id !== ignoreId && b.teacherId === config.teacherId && b.date === slot.date && b.period === slot.period && b.offset === slot.offset)) {
    return "Someone has just booked that slot.";
  }
  return null;
}

/** Bookings this student already holds with the teacher in the date's week. */
export function weekCount(booked: BookedSlot[], teacherId: string, studentId: string, date: string, ignoreId?: string): number {
  const week = weekStart(date);
  return booked.filter((b) => b.id !== ignoreId && b.teacherId === teacherId && b.studentId === studentId && weekStart(b.date) === week).length;
}

export interface OpenSlot {
  date: string;
  period: number;
  offset: number;
  start: string;
  end: string;
}

/** Every bookable sub-slot over the given dates. */
export function openSlots(config: OfficeHoursConfig, days: DateInfo[], periods: { start: string; end: string }[], booked: BookedSlot[]): OpenSlot[] {
  const out: OpenSlot[] = [];
  for (const info of days) {
    if (info.plan.kind !== "classes") continue;
    const dayIndex = info.plan.dayIndex;
    const ps = config.slots.filter(([d]) => d === dayIndex).map(([, p]) => p).sort((a, b) => a - b);
    for (const p of ps) {
      if (info.busy.has(p) || !periods[p]) continue;
      for (const s of subSlots(periods[p], config.slotMinutes)) {
        const slot = { date: info.date, period: p, offset: s.offset };
        if (!slotProblem(slot, config, info, periods, booked)) out.push({ ...slot, start: s.start, end: s.end });
      }
    }
  }
  return out;
}
