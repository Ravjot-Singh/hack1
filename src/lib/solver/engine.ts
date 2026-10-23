import { travelMinutes, walkAllowance } from "./time";
import type { Assignment, Problem } from "./types";

/** Small seeded PRNG so solves are reproducible. */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Compiled, index-based view of a Problem plus the mutable placement state.
 * Slots are numbered day * P + period. Occupancy arrays store index + 1 (0 = free).
 */
export class Engine {
  readonly D: number;
  readonly P: number;
  readonly S: number;
  readonly problem: Problem;

  // Static, per lesson
  readonly lTeachers: number[][];
  readonly lAtoms: number[][];
  readonly lRooms: number[][];
  readonly lUnit: number[];
  readonly lSpread: number[];
  readonly lDur: number[];
  // Static, per unit
  readonly uLessons: number[][];
  readonly uDur: number[];
  readonly uTeachers: number[][];
  readonly uAtoms: number[][];
  readonly uStarts: number[][];
  readonly uPinned: ({ slot: number; rooms: number[] } | null)[];
  // Static, per entity
  readonly teacherMaxDay: number[];
  readonly teacherMaxWeek: number[];
  readonly teacherPref: Int8Array[];
  readonly roomBuilding: number[];
  readonly travel: number[][];
  readonly allowance: number[];

  // Mutable state
  readonly teacherOcc: Int32Array[]; // lesson + 1
  readonly roomOcc: Int32Array[]; // lesson + 1
  readonly atomOcc: Int32Array[]; // lesson + 1
  readonly teacherDay: Int32Array; // t * D + d -> periods
  readonly teacherWeek: Int32Array; // t -> periods
  readonly atomDay: Int32Array; // a * D + d -> periods
  readonly spreadDay: Int32Array; // spreadKey * D + d -> lessons
  readonly unitStart: Int32Array; // -1 = unplaced
  readonly lessonRoom: Int32Array;

  readonly teacherIds: string[];
  readonly roomIds: string[];
  readonly atomIds: string[];
  readonly maxConsecS: number;
  readonly maxConsecT: number;
  readonly travelHard: boolean;

