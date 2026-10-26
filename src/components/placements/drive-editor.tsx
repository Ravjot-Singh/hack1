"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Save, Trash2 } from "lucide-react";
import { deleteDrive, saveDrive } from "@/app/[inst]/placements/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { todayIso } from "@/lib/calendar";
import { countsFromRolls, parseRolls, type Attendance } from "@/lib/placements";
import { cn } from "@/lib/utils";

export interface EditorSection {
  id: string;
  name: string;
  year: number;
  deptId: string;
  size: number;
}

export interface DriveDraft {
  id: string | null;
  company: string;
  role: string;
  notes: string;
  attending: Attendance[];
  rounds: { id: string | null; name: string; date: string; start: number; end: number; roomId: string | null }[];
}

interface Props {
  slug: string;
  drive: DriveDraft | null;
  sections: EditorSection[];
  departments: { id: string; code: string }[];
  rooms: { id: string; name: string; capacity: number; isEventVenue: boolean }[];
  periods: { start: string; end: string }[];
  onDone?: () => void;
}

const selectClass = "h-8 rounded-md border bg-background px-2 text-sm";

export function DriveEditor({ slug, drive, sections, departments, rooms, periods, onDone }: Props) {
  const router = useRouter();
  const [company, setCompany] = useState(drive?.company ?? "");
  const [role, setRole] = useState(drive?.role ?? "");
  const [notes, setNotes] = useState(drive?.notes ?? "");
  const [counts, setCounts] = useState<Record<string, number>>(() => Object.fromEntries((drive?.attending ?? []).map((a) => [a.sectionId, a.count])));
  const [mode, setMode] = useState<"sections" | "rolls">("sections");
  const [rollsText, setRollsText] = useState("");
  const [dept, setDept] = useState("");
  const [year, setYear] = useState("");
  const [rounds, setRounds] = useState(drive?.rounds ?? [{ id: null, name: "Aptitude test", date: todayIso(), start: 0, end: 1, roomId: null }]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  const years = [...new Set(sections.map((s) => s.year))].sort();
  const shown = sections.filter((s) => (!dept || s.deptId === dept) && (!year || s.year === Number(year)));
  const parsed = useMemo(() => (mode === "rolls" && rollsText.trim() ? parseRolls(rollsText, sections) : null), [mode, rollsText, sections]);
  const attending: Attendance[] = parsed ? countsFromRolls(parsed.rows) : Object.entries(counts).filter(([, n]) => n > 0).map(([sectionId, count]) => ({ sectionId, count }));
  const total = attending.reduce((n, a) => n + a.count, 0);
  const setRound = (i: number, patch: Partial<(typeof rounds)[number]>) => setRounds((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const save = () =>
    start(async () => {
      const res = await saveDrive(slug, {
        id: drive?.id ?? null,
        company,
        role,
        notes,
        attending,
        rollsText: mode === "rolls" ? rollsText : "",
        rounds,
      });
      if (!res.ok) return setMsg({ ok: false, text: res.error });
      setMsg({ ok: true, text: res.warnings.length ? `Saved, but some venues couldn't be requested. ${res.warnings.join(" ")}` : "Saved. Venues requested at placement priority." });
      router.refresh();
      if (!res.warnings.length) onDone?.();
    });

  return (
    <div className="space-y-5 rounded-lg border p-4">
      <div className="flex flex-wrap gap-3">
        <label className="grid w-full gap-1 text-sm sm:w-auto">
          <span className="text-xs text-muted-foreground">Company</span>
          <Input className="w-full sm:w-56" value={company} maxLength={80} onChange={(e) => setCompany(e.target.value)} placeholder="e.g. Infosys" />
        </label>
        <label className="grid w-full gap-1 text-sm sm:w-auto">
          <span className="text-xs text-muted-foreground">Role</span>
          <Input className="w-full sm:w-56" value={role} maxLength={80} onChange={(e) => setRole(e.target.value)} placeholder="e.g. Systems Engineer" />
        </label>
        <label className="grid flex-1 gap-1 text-sm">
          <span className="text-xs text-muted-foreground">Notes for students</span>
          <Input value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} placeholder="Eligibility, what to bring…" />
        </label>
      </div>

      <section className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-medium">Who takes part</h3>
          <div role="radiogroup" className="flex rounded-lg border p-0.5 text-xs">
            {(
              [
                ["sections", "Pick sections"],
                ["rolls", "Paste roll numbers"],
              ] as const
            ).map(([v, label]) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={mode === v}
                onClick={() => setMode(v)}
                className={cn("rounded-md px-2.5 py-1", mode === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted")}
              >
                {label}
              </button>
            ))}
          </div>
          <span className="ml-auto text-sm text-muted-foreground">{total} students</span>
        </div>
        {mode === "sections" ? (
          <>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <select aria-label="Department" className={selectClass} value={dept} onChange={(e) => setDept(e.target.value)}>
                <option value="">All departments</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.code}
                  </option>
                ))}
              </select>
              <select aria-label="Year" className={selectClass} value={year} onChange={(e) => setYear(e.target.value)}>
                <option value="">All years</option>
                {years.map((y) => (
                  <option key={y} value={y}>
                    Year {y}
                  </option>
                ))}
              </select>
              <Button size="xs" variant="outline" onClick={() => setCounts((c) => ({ ...c, ...Object.fromEntries(shown.map((s) => [s.id, s.size])) }))}>
                Whole sections shown
              </Button>
              <Button size="xs" variant="ghost" onClick={() => setCounts((c) => ({ ...c, ...Object.fromEntries(shown.map((s) => [s.id, 0])) }))}>
                Clear shown
              </Button>
            </div>
            <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
              {shown.map((s) => (
                <label key={s.id} className="flex items-center gap-2 text-sm">
                  <Input
                    type="number"
                    min={0}
                    max={s.size}
                    aria-label={`Students from ${s.name}`}
                    className="h-8 w-20"
                    value={counts[s.id] ?? 0}
                    onChange={(e) => setCounts((c) => ({ ...c, [s.id]: Math.max(0, Math.min(s.size, Number(e.target.value) || 0)) }))}
                  />
                  <span>
                    {s.name} <span className="text-muted-foreground">of {s.size}</span>
                  </span>
                </label>
              ))}
            </div>
          </>
        ) : (
          <div className="space-y-1">
            <textarea
              aria-label="Roll numbers"
              className="h-32 w-full rounded-md border bg-background p-2 font-mono text-xs"
              placeholder={"roll, section\n2215001, CSE-2A\n2215044, CSE-2B"}
              value={rollsText}
              onChange={(e) => setRollsText(e.target.value)}
            />
            {parsed && (
              <p className={cn("text-xs", parsed.errors.length ? "text-destructive" : "text-muted-foreground")}>
                {parsed.errors.length
                  ? parsed.errors.slice(0, 3).join(" ")
                  : `${parsed.rows.length} students: ${countsFromRolls(parsed.rows)
                      .map((a) => `${sections.find((s) => s.id === a.sectionId)?.name} ${a.count}`)
                      .join(", ")}`}
              </p>
            )}
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h3 className="font-medium">Rounds</h3>
        {rounds.map((r, i) => (
          <div key={r.id ?? `new-${i}`} className="flex flex-wrap items-end gap-2 text-sm">
            <Input aria-label="Round name" className="w-44" value={r.name} maxLength={60} onChange={(e) => setRound(i, { name: e.target.value })} />
            <input type="date" aria-label="Round date" className={selectClass} value={r.date} onChange={(e) => e.target.value && setRound(i, { date: e.target.value })} />
            <select aria-label="From period" className={selectClass} value={r.start} onChange={(e) => setRound(i, { start: Number(e.target.value), end: Math.max(r.end, Number(e.target.value)) })}>
              {periods.map((p, k) => (
                <option key={k} value={k}>
                  from P{k + 1} {p.start}
                </option>
              ))}
            </select>
            <select aria-label="To period" className={selectClass} value={r.end} onChange={(e) => setRound(i, { end: Number(e.target.value) })}>
              {periods.map((p, k) =>
                k < r.start ? null : (
                  <option key={k} value={k}>
                    to P{k + 1} {p.end}
                  </option>
                ),
              )}
            </select>
            <select aria-label="Venue" className={cn(selectClass, "max-w-56")} value={r.roomId ?? ""} onChange={(e) => setRound(i, { roomId: e.target.value || null })}>
              <option value="">No venue needed</option>
              {rooms.map((room) => (
                <option key={room.id} value={room.id}>
                  {room.name} ({room.capacity}){room.capacity < total ? " too small" : ""}
                </option>
              ))}
            </select>
            <Button size="icon-sm" variant="ghost" aria-label={`Remove ${r.name}`} disabled={rounds.length === 1} onClick={() => setRounds((rs) => rs.filter((_, j) => j !== i))}>
              <Trash2 />
            </Button>
          </div>
        ))}
        <Button
          size="xs"
          variant="outline"
          onClick={() => setRounds((rs) => [...rs, { id: null, name: "Interviews", date: rs[rs.length - 1]?.date ?? todayIso(), start: 4, end: Math.min(periods.length - 1, 6), roomId: null }])}
        >
          <Plus /> Add round
        </Button>
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={save} disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : <Save />} {drive ? "Save changes" : "Create drive"}
        </Button>
        {onDone && (
          <Button variant="ghost" onClick={onDone}>
            Close
          </Button>
        )}
        {drive?.id && (
          <Button
            variant="ghost"
            className="ml-auto text-destructive"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await deleteDrive(slug, drive.id!);
                if (!res.ok) setMsg({ ok: false, text: res.error });
                else router.refresh();
              })
            }
          >
            <Trash2 /> Delete drive
          </Button>
        )}
      </div>
      {msg && <p className={cn("text-sm", msg.ok ? "text-muted-foreground" : "text-destructive")}>{msg.text}</p>}
    </div>
  );
}

/** "New drive" / "Edit" toggles around the editor. */
export function DriveEditorToggle({ label, ...props }: Omit<Props, "onDone"> & { label: string }) {
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <Button size="sm" variant={props.drive ? "outline" : "default"} onClick={() => setOpen(true)}>
        {props.drive ? null : <Plus />} {label}
      </Button>
    );
  return <DriveEditor {...props} onDone={() => setOpen(false)} />;
}
