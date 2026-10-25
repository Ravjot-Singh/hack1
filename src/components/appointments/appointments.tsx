"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Loader2, Save } from "lucide-react";
import { bookAppointment, cancelAppointment, saveOfficeHours } from "@/app/[inst]/appointments/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SLOT_LENGTHS, subSlots, type OfficeHoursConfig } from "@/lib/appointments";
import { cn } from "@/lib/utils";

type Msg = { ok: boolean; text: string } | null;
const selectClass = "h-8 rounded-md border bg-background px-2 text-sm";
const prettyDate = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

function useAction() {
  const router = useRouter();
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>, after?: () => void) =>
    start(async () => {
      const res = await fn();
      setMsg(res.ok ? (res.message ? { ok: true, text: res.message } : null) : { ok: false, text: res.error ?? "Something went wrong." });
      if (res.ok) {
        after?.();
        router.refresh();
      }
    });
  return { msg, pending, run };
}

function Message({ msg }: { msg: Msg }) {
  return msg ? <p className={cn("text-sm", msg.ok ? "text-muted-foreground" : "text-destructive")}>{msg.text}</p> : null;
}

export function OfficeHoursEditor({
  slug,
  days,
  periods,
  teaching,
  closed,
  initial,
}: {
  slug: string;
  days: string[];
  periods: { start: string; end: string }[];
  /** "day:period" keys where the teacher has a class. */
  teaching: string[];
  closed: string[];
  initial: OfficeHoursConfig;
}) {
  const [on, setOn] = useState(() => new Set(initial.slots.map(([d, p]) => `${d}:${p}`)));
  const [minutes, setMinutes] = useState(initial.slotMinutes);
  const [perWeek, setPerWeek] = useState(initial.perStudentWeek);
  const [location, setLocation] = useState(initial.location);
  const { msg, pending, run } = useAction();
  const busy = new Set(teaching);
  const shut = new Set(closed);
  const perPeriod = subSlots(periods[0] ?? { start: "09:00", end: "09:50" }, minutes).length;

  const toggle = (key: string) =>
    setOn((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <section className="space-y-4">
      <div className="overflow-x-auto rounded-lg border p-2">
        <div className="grid min-w-[36rem] gap-[2px] text-xs" style={{ gridTemplateColumns: `3rem repeat(${periods.length}, minmax(2.5rem, 1fr))` }}>
          <div />
          {periods.map((p, i) => (
            <div key={i} className="text-center text-muted-foreground">
              <div className="font-medium">P{i + 1}</div>
              <div className="text-[10px]">{p.start}</div>
            </div>
          ))}
          {days.map((d, di) => (
            <div key={d} className="contents">
              <div className="font-medium leading-8">{d}</div>
              {periods.map((_, p) => {
                const key = `${di}:${p}`;
                const disabled = busy.has(key) || shut.has(key);
                const selected = on.has(key) && !disabled;
                return (
                  <button
                    key={p}
                    type="button"
                    disabled={disabled}
                    aria-pressed={selected}
                    aria-label={`${d} P${p + 1}: ${busy.has(key) ? "you teach" : shut.has(key) ? "break" : selected ? "office hours" : "free"}`}
                    onClick={() => toggle(key)}
                    className={cn(
                      "h-8 rounded-[3px] text-[10px]",
                      busy.has(key) ? "bg-muted text-muted-foreground" : shut.has(key) ? "tt-closed" : selected ? "bg-primary text-primary-foreground" : "border bg-background hover:bg-muted",
                    )}
                  >
                    {busy.has(key) ? "class" : selected ? "open" : ""}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <span className="inline-block size-3 rounded-[3px] bg-primary" /> Office hours
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block size-3 rounded-[3px] border" /> Free (click to open)
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block size-3 rounded-[3px] bg-muted" /> Your class
        </span>
      </div>
      <div className="flex flex-wrap items-end gap-3 text-sm">
        <label className="grid gap-1">
          <span className="text-xs text-muted-foreground">Slot length</span>
          <select className={selectClass} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
            {SLOT_LENGTHS.map((n) => (
              <option key={n} value={n}>
                {n} minutes
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1">
          <span className="text-xs text-muted-foreground">Bookings per student per week</span>
          <Input className="w-24" type="number" min={1} max={10} value={perWeek} onChange={(e) => setPerWeek(Math.max(1, Math.min(10, Number(e.target.value) || 1)))} />
        </label>
        <label className="grid gap-1">
          <span className="text-xs text-muted-foreground">Where</span>
          <Input className="w-56" value={location} maxLength={80} placeholder="e.g. Staff room, Block B" onChange={(e) => setLocation(e.target.value)} />
        </label>
        <Button
          disabled={pending}
          onClick={() => run(() => saveOfficeHours(slug, { slots: [...on].map((k) => k.split(":").map(Number)), slotMinutes: minutes, perStudentWeek: perWeek, location }))}
        >
          {pending ? <Loader2 className="animate-spin" /> : <Save />} Save office hours
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {on.size} period{on.size === 1 ? "" : "s"} a week · about {on.size * perPeriod} slots of {minutes} minutes.
      </p>
      <Message msg={msg} />
    </section>
  );
}

export function BookingPanel({
  slug,
  teachers,
  pickedId,
  slots,
  limitNote,
}: {
  slug: string;
  teachers: { id: string; name: string; teachesYou: boolean; location: string }[];
  pickedId: string | null;
  slots: { date: string; period: number; offset: number; start: string; end: string }[];
  limitNote: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [chosen, setChosen] = useState<(typeof slots)[number] | null>(null);
  const [topic, setTopic] = useState("");
  const { msg, pending, run } = useAction();

  if (!teachers.length) return <p className="text-sm text-muted-foreground">No teacher offers office hours yet.</p>;
  const byDate = new Map<string, typeof slots>();
  for (const s of slots) byDate.set(s.date, [...(byDate.get(s.date) ?? []), s]);

  return (
    <section className="space-y-4">
      <label className="flex flex-wrap items-center gap-2 text-sm">
        Teacher
        <select
          className={cn(selectClass, "min-w-64")}
          value={pickedId ?? ""}
          onChange={(e) => {
            setChosen(null);
            router.replace(`${pathname}?t=${e.target.value}`, { scroll: false });
          }}
        >
          {teachers.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
              {t.teachesYou ? " (teaches you)" : ""}
            </option>
          ))}
        </select>
      </label>
      {limitNote && <p className="text-xs text-muted-foreground">{limitNote}</p>}
      {slots.length === 0 ? (
        <p className="text-sm text-muted-foreground">No free slots in the next two weeks (or you have reached this teacher&apos;s weekly limit).</p>
      ) : (
        <div className="space-y-3">
          {[...byDate].map(([date, list]) => (
            <div key={date} className="flex flex-wrap items-center gap-1.5">
              <span className="w-28 shrink-0 text-sm font-medium">{prettyDate(date)}</span>
              {list.map((s) => {
                const on = chosen?.date === s.date && chosen.period === s.period && chosen.offset === s.offset;
                return (
                  <Button key={`${s.period}:${s.offset}`} size="xs" variant={on ? "default" : "outline"} aria-pressed={on} onClick={() => setChosen(s)}>
                    {s.start}
                  </Button>
                );
              })}
            </div>
          ))}
        </div>
      )}
      {chosen && pickedId && (
        <div className="flex flex-wrap items-end gap-2 rounded-lg border p-3">
          <div className="text-sm">
            <div className="font-medium">
              {prettyDate(chosen.date)}, {chosen.start}–{chosen.end}
            </div>
            <div className="text-xs text-muted-foreground">with {teachers.find((t) => t.id === pickedId)?.name}</div>
          </div>
          <Input className="w-72" value={topic} maxLength={140} placeholder="What do you want to discuss?" onChange={(e) => setTopic(e.target.value)} />
          <Button
            disabled={pending || topic.trim().length < 3}
            onClick={() =>
              run(
                () => bookAppointment(slug, { teacherId: pickedId, date: chosen.date, period: chosen.period, offset: chosen.offset, topic }),
                () => {
                  setChosen(null);
                  setTopic("");
                },
              )
            }
          >
            {pending && <Loader2 className="animate-spin" />} Book
          </Button>
        </div>
      )}
      <Message msg={msg} />
    </section>
  );
}

export interface AppointmentView {
  id: string;
  date: string;
  time: string;
  minutes: number;
  topic: string;
  status: "BOOKED" | "CANCELLED" | "INVALID";
  note: string | null;
  with: string;
}

const STATUS: Record<AppointmentView["status"], string> = { BOOKED: "Booked", CANCELLED: "Cancelled", INVALID: "Called off" };

export function AppointmentList({ slug, items, empty }: { slug: string; items: AppointmentView[]; empty: string }) {
  const { msg, pending, run } = useAction();
  if (!items.length) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <>
      <ul className="divide-y rounded-lg border">
        {items.map((a) => (
          <li key={a.id} className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm", a.status !== "BOOKED" && "text-muted-foreground")}>
            <Badge variant={a.status === "BOOKED" ? "default" : a.status === "INVALID" ? "destructive" : "secondary"}>{STATUS[a.status]}</Badge>
            <span className="font-medium">
              {prettyDate(a.date)}, {a.time}
            </span>
            <span>
              {a.with} · {a.minutes} min · “{a.topic}”
            </span>
            {a.note && a.status !== "BOOKED" && <span className="w-full text-xs">{a.note}</span>}
            {a.status === "BOOKED" && (
              <Button size="xs" variant="ghost" className="ml-auto" disabled={pending} onClick={() => run(() => cancelAppointment(slug, a.id))}>
                Cancel
              </Button>
            )}
          </li>
        ))}
      </ul>
      <Message msg={msg} />
    </>
  );
}