  constructor(problem: Problem) {
    this.problem = problem;
    const { input, lessons, units } = problem;
    this.D = input.days.length;
    this.P = input.periods.length;
    this.S = this.D * this.P;
    const { D, P, S } = this;

    this.teacherIds = input.teachers.map((t) => t.id);
    this.roomIds = input.rooms.map((r) => r.id);
    this.atomIds = Object.keys(problem.atomNames);
    const tIdx = new Map(this.teacherIds.map((id, i) => [id, i]));
    const aIdx = new Map(this.atomIds.map((id, i) => [id, i]));
    const uIdx = new Map(units.map((u, i) => [u.id, i]));
    const lIdx = new Map(lessons.map((l, i) => [l.id, i]));
    const bIdx = new Map(input.buildings.map((b, i) => [b.id, i]));

    this.maxConsecS = input.rules.maxConsecutiveSection ?? Infinity;
    this.maxConsecT = input.rules.maxConsecutiveTeacher ?? Infinity;
    this.travelHard = input.rules.travelTimeHard;
    this.teacherMaxDay = input.teachers.map((t) => t.maxPerDay);
    this.teacherMaxWeek = input.teachers.map((t) => t.maxPerWeek);
    this.teacherPref = input.teachers.map((t) => {
      const arr = new Int8Array(S);
      for (const p of t.prefs) if (p.day < D && p.period < P) arr[p.day * P + p.period] = p.value === "AVOID" ? 1 : -1;
      return arr;
    });
    this.roomBuilding = input.rooms.map((r) => (r.buildingId ? (bIdx.get(r.buildingId) ?? -1) : -1));
    this.travel = input.buildings.map((a) => input.buildings.map((b) => travelMinutes(input, a.id, b.id)));
    this.allowance = Array.from({ length: P }, (_, p) => walkAllowance(input, p));

    const spreadKeys = new Map<string, number>();
    this.lTeachers = lessons.map((l) => l.teacherIds.map((id) => tIdx.get(id)!).filter((x) => x !== undefined));
    this.lAtoms = lessons.map((l) => l.atoms.map((id) => aIdx.get(id)!).filter((x) => x !== undefined));
    this.lUnit = lessons.map((l) => uIdx.get(l.unitId)!);
    this.lDur = lessons.map((l) => l.duration);
    this.lSpread = lessons.map((l) => {
      const key = `${l.offeringId}|${l.kind === "P" ? (l.batchId ?? "all") : "theory"}`;
      if (!spreadKeys.has(key)) spreadKeys.set(key, spreadKeys.size);
      return spreadKeys.get(key)!;
    });
    this.lRooms = lessons.map((l) =>
      input.rooms
        .map((r, i) => ({ r, i }))
        .filter(({ r }) => !r.isEventVenue && r.type === l.roomType && r.capacity >= l.size)
        .sort((x, y) => {
          // Own department's rooms first, then common rooms, then other departments' rooms; best fit by size.
          const rank = (o: string | null) => (o === l.deptId ? 0 : o === null ? 1 : 2);
          return rank(x.r.ownerDeptId) - rank(y.r.ownerDeptId) || x.r.capacity - y.r.capacity;
        })
        .map(({ i }) => i),
    );

    this.uLessons = units.map((u) => u.lessonIds.map((id) => lIdx.get(id)!));
    this.uDur = units.map((u) => u.duration);
    this.uTeachers = this.uLessons.map((ls) => [...new Set(ls.flatMap((l) => this.lTeachers[l]))]);
    this.uAtoms = this.uLessons.map((ls) => [...new Set(ls.flatMap((l) => this.lAtoms[l]))]);

    const sections = new Map(input.sections.map((s) => [s.id, s]));
    const grids = new Map(input.grids.map((g) => [g.id, g]));
    this.uStarts = units.map((u, ui) => {
      const dur = u.duration;
      const ls = this.uLessons[ui];
      const secGrids = [...new Set(ls.flatMap((l) => lessons[l].sectionIds))].map(
        (sid) => grids.get(sections.get(sid)?.gridId ?? ""),
      );
      // A teacher listed on two parallel lessons of one unit can never be placed.
      const tCount = ls.flatMap((l) => this.lTeachers[l]);
      if (new Set(tCount).size !== tCount.length) return [];
      if (ls.some((l) => !this.lRooms[l].length)) return [];
      if (dur > this.maxConsecS || dur > this.maxConsecT) return [];
      const starts: number[] = [];
      for (let d = 0; d < D; d++) {
        outer: for (let p = 0; p + dur <= P; p++) {
          for (const g of secGrids) for (let k = p; k < p + dur; k++) if (!g?.open[d]?.[k]) continue outer;
          for (const t of this.uTeachers[ui]) {
            if (dur > this.teacherMaxDay[t]) continue outer;
            const un = input.teachers[t].unavailable;
            if (un.some(([ud, up]) => ud === d && up >= p && up < p + dur)) continue outer;
          }
          starts.push(d * P + p);
        }
      }
      return starts;
    });

    const roomIdx = new Map(this.roomIds.map((id, i) => [id, i]));
    this.uPinned = units.map(() => null);
    for (const pin of input.pins ?? []) {
      const li = lIdx.get(pin.lessonId);
      const ri = roomIdx.get(pin.roomId);
      if (li === undefined || ri === undefined) continue;
      const u = this.lUnit[li];
      const cur = this.uPinned[u] ?? { slot: pin.day * P + pin.period, rooms: this.uLessons[u].map(() => -1) };
      cur.rooms[this.uLessons[u].indexOf(li)] = ri;
      this.uPinned[u] = cur;
    }

    this.teacherOcc = this.teacherIds.map(() => new Int32Array(S));
    this.roomOcc = this.roomIds.map(() => new Int32Array(S));
    this.atomOcc = this.atomIds.map(() => new Int32Array(S));
    this.teacherDay = new Int32Array(this.teacherIds.length * D);
    this.teacherWeek = new Int32Array(this.teacherIds.length);
    this.atomDay = new Int32Array(this.atomIds.length * D);
    this.spreadDay = new Int32Array(Math.max(1, spreadKeys.size) * D);
    this.unitStart = new Int32Array(units.length).fill(-1);
    this.lessonRoom = new Int32Array(lessons.length).fill(-1);
  }

  /** Length of the busy run through [p, p + dur) on day d if it were filled. */
  private runLength(occ: Int32Array, d: number, p: number, dur: number): number {
    const base = d * this.P;
    let left = 0;
    for (let k = p - 1; k >= 0 && occ[base + k]; k--) left++;
    let right = 0;
    for (let k = p + dur; k < this.P && occ[base + k]; k++) right++;
    return left + dur + right;
  }

