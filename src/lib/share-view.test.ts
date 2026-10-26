import { describe, expect, it } from "vitest";
import { demoCollege } from "@/lib/demo/demo-college";
import { buildProblem, solve } from "@/lib/solver";
import { publicView } from "./share-view";

const input = demoCollege();
const problem = buildProblem(input);
const { assignment } = solve(problem, { seed: 3, constructMs: 20000, improveMs: 100 });

describe("what a public share link reveals", () => {
  it("never includes availability, preferences, custom rules or pins", () => {
    const withSecrets = { ...input, rules: { ...input.rules, custom: [{ text: "Dr. X leaves early on Fridays" } as never] }, pins: [{ lessonId: "x", day: 0, period: 0, roomId: "r" }] };
    withSecrets.teachers = withSecrets.teachers.map((t) => ({ ...t, unavailable: [[4, 6]], prefs: [{ day: 0, period: 0, kind: "avoid" } as never] }));
    const { snapshot } = publicView(withSecrets, assignment, null);
    expect(snapshot.rules.custom).toEqual([]);
    expect(snapshot.pins).toEqual([]);
    expect(snapshot.teachers.every((t) => t.unavailable.length === 0 && t.prefs.length === 0)).toBe(true);
    // A college-wide link still shows every section.
    expect(snapshot.sections).toHaveLength(input.sections.length);
  });

  it.each(["section", "teacher", "room"] as const)("a %s link shows only that %s's classes, and still renders", (view) => {
    const entityId = view === "section" ? input.sections[3].id : view === "teacher" ? input.teachers[2].id : Object.values(assignment)[0].roomId;
    const { snapshot, assignment: shown } = publicView(input, assignment, { view, entityId });
    const scoped = buildProblem(snapshot);
    // Every placement shown is a lesson of the reduced timetable, so the grid lines up.
    const ids = new Set(scoped.lessons.map((l) => l.id));
    expect(Object.keys(shown).every((id) => ids.has(id))).toBe(true);
    expect(Object.keys(shown).length).toBeGreaterThan(0);
    expect(Object.keys(shown).length).toBeLessThan(Object.keys(assignment).length);
    if (view === "section") expect(snapshot.sections.map((s) => s.id)).toEqual([entityId]);
    if (view === "teacher") expect(scoped.lessons.filter((l) => shown[l.id]).every((l) => l.teacherIds.includes(entityId))).toBe(true);
    if (view === "room") expect(Object.values(shown).every((a) => a.roomId === entityId)).toBe(true);
  });
});
