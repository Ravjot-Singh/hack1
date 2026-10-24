import type { CustomRule, Lesson, Problem } from "./types";

/** Does a custom rule apply to this lesson? */
export function ruleMatches(rule: CustomRule, lesson: Lesson, sectionYear: Map<string, number>): boolean {
  const t = rule.target;
  const anyWho = t.teacherIds.length || t.sectionIds.length || t.years.length;
  const who =
    !anyWho ||
    lesson.teacherIds.some((id) => t.teacherIds.includes(id)) ||
    lesson.sectionIds.some((id) => t.sectionIds.includes(id)) ||
    lesson.sectionIds.some((id) => t.years.includes(sectionYear.get(id) ?? -1));
  return who && (!t.kinds.length || t.kinds.includes(lesson.kind)) && (!t.subjectIds.length || t.subjectIds.includes(lesson.subjectId));
}

export interface LessonRuleSlots {
  /** slot (day * P + period) -> the hard rule that forbids it. */
  forbid: Map<number, CustomRule>;
  /** slot -> number of soft rules asking to avoid it. */
  avoid: Map<number, number>;
}

/** Per-lesson forbidden/avoided slots from the institute's custom rules. */
export function customRuleSlots(problem: Problem): Map<string, LessonRuleSlots> {
  const rules = problem.input.rules.custom ?? [];
  const P = problem.input.periods.length;
  const sectionYear = new Map(problem.input.sections.map((s) => [s.id, s.year]));
  const out = new Map<string, LessonRuleSlots>();
  if (!rules.length) return out;
  for (const l of problem.lessons) {
    const entry: LessonRuleSlots = { forbid: new Map(), avoid: new Map() };
    for (const r of rules) {
      if (!ruleMatches(r, l, sectionYear)) continue;
      for (const [d, p] of r.slots) {
        const s = d * P + p;
        if (r.strength === "hard") {
          if (!entry.forbid.has(s)) entry.forbid.set(s, r);
        } else entry.avoid.set(s, (entry.avoid.get(s) ?? 0) + 1);
      }
    }
    if (entry.forbid.size || entry.avoid.size) out.set(l.id, entry);
  }
  return out;
}
