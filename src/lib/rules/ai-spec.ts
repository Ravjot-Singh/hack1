// What the AI fallback is asked to return, the prompt that asks for it, and the code that
// turns its names into ids. The model never sees or returns ids: everything it says is
// checked against the college's own lists here, and anything unknown is refused.

import { z } from "zod";
import type { LessonKind } from "@/lib/solver/types";
import { emptyTarget, halves, type RuleContext, type RuleDraft } from "./draft";

export const aiRuleSchema = z.strictObject({
  understood: z.boolean().describe("false if the sentence is not a timetable rule this format can express"),
  problem: z.string().describe("when understood is false: one short sentence saying why; otherwise empty"),
  kind: z.enum(["slots", "limit"]),
  strength: z.enum(["hard", "soft"]).describe("hard = must never happen; soft = avoid if possible"),
  only: z.boolean().describe("true when the listed times are the ONLY allowed times"),
  teachers: z.array(z.string()).describe("exact teacher names from the list"),
  sections: z.array(z.string()).describe("exact section names from the list"),
  years: z.array(z.number()).describe("year numbers, e.g. 2 for second years"),
  lessonKinds: z.array(z.enum(["lecture", "tutorial", "lab"])).describe("empty = all kinds"),
  subjects: z.array(z.string()).describe("exact subject codes from the list"),
  days: z.array(z.string()).describe("exact day names from the list; empty = every day"),
  periods: z.array(z.number()).describe("period numbers (1-based); empty = the whole day"),
  limitWho: z.enum(["students", "teachers", "none"]).describe("for kind=limit"),
  limitMax: z.number().describe("for kind=limit: max periods in a row; otherwise 0"),
});
export type AiRule = z.infer<typeof aiRuleSchema>;

export const SYSTEM_PROMPT = `You convert one sentence written by a college timetable administrator into a structured rule.

There are two kinds of rule:
- "slots": some classes must not (or should preferably not) be held at certain times. Set "only" to true when the sentence lists the only times allowed ("Dr. X only teaches mornings") and false when it lists forbidden times ("no labs on Monday").
- "limit": the maximum number of periods in a row for students or for teachers.

Who the rule is about: teachers, sections, years, kinds of class and subjects. Leave all of them empty when it applies to every class. Use only names that appear in the lists you are given, spelled exactly as listed. Convert clock times and words like "morning" or "after lunch" into period numbers using the bell schedule: "before 11" means periods that end by 11:00, "after 3 pm" means periods that start at or after 15:00, and times without am/pm between 1 and 7 are in the afternoon.

Set "understood" to false, with a short reason in "problem", if the sentence needs something these fields cannot express (exceptions, different times for different days, rooms, events), mentions a person, section or subject not in the lists, or is not a timetable rule. Never guess a name.`;

/** The college-specific part of the prompt: names and the bell schedule. */
export function contextPrompt(ctx: RuleContext): string {
  const { morning, afternoon } = halves(ctx);
  const p = (xs: number[]) => (xs.length ? `P${xs[0] + 1}–P${xs[xs.length - 1] + 1}` : "none");
  return [
    `Days: ${ctx.days.join(", ")}`,
    `Periods: ${ctx.periods.map((x, i) => `P${i + 1} ${x.start}–${x.end}`).join("; ")}`,
    `Morning (before lunch): ${p(morning)}. Afternoon (after lunch): ${p(afternoon)}.`,
    `Teachers: ${ctx.teachers.map((t) => t.name).join("; ")}`,
    `Sections (year): ${ctx.sections.map((s) => `${s.name} (${s.year})`).join("; ")}`,
    `Departments and their sections: ${ctx.departments
      .map((d) => `${d.code} = ${ctx.sections.filter((s) => s.deptId === d.id).map((s) => s.name).join(", ") || "none"}`)
      .join("; ")}`,
    `Subjects: ${ctx.subjects.map((s) => `${s.code} ${s.name}`).join("; ")}`,
  ].join("\n");
}

const norm = (s: string) => s.toLowerCase().replace(/^(?:dr|prof|mr|mrs|ms|miss)\.?\s+/, "").replace(/[^a-z0-9]+/g, "");
const KINDS: Record<AiRule["lessonKinds"][number], LessonKind[]> = { lecture: ["L", "H"], tutorial: ["T"], lab: ["P"] };

/** Check every name the model returned against the college's lists. */
export function resolveAiRule(r: AiRule, ctx: RuleContext): { ok: true; draft: RuleDraft } | { ok: false; reason: string } {
  if (!r.understood) return { ok: false, reason: r.problem || "The AI couldn't turn that into a rule." };
  if (r.kind === "limit") {
    const max = Math.round(r.limitMax);
    if (r.limitWho === "none" || !(max >= 1 && max <= 12)) return { ok: false, reason: "The AI returned an incomplete back-to-back limit." };
    return { ok: true, draft: { kind: "limit", who: r.limitWho, max } };
  }
  const missing: string[] = [];
  const find = <T,>(names: string[], list: T[], key: (x: T) => string[], what: string) =>
    names.flatMap((n) => {
      const hit = list.find((x) => key(x).some((k) => norm(k) === norm(n)));
      if (!hit) missing.push(`${what} "${n}"`);
      return hit ? [hit] : [];
    });
  const target = emptyTarget();
  target.teacherIds = find(r.teachers, ctx.teachers, (t) => [t.name], "teacher").map((t) => t.id);
  target.sectionIds = find(r.sections, ctx.sections, (s) => [s.name], "section").map((s) => s.id);
  target.subjectIds = find(r.subjects, ctx.subjects, (s) => [s.code, s.name], "subject").map((s) => s.id);
  target.years = [...new Set(r.years.map(Math.round))];
  for (const y of target.years) if (!ctx.sections.some((s) => s.year === y)) missing.push(`year ${y}`);
  target.kinds = [...new Set(r.lessonKinds.flatMap((k) => KINDS[k]))];
  const days = find(r.days, ctx.days.map((d, i) => ({ d, i })), (x) => [x.d, x.d.slice(0, 3)], "day").map((x) => x.i);
  const periods = r.periods.map((p) => Math.round(p) - 1);
  const bad = periods.find((p) => p < 0 || p >= ctx.periods.length);
  if (bad !== undefined) missing.push(`period ${bad + 1}`);
  if (missing.length) return { ok: false, reason: `The AI mentioned ${missing.join(", ")}, which isn't in your setup.` };
  if (!days.length && !periods.length) return { ok: false, reason: "The AI couldn't tell which days or periods the rule is about." };
  return {
    ok: true,
    draft: {
      kind: "slots",
      strength: r.strength,
      only: r.only,
      target,
      days: [...new Set(days)].sort((a, b) => a - b),
      periods: [...new Set(periods)].sort((a, b) => a - b),
    },
  };
}

/** Bump when the prompt or schema changes so old cached answers are not reused. */
const PROMPT_VERSION = 2;

/** Cache key: the same sentence typed again is not sent again. */
export const cacheKey = (text: string) => `v${PROMPT_VERSION}:${text.trim().toLowerCase().replace(/\s+/g, " ")}`;
