import { describe, expect, it } from "vitest";
import { buildPeriods, defaultGrid, slugify } from "./bell";
import { isStep, stepForIssue, STEPS } from "./steps";

describe("bell schedule", () => {
  it("adds the short break after the chosen period", () => {
    const p = buildPeriods({ start: "09:00", periodMinutes: 50, periods: 4, breakAfter: 2, breakMinutes: 10, lunchPeriod: 0 });
    expect(p).toEqual([
      { start: "09:00", end: "09:50" },
      { start: "09:50", end: "10:40" },
      { start: "10:50", end: "11:40" },
      { start: "11:40", end: "12:30" },
    ]);
  });

  it("closes lunch and half of Saturday", () => {
    const g = defaultGrid(["Mon", "Sat"], 8, 5, true);
    expect(g[0]).toEqual([true, true, true, true, false, true, true, true]);
    expect(g[1]).toEqual([true, true, true, true, false, false, false, false]);
  });

  it("makes safe slugs", () => {
    expect(slugify("St. Xavier's College, Mumbai!")).toBe("st-xavier-s-college-mumbai");
    expect(slugify("!!!")).toBe("college");
    expect(slugify("x".repeat(80))).toHaveLength(30);
  });
});

describe("setup steps", () => {
  it("knows its steps", () => {
    expect(STEPS.map((s) => s.slug)).toContain("rules");
    expect(isStep("rules")).toBe(true);
    expect(isStep("nope")).toBe(false);
  });

  it("sends each readiness issue to the step that fixes it", () => {
    expect(stepForIssue("teacher-availability")).toBe("teachers");
    expect(stepForIssue("teacher-load")).toBe("allocation");
    expect(stepForIssue("basket-teacher")).toBe("allocation");
    expect(stepForIssue("room-capacity")).toBe("rooms");
    expect(stepForIssue("block-length")).toBe("subjects");
    expect(stepForIssue("custom-rule")).toBe("rules");
    expect(stepForIssue("something-else")).toBe("review");
  });
});
