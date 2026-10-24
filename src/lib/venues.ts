// Venue booking rules. Pure: no DB or framework imports, so they are unit-tested and shared
// by the page (live availability) and the server actions (enforcement).

import type { Member, Role } from "./permissions";
import type { Assignment, Problem, RoomInput } from "./solver/types";

export type Priority = "INSTITUTE" | "PLACEMENT" | "DEPARTMENT" | "CLUB";
export type BookingStatus = "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";

export const PRIORITIES: Priority[] = ["INSTITUTE", "PLACEMENT", "DEPARTMENT", "CLUB"];
export const PRIORITY_RANK: Record<Priority, number> = { INSTITUTE: 4, PLACEMENT: 3, DEPARTMENT: 2, CLUB: 1 };
export const PRIORITY_LABEL: Record<Priority, string> = {
  INSTITUTE: "Institute event",
  PLACEMENT: "Placement",
  DEPARTMENT: "Department",
  CLUB: "Club / society",
};

export interface Booking {
  id: string;
  roomId: string;
  /** 0-based periods, inclusive. */
  start: number;
  end: number;
  priority: Priority;
  status: BookingStatus;
  title: string;
}

export type Room = Pick<RoomInput, "id" | "name" | "type" | "capacity" | "ownerDeptId" | "isEventVenue">;

export const overlaps = (a: { start: number; end: number }, b: { start: number; end: number }) => a.start <= b.end && b.start <= a.end;

/** Which priorities a role may request at. */
export function allowedPriorities(role: Role): Priority[] {
  switch (role) {
    case "INSTITUTE_ADMIN":
    case "HEAD_OF_INSTITUTE":
      return ["INSTITUTE", "DEPARTMENT", "CLUB"];
    case "VENUE_MANAGER":
      return ["INSTITUTE", "CLUB"];
    case "PLACEMENT_OFFICER":
      return ["PLACEMENT"];
    case "HOD":
    case "TEACHER":
      return ["DEPARTMENT", "CLUB"];
    default:
      return [];
  }
}

/**
 * Who decides requests for a room: the owning department's HOD for department rooms, the
 * Venue Manager for common rooms and event venues (the admin stands in when there is none).
 * The Head of Institute may decide anything.
 */
export function canDecide(member: Member | null, room: Room, opts: { noVenueManager: boolean }): boolean {
  if (!member) return false;
  if (member.role === "HEAD_OF_INSTITUTE") return true;
  if (room.ownerDeptId && !room.isEventVenue) return member.role === "HOD" && member.departmentId === room.ownerDeptId;
  return member.role === "VENUE_MANAGER" || (opts.noVenueManager && member.role === "INSTITUTE_ADMIN");
}

export function approverLabel(room: Room, deptCode: (id: string) => string): string {
  return room.ownerDeptId && !room.isEventVenue ? `HOD of ${deptCode(room.ownerDeptId)}` : "Venue Manager";
}

/**
 * room id -> period -> class label, from the timetable day running on the date. Cancelled
 * classes free their room. Event venues never hold classes.
 */
export function classUse(problem: Problem, assignment: Assignment, dayIndex: number | null, cancelled: Set<string> = new Set()): Map<string, Map<number, string>> {
  const out = new Map<string, Map<number, string>>();
  if (dayIndex == null) return out;
  for (const l of problem.lessons) {
    const a = assignment[l.id];
    if (!a || a.day !== dayIndex || cancelled.has(l.id)) continue;
    const m = out.get(a.roomId) ?? new Map<number, string>();
    for (let k = 0; k < l.duration; k++) m.set(a.period + k, l.label);
    out.set(a.roomId, m);
  }
  return out;
}

export interface Request {
  roomId: string;
  start: number;
  end: number;
  priority: Priority;
  attendees: number;
}

export interface RequestCheck {
  /** Classes in the room during the requested periods. */
  classes: { period: number; label: string }[];
  /** Approved bookings at the same or higher priority: the request cannot go ahead. */
  blockers: Booking[];
  /** Approved bookings at a lower priority: cancelled if this one is approved. */
  bumps: Booking[];
  /** Other pending requests for the same time. */
  competing: Booking[];
  tooSmall: boolean;
}

export function checkRequest(req: Request, room: Room, use: Map<string, Map<number, string>>, bookings: Booking[], selfId?: string): RequestCheck {
  const classes: RequestCheck["classes"] = [];
  const busy = use.get(req.roomId);
  for (let p = req.start; p <= req.end; p++) {
    const label = busy?.get(p);
    if (label) classes.push({ period: p, label });
  }
  const same = bookings.filter((b) => b.id !== selfId && b.roomId === req.roomId && overlaps(b, req));
  const approved = same.filter((b) => b.status === "APPROVED");
  return {
    classes,
    blockers: approved.filter((b) => PRIORITY_RANK[b.priority] >= PRIORITY_RANK[req.priority]),
    bumps: approved.filter((b) => PRIORITY_RANK[b.priority] < PRIORITY_RANK[req.priority]),
    competing: same.filter((b) => b.status === "PENDING"),
    tooSmall: req.attendees > room.capacity,
  };
}

/** Is the room completely free (no class, no approved booking) for the request's periods? */
export function isFree(roomId: string, start: number, end: number, use: Map<string, Map<number, string>>, bookings: Booking[]): boolean {
  const busy = use.get(roomId);
  for (let p = start; p <= end; p++) if (busy?.has(p)) return false;
  return !bookings.some((b) => b.status === "APPROVED" && b.roomId === roomId && overlaps(b, { start, end }));
}

/** Free rooms that fit the request, event venues first (if one was asked for), then best fit. */
export function alternatives(req: Request, rooms: Room[], use: Map<string, Map<number, string>>, bookings: Booking[], limit = 4): Room[] {
  const wanted = rooms.find((r) => r.id === req.roomId);
  return rooms
    .filter((r) => r.id !== req.roomId && r.capacity >= req.attendees && isFree(r.id, req.start, req.end, use, bookings))
    .sort((a, b) => {
      const venueFirst = wanted?.isEventVenue ? Number(b.isEventVenue) - Number(a.isEventVenue) : 0;
      const sameType = Number(b.type === wanted?.type) - Number(a.type === wanted?.type);
      return venueFirst || sameType || a.capacity - b.capacity;
    })
    .slice(0, limit);
}

/** "P3–P5 (10:50–13:20)" */
export function periodRange(start: number, end: number, periods: { start: string; end: string }[]): string {
  const label = start === end ? `P${start + 1}` : `P${start + 1}–P${end + 1}`;
  return `${label} (${periods[start]?.start ?? "?"}–${periods[end]?.end ?? "?"})`;
}