  private travelOk(lesson: number, room: number, slot: number, dur: number, singleUnit: boolean): boolean {
    if (!this.travelHard) return true;
    const b = this.roomBuilding[room];
    if (b < 0) return true;
    const p = slot % this.P;
    const check = (other: number, gapPeriod: number) => {
      if (!other) return true;
      const r2 = this.lessonRoom[other - 1];
      const b2 = r2 >= 0 ? this.roomBuilding[r2] : -1;
      return b2 < 0 || this.travel[b][b2] <= this.allowance[gapPeriod];
    };
    const prev = p > 0 ? slot - 1 : -1;
    const next = p + dur < this.P ? slot + dur : -1;
    for (const t of this.lTeachers[lesson]) {
      if (prev >= 0 && !check(this.teacherOcc[t][prev], p - 1)) return false;
      if (next >= 0 && !check(this.teacherOcc[t][next], p + dur - 1)) return false;
    }
    if (!singleUnit) return true;
    for (const a of this.lAtoms[lesson]) {
      for (const [s, gp] of [
        [prev, p - 1],
        [next, p + dur - 1],
      ]) {
        if (s < 0) continue;
        const other = this.atomOcc[a][s];
        if (other && this.uLessons[this.lUnit[other - 1]].length === 1 && !check(other, gp)) return false;
      }
    }
    return true;
  }

  /** Rooms (one per lesson of the unit) if the unit can be placed at `slot`, else null. */
  tryPlace(u: number, slot: number, forcedRooms?: number[]): number[] | null {
    const dur = this.uDur[u];
    const d = Math.floor(slot / this.P);
    const p = slot % this.P;
    for (const t of this.uTeachers[u]) {
      const occ = this.teacherOcc[t];
      for (let k = 0; k < dur; k++) if (occ[slot + k]) return null;
      if (this.teacherDay[t * this.D + d] + dur > this.teacherMaxDay[t]) return null;
      if (this.teacherWeek[t] + dur > this.teacherMaxWeek[t]) return null;
      if (this.runLength(occ, d, p, dur) > this.maxConsecT) return null;
    }
    for (const a of this.uAtoms[u]) {
      const occ = this.atomOcc[a];
      for (let k = 0; k < dur; k++) if (occ[slot + k]) return null;
      if (this.runLength(occ, d, p, dur) > this.maxConsecS) return null;
    }
    const lessons = this.uLessons[u];
    const single = lessons.length === 1;
    const chosen: number[] = new Array(lessons.length).fill(-1);
    // Lessons with the fewest room options choose first.
    const order = lessons.map((_, i) => i).sort((x, y) => this.lRooms[lessons[x]].length - this.lRooms[lessons[y]].length);
    for (const i of order) {
      const l = lessons[i];
      const candidates = forcedRooms && forcedRooms[i] >= 0 ? [forcedRooms[i]] : this.lRooms[l];
      let pick = -1;
      for (const r of candidates) {
        if (chosen.includes(r)) continue;
        const occ = this.roomOcc[r];
        let free = true;
        for (let k = 0; k < dur; k++) if (occ[slot + k]) { free = false; break; }
        if (free && this.travelOk(l, r, slot, dur, single)) { pick = r; break; }
      }
      if (pick < 0) return null;
      chosen[i] = pick;
    }
    return chosen;
  }

  place(u: number, slot: number, rooms: number[]) {
    const dur = this.uDur[u];
    const d = Math.floor(slot / this.P);
    this.unitStart[u] = slot;
    this.uLessons[u].forEach((l, i) => {
      this.lessonRoom[l] = rooms[i];
      for (let k = 0; k < dur; k++) {
        for (const t of this.lTeachers[l]) this.teacherOcc[t][slot + k] = l + 1;
        for (const a of this.lAtoms[l]) this.atomOcc[a][slot + k] = l + 1;
        this.roomOcc[rooms[i]][slot + k] = l + 1;
      }
      for (const t of this.lTeachers[l]) {
        this.teacherDay[t * this.D + d] += dur;
        this.teacherWeek[t] += dur;
      }
      this.spreadDay[this.lSpread[l] * this.D + d]++;
    });
    for (const a of this.uAtoms[u]) this.atomDay[a * this.D + d] += dur;
  }

  remove(u: number) {
    const slot = this.unitStart[u];
    if (slot < 0) return;
    const dur = this.uDur[u];
    const d = Math.floor(slot / this.P);
    for (const l of this.uLessons[u]) {
      for (let k = 0; k < dur; k++) {
        for (const t of this.lTeachers[l]) this.teacherOcc[t][slot + k] = 0;
        for (const a of this.lAtoms[l]) this.atomOcc[a][slot + k] = 0;
        this.roomOcc[this.lessonRoom[l]][slot + k] = 0;
      }
      for (const t of this.lTeachers[l]) {
        this.teacherDay[t * this.D + d] -= dur;
        this.teacherWeek[t] -= dur;
      }
      this.spreadDay[this.lSpread[l] * this.D + d]--;
      this.lessonRoom[l] = -1;
    }
    for (const a of this.uAtoms[u]) this.atomDay[a * this.D + d] -= dur;
    this.unitStart[u] = -1;
  }

