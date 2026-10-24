// Plain-English rules: the structured "draft" both the built-in parser and the AI fallback
// produce, and the code that turns it into a solver CustomRule plus the summary the admin
// confirms. Pure: no DB, no network.

import type { CustomRule, InstituteInput, LessonKind } from "@/lib/solver/types";

export type RuleContext = Pick<InstituteInput, "days" | "periods" | "grids" | "teachers" | "sections" | "subjects" | "departments">;

export interface SlotDraft {
  kind: "slots";
  strength: "hard" | "soft";
  /** true: the lessons may only be in the described time ("only mornings"). */
  only: boolean;
  target: CustomRule["target"];
  /** Day indexes; empty = every day. */
  days: number[];
  /** Period indexes (0-based); empty = the whole day. */
  periods: number[];
}

export interface LimitDraft {
  kind: "limit";
  who: "students" | "teachers";
  max: number;
}

export type RuleDraft = SlotDraft | LimitDraft;

export const emptyTarget = (): CustomRule["target"] => ({ teacherIds: [], sectionIds: [], years: [], kinds: [], subjectIds: [] });

/** The period most often closed between open periods (the lunch break), or null. */
export function lunchPeriod(ctx: RuleContext): number | null {
  const P = ctx.periods.length;
  const votes = new Array(P).fill(0);
  for (const g of ctx.grids) {
    for (const day of g.open) {
      for (let p = 1; p < P - 1; p++) if (!day[p] && day.slice(0, p).some(Boolean) && day.slice(p + 1).some(Boolean)) votes[p]++;
    }
  }
  const best = votes.reduce((b, v, p) => (v > votes[b] ? p : b), 0);
  return votes[best] > 0 ? best : null;
}

/** Periods before / after lunch. Without a lunch break, noon splits the day. */
export function halves(ctx: RuleContext): { morning: number[]; afternoon: number[] } {
  const lunch = lunchPeriod(ctx);
  const idx = ctx.periods.map((_, p) => p);
  if (lunch != null) return { morning: idx.filter((p) => p < lunch), afternoon: idx.filter((p) => p > lunch) };
  return { morning: idx.filter((p) => ctx.periods[p].start < "12:00"), afternoon: idx.filter((p) => ctx.periods[p].start >= "12:00") };
}

/** Turn a slot draft into the solver rule (slots computed, summary generated). */
export function toCustomRule(d: SlotDraft, text: string, ctx: RuleContext, id: string): CustomRule {
  const D = ctx.days.length;
  const P = ctx.periods.length;
  const days = d.days.length ? d.days : [...Array(D).keys()];
  const periods = d.periods.length ? d.periods : [...Array(P).keys()];
  const inside = new Set(days.flatMap((day) => periods.map((p) => day * P + p)));
  const slots: [number, number][] = [];
  for (let s = 0; s < D * P; s++) if (inside.has(s) !== d.only) slots.push([Math.floor(s / P), s % P]);
  return { id, text, summary: describe(d, ctx), strength: d.strength, target: d.target, slots };
}

const KIND_WORD: Record<LessonKind, string> = { L: "lectures", T: "tutorials", P: "labs", H: "classes" };

function list(xs: string[]): string {
  return xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} or ${xs[xs.length - 1]}`;
}

/** Runs of consecutive numbers as "A–B" labels. */
function runs(xs: number[], label: (i: number) => string): string[] {
  const sorted = [...new Set(xs)].sort((a, b) => a - b);
  const out: string[] = [];
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    out.push(j - i >= 2 ? `${label(sorted[i])}–${label(sorted[j])}` : sorted.slice(i, j + 1).map(label).join(", "));
    i = j + 1;
  }
  return out;
}

/** "What": which classes the rule is about. */
export function describeTarget(t: CustomRule["target"], ctx: RuleContext): string {
  const kinds = t.kinds.filter((k) => k !== "H");
  let what = kinds.length && kinds.length < 3 ? list(kinds.map((k) => KIND_WORD[k])) : "classes";
  const subjects = t.subjectIds.map((id) => ctx.subjects.find((s) => s.id === id)?.code ?? "?");
  if (subjects.length) what = `${list(subjects)} ${what}`;
  const who = [
    ...t.teacherIds.map((id) => `taught by ${ctx.teachers.find((x) => x.id === id)?.name ?? "?"}`),
    ...t.sectionIds.map((id) => `for ${ctx.sections.find((x) => x.id === id)?.name ?? "?"}`),
    ...t.years.map((y) => `for year ${y}`),
  ];
  const s = who.length ? `${what} ${list(who)}` : `${t.kinds.length || subjects.length ? "" : "all "}${what}`;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** "When": e.g. "on Mon–Wed in P1–P4 (09:00–12:30)" or "on Sat" or "in P6–P8 (13:20–15:50)". */
export function describeWhen(days: number[], periods: number[], ctx: RuleContext): string {
  const P = ctx.periods.length;
  const parts: string[] = [];
  if (days.length && days.length < ctx.days.length) parts.push(`on ${runs(days, (d) => ctx.days[d]).join(", ")}`);
  if (periods.length && periods.length < P) {
    const sorted = [...periods].sort((a, b) => a - b);
    const contiguous = sorted.every((p, i) => i === 0 || p === sorted[i - 1] + 1);
    const time = contiguous ? ` (${ctx.periods[sorted[0]].start}–${ctx.periods[sorted[sorted.length - 1]].end})` : "";
    parts.push(`in ${runs(sorted, (p) => `P${p + 1}`).join(", ")}${time}`);
  }
  return parts.join(" ") || "at any time";
}

export function describe(d: RuleDraft, ctx: RuleContext): string {
  if (d.kind === "limit") return `At most ${d.max} periods in a row for ${d.who}`;
  const verb = d.strength === "hard" ? (d.only ? "only" : "never") : d.only ? "preferably only" : "avoid";
  return `${describeTarget(d.target, ctx)}: ${verb} ${describeWhen(d.days, d.periods, ctx)}`;
}
