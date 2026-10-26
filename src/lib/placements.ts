// Placement drives: who is away, and which classes that hits. Pure: no DB or framework imports.

import type { Assignment, Problem, SectionInput } from "./solver/types";

/** Students from one section attending a drive. */
export interface Attendance {
  sectionId: string;
  count: number;
}

export interface RollRow {
  roll: string;
  sectionId: string;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Seat a round's students across its rooms in proportion to each room's capacity, never more
 * than a room holds. Rooms come back in the order given; `short` is how many don't fit.
 */
export function splitSeats(total: number, rooms: { id: string; capacity: number }[]): { seats: { roomId: string; seats: number }[]; short: number } {
  const capacity = rooms.reduce((n, r) => n + r.capacity, 0);
  if (total >= capacity) return { seats: rooms.map((r) => ({ roomId: r.id, seats: r.capacity })), short: total - capacity };
  const exact = rooms.map((r) => (total * r.capacity) / capacity);
  const seats = exact.map(Math.floor);
  // Hand out the remainder by the largest fractions (exact <= capacity, so no room overflows).
  let left = total - seats.reduce((n, s) => n + s, 0);
  for (const i of exact.map((_, i) => i).sort((a, b) => exact[b] - seats[b] - (exact[a] - seats[a]))) {
    if (!left) break;
    if (seats[i] < rooms[i].capacity) {
      seats[i]++;
      left--;
    }
  }
  return { seats: rooms.map((r, i) => ({ roomId: r.id, seats: seats[i] })), short: 0 };
}

/**
 * Parse pasted "roll number, section" lines (comma, tab or semicolon separated; a header line
 * is skipped). Sections match by name, ignoring case, spaces and dashes.
 */
export function parseRolls(text: string, sections: Pick<SectionInput, "id" | "name">[]): { rows: RollRow[]; errors: string[] } {
  const rows: RollRow[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  const byName = new Map(sections.map((s) => [norm(s.name), s.id]));
  text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .forEach((line, i) => {
      if (!line) return;
      const [roll = "", section = ""] = line.split(/[,\t;]/).map((x) => x.trim().replace(/^"|"$/g, ""));
      if (i === 0 && /roll|reg|id/i.test(roll) && /section|class|div/i.test(section)) return;
      if (!roll || !section) {
        errors.push(`Line ${i + 1}: expected "roll number, section".`);
        return;
      }
      const sectionId = byName.get(norm(section));
      if (!sectionId) {
        errors.push(`Line ${i + 1}: no section called "${section}".`);
        return;
      }
      if (seen.has(roll.toLowerCase())) return; // duplicates count once
      seen.add(roll.toLowerCase());
      rows.push({ roll, sectionId });
    });
  return { rows, errors };
}

export function countsFromRolls(rows: RollRow[]): Attendance[] {
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.sectionId, (m.get(r.sectionId) ?? 0) + 1);
  return [...m].map(([sectionId, count]) => ({ sectionId, count }));
}

export interface ClassHit {
  lessonId: string;
  label: string;
  period: number;
  duration: number;
  teacherIds: string[];
  sectionIds: string[];
  /** Students of this class expected to be at the drive. */
  away: number;
  /** Students in this class. */
  size: number;
}

/**
 * Classes on timetable day `dayIndex` overlapping periods [start, end] that have students at
 * the drive. Batch classes get the section's share by batch size. Cancelled classes are skipped.
 */
export function classesHit(
  problem: Problem,
  assignment: Assignment,
  dayIndex: number,
  start: number,
  end: number,
  attending: Attendance[],
  cancelled: Set<string> = new Set(),
): ClassHit[] {
  const sections = new Map(problem.input.sections.map((s) => [s.id, s]));
  const count = new Map(attending.map((a) => [a.sectionId, a.count]));
  const out: ClassHit[] = [];
  for (const l of problem.lessons) {
    const a = assignment[l.id];
    if (!a || a.day !== dayIndex || cancelled.has(l.id)) continue;
    if (a.period > end || a.period + l.duration - 1 < start) continue;
    let away = 0;
    for (const sid of l.sectionIds) {
      const n = count.get(sid) ?? 0;
      const sec = sections.get(sid);
      if (!n || !sec) continue;
      const batch = l.batchId ? sec.batches.find((b) => b.id === l.batchId) : null;
      away += batch ? Math.round((n * batch.size) / Math.max(1, sec.size)) : n;
    }
    if (!away) continue;
    out.push({ lessonId: l.id, label: l.label, period: a.period, duration: l.duration, teacherIds: l.teacherIds, sectionIds: l.sectionIds, away: Math.min(away, l.size), size: l.size });
  }
  return out.sort((x, y) => x.period - y.period || x.label.localeCompare(y.label));
}

export interface SectionImpact {
  sectionId: string;
  name: string;
  away: number;
  size: number;
  /** Classes (lessons) the attending students miss. */
  classes: number;
}

/** Per-section summary over all of a drive's rounds. */
export function sectionImpact(problem: Problem, attending: Attendance[], hits: ClassHit[]): SectionImpact[] {
  return attending
    .filter((a) => a.count > 0)
    .map((a) => {
      const s = problem.input.sections.find((x) => x.id === a.sectionId);
      return {
        sectionId: a.sectionId,
        name: s?.name ?? "Former section",
        away: a.count,
        size: s?.size ?? a.count,
        classes: new Set(hits.filter((h) => h.sectionIds.includes(a.sectionId)).map((h) => h.lessonId)).size,
      };
    })
    .sort((x, y) => y.classes - x.classes || x.name.localeCompare(y.name));
}
