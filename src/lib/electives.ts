// Elective registration: windows, seat limits and turning choices into class sizes for the
// solver. Pure: no DB or framework imports.

export interface ElectiveWindowInfo {
  opensOn: string;
  closesOn: string;
  /** offeringId -> seat limit (missing = no limit). */
  seats: Record<string, number>;
}

export type WindowState = "upcoming" | "open" | "closed";

export function windowState(w: ElectiveWindowInfo, today: string): WindowState {
  return today < w.opensOn ? "upcoming" : today > w.closesOn ? "closed" : "open";
}

/** Registrations per offering. */
export function countChoices(choices: { offeringId: string }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of choices) out[c.offeringId] = (out[c.offeringId] ?? 0) + 1;
  return out;
}

/** Why the student can't take `offeringId` now, or null. Moving an existing choice frees its seat. */
export function choiceProblem(args: {
  window: ElectiveWindowInfo | null;
  today: string;
  studentSectionId: string | null;
  basketSectionIds: string[];
  offeringId: string;
  offeringIds: string[];
  counts: Record<string, number>;
  current: string | null;
  label: (offeringId: string) => string;
}): string | null {
  const { window, today, offeringId, counts, current } = args;
  if (!window) return "Registration isn't set up for this basket.";
  const state = windowState(window, today);
  if (state === "upcoming") return `Registration opens on ${window.opensOn}.`;
  if (state === "closed") return `Registration closed on ${window.closesOn}.`;
  if (!args.studentSectionId || !args.basketSectionIds.includes(args.studentSectionId)) return "This basket isn't offered to your section.";
  if (!args.offeringIds.includes(offeringId)) return "That elective isn't in this basket.";
  if (current === offeringId) return "You have already chosen it.";
  const limit = window.seats[offeringId];
  if (limit != null && (counts[offeringId] ?? 0) >= limit) return `${args.label(offeringId)} is full (${limit} seats).`;
  return null;
}

/**
 * Class sizes from registrations. "registered" uses the counts as they are; "scaled" spreads
 * all the basket's students in the same proportions (for students who never registered),
 * keeping the total exact. Every elective gets at least 1 so the solver still books a room.
 */
export function sizesFromChoices(
  offeringIds: string[],
  counts: Record<string, number>,
  mode: "registered" | "scaled",
  totalStudents: number,
  seats: Record<string, number> = {},
): Record<string, number> {
  const registered = offeringIds.reduce((n, id) => n + (counts[id] ?? 0), 0);
  if (mode === "registered" || !registered) return Object.fromEntries(offeringIds.map((id) => [id, Math.max(1, counts[id] ?? 0)]));
  // Proportional shares, but an elective never grows past its seat limit: capped ones are
  // fixed and the rest of the students are shared again among the others.
  const out: Record<string, number> = {};
  let open = offeringIds.filter((id) => counts[id]);
  let remaining = totalStudents;
  for (;;) {
    const weight = open.reduce((n, id) => n + counts[id], 0);
    const capped = open.filter((id) => seats[id] != null && (counts[id] * remaining) / weight > seats[id]);
    if (!capped.length || !weight) break;
    for (const id of capped) {
      out[id] = seats[id];
      remaining -= seats[id];
    }
    open = open.filter((id) => !capped.includes(id));
  }
  const weight = open.reduce((n, id) => n + counts[id], 0);
  const sizes = open.map((id) => {
    const share = weight ? (counts[id] * Math.max(0, remaining)) / weight : 0;
    return { id, n: Math.floor(share), rest: share - Math.floor(share) };
  });
  let left = Math.max(0, remaining) - sizes.reduce((n, x) => n + x.n, 0);
  for (const x of [...sizes].sort((a, b) => b.rest - a.rest)) {
    if (left <= 0) break;
    x.n++;
    left--;
  }
  for (const x of sizes) out[x.id] = x.n;
  return Object.fromEntries(offeringIds.map((id) => [id, Math.max(1, out[id] ?? 0)]));
}

/** Electives whose size won't fit any room of their type. */
export function roomWarnings(
  sizes: Record<string, number>,
  offerings: { id: string; label: string; roomType: string }[],
  rooms: { type: string; capacity: number; isEventVenue: boolean }[],
): string[] {
  return offerings.flatMap((o) => {
    const largest = Math.max(0, ...rooms.filter((r) => !r.isEventVenue && r.type === o.roomType).map((r) => r.capacity));
    return (sizes[o.id] ?? 0) > largest ? [`${o.label}: ${sizes[o.id]} students but the largest ${o.roomType} holds ${largest}.`] : [];
  });
}
