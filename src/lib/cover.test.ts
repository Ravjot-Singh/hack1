import { describe, expect, it } from "vitest";
import { demoCollege } from "@/lib/demo/demo-college";
import { buildProblem } from "@/lib/solver/lessons";
import { solve } from "@/lib/solver/solve";
import { affectedLessons, suggestSubstitutes, type DayContext } from "./cover";

describe("substitutions", () => {
  const problem = buildProblem(demoCollege());
  const assignment = solve(problem, { seed: 9, improveMs: 100 }).assignment;
  const anita = "t-anita";
  // A day on which Dr. Anita Desai teaches.
  const dayIndex = assignment[problem.lessons.find((l) => l.teacherIds.includes(anita))!.id].day;
  const ctx = (extra: Partial<DayContext> = {}): DayContext => ({
    problem,
    assignment,
    dayIndex,
    absences: [{ teacherId: anita, periods: [] }],
    covers: [],
    coversThisMonth: {},
    ...extra,
  });

  it("lists the absent teacher's classes that day", () => {
    const affected = affectedLessons(ctx(), anita);
    expect(affected.length).toBeGreaterThan(0);
    expect(affected.every((a) => a.lesson.teacherIds.includes(anita) && assignment[a.lesson.id].day === dayIndex)).toBe(true);
  });

  it("only suggests teachers who are free, present and under their daily limit", () => {
    const [first] = affectedLessons(ctx(), anita);
    const subs = suggestSubstitutes(ctx(), first.lesson.id, 50);
    expect(subs.length).toBeGreaterThan(0);
    const periods = Array.from({ length: first.lesson.duration }, (_, k) => first.period + k);
    for (const s of subs) {
      expect(s.teacherId).not.toBe(anita);
      const clash = problem.lessons.some(
        (l) =>
          l.teacherIds.includes(s.teacherId) &&
          assignment[l.id]?.day === dayIndex &&
          periods.some((p) => p >= assignment[l.id].period && p < assignment[l.id].period + l.duration),
      );
      expect(clash).toBe(false);
      const t = problem.input.teachers.find((x) => x.id === s.teacherId)!;
      expect(s.dayLoad).toBeLessThanOrEqual(t.maxPerDay);
    }
  });

  it("never suggests someone already covering at that time, or who is absent too", () => {
    const [first] = affectedLessons(ctx(), anita);
    const [best] = suggestSubstitutes(ctx(), first.lesson.id);
    const second = affectedLessons(ctx(), anita).find((a) => a.lesson.id !== first.lesson.id && a.period === first.period);
    const withCover = ctx({ covers: [{ lessonId: first.lesson.id, action: "SUBSTITUTE", substituteId: best.teacherId }] });
    if (second) expect(suggestSubstitutes(withCover, second.lesson.id, 50).some((s) => s.teacherId === best.teacherId)).toBe(false);
    const bothAway = ctx({ absences: [{ teacherId: anita, periods: [] }, { teacherId: best.teacherId, periods: [] }] });
    expect(suggestSubstitutes(bothAway, first.lesson.id, 50).some((s) => s.teacherId === best.teacherId)).toBe(false);
  });

  it("spreads covers: someone who covered a lot ranks below an equal colleague", () => {
    const [first] = affectedLessons(ctx(), anita);
    const subs = suggestSubstitutes(ctx(), first.lesson.id, 50);
    const top = subs[0].teacherId;
    const busyTop = suggestSubstitutes(ctx({ coversThisMonth: { [top]: 30 } }), first.lesson.id, 50);
    expect(busyTop[0].teacherId).not.toBe(top);
  });
});
