import { describe, expect, it } from "vitest";
import { demoCollege } from "@/lib/demo/demo-college";
import { busyPeriods, openSlots, type OfficeHoursConfig } from "./appointments";
import { sizesFromChoices } from "./electives";
import { classesHit } from "./placements";
import { buildProblem } from "./solver/lessons";
import { mulberry32 } from "./solver/engine";
import { solve } from "./solver/solve";
import { alternatives, classUse, isFree, PRIORITIES, type Booking } from "./venues";

const input = demoCollege();
const problem = buildProblem(input);
const { assignment } = solve(problem, { seed: 8, constructMs: 20000, improveMs: 200 });
const P = input.periods.length;

describe("property: elective class sizes", () => {
  it("respect seat limits and the number of students (1000 random cases)", () => {
    const rand = mulberry32(31);
    for (let i = 0; i < 1000; i++) {
      const ids = Array.from({ length: 2 + Math.floor(rand() * 4) }, (_, k) => `e${k}`);
      const counts = Object.fromEntries(ids.map((id) => [id, Math.floor(rand() * 40)]));
      const seats = Object.fromEntries(ids.filter(() => rand() < 0.5).map((id) => [id, 1 + Math.floor(rand() * 60)]));
      const total = 50 + Math.floor(rand() * 300);
      const sizes = sizesFromChoices(ids, counts, "scaled", total, seats);
      const registered = ids.reduce((n, id) => n + counts[id], 0);
      for (const id of ids) {
        expect(sizes[id]).toBeGreaterThanOrEqual(1);
        if (seats[id] != null && registered) expect(sizes[id]).toBeLessThanOrEqual(Math.max(1, seats[id]));
      }
      // Electives someone chose never hold more students than exist.
      const chosen = ids.filter((id) => counts[id]).reduce((n, id) => n + sizes[id], 0);
      if (registered) expect(chosen).toBeLessThanOrEqual(total);
    }
  });
});

describe("property: venue alternatives are really free", () => {
  it("for random days and bookings (300 cases)", () => {
    const rand = mulberry32(41);
    for (let i = 0; i < 300; i++) {
      const day = Math.floor(rand() * 5);
      const use = classUse(problem, assignment, day);
      const bookings: Booking[] = Array.from({ length: Math.floor(rand() * 8) }, (_, k) => {
        const start = Math.floor(rand() * P);
        return { id: `b${k}`, roomId: input.rooms[Math.floor(rand() * input.rooms.length)].id, start, end: Math.min(P - 1, start + Math.floor(rand() * 3)), priority: PRIORITIES[Math.floor(rand() * 4)], status: rand() < 0.6 ? "APPROVED" : "PENDING", title: "x" };
      });
      const start = Math.floor(rand() * P);
      const req = { roomId: input.rooms[0].id, start, end: Math.min(P - 1, start + Math.floor(rand() * 3)), priority: "CLUB" as const, attendees: 1 + Math.floor(rand() * 150) };
      for (const r of alternatives(req, input.rooms, use, bookings, 10)) {
        expect(isFree(r.id, req.start, req.end, use, bookings)).toBe(true);
        expect(r.capacity).toBeGreaterThanOrEqual(req.attendees);
      }
    }
  });
});

describe("property: office-hour slots", () => {
  it("are never in busy periods or already booked (200 cases)", () => {
    const rand = mulberry32(51);
    for (let i = 0; i < 200; i++) {
      const teacher = input.teachers[Math.floor(rand() * input.teachers.length)].id;
      const dayIndex = Math.floor(rand() * 5);
      const config: OfficeHoursConfig = {
        teacherId: teacher,
        slots: Array.from({ length: P }, (_, p): [number, number] => [dayIndex, p]).filter(() => rand() < 0.6),
        slotMinutes: [10, 15, 20][Math.floor(rand() * 3)],
        perStudentWeek: 2,
        location: "",
      };
      const busy = busyPeriods(problem, assignment, { dayIndex, absences: rand() < 0.2 ? [{ teacherId: teacher, periods: [Math.floor(rand() * P)] }] : [], covers: [] }, teacher, P);
      const info = { date: "2026-11-02", plan: { kind: "classes" as const, dayIndex, note: null }, busy };
      const first = openSlots(config, [info], input.periods, []);
      const booked = first.filter(() => rand() < 0.3).map((s) => ({ teacherId: teacher, studentId: "s", date: s.date, period: s.period, offset: s.offset }));
      for (const s of openSlots(config, [info], input.periods, booked)) {
        expect(busy.has(s.period)).toBe(false);
        expect(config.slots.some(([d, p]) => d === dayIndex && p === s.period)).toBe(true);
        expect(booked.some((b) => b.period === s.period && b.offset === s.offset)).toBe(false);
      }
    }
  });
});

describe("property: placement impact", () => {
  it("never has more students away than are in the class (200 cases)", () => {
    const rand = mulberry32(61);
    for (let i = 0; i < 200; i++) {
      const attending = input.sections.filter(() => rand() < 0.4).map((s) => ({ sectionId: s.id, count: Math.floor(rand() * (s.size + 1)) }));
      const start = Math.floor(rand() * P);
      for (const h of classesHit(problem, assignment, Math.floor(rand() * 5), start, Math.min(P - 1, start + Math.floor(rand() * 4)), attending)) {
        expect(h.away).toBeGreaterThan(0);
        expect(h.away).toBeLessThanOrEqual(h.size);
      }
    }
  });
});
