import { describe, expect, it } from "vitest";
import { demoCollege } from "@/lib/demo/demo-college";
import { ruleMatches } from "./custom-rules";
import { mulberry32 } from "./engine";
import { buildProblem } from "./lessons";
import { solve } from "./solve";
import type { CustomRule, InstituteInput } from "./types";
import { validate } from "./validate";

// Random hard rules on the demo college: whatever the solver produces must pass the
// independent validator (0 violations), and no placed class may sit in a forbidden slot.
function withRandomRules(seed: number): InstituteInput {
  const rand = mulberry32(seed);
  const input = demoCollege();
  const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
  const rules: CustomRule[] = Array.from({ length: 1 + Math.floor(rand() * 3) }, (_, i) => {
    const day = Math.floor(rand() * 5);
    const from = Math.floor(rand() * 6);
    const slots: [number, number][] = [from, from + 1].map((p) => [day, p]);
    const who = Math.floor(rand() * 3);
    return {
      id: `r${i}`,
      text: "",
      summary: `random rule ${i}`,
      strength: rand() < 0.7 ? "hard" : "soft",
      target: {
        teacherIds: who === 0 ? [pick(input.teachers).id] : [],
        sectionIds: who === 1 ? [pick(input.sections).id] : [],
        years: who === 2 ? [1 + Math.floor(rand() * 3)] : [],
        kinds: rand() < 0.3 ? ["P"] : [],
        subjectIds: [],
      },
      slots,
    };
  });
  return { ...input, rules: { ...input.rules, custom: rules } };
}

describe("property: random custom rules are never broken", () => {
  for (const seed of [101, 202, 303, 404, 505]) {
    it(`seed ${seed}`, () => {
      const input = withRandomRules(seed);
      const problem = buildProblem(input);
      const result = solve(problem, { seed, constructMs: 15000, improveMs: 300 });
      expect(validate(problem, result.assignment).violations).toEqual([]);
      const years = new Map(input.sections.map((s) => [s.id, s.year]));
      for (const r of input.rules.custom!.filter((x) => x.strength === "hard")) {
        for (const l of problem.lessons) {
          const a = result.assignment[l.id];
          if (!a || !ruleMatches(r, l, years)) continue;
          for (let k = 0; k < l.duration; k++) expect(r.slots.some(([d, p]) => d === a.day && p === a.period + k)).toBe(false);
        }
      }
      // Anything left unplaced is explained.
      for (const id of result.unscheduled) expect(result.explanations[id]?.length ?? 0).toBeGreaterThan(0);
    });
  }
});
