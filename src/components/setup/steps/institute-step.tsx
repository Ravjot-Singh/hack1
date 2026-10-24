"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Save, Trash2 } from "lucide-react";
import { saveSettings } from "@/app/[inst]/setup/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { StepProps } from "../step-view";

const ALL_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function InstituteStep({ slug, data, readOnly }: StepProps) {
  const router = useRouter();
  const [s, setS] = useState(data.settings);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const set = (patch: Partial<typeof s>) => {
    setS((x) => ({ ...x, ...patch }));
    setMsg(null);
  };
  const setPeriod = (i: number, key: "start" | "end", v: string) =>
    set({ periods: s.periods.map((p, j) => (j === i ? { ...p, [key]: v } : p)) });
  const addPeriod = () => {
    const last = s.periods.at(-1);
    set({ periods: [...s.periods, { start: last?.end ?? "09:00", end: last?.end ?? "10:00" }] });
  };

  const save = () =>
    start(async () => {
      const res = await saveSettings(slug, s);
      setMsg(res.ok ? { ok: true, text: "Saved." } : { ok: false, text: res.error });
      if (res.ok) router.refresh();
    });

  return (
    <div className="max-w-2xl space-y-6">
      <div className="space-y-1.5">
        <Label htmlFor="inst-name">College name</Label>
        <Input id="inst-name" value={s.name} disabled={readOnly} onChange={(e) => set({ name: e.target.value })} />
      </div>

      <div className="space-y-1.5">
        <Label>Working days</Label>
        <div className="flex flex-wrap gap-1.5">
          {ALL_DAYS.map((d) => {
            const on = s.days.includes(d);
            return (
              <button
                key={d}
                type="button"
                disabled={readOnly}
                aria-pressed={on}
                onClick={() => set({ days: ALL_DAYS.filter((x) => (x === d ? !on : s.days.includes(x))) })}
                className={cn(
                  "h-8 rounded-md border px-3 text-sm",
                  on ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
                )}
              >
                {d}
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-2">
        <Label>Bell schedule</Label>
        <p className="text-sm text-muted-foreground">
          Every time grid shares these period timings. A lunch period is just a period that is closed in a time grid.
        </p>
        <div className="space-y-1.5">
          {s.periods.map((p, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="w-8 text-sm font-medium tabular-nums">P{i + 1}</span>
              <Input type="time" className="w-32" value={p.start} disabled={readOnly} aria-label={`P${i + 1} start`} onChange={(e) => setPeriod(i, "start", e.target.value)} />
              <span className="text-muted-foreground">–</span>
              <Input type="time" className="w-32" value={p.end} disabled={readOnly} aria-label={`P${i + 1} end`} onChange={(e) => setPeriod(i, "end", e.target.value)} />
              {!readOnly && s.periods.length > 1 && (
                <Button variant="ghost" size="icon-xs" aria-label={`Remove P${i + 1}`} onClick={() => set({ periods: s.periods.filter((_, j) => j !== i) })}>
                  <Trash2 />
                </Button>
              )}
            </div>
          ))}
        </div>
        {!readOnly && (
          <Button variant="outline" size="sm" onClick={addPeriod}>
            <Plus /> Add period
          </Button>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="grace">Grace minutes for walking between periods</Label>
        <Input
          id="grace"
          type="number"
          min={0}
          max={30}
          className="w-24"
          value={Number(s.passingMinutes)}
          disabled={readOnly}
          onChange={(e) => set({ passingMinutes: Number(e.target.value) })}
        />
      </div>

      {!readOnly && (
        <div className="flex items-center gap-3">
          <Button onClick={save} disabled={pending}>
            {pending ? <Loader2 className="animate-spin" /> : <Save />} Save
          </Button>
          {msg && <span className={cn("text-sm", msg.ok ? "text-muted-foreground" : "text-destructive")}>{msg.text}</span>}
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Adding or removing days or periods resizes every time grid and drops teacher availability outside the new week.
      </p>
    </div>
  );
}
