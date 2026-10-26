"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Ban, ChevronLeft, ChevronRight, Loader2, Trash2, Undo2, UserCheck, UserMinus } from "lucide-react";
import { clearCover, markAbsent, removeAbsence, setCover } from "@/app/[inst]/absences/actions";
import { Button } from "@/components/ui/button";
import { addDays, todayIso } from "@/lib/calendar";
import type { Candidate } from "@/lib/cover";
import { cn } from "@/lib/utils";

export interface AbsenceView {
  id: string;
  teacherId: string;
  teacherName: string;
  periods: number[];
  reason: string | null;
  canManage: boolean;
  affected: {
    lessonId: string;
    label: string;
    time: string;
    room: string;
    cover: { action: "SUBSTITUTE" | "CANCEL"; substitute: string | null } | null;
    candidates: Candidate[];
  }[];
}

interface Props {
  slug: string;
  date: string;
  dayNote: string;
  hasClasses: boolean;
  periods: { start: string; end: string }[];
  markable: { id: string; name: string }[];
  absences: AbsenceView[];
  canArrange: boolean;
}

export function AbsenceBoard({ slug, date, dayNote, hasClasses, periods, markable, absences, canArrange }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [teacherId, setTeacherId] = useState(markable[0]?.id ?? "");
  const [wholeDay, setWholeDay] = useState(true);
  const [picked, setPicked] = useState<number[]>([]);
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const go = (d: string) => router.replace(`${pathname}?date=${d}`, { scroll: false });

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, done?: string) =>
    start(async () => {
      const res = await fn();
      setMsg(res.ok ? (done ? { ok: true, text: done } : null) : { ok: false, text: res.error ?? "Something went wrong." });
      if (res.ok) router.refresh();
    });

  const pretty = new Date(`${date}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
  const open = absences.flatMap((a) => a.affected).filter((x) => !x.cover).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="icon-sm" variant="outline" aria-label="Previous day" onClick={() => go(addDays(date, -1))}>
          <ChevronLeft />
        </Button>
        <input type="date" aria-label="Date" className="h-8 rounded-md border bg-background px-2 text-sm" value={date} onChange={(e) => e.target.value && go(e.target.value)} />
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
        {open > 0 && <span className="ml-auto rounded-md bg-amber-500/15 px-2 py-1 text-xs text-amber-800 dark:text-amber-300">{open} class{open === 1 ? "" : "es"} need cover</span>}
      </div>

      {hasClasses && markable.length > 0 && (
        <section className="space-y-3 rounded-lg border p-4">
          <h2 className="flex items-center gap-2 font-semibold">
            <UserMinus className="size-4" /> Mark absent
          </h2>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <select aria-label="Teacher" className="h-8 w-full rounded-md border bg-background px-2 sm:w-auto sm:min-w-52" value={teacherId} onChange={(e) => setTeacherId(e.target.value)}>
              {markable.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-1.5">
              <input type="checkbox" className="size-4 accent-primary" checked={wholeDay} onChange={(e) => setWholeDay(e.target.checked)} /> Whole day
            </label>
            {!wholeDay &&
              periods.map((p, i) => (
                <button
                  key={i}
                  type="button"
                  aria-pressed={picked.includes(i)}
                  title={`${p.start}–${p.end}`}
                  onClick={() => setPicked((x) => (x.includes(i) ? x.filter((y) => y !== i) : [...x, i]))}
                  className={cn("h-7 rounded-md border px-2 text-xs", picked.includes(i) ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")}
                >
                  P{i + 1}
                </button>
              ))}
            <input aria-label="Reason" placeholder="Reason (optional)" className="h-8 w-full rounded-md border bg-background px-2 sm:w-48" value={reason} onChange={(e) => setReason(e.target.value)} />
            <Button
              size="sm"
              disabled={pending || !teacherId || (!wholeDay && !picked.length)}
              onClick={() => run(() => markAbsent(slug, { teacherId, date, periods: wholeDay ? [] : picked.sort((a, b) => a - b), reason }), "Marked absent.")}
            >
              {pending ? <Loader2 className="animate-spin" /> : <UserMinus />} Mark absent
            </Button>
          </div>
        </section>
      )}
      {msg && <p className={cn("text-sm", msg.ok ? "text-muted-foreground" : "text-destructive")}>{msg.text}</p>}

      {absences.length === 0 ? (
        <p className="text-sm text-muted-foreground">{hasClasses ? "Nobody is marked absent on this day." : "No classes on this day."}</p>
      ) : (
        <div className="space-y-4">
          {absences.map((a) => (
            <section key={a.id} className="space-y-2 rounded-lg border p-4">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-semibold">{a.teacherName}</h3>
                <span className="text-sm text-muted-foreground">
                  {a.periods.length ? `absent ${a.periods.map((p) => `P${p + 1}`).join(", ")}` : "absent all day"}
                  {a.reason && ` · ${a.reason}`}
                </span>
                {a.canManage && (
                  <Button size="xs" variant="ghost" className="ml-auto" onClick={() => run(() => removeAbsence(slug, a.id), "Absence removed.")}>
                    <Trash2 /> Not absent
                  </Button>
                )}
              </div>
              {a.affected.length === 0 ? (
                <p className="text-sm text-muted-foreground">No classes to cover.</p>
              ) : (
                <ul className="divide-y rounded-md border">
                  {a.affected.map((x) => (
                    <li key={x.lessonId} className="space-y-2 px-3 py-2 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="w-28 shrink-0 tabular-nums text-muted-foreground">{x.time}</span>
                        <span className="font-medium">{x.label}</span>
                        <span className="text-muted-foreground">· {x.room}</span>
                        <span className="ml-auto">
                          {x.cover?.action === "SUBSTITUTE" && (
                            <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
                              <UserCheck className="size-4" /> {x.cover.substitute}
                            </span>
                          )}
                          {x.cover?.action === "CANCEL" && <span className="text-muted-foreground">Cancelled</span>}
                          {!x.cover && <span className="text-amber-700 dark:text-amber-400">Needs cover</span>}
                        </span>
                        {x.cover && a.canManage && canArrange && (
                          <Button size="xs" variant="ghost" aria-label="Undo" onClick={() => run(() => clearCover(slug, date, x.lessonId))}>
                            <Undo2 />
                          </Button>
                        )}
                      </div>
                      {!x.cover && a.canManage && canArrange && (
                        <div className="flex flex-wrap gap-1.5 pl-0">
                          {x.candidates.length === 0 && <span className="text-xs text-muted-foreground">Nobody is free then.</span>}
                          {x.candidates.map((c, i) => (
                            <Button
                              key={c.teacherId}
                              size="xs"
                              variant={i === 0 ? "default" : "outline"}
                              disabled={pending}
                              title={c.reasons.join(" · ")}
                              onClick={() => run(() => setCover(slug, { date, lessonId: x.lessonId, action: "SUBSTITUTE", substituteId: c.teacherId }), `${c.name} will cover.`)}
                            >
                              {c.name}
                              <span className="opacity-70">· {c.reasons[0]}</span>
                            </Button>
                          ))}
                          <Button
                            size="xs"
                            variant="ghost"
                            disabled={pending}
                            onClick={() => run(() => setCover(slug, { date, lessonId: x.lessonId, action: "CANCEL", substituteId: null }), "Class cancelled.")}
                          >
                            <Ban /> Cancel class
                          </Button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