  roomsOf(u: number): number[] {
    return this.uLessons[u].map((l) => this.lessonRoom[l]);
  }

  /**
   * Units that would have to be removed to place `u` at `slot` (teacher, student and the
   * cheapest room conflicts). Null if a pinned unit is in the way.
   */
  conflicts(u: number, slot: number): Set<number> | null {
    const dur = this.uDur[u];
    const out = new Set<number>();
    const addOcc = (occ: Int32Array) => {
      for (let k = 0; k < dur; k++) {
        const v = occ[slot + k];
        if (v) out.add(this.lUnit[v - 1]);
      }
    };
    for (const t of this.uTeachers[u]) addOcc(this.teacherOcc[t]);
    for (const a of this.uAtoms[u]) addOcc(this.atomOcc[a]);
    const used: number[] = [];
    for (const l of this.uLessons[u]) {
      let best: number[] | null = null;
      let bestRoom = -1;
      for (const r of this.lRooms[l]) {
        if (used.includes(r)) continue;
        const extra: number[] = [];
        for (let k = 0; k < dur; k++) {
          const v = this.roomOcc[r][slot + k];
          if (v) {
            const ou = this.lUnit[v - 1];
            if (!out.has(ou) && !extra.includes(ou)) extra.push(ou);
          }
        }
        if (!best || extra.length < best.length) {
          best = extra;
          bestRoom = r;
          if (!extra.length) break;
        }
      }
      if (!best) return null;
      used.push(bestRoom);
      for (const x of best) out.add(x);
    }
    for (const x of out) if (this.uPinned[x]) return null;
    return out;
  }

  /** Soft cost of placing unplaced unit `u` at `slot` (lower is better). */
  cost(u: number, slot: number): number {
    const w = this.problem.input.rules.weights;
    const dur = this.uDur[u];
    const d = Math.floor(slot / this.P);
    const p = slot % this.P;
    let c = 0;
    if (w.teacherPrefs) {
      for (const t of this.uTeachers[u]) {
        const pref = this.teacherPref[t];
        for (let k = 0; k < dur; k++) c += pref[slot + k] > 0 ? 3 * w.teacherPrefs : pref[slot + k] < 0 ? -w.teacherPrefs : 0;
      }
    }
    if (w.subjectSpread) {
      for (const l of this.uLessons[u]) if (this.spreadDay[this.lSpread[l] * this.D + d]) c += 4 * w.subjectSpread;
    }
    const atoms = this.uAtoms[u];
    if (atoms.length && (w.balancedDays || w.idleGaps)) {
      let bal = 0;
      let gap = 0;
      for (const a of atoms) {
        const load = this.atomDay[a * this.D + d];
        bal += load;
        if (load) {
          const occ = this.atomOcc[a];
          const base = d * this.P;
          const adjacent = (p > 0 && occ[base + p - 1]) || (p + dur < this.P && occ[base + p + dur]);
          gap += adjacent ? -1 : 1;
        }
      }
      c += (w.balancedDays * 0.5 * bal + w.idleGaps * gap) / atoms.length;
    }
    if (w.balancedDays) for (const t of this.uTeachers[u]) c += 0.3 * w.balancedDays * this.teacherDay[t * this.D + d];
    return c + 0.02 * p;
  }

  snapshot(): { starts: Int32Array; rooms: Int32Array } {
    return { starts: this.unitStart.slice(), rooms: this.lessonRoom.slice() };
  }

  restore(snap: { starts: Int32Array; rooms: Int32Array }) {
    for (let u = 0; u < this.unitStart.length; u++) this.remove(u);
    for (let u = 0; u < snap.starts.length; u++) {
      if (snap.starts[u] >= 0) this.place(u, snap.starts[u], this.uLessons[u].map((l) => snap.rooms[l]));
    }
  }

  placedCount(): number {
    let n = 0;
    for (let u = 0; u < this.unitStart.length; u++) if (this.unitStart[u] >= 0) n++;
    return n;
  }

  toAssignment(): Assignment {
    const out: Assignment = {};
    const { lessons } = this.problem;
    for (let u = 0; u < this.unitStart.length; u++) {
      const slot = this.unitStart[u];
      if (slot < 0) continue;
      for (const l of this.uLessons[u]) {
        out[lessons[l].id] = {
          day: Math.floor(slot / this.P),
          period: slot % this.P,
          roomId: this.roomIds[this.lessonRoom[l]],
        };
      }
    }
    return out;
  }

