"use client";

import { useMemo, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Check, ChevronLeft, ChevronRight, Loader2, X } from "lucide-react";
import { cancelBooking, decideBooking, requestBooking } from "@/app/[inst]/venues/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addDays, todayIso } from "@/lib/calendar";
import { cn } from "@/lib/utils";
import {
  alternatives,
  checkRequest,
  periodRange,
  PRIORITY_LABEL,
  type Booking,
  type BookingStatus,
  type Priority,
  type Room,
} from "@/lib/venues";

export interface BookingView {
  id: string;
  roomId: string;
  roomName: string;
  date: string;
  start: number;
  end: number;
  when: string;
  title: string;
  attendees: number;
  priority: Priority;
  status: BookingStatus;
  requester: string;
  note: string | null;
  classOverride: boolean;
  mine: boolean;
  canDecide: boolean;
}

interface Props {
  slug: string;
  date: string;
  dayNote: string;
  published: boolean;
  periods: { start: string; end: string }[];
  rooms: (Room & { ownerCode: string | null })[];
  /** roomId -> period -> class label */
  use: Record<string, Record<number, string>>;
  /** roomId -> period -> why the room is out of service */
  down: Record<string, Record<number, string>>;
  bookings: BookingView[];
  queue: BookingView[];
  mine: BookingView[];
  priorities: Priority[];
  isHoi: boolean;
}

const STATUS_LABEL: Record<BookingStatus, string> = { PENDING: "Waiting", APPROVED: "Approved", REJECTED: "Declined", CANCELLED: "Cancelled" };
const selectClass = "h-8 rounded-md border bg-background px-2 text-sm";

