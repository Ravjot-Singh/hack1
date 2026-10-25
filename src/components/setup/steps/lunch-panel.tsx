"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Shuffle, Utensils } from "lucide-react";
import { applyLunchPlan } from "@/app/[inst]/setup/actions";
import { Button } from "@/components/ui/button";
import type { SetupData } from "@/lib/setup/convert";
import { gridLunch, lunchCrowd, moveLunch, spreadLunches } from "@/lib/setup/lunch";
import { cn } from "@/lib/utils";

const selectClass = "h-8 rounded-md border bg-background px-2 text-sm";

/** Department -> lunch period, with a live "students at lunch" chart. */
export function LunchPanel({ slug, data, disabled }: { slug: string; data: SetupData; disabled: boolean }) {
  const router = useRouter();
  const { periods } = data.settings;
  const deptOf = useMemo(() => new Map(data.programs.map((p) => [p.id, p.deptId])), [data.programs]);
  const grid = (id: string) => data.grids.find((g) => g.id === id);
  // Setup rows are loosely typed (they come straight from forms and imports).
  const sections = data.sections.map((s) => ({ id: s.id ?? s.name, programId: s.programId, gridId: s.gridId, size: Number(s.size) || 0 }));
  const departments = data.departments
    .map((d) => {
      const secs = sections.filter((s) => deptOf.get(s.programId) === d.id);
      const lunches = secs.map((s) => gridLunch(grid(s.gridId)?.open ?? []));
      // The lunch most of its sections have now.
      const current = lunches.sort((a, b) => lunches.filter((x) => x === b).length - lunches.filter((x) => x === a).length)[0] ?? null;
      return { id: d.id!, code: d.code, students: secs.reduce((n, s) => n + s.size, 0), sections: secs.length, current };
    })
    .filter((d) => d.sections > 0);

  const [plan, setPlan] = useState<Record<string, number | null>>(() => Object.fromEntries(departments.map((d) => [d.id, d.current])));
  const nowLunches = departments.map((d) => d.current).filter((x): x is number => x != null);
  const [windowPs, setWindowPs] = useState<number[]>(() => {
    if (!nowLunches.length) return [3, 4, 5].filter((p) => p < periods.length);
    const lo = Math.max(1, Math.min(...nowLunches) - 1);
    const hi = Math.min(periods.length - 2, Math.max(...nowLunches) + 1);
    return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
  });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  // What the grids would look like with this plan, for the crowd chart.
  const planned = sections.map((s) => {
    const lunch = plan[deptOf.get(s.programId) ?? ""];
    const open = grid(s.gridId)?.open ?? [];
    return { size: s.size, gridId: s.id, open: lunch == null || gridLunch(open) === lunch ? open : moveLunch(open, lunch) };
  });
  const crowd = lunchCrowd(planned, planned.map((p) => ({ id: p.gridId, open: p.open })), periods.length);
  const before = lunchCrowd(sections, data.grids.map((g) => ({ id: g.id!, open: g.open })), periods.length);
  const peak = Math.max(1, ...crowd, ...before);
  const changed = departments.some((d) => plan[d.id] !== d.current);

  if (!departments.length) return null;
  return (
    <section className="space-y-4 rounded-lg border p-4">
      <div>
        <h2 className="flex items-center gap-2 font-semibold">
          <Utensils className="size-4" /> Lunch by department
        </h2>
        <p className="text-sm text-muted-foreground">
          Let departments break at different times so the canteen and corridors aren&apos;t crowded. Each department&apos;s sections move
          to a copy of their grid with lunch at the chosen period; half days and other breaks stay as they are.
        </p>
      </div>

      <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
        {departments.map((d) => (
          <label key={d.id} className="flex items-center justify-between gap-2 text-sm">
            <span>
              <span className="font-medium">{d.code}</span>{" "}
              <span className="text-muted-foreground">
                {d.students} students · {d.sections} section{d.sections === 1 ? "" : "s"}
              </span>
            </span>
            <select
              className={selectClass}
              disabled={disabled}
              value={plan[d.id] ?? ""}
              onChange={(e) => setPlan((p) => ({ ...p, [d.id]: e.target.value === "" ? null : Number(e.target.value) }))}
            >
              <option value="">Keep current grid</option>
              {periods.map((p, i) =>
                i === 0 || i === periods.length - 1 ? null : (
                  <option key={i} value={i}>
                    P{i + 1} ({p.start}–{p.end})
                  </option>
                ),
              )}
            </select>
          </label>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">Lunch window:</span>
        {periods.map((p, i) =>
          i === 0 || i === periods.length - 1 ? null : (
            <button
              key={i}
              type="button"
              disabled={disabled}
              aria-pressed={windowPs.includes(i)}
              onClick={() => setWindowPs((w) => (w.includes(i) ? w.filter((x) => x !== i) : [...w, i].sort((a, b) => a - b)))}
              className={cn("rounded-md border px-2 py-0.5 text-xs", windowPs.includes(i) ? "bg-primary text-primary-foreground" : "hover:bg-muted")}
              title={`${p.start}–${p.end}`}
            >
              P{i + 1}
            </button>
          ),
        )}
        <Button size="sm" variant="outline" disabled={disabled || !windowPs.length} onClick={() => setPlan(spreadLunches(departments, windowPs))}>
          <Shuffle /> Spread departments evenly
        </Button>
      </div>

      <div className="space-y-1">
        <div className="text-xs text-muted-foreground">Students at lunch, busiest day (now → with this plan)</div>
        <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${periods.length}, minmax(0, 1fr))` }}>
          {periods.map((p, i) => (
            <div key={i} className="flex flex-col items-center gap-1 text-[10px]">
              <div className="flex h-20 w-full items-end justify-center gap-[2px]">
                <div className="w-2/5 rounded-t-[3px] bg-muted" style={{ height: `${(before[i] / peak) * 100}%` }} title={`Now: ${before[i]} students`} />
                <div className="w-2/5 rounded-t-[3px] bg-primary" style={{ height: `${(crowd[i] / peak) * 100}%` }} title={`With this plan: ${crowd[i]} students`} />
              </div>
              <div className="tabular-nums">{crowd[i] || ""}</div>
              <div className="text-muted-foreground">P{i + 1}</div>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Busiest lunch period: {Math.max(...before)} students now, {Math.max(...crowd)} with this plan.
        </p>
      </div>

      {!disabled && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            disabled={pending || !changed}
            onClick={() =>
              start(async () => {
                const res = await applyLunchPlan(slug, { lunches: Object.fromEntries(departments.map((d) => [d.id, plan[d.id] === d.current ? null : plan[d.id]])) });
                setMsg(res.ok ? { ok: true, text: res.message ?? "Saved." } : { ok: false, text: res.error });
                if (res.ok) router.refresh();
              })
            }
          >
            {pending && <Loader2 className="animate-spin" />} Apply lunch plan
          </Button>
          <span className="text-xs text-muted-foreground">Generate a new timetable afterwards to use it.</span>
          {msg && <span className={cn("text-sm", msg.ok ? "text-muted-foreground" : "text-destructive")}>{msg.text}</span>}
        </div>
      )}
    </section>
  );
}
