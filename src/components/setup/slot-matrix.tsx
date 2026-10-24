"use client";

import { cn } from "@/lib/utils";

export interface SlotState {
  value: string;
  label: string;
  /** Text shown inside the cell (keep it to a few characters). */
  short?: string;
  /** Tailwind classes for the cell. */
  className: string;
}

interface Props {
  days: string[];
  periods: { start: string; end: string }[];
  /** State value of each cell. */
  get: (day: number, period: number) => string;
  /** Click cycles through these in order. */
  states: SlotState[];
  onSet: (cells: [number, number][], value: string) => void;
  readOnly?: boolean;
}

/** Clickable week grid. Click a cell to cycle its state; click a day or period header to set the whole row/column. */
export function SlotMatrix({ days, periods, get, states, onSet, readOnly }: Props) {
  const next = (v: string) => states[(states.findIndex((s) => s.value === v) + 1) % states.length].value;
  const style = (v: string) => states.find((s) => s.value === v) ?? states[0];
  const row = (d: number) => periods.map((_, p) => [d, p] as [number, number]);
  const col = (p: number) => days.map((_, d) => [d, p] as [number, number]);

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <table className="border-separate border-spacing-0.5 text-xs">
          <thead>
            <tr>
              <th />
              {periods.map((p, i) => (
                <th key={i} className="px-0.5 font-normal">
                  <button
                    type="button"
                    disabled={readOnly}
                    className="w-full rounded px-1 py-0.5 text-muted-foreground hover:bg-muted"
                    title={`${p.start}–${p.end}: set the whole column`}
                    onClick={() => onSet(col(i), next(get(0, i)))}
                  >
                    P{i + 1}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {days.map((day, d) => (
              <tr key={day}>
                <th className="pr-1 text-left font-normal">
                  <button
                    type="button"
                    disabled={readOnly}
                    className="rounded px-1 py-0.5 text-muted-foreground hover:bg-muted"
                    title="Set the whole day"
                    onClick={() => onSet(row(d), next(get(d, 0)))}
                  >
                    {day}
                  </button>
                </th>
                {periods.map((_, p) => {
                  const s = style(get(d, p));
                  return (
                    <td key={p} className="p-0">
                      <button
                        type="button"
                        disabled={readOnly}
                        aria-label={`${day} P${p + 1}: ${s.label}`}
                        className={cn("h-7 w-10 rounded border text-[10px] transition-colors sm:w-12", s.className)}
                        onClick={() => onSet([[d, p]], next(s.value))}
                      >
                        {s.short}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
        {states.map((s) => (
          <span key={s.value} className="flex items-center gap-1">
            <span className={cn("inline-block size-3 rounded border", s.className)} /> {s.label}
          </span>
        ))}
        {!readOnly && <span>· click to change, click a day or P-number for the whole row or column</span>}
      </div>
    </div>
  );
}
