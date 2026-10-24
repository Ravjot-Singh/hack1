import { describe, expect, it } from "vitest";
import { demoCollege } from "@/lib/demo/demo-college";
import { buildProblem } from "@/lib/solver/lessons";
import { solve } from "@/lib/solver/solve";
import { utilization } from "./utilization";

describe("room utilization", () => {
  const problem = buildProblem(demoCollege());
  const assignment = solve(problem, { seed: 4, improveMs: 100 }).assignment;
  const u = utilization(problem, assignment);

  it("counts every scheduled period exactly once, in its room", () => {
    const scheduled = problem.lessons.reduce((n, l) => n + (assignment[l.id] ? l.duration : 0), 0);
    expect(u.rooms.reduce((n, r) => n + r.used, 0)).toBe(scheduled);
  });

  it("leaves out event venues and closed periods", () => {
    expect(u.rooms.some((r) => r.name === "Seminar Hall")).toBe(false);
    // Saturday afternoon is closed for every grid in the demo.
    const P = problem.input.periods.length;
    expect(u.teachingSlots.includes(5 * P + 6)).toBe(false);
    expect(u.busyBySlot[5 * P + 6]).toBe(0);
  });

  it("reports shares between 0 and 1 and the busiest slot", () => {
    expect(u.rooms.every((r) => r.share >= 0 && r.share <= 1)).toBe(true);
    expect(Math.max(...u.busyBySlot)).toBe(u.busyBySlot[u.peakSlot]);
    expect(u.averageShare).toBeGreaterThan(0);
  });
});
