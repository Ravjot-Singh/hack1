// Lunch by department: different departments break at different times so the canteen and
// corridors aren't flooded at once. Pure: no DB or framework imports.

/** A closed period with open periods before and after it that day (a mid-day break). */
const isMidBreak = (row: boolean[], p: number) => !row[p] && row.slice(0, p).some(Boolean) && row.slice(p + 1).some(Boolean);

/** The grid's lunch period: the mid-day break found on the most days, or null. */
export function gridLunch(open: boolean[][]): number | null {
  const P = open[0]?.length ?? 0;
  let best: number | null = null;
  let bestDays = 0;
  for (let p = 0; p < P; p++) {
    const days = open.filter((row) => isMidBreak(row, p)).length;
    if (days > bestDays) {
      best = p;
      bestDays = days;
    }
  }
  return best;
}

/**
 * The same grid with lunch moved to period `to`. Days with the old lunch get it moved; days
 * without a mid-day break (a half-day Saturday) stay as they are.
 */
export function moveLunch(open: boolean[][], to: number): boolean[][] {
  const from = gridLunch(open);
  return open.map((row) => {
    const next = [...row];
    if (from != null && isMidBreak(row, from)) next[from] = true;
    else if (from != null) return next; // no lunch this day (e.g. half day)
    // Only close `to` if classes run before and after it that day.
    if (next.slice(0, to).some(Boolean) && next.slice(to + 1).some(Boolean)) next[to] = false;
    return next;
  });
}

/**
 * Spread departments over the allowed lunch periods so each period has about the same number
 * of students (largest departments placed first, each into the emptiest period).
 */
export function spreadLunches(groups: { id: string; students: number }[], candidates: number[]): Record<string, number> {
  if (!candidates.length) return {};
  const load = new Map(candidates.map((p) => [p, 0]));
  const out: Record<string, number> = {};
  for (const g of [...groups].sort((a, b) => b.students - a.students || a.id.localeCompare(b.id))) {
    const p = [...load].sort((a, b) => a[1] - b[1] || a[0] - b[0])[0][0];
    out[g.id] = p;
    load.set(p, load.get(p)! + g.students);
  }
  return out;
}

/** Students on a mid-day break in each period (the busiest day counts). */
export function lunchCrowd(sections: { size: number; gridId: string }[], grids: { id: string; open: boolean[][] }[], periodCount: number): number[] {
  const byId = new Map(grids.map((g) => [g.id, g.open]));
  const days = Math.max(0, ...grids.map((g) => g.open.length));
  return Array.from({ length: periodCount }, (_, p) => {
    let worst = 0;
    for (let d = 0; d < days; d++) {
      const n = sections.reduce((sum, s) => {
        const row = byId.get(s.gridId)?.[d];
        return sum + (row && isMidBreak(row, p) ? s.size : 0);
      }, 0);
      worst = Math.max(worst, n);
    }
    return worst;
  });
}