  /** Human-readable reasons why unit `u` cannot go anywhere right now, most common first. */
  blockReasons(u: number): string[] {
    const { input, lessons } = this.problem;
    const dur = this.uDur[u];
    const ls = this.uLessons[u];
    const intro: string[] = [];
    for (const l of ls) {
      if (!this.lRooms[l].length) {
        const les = lessons[l];
        const ofType = input.rooms.filter((r) => !r.isEventVenue && r.type === les.roomType);
        intro.push(
          ofType.length
            ? `No ${les.roomType} can hold ${les.size} students (largest is ${Math.max(...ofType.map((r) => r.capacity))}).`
            : `There is no room of type "${les.roomType}" in the institute.`,
        );
      }
    }
    const tList = ls.flatMap((l) => this.lTeachers[l]);
    const dup = tList.find((t, i) => tList.indexOf(t) !== i);
    if (dup !== undefined) intro.push(`${input.teachers[dup].name} is assigned to two electives that must run at the same time.`);
    if (dur > this.maxConsecS) intro.push(`It needs ${dur} periods in a row but students may only have ${this.maxConsecS} in a row.`);
    if (dur > this.maxConsecT) intro.push(`It needs ${dur} periods in a row but teachers may only teach ${this.maxConsecT} in a row.`);
    if (intro.length) return intro;

    const counts = new Map<string, number>();
    const bump = (r: string) => counts.set(r, (counts.get(r) ?? 0) + 1);
    const sections = new Map(input.sections.map((s) => [s.id, s]));
    const grids = new Map(input.grids.map((g) => [g.id, g]));
    let total = 0;
    for (let d = 0; d < this.D; d++) {
      for (let p = 0; p + dur <= this.P; p++) {
        const slot = d * this.P + p;
        const secs = [...new Set(ls.flatMap((l) => lessons[l].sectionIds))];
        const closed = secs.some((sid) => {
          const g = grids.get(sections.get(sid)?.gridId ?? "");
          for (let k = p; k < p + dur; k++) if (!g?.open[d]?.[k]) return true;
          return false;
        });
        if (closed) continue; // breaks/closed periods are not real options
        total++;
        bump(this.firstBlock(u, slot));
      }
    }
    if (!total) return [`Its section's week grid has no ${dur}-period stretch without a break.`];
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([reason, n]) => `${n} of ${total} possible slots: ${reason}`);
  }

  private firstBlock(u: number, slot: number): string {
    const { input } = this.problem;
    const dur = this.uDur[u];
    const d = Math.floor(slot / this.P);
    const p = slot % this.P;
    for (const t of this.uTeachers[u]) {
      const name = input.teachers[t].name;
      if (input.teachers[t].unavailable.some(([ud, up]) => ud === d && up >= p && up < p + dur)) return `${name} is unavailable`;
    }
    for (const t of this.uTeachers[u]) {
      for (let k = 0; k < dur; k++) if (this.teacherOcc[t][slot + k]) return `${input.teachers[t].name} is already teaching`;
    }
    for (const a of this.uAtoms[u]) {
      for (let k = 0; k < dur; k++) if (this.atomOcc[a][slot + k]) return `${this.problem.atomNames[this.atomIds[a]]} already has a class`;
    }
    for (const t of this.uTeachers[u]) {
      if (this.teacherWeek[t] + dur > this.teacherMaxWeek[t]) return `${input.teachers[t].name} reached the weekly limit of ${this.teacherMaxWeek[t]}`;
      if (this.teacherDay[t * this.D + d] + dur > this.teacherMaxDay[t]) return `${input.teachers[t].name} reached the daily limit of ${this.teacherMaxDay[t]}`;
      if (this.runLength(this.teacherOcc[t], d, p, dur) > this.maxConsecT) return `${input.teachers[t].name} would exceed ${this.maxConsecT} periods in a row`;
    }
    for (const a of this.uAtoms[u]) {
      if (this.runLength(this.atomOcc[a], d, p, dur) > this.maxConsecS) return `students would exceed ${this.maxConsecS} periods in a row`;
    }
    if (!this.tryPlace(u, slot)) {
      const l = this.problem.lessons[this.uLessons[u][0]];
      return `no free ${l.roomType} for ${l.size} students${this.travelHard ? " (within walking distance)" : ""}`;
    }
    return "blocked";
  }
}
