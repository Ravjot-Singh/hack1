import { describe, expect, it } from "vitest";
import { demoCollege } from "@/lib/demo/demo-college";
import { buildProblem } from "./lessons";
import { score } from "./score";
import { solve } from "./solve";
import { toMinutes, travelMinutes, walkAllowance } from "./time";
import type { Assignment, InstituteInput } from "./types";

const base = demoCollege();
const problem = buildProblem(base);
const solved = solve(problem, { seed: 4, constructMs: 20000, improveMs: 300 }).assignment;

describe("score", () => {
  it("gives a quality between 0 and 100", () => {
    const s = score(problem, solved);
    expect(s.quality).toBeGreaterThan(0);
    expect(s.quality).toBeLessThanOrEqual(100);
  });

  it("is 100 when every soft goal is switched off", () => {
    const off: InstituteInput = { ...base, rules: { ...base.rules, weights: { teacherPrefs: 0, balancedDays: 0, idleGaps: 0, subjectSpread: 0, roomUtilization: 0 } } };
    expect(score(buildProblem(off), solved).quality).toBe(100);
  });

  it("counts the same subject twice on a day", () => {
    const theory = problem.lessons.filter((l) => l.offeringId === problem.lessons[0].offeringId && l.kind !== "P");
    const a: Assignment = Object.fromEntries(Object.entries(solved).map(([k, v]) => [k, { ...v }]));
    const before = score(problem, a).penalties.subjectSpread;
    for (const l of theory) a[l.id] = { ...a[l.id], day: a[theory[0].id].day };
    expect(score(problem, a).penalties.subjectSpread).toBeGreaterThan(before);
  });

  it("counts free periods between classes", () => {
    const a: Assignment = {};
    const sec = problem.lessons.filter((l) => l.sectionIds.includes("s-cse2a") && !l.batchId && l.duration === 1 && l.unitId === l.id).slice(0, 2);
    a[sec[0].id] = { day: 0, period: 0, roomId: "x" };
    a[sec[1].id] = { day: 0, period: 3, roomId: "x" };
    // Two free periods, counted for each of the section's two lab batches.
    expect(score(problem, a).penalties.idleGaps).toBe(4);
  });

  it("counts teacher 'avoid' slots used", () => {
    // Dr. Kavita Rao avoids P8 on weekdays.
    const x = problem.lessons.find((l) => l.teacherIds.includes("t-kavita") && l.duration === 1)!;
    expect(score(problem, { [x.id]: { day: 0, period: 7, roomId: "x" } }).penalties.teacherPrefs).toBe(1);
    expect(score(problem, { [x.id]: { day: 0, period: 0, roomId: "x" } }).penalties.teacherPrefs).toBe(0);
  });
});

describe("time helpers", () => {
  it("converts clock times", () => {
    expect(toMinutes("09:50")).toBe(590);
    expect(toMinutes("13")).toBe(780);
  });

  it("gives the walking allowance between periods", () => {
    // P2 ends 10:40, P3 starts 10:50: a 10-minute break plus the grace minutes.
    expect(walkAllowance(base, 1)).toBe(10 + base.passingMinutes);
    expect(walkAllowance(base, base.periods.length - 1)).toBe(Infinity);
  });

  it("looks up travel time in either direction, 0 for the same or unknown building", () => {
    const [a, b] = base.buildings;
    expect(travelMinutes(base, a.id, a.id)).toBe(0);
    expect(travelMinutes(base, a.id, null)).toBe(0);
    expect(travelMinutes(base, a.id, b.id)).toBe(travelMinutes(base, b.id, a.id));
  });
});
