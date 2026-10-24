import { describe, expect, it } from "vitest";
import { demoCollege } from "@/lib/demo/demo-college";
import type { Member } from "./permissions";
import { buildProblem } from "./solver/lessons";
import { solve } from "./solver/solve";
import { alternatives, allowedPriorities, canDecide, checkRequest, classUse, isFree, type Booking, type Room } from "./venues";

const input = demoCollege();
const problem = buildProblem(input);
const { assignment } = solve(problem, { seed: 3, constructMs: 20000, improveMs: 200 });
const rooms: Room[] = input.rooms;
const member = (m: Partial<Member>): Member => ({ role: "TEACHER", departmentId: null, teacherId: null, sectionId: null, ...m });
const booking = (b: Partial<Booking>): Booking => ({ id: "b", roomId: "", start: 0, end: 0, priority: "CLUB", status: "APPROVED", title: "x", ...b });

describe("venue booking", () => {
  const monday = classUse(problem, assignment, 0);

  it("knows which rooms hold classes on a timetable day", () => {
    const [lessonId, a] = Object.entries(assignment).find(([, a]) => a.day === 0)!;
    expect(monday.get(a.roomId)?.get(a.period)).toBe(problem.lessons.find((l) => l.id === lessonId)!.label);
    // A cancelled class frees its room.
    expect(classUse(problem, assignment, 0, new Set([lessonId])).get(a.roomId)?.get(a.period)).not.toBe(problem.lessons.find((l) => l.id === lessonId)!.label);
    expect(classUse(problem, assignment, null).size).toBe(0);
  });

  it("reports class clashes, blockers, bumps and capacity", () => {
    const [, a] = Object.entries(assignment).find(([, a]) => a.day === 0)!;
    const room = rooms.find((r) => r.id === a.roomId)!;
    const req = { roomId: room.id, start: a.period, end: a.period, priority: "DEPARTMENT" as const, attendees: room.capacity + 1 };
    const bookings = [
      booking({ id: "hi", roomId: room.id, start: a.period, end: a.period, priority: "PLACEMENT" }),
      booking({ id: "lo", roomId: room.id, start: a.period, end: a.period, priority: "CLUB" }),
      booking({ id: "wait", roomId: room.id, start: a.period, end: a.period, status: "PENDING" }),
      booking({ id: "other-day-time", roomId: room.id, start: a.period + 1, end: a.period + 2 }),
    ];
    const c = checkRequest(req, room, monday, bookings);
    expect(c.classes).toHaveLength(1);
    expect(c.blockers.map((b) => b.id)).toEqual(["hi"]);
    expect(c.bumps.map((b) => b.id)).toEqual(["lo"]);
    expect(c.competing.map((b) => b.id)).toEqual(["wait"]);
    expect(c.tooSmall).toBe(true);
  });

  it("suggests free rooms that fit, never the requested one", () => {
    const hall = rooms.find((r) => r.isEventVenue)!;
    const req = { roomId: hall.id, start: 1, end: 2, priority: "CLUB" as const, attendees: 60 };
    const alts = alternatives(req, rooms, monday, []);
    expect(alts.length).toBeGreaterThan(0);
    for (const r of alts) {
      expect(r.id).not.toBe(hall.id);
      expect(r.capacity).toBeGreaterThanOrEqual(60);
      expect(isFree(r.id, 1, 2, monday, [])).toBe(true);
    }
  });

  it("routes decisions to the room's owner", () => {
    const owned = rooms.find((r) => r.ownerDeptId && !r.isEventVenue)!;
    const common = rooms.find((r) => r.isEventVenue)!;
    const hod = member({ role: "HOD", departmentId: owned.ownerDeptId });
    const otherHod = member({ role: "HOD", departmentId: "someone-else" });
    expect(canDecide(hod, owned, { noVenueManager: false })).toBe(true);
    expect(canDecide(otherHod, owned, { noVenueManager: false })).toBe(false);
    expect(canDecide(hod, common, { noVenueManager: false })).toBe(false);
    expect(canDecide(member({ role: "VENUE_MANAGER" }), common, { noVenueManager: false })).toBe(true);
    expect(canDecide(member({ role: "INSTITUTE_ADMIN" }), common, { noVenueManager: false })).toBe(false);
    expect(canDecide(member({ role: "INSTITUTE_ADMIN" }), common, { noVenueManager: true })).toBe(true);
    expect(canDecide(member({ role: "HEAD_OF_INSTITUTE" }), owned, { noVenueManager: false })).toBe(true);
  });

  it("limits priorities by role", () => {
    expect(allowedPriorities("PLACEMENT_OFFICER")).toEqual(["PLACEMENT"]);
    expect(allowedPriorities("TEACHER")).not.toContain("INSTITUTE");
    expect(allowedPriorities("STUDENT")).toEqual([]);
  });
});
