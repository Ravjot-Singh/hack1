"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Save, Trash2 } from "lucide-react";
import { addSpecialDays, removeSpecialDay, saveTerm } from "@/app/[inst]/calendar/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { resolveDay, todayIso, type CalendarInfo, type CalendarKind, type SpecialDay } from "@/lib/calendar";
import { cn } from "@/lib/utils";

type Calendar = Omit<CalendarInfo, "specials"> & { specials: (SpecialDay & { id: string })[] };

const KIND_LABEL: Record<CalendarKind, string> = { HOLIDAY: "Holiday", EXAM: "Exams", FOLLOWS: "Follows another day" };
const KIND_STYLE: Record<CalendarKind, string> = {
  HOLIDAY: "bg-destructive/15 text-destructive",
  EXAM: "bg-amber-500/20 text-amber-800 dark:text-amber-300",
  FOLLOWS: "bg-sky-500/15 text-sky-800 dark:text-sky-300",
};
const selectClass = "h-8 rounded-md border bg-background px-2 text-sm";

export function CalendarManager({ slug, calendar }: { slug: string; calendar: Calendar }) {
  const router = useRouter();
  const [term, setTerm] = useState({ start: calendar.termStart ?? "", end: calendar.termEnd ?? "" });
  const [form, setForm] = useState({ date: "", until: "", kind: "HOLIDAY" as CalendarKind, label: "", followsDay: 0 });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, done: string) =>
    start(async () => {
      const res = await fn();
      setMsg(res.ok ? { ok: true, text: done } : { ok: false, text: res.error ?? "Something went wrong." });
      if (res.ok) router.refresh();
    });

  return (
    <div className="space-y-8">
      <section className="flex flex-wrap items-end gap-3 rounded-lg border p-4">
        <div className="space-y-1">
          <Label htmlFor="term-start">Term starts</Label>
          <Input id="term-start" type="date" className="h-8" value={term.start} onChange={(e) => setTerm({ ...term, start: e.target.value })} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="term-end">Term ends</Label>
          <Input id="term-end" type="date" className="h-8" value={term.end} onChange={(e) => setTerm({ ...term, end: e.target.value })} />
        </div>
        <Button size="sm" disabled={pending} onClick={() => run(() => saveTerm(slug, term.start, term.end), "Term saved.")}>
          <Save /> Save term
        </Button>
        <p className="w-full text-xs text-muted-foreground">Leave blank if you don&apos;t want to limit dates.</p>
      </section>

      <section className="space-y-3 rounded-lg border p-4">
        <h2 className="font-semibold">Add a special day</h2>
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="sp-date">Date</Label>
            <Input id="sp-date" type="date" className="h-8" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="sp-until">Until (optional)</Label>
            <Input id="sp-until" type="date" className="h-8" value={form.until} min={form.date} onChange={(e) => setForm({ ...form, until: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="sp-kind">Type</Label>
            <select id="sp-kind" className={selectClass} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as CalendarKind })}>
              {(Object.keys(KIND_LABEL) as CalendarKind[]).map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </div>
          {form.kind === "FOLLOWS" && (
            <div className="space-y-1">
              <Label htmlFor="sp-follows">Run the timetable of</Label>
              <select id="sp-follows" className={selectClass} value={form.followsDay} onChange={(e) => setForm({ ...form, followsDay: Number(e.target.value) })}>
                {calendar.days.map((d, i) => (
                  <option key={d} value={i}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="w-full space-y-1 sm:w-auto">
            <Label htmlFor="sp-label">Label</Label>
            <Input
              id="sp-label"
              className="h-8 w-full sm:w-48"
              placeholder={form.kind === "HOLIDAY" ? "Diwali" : form.kind === "EXAM" ? "Mid-semester exams" : "Compensatory day"}
              value={form.label}
              onChange={(e) => setForm({ ...form, label: e.target.value })}
            />
          </div>
          <Button
            size="sm"
            disabled={pending}
            onClick={() =>
              run(
                () =>
                  addSpecialDays(slug, {
                    date: form.date,
                    until: form.until,
                    kind: form.kind,
                    label: form.label,
                    followsDay: form.kind === "FOLLOWS" ? form.followsDay : null,
                  }),
                "Added.",
              )
            }
          >
            {pending ? <Loader2 className="animate-spin" /> : <Plus />} Add
          </Button>
        </div>
        {msg && <p className={cn("text-sm", msg.ok ? "text-muted-foreground" : "text-destructive")}>{msg.text}</p>}
      </section>

      <Months calendar={calendar} />

      <section className="space-y-2">
        <h2 className="font-semibold">Special days ({calendar.specials.length})</h2>
        {calendar.specials.length === 0 ? (
          <p className="text-sm text-muted-foreground">None yet.</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {calendar.specials.map((s) => (
              <li key={s.id} className="flex items-center gap-3 px-3 py-1.5 text-sm">
                <span className="w-28 tabular-nums">{s.date}</span>
                <span className={cn("rounded px-1.5 py-0.5 text-xs", KIND_STYLE[s.kind])}>{KIND_LABEL[s.kind]}</span>
                <span className="flex-1">
                  {s.label}
                  {s.kind === "FOLLOWS" && s.followsDay != null && <span className="text-muted-foreground"> · runs {calendar.days[s.followsDay]}</span>}
                </span>
                <Button size="xs" variant="ghost" aria-label={`Remove ${s.label} on ${s.date}`} onClick={() => run(() => removeSpecialDay(slug, s.id), "Removed.")}>
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** Month grids for the term (or the next three months when no term is set). */
function Months({ calendar }: { calendar: Calendar }) {
  const today = todayIso();
  const months = useMemo(() => {
    const first = (calendar.termStart ?? today).slice(0, 7);
    const last = (calendar.termEnd ?? "").slice(0, 7);
    const out: string[] = [];
    let [y, m] = first.split("-").map(Number);
    for (let i = 0; i < 12; i++) {
      const key = `${y}-${String(m).padStart(2, "0")}`;
      out.push(key);
      if ((last && key >= last) || (!last && i >= 2)) break;
      m++;
      if (m > 12) {
        m = 1;
        y++;
      }
    }
    return out;
  }, [calendar.termStart, calendar.termEnd, today]);

  return (
    <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {months.map((month) => {
        const [y, m] = month.split("-").map(Number);
        const firstDow = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7; // Monday first
        const daysIn = new Date(Date.UTC(y, m, 0)).getUTCDate();
        return (
          <div key={month} className="rounded-lg border p-3">
            <div className="mb-2 text-sm font-medium">
              {new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" })}
            </div>
            <div className="grid grid-cols-7 gap-0.5 text-center text-[11px]">
              {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
                <div key={i} className="text-muted-foreground">
                  {d}
                </div>
              ))}
              {Array.from({ length: firstDow }, (_, i) => (
                <div key={`b${i}`} />
              ))}
              {Array.from({ length: daysIn }, (_, i) => {
                const date = `${month}-${String(i + 1).padStart(2, "0")}`;
                const plan = resolveDay(date, calendar);
                const special = calendar.specials.find((s) => s.date === date);
                return (
                  <div
                    key={date}
                    title={plan.kind === "off" ? plan.reason : (plan.note ?? calendar.days[plan.dayIndex])}
                    className={cn(
                      "rounded py-1 tabular-nums",
                      special ? KIND_STYLE[special.kind] : plan.kind === "off" ? "text-muted-foreground/50" : "",
                      date === today && "ring-1 ring-primary",
                    )}
                  >
                    {i + 1}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </section>
  );
}
