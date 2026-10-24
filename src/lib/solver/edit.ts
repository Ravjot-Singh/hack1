import { Engine } from "./engine";
import { score } from "./score";
import type { Assignment, Problem } from "./types";

export type SlotOption =
  | { kind: "current" }
  | { kind: "move"; quality: number }
  | { kind: "swap"; quality: number; withLessonId: string; withLabel: string }
  | { kind: "blocked"; reason: string };

/**
 * Manual editing on top of the solver engine: for a picked class, say for every slot whether
 * it can move there, swap with what is there, or why not, using the same hard rules as the solver.
 * Pinned units are never moved by a swap.
 */
export class EditSession {
  readonly engine: Engine;
  private readonly lessonIdx: Map<string, number>;

  constructor(
    readonly problem: Problem,
    assignment: Assignment,
    private pinned: Set<string> = new Set(),
  ) {
    this.engine = new Engine(problem);
    this.lessonIdx = new Map(problem.lessons.map((l, i) => [l.id, i]));
    const e = this.engine;
    const roomIdx = new Map(e.roomIds.map((id, i) => [id, i]));
    for (let u = 0; u < e.uLessons.length; u++) {
      const ls = e.uLessons[u];
      const first = assignment[problem.lessons[ls[0]].id];
      if (!first) continue;
      const rooms = ls.map((l) => roomIdx.get(assignment[problem.lessons[l].id]?.roomId ?? "") ?? -1);
      if (rooms.some((r) => r < 0)) continue;
      e.place(u, first.day * e.P + first.period, rooms);
    }
  }

  unitOf(lessonId: string): number {
    return this.engine.lUnit[this.lessonIdx.get(lessonId) ?? -1] ?? -1;
  }

  /** Lesson ids that move together with this one (parallel electives in a basket). */
  unitLessons(lessonId: string): string[] {
    const u = this.unitOf(lessonId);
    return u < 0 ? [] : this.engine.uLessons[u].map((l) => this.problem.lessons[l].id);
  }

  isPinned(lessonId: string) {
    return this.unitLessons(lessonId).some((id) => this.pinned.has(id));
  }

  assignment(): Assignment {
    return this.engine.toAssignment();
  }

  quality(): number {
    return score(this.problem, this.assignment()).quality;
  }

  /** Every slot's option for the unit of `lessonId`, keyed by `${day}:${period}`. */
  options(lessonId: string): Map<string, SlotOption> {
    const e = this.engine;
    const u = this.unitOf(lessonId);
    const out = new Map<string, SlotOption>();
    const from = e.unitStart[u];
    if (u < 0 || from < 0) return out;
    const fromRooms = e.roomsOf(u);
    e.remove(u);
    try {
      for (let d = 0; d < e.D; d++) {
        for (let p = 0; p < e.P; p++) {
          const slot = d * e.P + p;
          const key = `${d}:${p}`;
          if (slot === from) {
            out.set(key, { kind: "current" });
            continue;
          }
          const closed = e.closedFor(u, slot);
          if (closed) {
            out.set(key, { kind: "blocked", reason: closed === "the day ends" ? "Runs past the end of the day" : `Break or closed period for ${closed}` });
            continue;
          }
          const rooms = e.tryPlace(u, slot);
          if (rooms) {
            e.place(u, slot, rooms);
            out.set(key, { kind: "move", quality: this.quality() });
            e.remove(u);
            continue;
          }
          const swap = this.trySwap(u, from, slot);
          out.set(key, swap ?? { kind: "blocked", reason: capitalise(e.reasonAt(u, slot)) });
        }
      }
    } finally {
      if (e.unitStart[u] < 0) e.place(u, from, fromRooms);
    }
    return out;
  }

  /** Swap u (currently removed, originally at `from`) with the single unit blocking `slot`. */
  private trySwap(u: number, from: number, slot: number): SlotOption | null {
    const e = this.engine;
    const blockers = e.conflicts(u, slot);
    if (!blockers || blockers.size !== 1) return null;
    const [v] = blockers;
    const vLesson = this.problem.lessons[e.uLessons[v][0]];
    if (this.isPinned(vLesson.id)) return null;
    const vFrom = e.unitStart[v];
    const vRooms = e.roomsOf(v);
    e.remove(v);
    let result: SlotOption | null = null;
    const uRooms = e.tryPlace(u, slot);
    if (uRooms) {
      e.place(u, slot, uRooms);
      const vNew = e.tryPlace(v, from);
      if (vNew) {
        e.place(v, from, vNew);
        result = { kind: "swap", quality: this.quality(), withLessonId: vLesson.id, withLabel: vLesson.label };
        e.remove(v);
      }
      e.remove(u);
    }
    e.place(v, vFrom, vRooms);
    return result;
  }

  /** Apply a move or swap chosen from `options`. Returns false if it is no longer valid. */
  apply(lessonId: string, day: number, period: number): boolean {
    const e = this.engine;
    const u = this.unitOf(lessonId);
    const from = e.unitStart[u];
    const fromRooms = e.roomsOf(u);
    const slot = day * e.P + period;
    e.remove(u);
    const rooms = e.tryPlace(u, slot);
    if (rooms) {
      e.place(u, slot, rooms);
      return true;
    }
    const blockers = e.conflicts(u, slot);
    if (blockers?.size === 1) {
      const [v] = blockers;
      if (!this.isPinned(this.problem.lessons[e.uLessons[v][0]].id)) {
        const vFrom = e.unitStart[v];
        const vRooms = e.roomsOf(v);
        e.remove(v);
        const uRooms = e.tryPlace(u, slot);
        if (uRooms) {
          e.place(u, slot, uRooms);
          const vNew = e.tryPlace(v, from);
          if (vNew) {
            e.place(v, from, vNew);
            return true;
          }
          e.remove(u);
        }
        e.place(v, vFrom, vRooms);
      }
    }
    e.place(u, from, fromRooms);
    return false;
  }
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