export function VenueBoard({ slug, date, dayNote, published, periods, rooms, use, down, bookings, queue, mine, priorities, isHoi }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const go = (d: string) => router.replace(`${pathname}?date=${d}`, { scroll: false });
  const [type, setType] = useState("");
  const [sel, setSel] = useState<{ roomId: string; start: number; end: number } | null>(null);
  const [title, setTitle] = useState("");
  const [attendees, setAttendees] = useState(30);
  const [priority, setPriority] = useState<Priority>(priorities[0]);
  const [override, setOverride] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  const P = periods.length;
  const past = date < todayIso();
  const useMap = useMemo(() => new Map(Object.entries(use).map(([r, m]) => [r, new Map(Object.entries(m).map(([p, l]) => [Number(p), l]))])), [use]);
  const downMap = useMemo(() => new Map(Object.entries(down).map(([r, m]) => [r, new Map(Object.entries(m).map(([p, why]) => [Number(p), why]))])), [down]);
  const live: Booking[] = bookings.map((b) => ({ id: b.id, roomId: b.roomId, start: b.start, end: b.end, priority: b.priority, status: b.status, title: b.title }));
  const shown = rooms.filter((r) => !type || (type === "venues" ? r.isEventVenue : r.type === type));
  const types = [...new Set(rooms.filter((r) => !r.isEventVenue).map((r) => r.type))].sort();
  const room = sel && rooms.find((r) => r.id === sel.roomId);
  const req = sel && { ...sel, priority, attendees };
  const check = room && req ? checkRequest(req, room, useMap, live, undefined, downMap) : null;
  const alts = room && req ? alternatives(req, rooms, useMap, live, 4, downMap) : [];

  const cellBooking = (roomId: string, p: number) =>
    bookings.find((b) => b.roomId === roomId && (b.status === "APPROVED" || b.status === "PENDING") && p >= b.start && p <= b.end && (b.status === "APPROVED" || !bookings.some((x) => x.status === "APPROVED" && x.roomId === roomId && p >= x.start && p <= x.end)));

  const pick = (roomId: string, p: number) => {
    setMsg(null);
    if (sel && sel.roomId === roomId && sel.start === sel.end && p !== sel.start) setSel({ roomId, start: Math.min(p, sel.start), end: Math.max(p, sel.start) });
    else setSel({ roomId, start: p, end: p });
  };

  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>, after?: () => void) =>
    start(async () => {
      const res = await fn();
      setMsg(res.ok ? (res.message ? { ok: true, text: res.message } : null) : { ok: false, text: res.error ?? "Something went wrong." });
      if (res.ok) {
        after?.();
        router.refresh();
      }
    });

  const pretty = new Date(`${date}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
  const cols = `minmax(8rem, 11rem) repeat(${P}, minmax(2.5rem, 1fr))`;

  return (
    <div className="space-y-6">
      {queue.length > 0 && (
        <section className="space-y-2 rounded-lg border border-primary/40 p-4">
          <h2 className="font-semibold">Waiting for your decision ({queue.length})</h2>
          <ul className="divide-y">
            {queue.map((b) => (
              <Decision key={b.id} b={b} pending={pending} onDecide={(ok, note) => run(() => decideBooking(slug, b.id, ok, note))} />
            ))}
          </ul>
        </section>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button size="icon-sm" variant="outline" aria-label="Previous day" onClick={() => go(addDays(date, -1))}>
          <ChevronLeft />
        </Button>
        <input type="date" aria-label="Date" className={selectClass} value={date} onChange={(e) => e.target.value && go(e.target.value)} />
        <Button size="icon-sm" variant="outline" aria-label="Next day" onClick={() => go(addDays(date, 1))}>
          <ChevronRight />
        </Button>
        {date !== todayIso() && (
          <Button size="sm" variant="ghost" onClick={() => go(todayIso())}>
            Today
          </Button>
        )}
        <span className="ml-2 text-sm">
          <span className="font-medium">{pretty}</span> <span className="text-muted-foreground">· {dayNote}</span>
        </span>
        <select aria-label="Rooms shown" className={cn(selectClass, "ml-auto")} value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">All rooms</option>
          <option value="venues">Seminar halls & venues</option>
          {types.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
      </div>
      {!published && <p className="text-sm text-muted-foreground">No timetable is published yet, so no room is marked as busy with classes.</p>}

      <section className="space-y-2">
        <p className="text-sm text-muted-foreground">{past ? "This date has passed." : "Click a free cell to start a request; click another cell in the same row to cover several periods."}</p>
        <div className="overflow-x-auto rounded-lg border p-2">
          <div className="grid min-w-[40rem] gap-[2px] text-xs" style={{ gridTemplateColumns: cols }}>
            <div />
            {periods.map((p, i) => (
              <div key={i} className="text-center text-muted-foreground">
                <div className="font-medium">P{i + 1}</div>
                <div className="text-[10px]">{p.start}</div>
              </div>
            ))}
            {shown.map((r) => (
              <div key={r.id} className="contents">
                <div className="truncate pr-2 leading-8" title={`${r.name} · ${r.type} · ${r.capacity} seats${r.ownerCode ? ` · ${r.ownerCode}` : ""}`}>
                  <span className="font-medium">{r.name}</span> <span className="text-muted-foreground">{r.capacity}</span>
                </div>
                {periods.map((_, p) => {
                  const off = down[r.id]?.[p];
                  const cls = use[r.id]?.[p];
                  const b = cellBooking(r.id, p);
                  const selected = sel?.roomId === r.id && p >= sel.start && p <= sel.end;
                  const label = off ? `Out of service: ${off}` : cls ? `Class: ${cls}` : b ? `${b.status === "APPROVED" ? "Booked" : "Requested"}: ${b.title} (${PRIORITY_LABEL[b.priority]})` : "Free";
                  return (
                    <button
                      key={p}
                      type="button"
                      disabled={past || !!off}
                      title={`${r.name}, P${p + 1}: ${label}`}
                      aria-label={`${r.name}, P${p + 1}: ${label}`}
                      aria-pressed={selected}
                      onClick={() => pick(r.id, p)}
                      className={cn(
                        "h-8 truncate rounded-[3px] px-1 text-left text-[10px] leading-8",
                        off && "tt-closed text-muted-foreground",
                        !off && cls && "bg-muted text-muted-foreground",
                        b?.status === "APPROVED" && "bg-primary text-primary-foreground",
                        b?.status === "PENDING" && "border border-dashed border-primary text-primary",
                        !cls && !b && "bg-muted/30 hover:bg-muted",
                        selected && "ring-2 ring-ring ring-offset-1 ring-offset-background",
                      )}
                    >
                      {off ? "out" : cls ? "class" : b ? b.title : ""}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
          <Legend className="bg-muted/30 border" label="Free" />
          <Legend className="bg-muted" label="Class" />
          <Legend className="bg-primary" label="Booked" />
          <Legend className="border border-dashed border-primary" label="Requested" />
          <Legend className="tt-closed border" label="Out of service" />
        </div>
      </section>

      {sel && room && check && !past && (
        <section className="space-y-3 rounded-lg border p-4">
          <h2 className="font-semibold">
            Book {room.name} · {periodRange(sel.start, sel.end, periods)}
          </h2>
          <div className="flex flex-wrap items-end gap-3 text-sm">
            <label className="grid gap-1">
              <span className="text-xs text-muted-foreground">What for</span>
              <Input className="w-64" value={title} maxLength={120} placeholder="e.g. Guest lecture on AI" onChange={(e) => setTitle(e.target.value)} />
            </label>
            <label className="grid gap-1">
              <span className="text-xs text-muted-foreground">People</span>
              <Input className="w-24" type="number" min={1} value={attendees} onChange={(e) => setAttendees(Math.max(1, Number(e.target.value) || 1))} />
            </label>
            <label className="grid gap-1">
              <span className="text-xs text-muted-foreground">Priority</span>
              <select className={selectClass} value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
                {priorities.map((p) => (
                  <option key={p} value={p}>
                    {PRIORITY_LABEL[p]}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <ul className="space-y-1 text-sm">
            {check.outOfService.length > 0 && <li className="text-destructive">{room.name} is out of service then: {check.outOfService[0].reason}.</li>}
            {check.tooSmall && <li className="text-destructive">{room.name} holds {room.capacity} people.</li>}
            {check.classes.length > 0 && (
              <li className={isHoi ? "text-amber-700 dark:text-amber-300" : "text-destructive"}>
                Classes use this room then: {check.classes.map((c) => `${c.label} (P${c.period + 1})`).join(", ")}.
                {isHoi ? (
                  <label className="ml-2 inline-flex items-center gap-1.5">
                    <input type="checkbox" className="size-4 accent-primary" checked={override} onChange={(e) => setOverride(e.target.checked)} /> Book over them
                    (Head of Institute override)
                  </label>
                ) : (
                  " Only the Head of Institute can book over classes."
                )}
              </li>
            )}
            {check.blockers.map((b) => (
              <li key={b.id} className="text-destructive">
                Already booked for “{b.title}” ({PRIORITY_LABEL[b.priority]}), which has the same or higher priority.
              </li>
            ))}
            {check.bumps.map((b) => (
              <li key={b.id} className="text-amber-700 dark:text-amber-300">
                Booked for “{b.title}” ({PRIORITY_LABEL[b.priority]}); if approved, yours replaces it and they are offered another room.
              </li>
            ))}
            {check.competing.map((b) => (
              <li key={b.id} className="text-muted-foreground">
                Also requested for “{b.title}” ({PRIORITY_LABEL[b.priority]}); the approver picks, higher priority first.
              </li>
            ))}
            {!check.tooSmall && !check.outOfService.length && !check.classes.length && !check.blockers.length && !check.bumps.length && !check.competing.length && (
              <li className="text-muted-foreground">Free for this time. Approved by the {room.ownerDeptId && !room.isEventVenue ? `HOD of ${room.ownerCode}` : "Venue Manager"}.</li>
            )}
          </ul>
          {(check.tooSmall || check.outOfService.length > 0 || (check.classes.length > 0 && !override) || check.blockers.length > 0) && alts.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 text-sm">
              <span className="text-muted-foreground">Free instead:</span>
              {alts.map((a) => (
                <Button key={a.id} size="xs" variant="outline" onClick={() => setSel({ ...sel, roomId: a.id })}>
                  {a.name} ({a.capacity})
                </Button>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2">
            <Button
              disabled={pending || title.trim().length < 3}
              onClick={() =>
                run(
                  () => requestBooking(slug, { date, roomId: sel.roomId, start: sel.start, end: sel.end, title, attendees, priority, override }),
                  () => {
                    setSel(null);
                    setTitle("");
                    setOverride(false);
                  },
                )
              }
            >
              {pending && <Loader2 className="animate-spin" />} Request
            </Button>
            <Button variant="ghost" onClick={() => setSel(null)}>
              Cancel
            </Button>
          </div>
        </section>
      )}
      {msg && <p className={cn("text-sm", msg.ok ? "text-muted-foreground" : "text-destructive")}>{msg.text}</p>}

      <section className="space-y-2">
        <h2 className="font-semibold">Your upcoming requests</h2>
        {mine.length === 0 ? (
          <p className="text-sm text-muted-foreground">None yet.</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {mine.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                <Badge variant={b.status === "APPROVED" ? "default" : b.status === "PENDING" ? "outline" : "secondary"}>{STATUS_LABEL[b.status]}</Badge>
                <span className="font-medium">{b.title}</span>
                <span className="text-muted-foreground">
                  {b.roomName} · {b.date} · {b.when}
                </span>
                {b.note && <span className="w-full text-xs text-muted-foreground">{b.note}</span>}
                {(b.status === "PENDING" || b.status === "APPROVED") && (
                  <Button size="xs" variant="ghost" className="ml-auto" disabled={pending} onClick={() => run(() => cancelBooking(slug, b.id))}>
                    Cancel booking
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Decision({ b, pending, onDecide }: { b: BookingView; pending: boolean; onDecide: (approve: boolean, note: string) => void }) {
  const [note, setNote] = useState("");
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2 text-sm">
      <div className="min-w-0 flex-1">
        <div>
          <span className="font-medium">{b.title}</span> <Badge variant="outline">{PRIORITY_LABEL[b.priority]}</Badge>
          {b.classOverride && <Badge variant="secondary" className="ml-1">over classes</Badge>}
        </div>
        <div className="text-xs text-muted-foreground">
          {b.roomName} · {b.date} · {b.when} · {b.attendees} people · asked by {b.requester}
        </div>
      </div>
      <Input className="h-8 w-48" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
      <Button size="sm" disabled={pending} onClick={() => onDecide(true, note)}>
        <Check /> Approve
      </Button>
      <Button size="sm" variant="outline" disabled={pending} onClick={() => onDecide(false, note)}>
        <X /> Decline
      </Button>
    </li>
  );
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className={cn("inline-block size-3 rounded-[3px]", className)} /> {label}
    </span>
  );
}
