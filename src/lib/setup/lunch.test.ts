import { describe, expect, it } from "vitest";
import { demoCollege } from "@/lib/demo/demo-college";
import { buildProblem, solve, validate } from "@/lib/solver";
import { gridLunch, lunchCrowd, moveLunch, spreadLunches } from "./lunch";

const input = demoCollege();
const senior = input.grids.find((g) => g.id === "g-senior")!;

describe("lunch by department", () => {
  it("finds a grid's lunch", () => {
    expect(gridLunch(senior.open)).toBe(5);
    expect(gridLunch(input.grids.find((g) => g.id === "g-junior")!.open)).toBe(4);
    expect(gridLunch([[true, true, true]])).toBeNull();
  });

  it("moves lunch and leaves half days alone", () => {
    const moved = moveLunch(senior.open, 3);
    expect(gridLunch(moved)).toBe(3);
    expect(moved[0]).toEqual([true, true, true, false, true, true, true, true]);
    // Saturday is a half day (P1-P4 open): unchanged.
    expect(moved[5]).toEqual(senior.open[5]);
    // Lunch can't go at the very start or end of the day.
    expect(moveLunch(senior.open, 0)[0][0]).toBe(true);
  });

  it("spreads departments to balance students", () => {
    const plan = spreadLunches(
      [
        { id: "a", students: 200 },
        { id: "b", students: 120 },
        { id: "c", students: 100 },
        { id: "d", students: 90 },
      ],
      [3, 4, 5],
    );
    // 200 alone; 120 and 100 apart; 90 joins the lightest.
    expect(new Set([plan.a, plan.b, plan.c]).size).toBe(3);
    expect(plan.d).toBe(plan.c);
    expect(spreadLunches([{ id: "a", students: 5 }], [])).toEqual({});
  });

  it("counts students at lunch per period", () => {
    const crowd = lunchCrowd(input.sections, input.grids, input.periods.length);
    const first = input.sections.filter((s) => s.year === 1).reduce((n, s) => n + s.size, 0);
    const rest = input.sections.filter((s) => s.year !== 1).reduce((n, s) => n + s.size, 0);
    expect(crowd[4]).toBe(first);
    expect(crowd[5]).toBe(rest);
    expect(crowd[0]).toBe(0);
  });

  it("a college with staggered department lunches still solves cleanly", () => {
    // CSE lunches at P4, ECE at P5, ME at P6 (seniors), first years keep P5.
    const lunchOf: Record<string, number> = { "d-cse": 3, "d-ece": 4, "d-me": 5 };
    const grids = [...input.grids];
    const sections = input.sections.map((s) => {
      if (!(s.deptId in lunchOf)) return s;
      const id = `g-lunch-${lunchOf[s.deptId]}`;
      if (!grids.some((g) => g.id === id)) grids.push({ id, name: id, open: moveLunch(senior.open, lunchOf[s.deptId]) });
      return { ...s, gridId: id };
    });
    const staggered = { ...input, grids, sections };
    const crowd = lunchCrowd(sections, grids, input.periods.length);
    expect(Math.max(...crowd)).toBeLessThan(Math.max(...lunchCrowd(input.sections, input.grids, input.periods.length)));
    const problem = buildProblem(staggered);
    const result = solve(problem, { seed: 3, constructMs: 20000, improveMs: 300 });
    expect(result.unscheduled).toEqual([]);
    expect(validate(problem, result.assignment).violations).toEqual([]);
  });
});
