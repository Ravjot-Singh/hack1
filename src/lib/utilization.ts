import type { Assignment, Problem } from "@/lib/solver/types";

// Room utilization for one timetable. Pure; no DB.

export interface RoomUse {
  id: string;
  name: string;
  type: string;
  buildingId: string | null;
  ownerDeptId: string | null;
  /** Lesson label per slot (day * P + period), or null when free. */
  slots: (string | null)[];
  used: number;
  /** Share of teaching periods the room is in use, 0..1. */
  share: number;
}

export interface Utilization {
  rooms: RoomUse[];
  /** Slots where any grid holds classes (breaks and closed periods excluded). */
  teachingSlots: number[];
  /** Share of rooms in use per slot, 0..1. */
  busyBySlot: number[];
  averageShare: number;
  underused: RoomUse[];
  unused: RoomUse[];
  peakSlot: number;
}

export function utilization(problem: Problem, assignment: Assignment, underusedBelow = 0.3): Utilization {
  const { input, lessons } = problem;
  const D = input.days.length;
  const P = input.periods.length;
  const teachingSlots = Array.from({ length: D * P }, (_, s) => s).filter((s) =>
    input.grids.some((g) => g.open[Math.floor(s / P)]?.[s % P]),
  );
  const teaching = new Set(teachingSlots);

  const rooms: RoomUse[] = input.rooms
    .filter((r) => !r.isEventVenue)
    .map((r) => ({ id: r.id, name: r.name, type: r.type, buildingId: r.buildingId, ownerDeptId: r.ownerDeptId, slots: new Array(D * P).fill(null), used: 0, share: 0 }));
  const byId = new Map(rooms.map((r) => [r.id, r]));
  for (const l of lessons) {
    const a = assignment[l.id];
    const room = a && byId.get(a.roomId);
    if (!room) continue;
    for (let k = 0; k < l.duration; k++) room.slots[a.day * P + a.period + k] = l.label;
  }
  for (const r of rooms) {
    r.used = r.slots.filter((x, s) => x && teaching.has(s)).length;
    r.share = teachingSlots.length ? r.used / teachingSlots.length : 0;
  }

  const busyBySlot = Array.from({ length: D * P }, (_, s) =>
    rooms.length && teaching.has(s) ? rooms.filter((r) => r.slots[s]).length / rooms.length : 0,
  );
  const peakSlot = busyBySlot.reduce((best, v, s) => (v > busyBySlot[best] ? s : best), teachingSlots[0] ?? 0);
  const averageShare = rooms.length ? rooms.reduce((n, r) => n + r.share, 0) / rooms.length : 0;
  return {
    rooms,
    teachingSlots,
    busyBySlot,
    averageShare,
    underused: rooms.filter((r) => r.used > 0 && r.share < underusedBelow).sort((a, b) => a.share - b.share),
    unused: rooms.filter((r) => r.used === 0),
    peakSlot,
  };
}
