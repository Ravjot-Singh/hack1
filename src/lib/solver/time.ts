import type { InstituteInput } from "./types";

export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + (m || 0);
}

/** Minutes students/teachers have to walk between period p and p + 1 (gap + grace). */
export function walkAllowance(input: InstituteInput, p: number): number {
  const a = input.periods[p];
  const b = input.periods[p + 1];
  if (!a || !b) return Infinity;
  return toMinutes(b.start) - toMinutes(a.end) + input.passingMinutes;
}

/** Walking minutes between two buildings (0 when same / unknown). */
export function travelMinutes(input: InstituteInput, fromBuilding: string | null, toBuilding: string | null): number {
  if (!fromBuilding || !toBuilding || fromBuilding === toBuilding) return 0;
  const from = input.buildings.find((b) => b.id === fromBuilding);
  const to = input.buildings.find((b) => b.id === toBuilding);
  return from?.travelMinutes[toBuilding] ?? to?.travelMinutes[fromBuilding] ?? 0;
}
