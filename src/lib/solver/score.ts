import { customRuleSlots } from "./custom-rules";
import type { Assignment, Problem, ScoreBreakdown, SoftWeights } from "./types";

/** Weight of one period in an "avoid" custom-rule slot, on the same scale as a High soft goal. */
const CUSTOM_AVOID_WEIGHT = 3;

/**
 * Soft-goal penalties for a (complete or partial) timetable. Raw counts per goal, then a
 * single 0-100 quality number weighted by the institute's soft-goal settings.
 */
export function score(problem: Problem, assignment: Assignment): ScoreBreakdown {
  const { input, lessons } = problem;
  const D = input.days.length;
  const P = input.periods.length;
  const w = input.rules.weights;
  const penalties: Record<keyof SoftWeights, number> = {
    teacherPrefs: 0,
    balancedDays: 0,
    idleGaps: 0,
    subjectSpread: 0,
    roomUtilization: 0,
  };

  const atomLine = new Map<string, number[][]>(); // atom -> [day][period] = count
  const teacherDay = new Map<string, number[]>();
  const spread = new Map<string, number>();
  const roomUse = new Map<string, number>();
  const prefs = new Map(input.teachers.map((t) => [t.id, t.prefs]));

  for (const l of lessons) {
    const a = assignment[l.id];
    if (!a) continue;
    roomUse.set(a.roomId, (roomUse.get(a.roomId) ?? 0) + l.duration);
    const sk = `${l.offeringId}|${l.kind === "P" ? (l.batchId ?? "all") : "theory"}|${a.day}`;
    spread.set(sk, (spread.get(sk) ?? 0) + 1);
    for (const atom of l.atoms) {
      let line = atomLine.get(atom);
      if (!line) atomLine.set(atom, (line = Array.from({ length: D }, () => new Array(P).fill(0))));
      for (let k = 0; k < l.duration; k++) line[a.day][a.period + k] = 1;
    }
    for (const tid of l.teacherIds) {
      const days = teacherDay.get(tid) ?? new Array(D).fill(0);
      days[a.day] += l.duration;
      teacherDay.set(tid, days);
      for (let k = 0; k < l.duration; k++) {
        const pref = prefs.get(tid)?.find((x) => x.day === a.day && x.period === a.period + k);
        if (pref?.value === "AVOID") penalties.teacherPrefs += 1;
      }
    }
  }

  for (const n of spread.values()) if (n > 1) penalties.subjectSpread += n - 1;

  const stdev = (xs: number[]) => {
    const used = xs.filter((x) => x > 0);
    if (used.length < 2) return 0;
    const mean = used.reduce((s, x) => s + x, 0) / used.length;
    return Math.sqrt(used.reduce((s, x) => s + (x - mean) ** 2, 0) / used.length);
  };
  for (const line of atomLine.values()) {
    penalties.balancedDays += stdev(line.map((day) => day.reduce((s, x) => s + x, 0)));
    for (const day of line) {
      const first = day.indexOf(1);
      const last = day.lastIndexOf(1);
      if (first < 0) continue;
      for (let p = first; p <= last; p++) if (!day[p]) penalties.idleGaps++;
    }
  }
  for (const days of teacherDay.values()) penalties.balancedDays += 0.5 * stdev(days);

  // Room utilization: "compact" penalises rooms used only a little; "spread" penalises uneven use.
  const uses = [...roomUse.values()];
  if (uses.length) {
    penalties.roomUtilization =
      input.rules.roomUtilizationMode === "compact" ? uses.filter((x) => x < 8).length : stdev(uses) / 2;
  }

  for (const k of Object.keys(penalties) as (keyof SoftWeights)[]) penalties[k] = Math.round(penalties[k] * 10) / 10;
  let weighted = (Object.keys(penalties) as (keyof SoftWeights)[]).reduce((s, k) => s + penalties[k] * w[k], 0);

  const soft = (input.rules.custom ?? []).some((r) => r.strength === "soft");
  const out: ScoreBreakdown["penalties"] = penalties;
  if (soft) {
    const rs = customRuleSlots(problem);
    let hits = 0;
    for (const l of lessons) {
      const a = assignment[l.id];
      const avoid = a && rs.get(l.id)?.avoid;
      if (!avoid) continue;
      for (let k = 0; k < l.duration; k++) hits += avoid.get(a.day * P + a.period + k) ?? 0;
    }
    out.customRules = hits;
    weighted += hits * CUSTOM_AVOID_WEIGHT;
  }
  // Normalised per student-group-day: ~2 weighted penalty points per group per day halves the score.
  const groupDays = Math.max(1, atomLine.size * D);
  const quality = Math.round(100 / (1 + weighted / (groupDays * 2)));
  return { quality, penalties: out };
}
