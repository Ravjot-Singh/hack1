"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Loader2, Undo2, Wrench } from "lucide-react";
import { markDowntime, moveClass, removeDowntime } from "@/app/[inst]/labs/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addDays, todayIso } from "@/lib/calendar";
import { cn } from "@/lib/utils";

type Msg = { ok: boolean; text: string } | null;
const selectClass = "h-8 rounded-md border bg-background px-2 text-sm";
const pretty = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

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

export function DowntimeForm({ slug, rooms, periods }: { slug: string; rooms: { id: string; name: string; type: string }[]; periods: { start: string; end: string }[] }) {
  const today = todayIso();
  const [roomId, setRoomId] = useState(rooms[0]?.id ?? "");
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [wholeDay, setWholeDay] = useState(true);
  const [picked, setPicked] = useState<number[]>([]);
  const [reason, setReason] = useState("");
  const { msg, pending, run } = useAction();

  return (
    <section className="space-y-3 rounded-lg border p-4">
      <h2 className="flex items-center gap-2 font-semibold">
        <Wrench className="size-4" /> Mark out of service
      </h2>
      <div className="flex flex-wrap items-end gap-3 text-sm">
        <label className="grid gap-1">
          <span className="text-xs text-muted-foreground">Room</span>
          <select className={cn(selectClass, "min-w-48")} value={roomId} onChange={(e) => setRoomId(e.target.value)}>
            {rooms.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} · {r.type}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1">
          <span className="text-xs text-muted-foreground">From</span>
          <input type="date" aria-label="From" className={selectClass} value={from} min={today} onChange={(e) => e.target.value && (setFrom(e.target.value), e.target.value > to && setTo(e.target.value))} />
        </label>
        <label className="grid gap-1">
          <span className="text-xs text-muted-foreground">To</span>
          <input type="date" aria-label="To" className={selectClass} value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} />
        </label>
        <label className="grid flex-1 gap-1">
          <span className="text-xs text-muted-foreground">What&apos;s wrong</span>
          <Input value={reason} maxLength={140} placeholder="e.g. Network down, AC repair" onChange={(e) => setReason(e.target.value)} />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label className="flex items-center gap-1.5">
          <input type="checkbox" className="size-4 accent-primary" checked={wholeDay} onChange={(e) => setWholeDay(e.target.checked)} /> Whole day
        </label>
        {!wholeDay &&
          periods.map((p, i) => {
            const on = picked.includes(i);
            return (
              <button
                key={i}
                type="button"
                aria-pressed={on}
                onClick={() => setPicked((x) => (on ? x.filter((y) => y !== i) : [...x, i]))}
                className={cn("rounded-md border px-2 py-0.5 text-xs", on ? "bg-primary text-primary-foreground" : "hover:bg-muted")}
                title={`${p.start}–${p.end}`}
              >
                P{i + 1}
              </button>
            );
          })}
      </div>
      <Button
        disabled={pending || !roomId || reason.trim().length < 3 || (!wholeDay && !picked.length)}
        onClick={() => run(() => markDowntime(slug, { roomId, from, to, periods: wholeDay ? [] : picked.sort((a, b) => a - b), reason }), () => setReason(""))}
      >
        {pending && <Loader2 className="animate-spin" />} Mark out of service
      </Button>
      <Message msg={msg} />
    </section>
  );
}

export function DowntimeList({ slug, items }: { slug: string; items: { id: string; room: string; when: string; reason: string }[] }) {
  const { msg, pending, run } = useAction();
  if (!items.length) return <p className="text-sm text-muted-foreground">Every room is in service.</p>;
  return (
    <>
      <ul className="divide-y rounded-lg border">
        {items.map((d) => (
          <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
            <span className="font-medium">{d.room}</span>
            <span>{d.when}</span>
            <span className="text-muted-foreground">{d.reason}</span>
            <Button size="xs" variant="ghost" className="ml-auto" disabled={pending} onClick={() => run(() => removeDowntime(slug, d.id))}>
              Back in service
            </Button>
          </li>
        ))}
      </ul>
      <Message msg={msg} />
    </>
  );
}

export interface ConflictView {
  date: string;
  open: { lessonId: string; label: string; time: string; room: string; reason: string; options: { id: string; name: string; capacity: number }[] }[];
  moved: { lessonId: string; label: string; time: string; from: string; to: string }[];
}

export function ConflictList({ slug, days }: { slug: string; days: ConflictView[] }) {
  const { msg, pending, run } = useAction();
  if (!days.length) return <p className="text-sm text-muted-foreground">No class is affected in the next three weeks.</p>;
  return (
    <div className="space-y-3">
      {days.map((d) => (
        <div key={d.date} className="space-y-1.5">
          <h3 className="text-sm font-semibold">{pretty(d.date)}</h3>
          <ul className="divide-y rounded-lg border">
            {d.open.map((c) => (
              <li key={c.lessonId} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2 text-sm">
                <span className="w-28 tabular-nums text-muted-foreground">{c.time}</span>
                <span className="font-medium">{c.label}</span>
                <span className="text-destructive">
                  {c.room} out of service ({c.reason})
                </span>
                <span className="ml-auto flex flex-wrap items-center gap-1">
                  {c.options.length ? (
                    c.options.map((o) => (
                      <Button key={o.id} size="xs" variant="outline" disabled={pending} onClick={() => run(() => moveClass(slug, { date: d.date, lessonId: c.lessonId, roomId: o.id }))}>
                        Move to {o.name}
                      </Button>
                    ))
                  ) : (
                    <span className="text-xs text-muted-foreground">No free room of this type; ask the HOD to cancel or reschedule it.</span>
                  )}
                </span>
              </li>
            ))}
            {d.moved.map((c) => (
              <li key={c.lessonId} className="flex flex-wrap items-center gap-x-3 px-3 py-2 text-sm text-muted-foreground">
                <span className="w-28 tabular-nums">{c.time}</span>
                <span className="font-medium text-foreground">{c.label}</span>
                <span>
                  moved from {c.from} to {c.to}
                </span>
                <Button size="xs" variant="ghost" className="ml-auto" disabled={pending} onClick={() => run(() => moveClass(slug, { date: d.date, lessonId: c.lessonId, roomId: null }))}>
                  <Undo2 /> Undo
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ))}
      <Message msg={msg} />
    </div>
  );
}

export function ScheduleDate({ date }: { date: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const go = (d: string) => router.replace(`${pathname}?date=${d}`, { scroll: false });
  return (
    <div className="flex items-center gap-2">
      <Button size="icon-sm" variant="outline" aria-label="Previous day" onClick={() => go(addDays(date, -1))}>
        <ChevronLeft />
      </Button>
      <input type="date" aria-label="Schedule date" className={selectClass} value={date} onChange={(e) => e.target.value && go(e.target.value)} />
      <Button size="icon-sm" variant="outline" aria-label="Next day" onClick={() => go(addDays(date, 1))}>
        <ChevronRight />
      </Button>
    </div>
  );
}
