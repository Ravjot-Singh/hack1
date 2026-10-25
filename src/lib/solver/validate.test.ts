import { describe, expect, it } from "vitest";
import { demoCollege } from "@/lib/demo/demo-college";
import { buildProblem } from "./lessons";
import { solve } from "./solve";
import type { Assignment, InstituteInput, Lesson } from "./types";
import { validate } from "./validate";

// One valid timetable, then broken in exactly one way per test: the independent validator
// must name that rule. This is what stops a buggy solver from ever saving a bad timetable.
const base = demoCollege();
const problem = buildProblem(base);
const solved = solve(problem, { seed: 21, constructMs: 20000, improveMs: 300 }).assignment;

const clone = (a: Assignment): Assignment => Object.fromEntries(Object.entries(a).map(([k, v]) => [k, { ...v }]));
const rulesOf = (p = problem, a: Assignment) => new Set(validate(p, a).violations.map((v) => v.rule));
const single = (l: Lesson) => l.unitId === l.id; // not part of an elective basket
const at = (l: Lesson) => solved[l.id];

describe("validator: the solved timetable", () => {
  it("is clean", () => {
    expect(validate(problem, solved).violations).toEqual([]);
  });
});

describe("validator catches each broken hard rule", () => {
  it("teacher double-booked", () => {
    const [x, y] = problem.lessons.filter((l) => single(l) && l.teacherIds.includes("t-rajesh") && l.duration === 1);
    const a = clone(solved);
    a[y.id] = { ...a[y.id], day: at(x).day, period: at(x).period };
    expect(rulesOf(problem, a)).toContain("teacher-clash");
  });

  it("room double-booked", () => {
    const x = problem.lessons.find((l) => single(l) && l.kind === "L")!;
    const y = problem.lessons.find((l) => single(l) && l.kind === "L" && at(l).roomId !== at(x).roomId && (at(l).day !== at(x).day || at(l).period !== at(x).period))!;
    const a = clone(solved);
    a[y.id] = { ...a[y.id], roomId: at(x).roomId, day: at(x).day, period: at(x).period };
    expect(rulesOf(problem, a)).toContain("room-clash");
  });

  it("students in two classes at once", () => {
    const sec = "s-cse2a";
    const mine = problem.lessons.filter((l) => single(l) && l.sectionIds.includes(sec) && !l.batchId && l.duration === 1);
    const x = mine[0];
    const y = mine.find((l) => !l.teacherIds.some((t) => x.teacherIds.includes(t)) && (at(l).day !== at(x).day || at(l).period !== at(x).period))!;
    const a = clone(solved);
    a[y.id] = { ...a[y.id], day: at(x).day, period: at(x).period };
    expect(rulesOf(problem, a)).toContain("student-clash");
  });

  it("class during a break", () => {
    const x = problem.lessons.find((l) => single(l) && l.sectionIds.includes("s-cse2a") && l.duration === 1)!;
    const a = clone(solved);
    a[x.id] = { ...a[x.id], day: 0, period: 5 }; // senior lunch (13:20)
    expect(rulesOf(problem, a)).toContain("grid");
    a[x.id] = { ...a[x.id], day: 0, period: base.periods.length }; // past the end of the day
    expect(rulesOf(problem, a)).toContain("grid");
  });

  it("wrong room type and too small a room", () => {
    const lecture = problem.lessons.find((l) => single(l) && l.kind === "L")!;
    const lab = base.rooms.find((r) => r.type !== lecture.roomType && !r.isEventVenue)!;
    const a = clone(solved);
    a[lecture.id] = { ...a[lecture.id], roomId: lab.id };
    expect(rulesOf(problem, a)).toContain("room");
    const tiny: InstituteInput = { ...base, rooms: base.rooms.map((r) => (r.id === at(lecture).roomId ? { ...r, capacity: 1 } : r)) };
    expect(rulesOf(buildProblem(tiny), solved)).toContain("room");
  });

  it("teacher scheduled while unavailable", () => {
    // Dr. Meera Iyer is unavailable on Saturday P1-P4.
    const x = problem.lessons.find((l) => single(l) && l.teacherIds.includes("t-meera") && l.duration === 1)!;
    const a = clone(solved);
    a[x.id] = { ...a[x.id], day: 5, period: 0 };
    expect(rulesOf(problem, a)).toContain("teacher-unavailable");
  });

  it("teacher over the daily or weekly limit", () => {
    const strict: InstituteInput = { ...base, teachers: base.teachers.map((t) => (t.id === "t-rajesh" ? { ...t, maxPerDay: 1, maxPerWeek: 2 } : t)) };
    const v = validate(buildProblem(strict), solved).violations.filter((x) => x.rule === "teacher-load");
    expect(v.some((x) => x.message.includes("this week"))).toBe(true);
    expect(v.some((x) => /on (Mon|Tue|Wed|Thu|Fri|Sat)/.test(x.message))).toBe(true);
  });

  it("too many periods in a row", () => {
    const strict: InstituteInput = { ...base, rules: { ...base.rules, maxConsecutiveSection: 1 } };
    expect(rulesOf(buildProblem(strict), solved)).toContain("consecutive");
  });

  it("a pinned class that moved", () => {
    const x = problem.lessons.find(single)!;
    const pinned: InstituteInput = { ...base, pins: [{ lessonId: x.id, day: (at(x).day + 1) % 5, period: at(x).period, roomId: at(x).roomId }] };
    expect(rulesOf(buildProblem(pinned), solved)).toContain("pinned");
  });

  it("an elective basket split across times", () => {
    const basket = problem.lessons.filter((l) => !single(l));
    const a = clone(solved);
    a[basket[0].id] = { ...a[basket[0].id], period: (a[basket[0].id].period + 1) % 4 };
    expect(rulesOf(problem, a)).toContain("basket");
  });

  it("walking time between far buildings", () => {
    const far: InstituteInput = {
      ...base,
      passingMinutes: 0,
      rules: { ...base.rules, travelTimeHard: true },
      buildings: base.buildings.map((b) => ({ ...b, travelMinutes: Object.fromEntries(base.buildings.filter((o) => o.id !== b.id).map((o) => [o.id, 999])) })),
    };
    // Back-to-back classes in different buildings now break the walking rule somewhere.
    expect(rulesOf(buildProblem(far), solved)).toContain("travel");
  });

  it("a custom rule", () => {
    const x = problem.lessons.find(single)!;
    const ruled: InstituteInput = {
      ...base,
      rules: {
        ...base.rules,
        custom: [{ id: "r", text: "", summary: "nothing then", strength: "hard", target: { teacherIds: [], sectionIds: [], years: [], kinds: [], subjectIds: [] }, slots: [[at(x).day, at(x).period]] }],
      },
    };
    expect(rulesOf(buildProblem(ruled), solved)).toContain("custom-rule");
  });

  it("reports unscheduled classes and readable messages with names", () => {
    const a = clone(solved);
    const x = problem.lessons[0];
    delete a[x.id];
    const r = validate(problem, a);
    expect(r.unscheduled).toEqual([x.id]);
    const y = problem.lessons.find((l) => single(l) && l.teacherIds.includes("t-rajesh"))!;
    const z = problem.lessons.find((l) => single(l) && l.id !== y.id && l.teacherIds.includes("t-rajesh") && l.duration === y.duration)!;
    a[z.id] = { ...a[z.id], day: at(y).day, period: at(y).period };
    const msg = validate(problem, a).violations.find((v) => v.rule === "teacher-clash")!.message;
    expect(msg).toContain("Dr. Rajesh Kumar");
    expect(msg).not.toMatch(/t-rajesh/);
  });
});
