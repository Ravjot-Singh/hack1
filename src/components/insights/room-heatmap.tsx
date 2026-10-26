"use client";

import { useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { buildProblem } from "@/lib/solver";
import type { Assignment, InstituteInput } from "@/lib/solver";
import { utilization } from "@/lib/utilization";
import { cn } from "@/lib/utils";

interface Props {
  snapshot: InstituteInput;
  assignment: Assignment;
  versions: { id: string; label: string }[];
  versionId: string;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
/** Ordinal bucket 1..5 for a 0..1 share (0 = no fill). */
const bucket = (x: number) => (x <= 0 ? 0 : Math.min(5, Math.ceil(x * 5)));
const BUCKET_LABEL = ["", "1–20%", "21–40%", "41–60%", "61–80%", "81–100%"];
const selectClass = "h-8 rounded-md border bg-background px-2 text-sm";

export function RoomHeatmap({ snapshot, assignment, versions, versionId }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const problem = useMemo(() => buildProblem(snapshot), [snapshot]);
  const [building, setBuilding] = useState("");
  const [type, setType] = useState("");
  const [owner, setOwner] = useState("");
  const [sortByUse, setSortByUse] = useState(false);
  const [hover, setHover] = useState<{ room: string; slot: number; label: string | null } | null>(null);

  const D = snapshot.days.length;
  const P = snapshot.periods.length;
  const all = useMemo(() => utilization(problem, assignment), [problem, assignment]);
  const teaching = new Set(all.teachingSlots);
  const rooms = all.rooms
    .filter((r) => (!building || r.buildingId === building) && (!type || r.type === type) && (!owner || (owner === "shared" ? !r.ownerDeptId : r.ownerDeptId === owner)))
    .sort((a, b) => (sortByUse ? a.share - b.share : a.type.localeCompare(b.type) || a.name.localeCompare(b.name)));
  // Stats follow the filters so "labs in the Engineering Block" can be judged on their own.
  const busyBySlot = Array.from({ length: D * P }, (_, s) => (rooms.length && teaching.has(s) ? rooms.filter((r) => r.slots[s]).length / rooms.length : 0));
  const avg = rooms.length ? rooms.reduce((n, r) => n + r.share, 0) / rooms.length : 0;
  const underused = rooms.filter((r) => r.used > 0 && r.share < 0.3);
  const unused = rooms.filter((r) => r.used === 0);
  const peak = all.teachingSlots.reduce((best, s) => (busyBySlot[s] > busyBySlot[best] ? s : best), all.teachingSlots[0] ?? 0);
  const slotName = (s: number) => `${snapshot.days[Math.floor(s / P)]} P${(s % P) + 1} (${snapshot.periods[s % P]?.start})`;

  const types = [...new Set(all.rooms.map((r) => r.type))].sort();
  const cols = `minmax(7rem, 9rem) repeat(${D}, minmax(0, 1fr)) 3rem`;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="Timetable" className={selectClass} value={versionId} onChange={(e) => router.replace(`${pathname}?v=${e.target.value}`)}>
          {versions.map((v) => (
            <option key={v.id} value={v.id}>
              {v.label}
            </option>
          ))}
        </select>
        <select aria-label="Building" className={selectClass} value={building} onChange={(e) => setBuilding(e.target.value)}>
          <option value="">All buildings</option>
          {snapshot.buildings.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
        <select aria-label="Room type" className={selectClass} value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">All room types</option>
          {types.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
        <select aria-label="Owner" className={selectClass} value={owner} onChange={(e) => setOwner(e.target.value)}>
          <option value="">Any owner</option>
          <option value="shared">Shared rooms</option>
          {snapshot.departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.code}
            </option>
          ))}
        </select>
        <label className="ml-auto flex items-center gap-1.5 text-sm">
          <input type="checkbox" className="size-4 accent-primary" checked={sortByUse} onChange={(e) => setSortByUse(e.target.checked)} /> Least used first
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile value={pct(avg)} label={`Average use of ${rooms.length} room${rooms.length === 1 ? "" : "s"}`} />
        <Tile value={String(underused.length)} label="Used under 30% of the time" />
        <Tile value={String(unused.length)} label="Never used" />
        <Tile value={pct(busyBySlot[peak] ?? 0)} label={`Rooms busy at the peak, ${slotName(peak)}`} />
      </div>

      <section className="space-y-2">
        <p className="h-5 text-sm text-muted-foreground" aria-live="polite">
          {hover ? (
            <>
              <span className="font-medium text-foreground">{hover.room}</span> · {slotName(hover.slot)} ·{" "}
              {hover.label ?? (teaching.has(hover.slot) ? "free" : "no classes (break or closed)")}
            </>
          ) : (
            "Hover a cell to see what's in the room."
          )}
        </p>
        <div className="overflow-x-auto rounded-lg border p-2" onMouseLeave={() => setHover(null)}>
          <div className="grid min-w-[48rem] gap-y-[2px] text-xs" style={{ gridTemplateColumns: cols }}>
            {/* Room names stay put while the week scrolls sideways on narrow screens. */}
            <div className="sticky left-0 z-10 bg-background" />
            {snapshot.days.map((d) => (
              <div key={d} className="px-[1px] text-center font-medium text-muted-foreground">
                {d}
              </div>
            ))}
            <div className="text-right text-muted-foreground">Use</div>

            <div className="sticky left-0 z-10 truncate bg-background pr-2 font-medium">All rooms</div>
            {snapshot.days.map((d, di) => (
              <div key={d} className="grid gap-[2px] px-[3px]" style={{ gridTemplateColumns: `repeat(${P}, minmax(0, 1fr))` }}>
                {Array.from({ length: P }, (_, p) => {
                  const s = di * P + p;
                  const b = bucket(busyBySlot[s]);
                  return (
                    <div
                      key={p}
                      className={cn("h-4 rounded-[3px]", !teaching.has(s) && "tt-closed", teaching.has(s) && !b && "bg-muted")}
                      style={b ? { background: `var(--seq-${b})` } : undefined}
                      onMouseEnter={() => setHover({ room: "All rooms", slot: s, label: teaching.has(s) ? `${pct(busyBySlot[s])} of rooms busy` : null })}
                    />
                  );
                })}
              </div>
            ))}
            <div className="text-right tabular-nums text-muted-foreground">{pct(avg)}</div>

            <div className="col-span-full my-1 border-t" />

            {rooms.map((r) => (
              <div key={r.id} className="contents">
                <div className="sticky left-0 z-10 truncate bg-background pr-2" title={`${r.name} · ${r.type}`}>
                  {r.name}
                </div>
                {snapshot.days.map((d, di) => (
                  <div key={d} className="grid gap-[2px] px-[3px]" style={{ gridTemplateColumns: `repeat(${P}, minmax(0, 1fr))` }}>
                    {Array.from({ length: P }, (_, p) => {
                      const s = di * P + p;
                      const label = r.slots[s];
                      return (
                        <div
                          key={p}
                          className={cn("h-4 rounded-[3px]", !teaching.has(s) ? "tt-closed" : label ? "" : "bg-muted")}
                          style={label ? { background: "var(--occupied)" } : undefined}
                          onMouseEnter={() => setHover({ room: r.name, slot: s, label })}
                        />
                      );
                    })}
                  </div>
                ))}
                <div className={cn("text-right tabular-nums", r.share < 0.3 ? "font-medium text-foreground" : "text-muted-foreground")}>{pct(r.share)}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
          <Swatch style={{ background: "var(--occupied)" }} label="Room in use" />
          <Swatch className="bg-muted" label="Free" />
          <Swatch className="tt-closed border" label="Break / closed" />
          <span className="flex items-center gap-1">
            All rooms:
            {[1, 2, 3, 4, 5].map((b) => (
              <span key={b} className="inline-block size-3 rounded-[3px]" style={{ background: `var(--seq-${b})` }} title={BUCKET_LABEL[b]} />
            ))}
            <span>1% → 100% busy</span>
          </span>
        </div>
      </section>

      <details className="rounded-lg border">
        <summary className="cursor-pointer px-3 py-2 text-sm font-medium">View as table</summary>
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-1.5 font-medium">Room</th>
              <th className="px-3 py-1.5 font-medium">Type</th>
              <th className="px-3 py-1.5 font-medium">Building</th>
              <th className="px-3 py-1.5 font-medium">Owner</th>
              <th className="px-3 py-1.5 text-right font-medium">Periods used</th>
              <th className="px-3 py-1.5 text-right font-medium">Use</th>
            </tr>
          </thead>
          <tbody>
            {[...rooms].sort((a, b) => a.share - b.share).map((r) => (
              <tr key={r.id} className="border-t">
                <td className="px-3 py-1.5">{r.name}</td>
                <td className="px-3 py-1.5">{r.type}</td>
                <td className="px-3 py-1.5">{snapshot.buildings.find((b) => b.id === r.buildingId)?.name ?? "—"}</td>
                <td className="px-3 py-1.5">{snapshot.departments.find((d) => d.id === r.ownerDeptId)?.code ?? "Shared"}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">
                  {r.used}/{all.teachingSlots.length}
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums">{pct(r.share)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

function Tile({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function Swatch({ className, style, label }: { className?: string; style?: React.CSSProperties; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className={cn("inline-block size-3 rounded-[3px]", className)} style={style} /> {label}
    </span>
  );
}
