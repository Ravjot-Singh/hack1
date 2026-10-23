import { Engine, mulberry32 } from "./engine";

export interface SearchOptions {
  seed?: number;
  /** Max iterations of the construction phase (default 60 x units). */
  maxIterations?: number;
  timeLimitMs?: number;
  onProgress?: (iteration: number, placed: number, total: number) => void;
}

/**
 * Iterative forward search: repeatedly take the hardest unplaced unit and put it in its
 * cheapest feasible slot; if none is feasible, eject the fewest conflicting units and
 * re-queue them. Keeps the best (most complete) state seen.
 */
export function construct(engine: Engine, opts: SearchOptions = {}): { iterations: number } {
  const rand = mulberry32(opts.seed ?? 1);
  const U = engine.uDur.length;
  const deadline = Date.now() + (opts.timeLimitMs ?? 20000);
  const maxIter = opts.maxIterations ?? 60 * U + 1000;

  // Pinned units go in first, at their pinned slot.
  for (let u = 0; u < U; u++) {
    const pin = engine.uPinned[u];
    if (!pin) continue;
    const rooms = engine.tryPlace(u, pin.slot, pin.rooms);
    if (rooms) engine.place(u, pin.slot, rooms);
  }

  // Fewer options per period of demand = harder = earlier.
  const difficulty = Array.from({ length: U }, (_, u) => {
    const lessons = engine.uLessons[u].length;
    return engine.uStarts[u].length / (engine.uDur[u] * (1 + 0.5 * (lessons - 1)));
  });
  const ejected = new Int32Array(U);
  const stuck = new Int32Array(U);
  const unplaced = new Set<number>();
  // Pinned units that could not go at their pin stay unplaced (and get explained) rather than move.
  for (let u = 0; u < U; u++) if (engine.unitStart[u] < 0 && engine.uStarts[u].length && !engine.uPinned[u]) unplaced.add(u);
  const impossible = U - engine.placedCount() - unplaced.size;

  let best = engine.snapshot();
  let bestPlaced = engine.placedCount();
  let iter = 0;

  while (unplaced.size && iter < maxIter) {
    iter++;
    if ((iter & 63) === 0) {
      opts.onProgress?.(iter, engine.placedCount(), U);
      if (Date.now() > deadline) break;
    }

    let u = -1;
    let uKey = Infinity;
    for (const x of unplaced) {
      const key = difficulty[x] - 2 * ejected[x] + 4 * stuck[x];
      if (key < uKey) {
        uKey = key;
        u = x;
      }
    }

    // 1) Feasible slot with the lowest soft cost.
    let bestSlot = -1;
    let bestRooms: number[] | null = null;
    let bestCost = Infinity;
    for (const slot of engine.uStarts[u]) {
      const rooms = engine.tryPlace(u, slot);
      if (!rooms) continue;
      const c = engine.cost(u, slot) + rand() * 0.5;
      if (c < bestCost) {
        bestCost = c;
        bestSlot = slot;
        bestRooms = rooms;
      }
    }
    if (bestRooms) {
      engine.place(u, bestSlot, bestRooms);
      unplaced.delete(u);
    } else {
      // 2) Eject the cheapest set of conflicting units.
      const options: { slot: number; units: number[]; weight: number }[] = [];
      for (const slot of engine.uStarts[u]) {
        const c = engine.conflicts(u, slot);
        if (!c || !c.size) continue;
        let weight = rand() * 0.5;
        for (const x of c) weight += 1 + 0.3 * ejected[x];
        options.push({ slot, units: [...c], weight });
      }
      options.sort((a, b) => a.weight - b.weight);
      let done = false;
      for (const opt of options.slice(0, 6)) {
        const saved = opt.units.map((x) => ({ x, slot: engine.unitStart[x], rooms: engine.roomsOf(x) }));
        for (const s of saved) engine.remove(s.x);
        const rooms = engine.tryPlace(u, opt.slot);
        if (rooms) {
          engine.place(u, opt.slot, rooms);
          unplaced.delete(u);
          for (const s of saved) {
            ejected[s.x]++;
            unplaced.add(s.x);
          }
          done = true;
          break;
        }
        for (const s of saved) engine.place(s.x, s.slot, s.rooms);
      }
      if (!done) stuck[u]++;
    }

    const placed = U - unplaced.size - impossible;
    if (placed > bestPlaced) {
      bestPlaced = placed;
      best = engine.snapshot();
    }
  }

  if (engine.placedCount() < bestPlaced) engine.restore(best);
  opts.onProgress?.(iter, engine.placedCount(), U);
  return { iterations: iter };
}

/**
 * Local improvement: move one unit at a time to its cheapest feasible slot. Never makes
 * the timetable infeasible because the unit's old slot is always still available.
 */
export function improve(
  engine: Engine,
  opts: { seed?: number; timeLimitMs?: number; onPass?: (pass: number) => void } = {},
): number {
  const rand = mulberry32((opts.seed ?? 1) + 7);
  const deadline = Date.now() + (opts.timeLimitMs ?? 3000);
  const U = engine.uDur.length;
  let pass = 0;
  while (Date.now() < deadline) {
    pass++;
    let moved = 0;
    const order = Array.from({ length: U }, (_, u) => u).sort(() => rand() - 0.5);
    for (const u of order) {
      const from = engine.unitStart[u];
      if (from < 0 || engine.uPinned[u]) continue;
      const fromRooms = engine.roomsOf(u);
      engine.remove(u);
      let bestSlot = from;
      let bestRooms = fromRooms;
      let bestCost = engine.cost(u, from) - 1e-6;
      for (const slot of engine.uStarts[u]) {
        if (slot === from) continue;
        const c = engine.cost(u, slot);
        if (c >= bestCost) continue;
        const rooms = engine.tryPlace(u, slot);
        if (rooms) {
          bestCost = c;
          bestSlot = slot;
          bestRooms = rooms;
        }
      }
      if (bestSlot !== from) moved++;
      engine.place(u, bestSlot, bestRooms);
      if ((u & 31) === 0 && Date.now() > deadline) break;
    }
    opts.onPass?.(pass);
    if (!moved) break;
  }
  return pass;
}
