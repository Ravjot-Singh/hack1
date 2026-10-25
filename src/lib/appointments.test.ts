import { describe, expect, it } from "vitest";
import { demoCollege } from "@/lib/demo/demo-college";
import { busyPeriods, openSlots, slotProblem, subSlots, teachingSlots, weekCount, weekStart, type DateInfo, type OfficeHoursConfig } from "./appointments";
import { buildProblem } from "./solver/lessons";
import { solve } from "./solver/solve";

const input = demoCollege();
const problem = buildProblem(input);
const { assignment } = solve(problem, { seed: 5, constructMs: 20000, improveMs: 200 });
const teacher = "t-rajesh";
const P = input.periods.length;

describe("appointments", () => {
  it("cuts a period into sub-slots", () => {
    expect(subSlots({ start: "09:00", end: "09:50" }, 15).map((s) => s.start)).toEqual(["09:00", "09:15", "09:30"]);
    expect(subSlots({ start: "09:00", end: "09:50" }, 10)).toHaveLength(5);
  });

  it("finds weeks by Monday", () => {
    expect(weekStart("2026-10-28")).toBe("2026-10-26"); // Wednesday
    expect(weekStart("2026-10-26")).toBe("2026-10-26");
    expect(weekStart("2026-11-01")).toBe("2026-10-26"); // Sunday
  });

  it("treats classes, cover duty and leave as busy; cancelled classes as free", () => {
    const teaching = teachingSlots(problem, assignment, teacher);
    const [d, p] = [...teaching][0].split(":").map(Number);
    const lesson = problem.lessons.find((l) => l.teacherIds.includes(teacher) && assignment[l.id].day === d && assignment[l.id].period === p)!;
    expect(busyPeriods(problem, assignment, { dayIndex: d, absences: [], covers: [] }, teacher, P).has(p)).toBe(true);
    const cancelled = busyPeriods(problem, assignment, { dayIndex: d, absences: [], covers: [{ lessonId: lesson.id, action: "CANCEL", substituteId: null }] }, teacher, P);
    expect(cancelled.has(p)).toBe(false);
    const other = problem.lessons.find((l) => !l.teacherIds.includes(teacher) && assignment[l.id]?.day === d)!;
    const covering = busyPeriods(problem, assignment, { dayIndex: d, absences: [], covers: [{ lessonId: other.id, action: "SUBSTITUTE", substituteId: teacher }] }, teacher, P);
    expect(covering.has(assignment[other.id].period)).toBe(true);
    expect(busyPeriods(problem, assignment, { dayIndex: d, absences: [{ teacherId: teacher, periods: [] }], covers: [] }, teacher, P).size).toBe(P);
  });

  it("offers only free sub-slots in office hours, and explains refusals", () => {
    const teaching = teachingSlots(problem, assignment, teacher);
    // Office hours on Monday (day 0): every period, including ones with classes.
    const config: OfficeHoursConfig = { teacherId: teacher, slots: Array.from({ length: P }, (_, p): [number, number] => [0, p]), slotMinutes: 15, perStudentWeek: 1, location: "" };
    const monday: DateInfo = { date: "2026-10-26", plan: { kind: "classes", dayIndex: 0, note: null }, busy: busyPeriods(problem, assignment, { dayIndex: 0, absences: [], covers: [] }, teacher, P) };
    const open = openSlots(config, [monday], input.periods, []);
    expect(open.length).toBeGreaterThan(0);
    expect(open.every((s) => !teaching.has(`0:${s.period}`))).toBe(true);
    const first = open[0];
    const booked = [{ id: "a", teacherId: teacher, studentId: "s1", ...first }];
    expect(slotProblem(first, config, monday, input.periods, booked)).toContain("just booked");
    expect(openSlots(config, [monday], input.periods, booked)).toHaveLength(open.length - 1);
    expect(weekCount(booked, teacher, "s1", "2026-10-30")).toBe(1);
    const busyP = [...monday.busy][0];
    if (busyP !== undefined) expect(slotProblem({ date: monday.date, period: busyP, offset: 0 }, config, monday, input.periods, [])).toContain("busy");
    const holiday: DateInfo = { date: "2026-11-08", plan: { kind: "off", reason: "Holiday: Diwali" }, busy: new Set() };
    expect(openSlots(config, [holiday], input.periods, [])).toEqual([]);
  });
});
