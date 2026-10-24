"use client";

import { useMemo, useState, useTransition } from "react";
import { ArrowRight, Loader2 } from "lucide-react";
import { createBlankInstitute, type NewCollegeInput } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { buildPeriods } from "@/lib/setup/bell";
import { cn } from "@/lib/utils";

const ALL_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function NewCollegeForm() {
  const [form, setForm] = useState({
    name: "",
    days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
    start: "09:00",
    periodMinutes: 50,
    periods: 8,
    breakAfter: 2,
    breakMinutes: 10,
    lunchPeriod: 5,
    halfSaturday: true,
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  const preview = useMemo(
    () => (form.periods > 0 && form.periods <= 14 && form.periodMinutes >= 20 ? buildPeriods(form) : []),
    [form],
  );

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    start(async () => {
      const res = await createBlankInstitute({
        ...form,
        days: ALL_DAYS.filter((d) => form.days.includes(d)),
      } satisfies NewCollegeInput);
      if (res?.error) setError(res.error);
    });
  };

  const num = (k: "periodMinutes" | "periods" | "breakAfter" | "breakMinutes" | "lunchPeriod") => ({
    type: "number",
    value: form[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => set(k, Number(e.target.value)),
  });

  return (
    <form onSubmit={submit} className="space-y-6">
      <Card>
        <CardContent className="space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="name">College name</Label>
            <Input id="name" required value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Guru Nanak Dev Engineering College" />
          </div>

          <div className="space-y-1.5">
            <Label>Working days</Label>
            <div className="flex flex-wrap gap-1.5">
              {ALL_DAYS.map((d) => {
                const on = form.days.includes(d);
                return (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={on}
                    onClick={() => set("days", on ? form.days.filter((x) => x !== d) : [...form.days, d])}
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
            {form.days.includes("Sat") && (
              <label className="flex items-center gap-2 pt-1 text-sm">
                <input type="checkbox" className="size-4 accent-primary" checked={form.halfSaturday} onChange={(e) => set("halfSaturday", e.target.checked)} />
                Saturday is a half day (classes only before lunch)
              </label>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="start">Day starts at</Label>
              <Input id="start" type="time" value={form.start} onChange={(e) => set("start", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="len">Period length (min)</Label>
              <Input id="len" min={20} max={180} {...num("periodMinutes")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="count">Periods per day</Label>
              <Input id="count" min={1} max={14} {...num("periods")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="brk">Short break after period</Label>
              <Input id="brk" min={0} max={form.periods - 1} {...num("breakAfter")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="brkm">Short break (min)</Label>
              <Input id="brkm" min={0} max={60} {...num("breakMinutes")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lunch">Lunch period</Label>
              <Input id="lunch" min={0} max={form.periods} {...num("lunchPeriod")} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Lunch is a period with no classes. Later you can give different years a different lunch period (staggered lunch).
            Use 0 for no short break or no lunch.
          </p>
        </CardContent>
      </Card>

      {preview.length > 0 && (
        <div className="flex flex-wrap gap-1.5 text-xs">
          {preview.map((p, i) => (
            <span
              key={i}
              className={cn(
                "rounded-md border px-2 py-1 tabular-nums",
                i + 1 === form.lunchPeriod && "tt-closed text-muted-foreground",
              )}
            >
              <span className="font-medium">{i + 1 === form.lunchPeriod ? "Lunch" : `P${i + 1}`}</span> {p.start}–{p.end}
            </span>
          ))}
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" size="lg" disabled={pending || !form.name.trim()}>
        {pending ? <Loader2 className="animate-spin" /> : null} Create college and continue <ArrowRight />
      </Button>
    </form>
  );
}
