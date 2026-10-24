import { describe, expect, it } from "vitest";
import { demoCollege } from "@/lib/demo/demo-college";
import { precheck } from "./explain";
import { buildProblem } from "./lessons";
import { score } from "./score";
import { solve } from "./solve";
import type { CustomRule, InstituteInput } from "./types";
import { validate } from "./validate";

const rule = (r: Partial<CustomRule> & Pick<CustomRule, "slots">): CustomRule => ({
  id: "r1",
  text: "",
  summary: "test rule",
  strength: "hard",
  ...r,
  target: { teacherIds: [], sectionIds: [], years: [], kinds: [], subjectIds: [], ...r.target },
});

const withRules = (rules: CustomRule[]): InstituteInput => {
  const input = demoCollege();
  input.rules = { ...input.rules, custom: rules };
  return input;
};

const opts = { seed: 7, constructMs: 20000, improveMs: 500 };
const all = (days: number[], periods: number[]) => days.flatMap((d) => periods.map((p): [number, number] => [d, p]));

describe("custom rules", () => {
  it("never places a matching class in a forbidden slot", () => {
    // "No labs on Monday" and "No 2nd-year classes on Friday after lunch"
    const rules = [
      rule({ id: "a", summary: "no labs on Mon", target: { kinds: ["P"] } as CustomRule["target"], slots: all([0], [0, 1, 2, 3, 4, 5, 6, 7]) }),
      rule({ id: "b", summary: "no 2nd years Fri afternoon", target: { years: [2] } as CustomRule["target"], slots: all([4], [5, 6, 7]) }),
    ];
    const problem = buildProblem(withRules(rules));
    const result = solve(problem, opts);
    expect(result.unscheduled).toEqual([]);
    expect(validate(problem, result.assignment).violations).toEqual([]);
    for (const l of problem.lessons) {
      const a = result.assignment[l.id];
      if (l.kind === "P") expect(a.day).not.toBe(0);
      const year2 = l.sectionIds.some((id) => problem.input.sections.find((s) => s.id === id)?.year === 2);
      if (year2 && a.day === 4) expect(a.period + l.duration - 1).toBeLessThan(5);
    }
  });

  it("validator reports a placement that breaks a hard rule", () => {
    const base = buildProblem(demoCollege());
    const result = solve(base, opts);
    const victim = base.lessons[0];
    const a = result.assignment[victim.id];
    const bad = buildProblem(withRules([rule({ summary: "nothing then", slots: [[a.day, a.period]] })]));
    const v = validate(bad, result.assignment).violations;
    expect(v.some((x) => x.rule === "custom-rule" && x.message.includes("nothing then"))).toBe(true);
  });

  it("soft rules lower the score instead of blocking", () => {
    const input = withRules([rule({ strength: "soft", summary: "avoid P1", slots: all([0, 1, 2, 3, 4, 5], [0]) })]);
    const problem = buildProblem(input);
    const result = solve(problem, opts);
    expect(result.violations).toEqual([]);
    const s = score(problem, result.assignment);
    expect(s.penalties.customRules).toBeDefined();
    // With the rule active, the solver uses P1 less than it does without it.
    const plain = buildProblem(demoCollege());
    const p1 = (as: typeof result.assignment) => Object.values(as).filter((x) => x.period === 0).length;
    expect(p1(result.assignment)).toBeLessThan(p1(solve(plain, opts).assignment));
  });

  it("precheck flags a rule that leaves a class no time at all", () => {
    const fy = "s-fya";
    const input = withRules([
      rule({ summary: "FY-A never", target: { sectionIds: [fy] } as CustomRule["target"], slots: all([0, 1, 2, 3, 4, 5], [0, 1, 2, 3, 4, 5, 6, 7]) }),
    ]);
    const issues = precheck(buildProblem(input));
    expect(issues.some((i) => i.rule === "custom-rule" && i.message.includes("FY-A never"))).toBe(true);
    const result = solve(buildProblem(input), { ...opts, constructMs: 2000 });
    const why = Object.values(result.explanations).flat().join(" ");
    expect(why).toContain("rule: FY-A never");
  });
});
