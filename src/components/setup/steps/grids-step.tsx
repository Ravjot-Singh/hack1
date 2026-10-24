"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, Loader2, Plus, Save, Trash2 } from "lucide-react";
import { saveGrids } from "@/app/[inst]/setup/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { newId, type GridRow } from "@/lib/setup/schemas";
import { cn } from "@/lib/utils";
import { SlotMatrix } from "../slot-matrix";
import type { StepProps } from "../step-view";

const GRID_STATES = [
  { value: "open", label: "Open for classes", short: "", className: "bg-background hover:bg-muted" },
  { value: "closed", label: "Closed (break / no classes)", short: "", className: "tt-closed border-muted-foreground/20" },
];

export function GridsStep({ slug, data, readOnly }: StepProps) {
  const router = useRouter();
  const { days, periods } = data.settings;
  const [grids, setGrids] = useState<GridRow[]>(data.grids);
  const [prev, setPrev] = useState(data.grids);
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  if (prev !== data.grids) {
    setPrev(data.grids);
    if (!dirty) setGrids(data.grids);
  }
  const usage = (id?: string) => data.sections.filter((s) => s.gridId === id).length;

  const update = (i: number, g: GridRow) => {
    setGrids((gs) => gs.map((x, j) => (j === i ? g : x)));
    setDirty(true);
    setMsg(null);
  };
  const add = (from?: GridRow) => {
    setGrids((gs) => [
      ...gs,
      {
        id: newId(),
        name: from ? `${from.name} (copy)` : `Grid ${gs.length + 1}`,
        open: from ? from.open.map((r) => [...r]) : days.map(() => periods.map(() => true)),
      },
    ]);
    setDirty(true);
  };

  const save = () =>
    start(async () => {
      const res = await saveGrids(slug, grids);
      if (res.ok) {
        setDirty(false);
        setMsg({ ok: true, text: "Saved." });
        router.refresh();
      } else setMsg({ ok: false, text: res.error });
    });

  return (
    <div className="space-y-6">
      <p className="max-w-3xl text-sm text-muted-foreground">
        A time grid marks which periods can hold classes. Use one grid for everyone, or separate grids for staggered
        lunch (e.g. 1st years eat at P5, seniors at P6) or a half-day Saturday. Each section picks its grid.
      </p>
      {grids.map((g, i) => {
        const lunchAt = (p: number) => update(i, { ...g, open: g.open.map((row) => row.map((v, k) => (k === p ? false : v))) });
        return (
          <section key={g.id} className="space-y-3 rounded-lg border p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Input
                className="h-8 max-w-xs font-medium"
                value={g.name}
                disabled={readOnly}
                aria-label="Grid name"
                onChange={(e) => update(i, { ...g, name: e.target.value })}
              />
              <span className="text-xs text-muted-foreground">
                Used by {usage(g.id)} section{usage(g.id) === 1 ? "" : "s"} · {g.open.flat().filter(Boolean).length} teaching periods/week
              </span>
              {!readOnly && (
                <div className="ml-auto flex flex-wrap gap-1">
                  <select
                    className="h-7 rounded-md border bg-background px-2 text-xs"
                    value=""
                    aria-label="Close a period every day"
                    onChange={(e) => e.target.value !== "" && lunchAt(Number(e.target.value))}
                  >
                    <option value="">Lunch at…</option>
                    {periods.map((p, k) => (
                      <option key={k} value={k}>
                        P{k + 1} ({p.start})
                      </option>
                    ))}
                  </select>
                  <Button variant="ghost" size="xs" onClick={() => add(g)}>
                    <Copy /> Copy
                  </Button>
                  <Button
                    variant="ghost"
                    size="xs"
                    disabled={grids.length < 2 || usage(g.id) > 0}
                    title={usage(g.id) > 0 ? "Sections use this grid" : undefined}
                    onClick={() => {
                      setGrids((gs) => gs.filter((_, j) => j !== i));
                      setDirty(true);
                    }}
                  >
                    <Trash2 /> Delete
                  </Button>
                </div>
              )}
            </div>
            <SlotMatrix
              days={days}
              periods={periods}
              states={GRID_STATES}
              readOnly={readOnly}
              get={(d, p) => (g.open[d]?.[p] ? "open" : "closed")}
              onSet={(cells, value) => {
                const open = g.open.map((r) => [...r]);
                for (const [d, p] of cells) open[d][p] = value === "open";
                update(i, { ...g, open });
              }}
            />
          </section>
        );
      })}
      {!readOnly && (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => add()}>
            <Plus /> Add grid
          </Button>
          <div className="ml-auto flex items-center gap-2">
            {dirty && <span className="text-xs text-amber-700 dark:text-amber-400">Unsaved changes</span>}
            {msg && <span className={cn("text-xs", msg.ok ? "text-muted-foreground" : "text-destructive")}>{msg.text}</span>}
            <Button size="sm" onClick={save} disabled={!dirty || pending}>
              {pending ? <Loader2 className="animate-spin" /> : <Save />} Save grids
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
