// "Fri P5-P8; Sat" <-> [day, period] pairs. Used for teacher availability in CSV files.

export function parseSlots(spec: string, days: string[], periods: number): { slots: [number, number][]; error?: string } {
  const slots: [number, number][] = [];
  for (const raw of spec.split(/[;,]/).map((s) => s.trim()).filter(Boolean)) {
    const m = raw.match(/^([A-Za-z]+)\s*(?:P?(\d+)\s*(?:-\s*P?(\d+))?)?$/i);
    const day = m ? days.findIndex((d) => d.slice(0, 3).toLowerCase() === m[1].slice(0, 3).toLowerCase()) : -1;
    if (!m || day < 0) return { slots, error: `"${raw}" is not like "Mon", "Mon P3" or "Fri P5-P8"` };
    const from = m[2] ? Number(m[2]) : 1;
    const to = m[3] ? Number(m[3]) : m[2] ? from : periods;
    if (from < 1 || to > periods || from > to) return { slots, error: `"${raw}": periods must be between P1 and P${periods}` };
    for (let p = from; p <= to; p++) slots.push([day, p - 1]);
  }
  return { slots };
}

export function formatSlots(slots: [number, number][], days: string[], periods: number): string {
  const byDay = new Map<number, number[]>();
  for (const [d, p] of slots) byDay.set(d, [...(byDay.get(d) ?? []), p]);
  const parts: string[] = [];
  for (const d of [...byDay.keys()].sort((a, b) => a - b)) {
    const ps = [...new Set(byDay.get(d))].sort((a, b) => a - b);
    if (ps.length === periods) {
      parts.push(days[d]);
      continue;
    }
    for (let i = 0; i < ps.length; ) {
      let j = i;
      while (j + 1 < ps.length && ps[j + 1] === ps[j] + 1) j++;
      parts.push(i === j ? `${days[d]} P${ps[i] + 1}` : `${days[d]} P${ps[i] + 1}-P${ps[j] + 1}`);
      i = j + 1;
    }
  }
  return parts.join("; ");
}
