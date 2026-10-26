// Rooms out of service (broken equipment, maintenance) and the classes that clash with it.
// Pure: no DB or framework imports.

import type { Member } from "./permissions";
import type { Assignment, Problem, RoomInput, SubjectInput } from "./solver/types";

export interface Downtime {
  id: string;
  roomId: string;
  /** Inclusive "YYYY-MM-DD" range. */
  from: string;
  to: string;
  /** 0-based periods; empty = the whole day. */
  periods: number[];
  reason: string;
}

/** room id -> period -> reason, for rooms out of service on `date`. */
export function downMap(downtimes: Downtime[], date: string, periodCount: number): Map<string, Map<number, string>> {
  const out = new Map<string, Map<number, string>>();
  for (const d of downtimes) {
    if (date < d.from || date > d.to) continue;
    const m = out.get(d.roomId) ?? new Map<number, string>();
    for (const p of d.periods.length ? d.periods : Array.from({ length: periodCount }, (_, i) => i)) if (!m.has(p)) m.set(p, d.reason);
    out.set(d.roomId, m);
  }
  return out;
}

/**
 * Room types used for practicals: what a lab assistant looks after. A type any subject also
 * uses for theory isn't a lab, so one subject's lab type (an HOD can set it) can't turn every
 * classroom into something a lab assistant may take out of service.
 */
export function labTypes(subjects: Pick<SubjectInput, "P" | "labRoomType" | "theoryRoomType">[]): Set<string> {
  const theory = new Set(subjects.map((s) => s.theoryRoomType));
  return new Set(subjects.filter((s) => s.P > 0 && s.labRoomType && !theory.has(s.labRoomType)).map((s) => s.labRoomType));
}

/**
 * Admins and the Venue Manager may mark any room; a lab assistant only labs of their
 * department (or, with no department, the common labs).
 */
export function canManageRoom(member: Member | null, room: Pick<RoomInput, "type" | "ownerDeptId" | "isEventVenue">, labs: Set<string>): boolean {
  if (!member) return false;
  if (member.role === "INSTITUTE_ADMIN" || member.role === "VENUE_MANAGER") return true;
  if (member.role !== "LAB_ASSISTANT" || room.isEventVenue || !labs.has(room.type)) return false;
  return (room.ownerDeptId ?? null) === (member.departmentId ?? null);
}

export interface Clash {
  lessonId: string;
  label: string;
  period: number;
  duration: number;
  roomId: string;
  size: number;
  roomType: string;
  reason: string;
}

/**
 * Classes on timetable day `dayIndex` whose room is out of service during them. Cancelled
 * classes and classes already moved to a working room are left out.
 */
export function clashes(
  problem: Problem,
  assignment: Assignment,
  dayIndex: number,
  down: Map<string, Map<number, string>>,
  opts: { cancelled?: Set<string>; moves?: Map<string, string> } = {},
): Clash[] {
  const out: Clash[] = [];
  for (const l of problem.lessons) {
    const a = assignment[l.id];
    if (!a || a.day !== dayIndex || opts.cancelled?.has(l.id)) continue;
    const roomId = opts.moves?.get(l.id) ?? a.roomId;
    const m = down.get(roomId);
    if (!m) continue;
    let reason: string | undefined;
    for (let k = 0; k < l.duration && !reason; k++) reason = m.get(a.period + k);
    if (reason) out.push({ lessonId: l.id, label: l.label, period: a.period, duration: l.duration, roomId, size: l.size, roomType: l.roomType, reason });
  }
  return out.sort((x, y) => x.period - y.period || x.label.localeCompare(y.label));
}

/** Working rooms of the right type and size that are free for the whole class. */
export function replacementRooms(
  clash: Clash,
  rooms: Pick<RoomInput, "id" | "name" | "type" | "capacity" | "isEventVenue">[],
  busy: (roomId: string, period: number) => boolean,
  limit = 4,
): { id: string; name: string; capacity: number }[] {
  return rooms
    .filter((r) => r.id !== clash.roomId && !r.isEventVenue && r.type === clash.roomType && r.capacity >= clash.size)
    .filter((r) => Array.from({ length: clash.duration }, (_, k) => clash.period + k).every((p) => !busy(r.id, p)))
    .sort((a, b) => a.capacity - b.capacity)
    .slice(0, limit)
    .map((r) => ({ id: r.id, name: r.name, capacity: r.capacity }));
}
