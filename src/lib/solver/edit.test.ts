import { describe, expect, it } from "vitest";
import { demoCollege } from "@/lib/demo/demo-college";
import { EditSession } from "./edit";
import { buildProblem } from "./lessons";
import { solve } from "./solve";
import { validate } from "./validate";

describe("manual editing", () => {
  const problem = buildProblem(demoCollege());
  const base = solve(problem, { seed: 5, improveMs: 200 }).assignment;
  const lecture = problem.lessons.find((l) => l.subjectCode === "CS201" && l.kind === "L")!;

  it("classifies every slot and every offered move or swap is valid", () => {
    const session = new EditSession(problem, base);
    const opts = session.options(lecture.id);
    expect(opts.size).toBe(problem.input.days.length * problem.input.periods.length);
    expect([...opts.values()].filter((o) => o.kind === "current")).toHaveLength(1);
    // Lunch for a senior section is a closed period.
    const lunch = opts.get("0:5");
    expect(lunch).toMatchObject({ kind: "blocked", reason: expect.stringMatching(/Break or closed period/) });

    let checked = 0;
    for (const [key, o] of opts) {
      if (o.kind !== "move" && o.kind !== "swap") continue;
      const s = new EditSession(problem, base);
      const [d, p] = key.split(":").map(Number);
      expect(s.apply(lecture.id, d, p)).toBe(true);
      expect(validate(problem, s.assignment()).violations).toEqual([]);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
    // The session is left unchanged by computing options.
    expect(session.assignment()).toEqual(new EditSession(problem, base).assignment());
  });

  it("explains blocked slots in plain words", () => {
    const opts = new EditSession(problem, base).options(lecture.id);
    const reasons = [...opts.values()].flatMap((o) => (o.kind === "blocked" ? [o.reason] : []));
    expect(reasons.length).toBeGreaterThan(0);
    expect(reasons.every((r) => r.length > 5 && r !== "Blocked")).toBe(true);
  });

  it("never swaps with a pinned class", () => {
    const first = new EditSession(problem, base).options(lecture.id);
    const swap = [...first.values()].find((o) => o.kind === "swap");
    if (!swap || swap.kind !== "swap") return;
    const pinned = new EditSession(problem, base, new Set([swap.withLessonId]));
    const again = [...pinned.options(lecture.id).values()].filter((o) => o.kind === "swap" && o.withLessonId === swap.withLessonId);
    expect(again).toEqual([]);
  });
});
