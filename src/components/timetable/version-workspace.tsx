"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Pencil, Redo2, Save, Sparkles, Undo2, X } from "lucide-react";
import { saveEdits } from "@/app/[inst]/timetables/actions";
import { Button } from "@/components/ui/button";
import { buildProblem } from "@/lib/solver";
import type { Assignment, InstituteInput } from "@/lib/solver";
import { runSolver } from "@/lib/solver-client";
import { EditSession } from "@/lib/solver/edit";
import { cn } from "@/lib/utils";
import { ShareDialog } from "./share-dialog";
import { TimetableExplorer } from "./timetable-explorer";

interface Props {
  slug: string;
  versionId: string;
  title: string;
  snapshot: InstituteInput;
  assignment: Assignment;
  pinned: string[];
  /** False for published versions and the read-only demo. */
  editable: boolean;
  /** May create public share links. */
  canShare: boolean;
  /** This version is the currently published one. */
  published: boolean;
  readOnlyReason?: string;
}

interface State {
  assignment: Assignment;
  pinned: Set<string>;
}

/** A saved timetable with optional manual editing: move/swap with live rule checks, pins, undo and re-solve. */
export function VersionWorkspace({ slug, versionId, title, snapshot, assignment, pinned, editable, canShare, published, readOnlyReason }: Props) {
  const router = useRouter();
  const problem = useMemo(() => buildProblem(snapshot), [snapshot]);
  const initial = useMemo<State>(() => ({ assignment, pinned: new Set(pinned) }), [assignment, pinned]);

  const [editing, setEditing] = useState(false);
  const [state, setState] = useState<State>(initial);
  const [prevInitial, setPrevInitial] = useState(initial);
  const [past, setPast] = useState<State[]>([]);
  const [future, setFuture] = useState<State[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [solving, setSolving] = useState(false);
  const [saving, startSaving] = useTransition();

  // Fresh server data (after saving) becomes the new baseline when nothing is pending.
  if (initial !== prevInitial) {
    setPrevInitial(initial);
    if (!past.length) setState(initial);
  }

  const session = useMemo(() => new EditSession(problem, state.assignment, state.pinned), [problem, state]);
  const baseQuality = useMemo(() => new EditSession(problem, initial.assignment).quality(), [problem, initial]);
  const quality = useMemo(() => session.quality(), [session]);
  const options = useMemo(() => (selected ? session.options(selected) : null), [session, selected]);
  const selectedUnit = useMemo(() => new Set(selected ? session.unitLessons(selected) : []), [session, selected]);
  const dirty = past.length > 0;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setSelected(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const commit = (next: State, note?: string) => {
    setPast((p) => [...p, state]);
    setFuture([]);
    setState(next);
    setSelected(null);
    setMsg(note ? { ok: true, text: note } : null);
  };

  const onTarget = (day: number, period: number) => {
    if (!selected) return;
    const s = new EditSession(problem, state.assignment, state.pinned);
    const opt = options?.get(`${day}:${period}`);
    if (!s.apply(selected, day, period)) {
      setMsg({ ok: false, text: "That move is no longer possible." });
      return;
    }
    // A hand-placed class is pinned so re-solving keeps it there.
    const pins = new Set(state.pinned);
    for (const id of s.unitLessons(selected)) pins.add(id);
    commit({ assignment: s.assignment(), pinned: pins }, opt?.kind === "swap" ? `Swapped with ${opt.withLabel}.` : undefined);
  };

  const togglePin = (lessonId: string) => {
    const ids = session.unitLessons(lessonId);
    const pins = new Set(state.pinned);
    const on = ids.some((id) => pins.has(id));
    for (const id of ids) {
      if (on) pins.delete(id);
      else pins.add(id);
    }
    commit({ assignment: state.assignment, pinned: pins });
  };

  const undo = () => {
    const prev = past.at(-1);
    if (!prev) return;
    setPast(past.slice(0, -1));
    setFuture([state, ...future]);
    setState(prev);
    setSelected(null);
  };
  const redo = () => {
    const [next, ...rest] = future;
    if (!next) return;
    setPast([...past, state]);
    setFuture(rest);
    setState(next);
    setSelected(null);
  };

  const resolve = async () => {
    setSolving(true);
    setSelected(null);
    setMsg(null);
    const pins = [...state.pinned]
      .filter((id) => state.assignment[id])
      .map((id) => ({ lessonId: id, ...state.assignment[id] }));
    try {
      const res = await runSolver({ ...snapshot, pins }).result;
      const before = problem.lessons.filter((l) => !state.assignment[l.id]).length;
      if (res.violations.length || res.unscheduled.length > before) {
        const why = Object.values(res.explanations)[0]?.[0];
        setMsg({ ok: false, text: `Re-solving around ${pins.length} pins couldn't place every class${why ? ` (${why})` : ""}. Unpin something and try again.` });
      } else {
        commit({ assignment: res.assignment, pinned: state.pinned }, `Re-solved around ${pins.length} pinned class${pins.length === 1 ? "" : "es"}.`);
      }
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Re-solve failed." });
    } finally {
      setSolving(false);
    }
  };

  const save = () =>
    startSaving(async () => {
      const res = await saveEdits(slug, versionId, state.assignment, [...state.pinned]);
      if (res.ok) {
        setPast([]);
        setFuture([]);
        setMsg({ ok: true, text: `Saved. Quality ${res.quality}/100.` });
        router.refresh();
      } else setMsg({ ok: false, text: res.error });
    });

  const discard = () => {
    setState(initial);
    setPast([]);
    setFuture([]);
    setSelected(null);
    setMsg(null);
  };

  const actions = !editable ? (
    readOnlyReason ? <span className="text-xs text-muted-foreground">{readOnlyReason}</span> : null
  ) : !editing ? (
    <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
      <Pencil /> Edit by hand
    </Button>
  ) : (
    <>
      <Button size="sm" variant="ghost" onClick={undo} disabled={!past.length} aria-label="Undo">
        <Undo2 />
      </Button>
      <Button size="sm" variant="ghost" onClick={redo} disabled={!future.length} aria-label="Redo">
        <Redo2 />
      </Button>
      <Button size="sm" variant="outline" onClick={resolve} disabled={solving || !state.pinned.size} title="Keep pinned classes where they are and re-arrange everything else">
        {solving ? <Loader2 className="animate-spin" /> : <Sparkles />} Re-solve around {state.pinned.size} pin{state.pinned.size === 1 ? "" : "s"}
      </Button>
      {dirty ? (
        <>
          <Button size="sm" variant="ghost" onClick={discard} disabled={saving}>
            <X /> Discard
          </Button>
          <Button size="sm" onClick={save} disabled={saving}>
            {saving ? <Loader2 className="animate-spin" /> : <Save />} Save changes
          </Button>
        </>
      ) : (
        <Button size="sm" variant="ghost" onClick={() => (setEditing(false), setSelected(null))}>
          <Check /> Done
        </Button>
      )}
    </>
  );

  return (
    <div className="space-y-3">
      {editing && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border bg-muted/40 px-3 py-2 text-xs print:hidden">
          <span className="font-medium">
            {selected ? "Pick where it should go" : "Click or drag a class to move it"}
          </span>
          <Legend className="bg-emerald-500/25" label="move" />
          <Legend className="bg-sky-500/25" label="swap" />
          <Legend className="bg-amber-400/30" label="allowed, lowers quality" />
          <Legend className="bg-destructive/15" label="not allowed (hover for why)" />
          <span className="ml-auto tabular-nums">
            Quality {baseQuality}
            {quality !== baseQuality && <span className={quality > baseQuality ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700"}> → {quality}</span>}
            {dirty && ` · ${past.length} change${past.length === 1 ? "" : "s"} unsaved`}
          </span>
        </div>
      )}
      {msg && <p className={cn("text-sm print:hidden", msg.ok ? "text-muted-foreground" : "text-destructive")}>{msg.text}</p>}
      <TimetableExplorer
        problem={problem}
        assignment={state.assignment}
        title={title}
        actions={(current) => (
          <>
            {/* Sharing publishes the saved version, so it's hidden while there are hand edits in progress. */}
            {!editing && canShare && <ShareDialog slug={slug} versionId={versionId} current={current} published={published} />}
            {actions}
          </>
        )}
        edit={
          editing
            ? {
                selected: selectedUnit,
                options,
                pinned: state.pinned,
                quality,
                onSelect: setSelected,
                onTarget,
                onTogglePin: togglePin,
              }
            : undefined
        }
      />
    </div>
  );
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1 text-muted-foreground">
      <span className={cn("inline-block size-3 rounded-sm border", className)} /> {label}
    </span>
  );
}
