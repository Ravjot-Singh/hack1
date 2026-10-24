// Maps real dates to the weekly timetable. Pure; dates are "YYYY-MM-DD" strings (no time zones).

export type CalendarKind = "HOLIDAY" | "EXAM" | "FOLLOWS";

export interface SpecialDay {
  date: string;
  kind: CalendarKind;
  label: string;
  followsDay: number | null;
}

export interface CalendarInfo {
  /** The institute's working days, e.g. ["Mon", ..., "Sat"]. */
  days: string[];
  termStart: string | null;
  termEnd: string | null;
  specials: SpecialDay[];
}

export type DayPlan =
  | { kind: "classes"; dayIndex: number; note: string | null }
  | { kind: "off"; reason: string };

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function weekdayOf(date: string): string {
  return WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()];
}

export function todayIso(now = new Date()): string {
  // Local calendar date, not UTC (a 1 a.m. visit in India is still "today").
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function addDays(date: string, n: number): string {
  const t = new Date(`${date}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

/** Which timetable day (if any) runs on `date`. */
export function resolveDay(date: string, cal: CalendarInfo): DayPlan {
  if (cal.termStart && date < cal.termStart) return { kind: "off", reason: "Before the term starts" };
  if (cal.termEnd && date > cal.termEnd) return { kind: "off", reason: "After the term ends" };
  const special = cal.specials.find((s) => s.date === date);
  if (special?.kind === "HOLIDAY") return { kind: "off", reason: `Holiday: ${special.label}` };
  if (special?.kind === "EXAM") return { kind: "off", reason: `Exams: ${special.label}` };
  if (special?.kind === "FOLLOWS" && special.followsDay != null && cal.days[special.followsDay]) {
    return { kind: "classes", dayIndex: special.followsDay, note: `${special.label}: follows ${cal.days[special.followsDay]}'s timetable` };
  }
  const idx = cal.days.findIndex((d) => d.slice(0, 3).toLowerCase() === weekdayOf(date).toLowerCase());
  if (idx < 0) return { kind: "off", reason: `No classes on ${weekdayOf(date)}` };
  return { kind: "classes", dayIndex: idx, note: special?.label ?? null };
}
