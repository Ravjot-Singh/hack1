import type { RuleSettings } from "@/lib/solver/types";

export interface BellInput {
  /** "09:00" */
  start: string;
  periodMinutes: number;
  /** Number of periods per day, including the lunch period. */
  periods: number;
  /** Short break after this period (1-based), 0 = none. */
  breakAfter: number;
  breakMinutes: number;
  /** Period (1-based) used for lunch, 0 = none. Lunch is a closed period in the time grid. */
  lunchPeriod: number;
}

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + (m || 0);
};
const toHHMM = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

/** Build the shared bell schedule from a few simple answers. */
export function buildPeriods(b: BellInput): { start: string; end: string }[] {
  const out: { start: string; end: string }[] = [];
  let t = toMin(b.start);
  for (let i = 1; i <= b.periods; i++) {
    out.push({ start: toHHMM(t), end: toHHMM(t + b.periodMinutes) });
    t += b.periodMinutes;
    if (i === b.breakAfter) t += b.breakMinutes;
  }
  return out;
}

/** Default grid: everything open except lunch; optional half-day on the last working day if it's Saturday. */
export function defaultGrid(days: string[], periods: number, lunchPeriod: number, halfSaturday: boolean): boolean[][] {
  return days.map((day) =>
    Array.from({ length: periods }, (_, p) => {
      if (halfSaturday && /^sat/i.test(day)) return lunchPeriod ? p < lunchPeriod - 1 : p < Math.ceil(periods / 2);
      return p !== lunchPeriod - 1;
    }),
  );
}

export const DEFAULT_RULES: RuleSettings = {
  maxConsecutiveSection: 4,
  maxConsecutiveTeacher: 3,
  travelTimeHard: true,
  roomUtilizationMode: "compact",
  weights: { teacherPrefs: 2, balancedDays: 2, idleGaps: 2, subjectSpread: 3, roomUtilization: 1 },
};

export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 30) || "college"
  );
}
