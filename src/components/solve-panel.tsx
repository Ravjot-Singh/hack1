"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, Play, RotateCcw, Save, XCircle } from "lucide-react";
import { saveVersion } from "@/app/[inst]/actions";
import { IssueList } from "@/components/issue-list";
import { TimetableExplorer } from "@/components/timetable/timetable-explorer";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { buildProblem, precheck } from "@/lib/solver";
import type { InstituteInput, SolveProgress, SolveResult } from "@/lib/solver";
import type { WorkerMessage, WorkerRequest } from "@/workers/solver.worker";

const GOAL_LABELS: Record<string, string> = {
  teacherPrefs: "Teacher 'avoid' slots used",
  balancedDays: "Uneven days (spread)",
  idleGaps: "Free periods between classes",
  subjectSpread: "Same subject twice a day",
  roomUtilization: "Rarely-used rooms",
  customRules: "Custom 'avoid' rules broken",
};

export function SolvePanel({ slug, input, canSave }: { slug: string; input: InstituteInput; canSave: boolean }) {
  const router = useRouter();
  const problem = useMemo(() => buildProblem(input), [input]);
  const issues = useMemo(() => precheck(problem), [problem]);
  const errors = issues.filter((i) => i.severity === "error");
  const [progress, setProgress] = useState<SolveProgress | null>(null);
  const [result, setResult] = useState<SolveResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  const workerRef = useRef<Worker | null>(null);

  useEffect(() => () => workerRef.current?.terminate(), []);

  const run = () => {
    workerRef.current?.terminate();
    const worker = new Worker(new URL("../workers/solver.worker.ts", import.meta.url), { type: "module" });
    workerRef.current = worker;
    setRunning(true);
    setResult(null);
    setError(null);
    setProgress(null);
    worker.onmessage = (e: MessageEvent<WorkerMessage>) => {
      const msg = e.data;
      if (msg.type === "progress") setProgress(msg.progress);
      else {
        if (msg.type === "done") setResult(msg.result);
        else setError(msg.message);
        setRunning(false);
        worker.terminate();
      }
    };
    worker.postMessage({ input, seed: Math.floor(Math.random() * 1e9) } satisfies WorkerRequest);
  };

  const save = () =>
    startSaving(async () => {
      if (!result) return;
      const res = await saveVersion(slug, result.assignment, result.ms);
      if (res.ok) router.push(`/${slug}/timetables/${res.versionId}`);
      else setError(res.error);
    });

  const placedLessons = result ? problem.lessons.length - result.unscheduled.length : 0;
  const lessonsById = useMemo(() => new Map(problem.lessons.map((l) => [l.id, l])), [problem]);

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Readiness check</CardTitle>
            <CardDescription>
              {problem.lessons.length} classes to place for {input.sections.length} sections, {input.teachers.length}{" "}
              teachers and {input.rooms.filter((r) => !r.isEventVenue).length} rooms.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <IssueList issues={issues} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Solver</CardTitle>
            <CardDescription>
              {errors.length
                ? "Fix the errors first for a complete timetable. You can still try, and it will place what it can."
                : "Hard rules are never broken. Soft goals are optimised."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button size="lg" className="w-full" onClick={run} disabled={running}>
              {running ? <Loader2 className="animate-spin" /> : result ? <RotateCcw /> : <Play />}
              {running ? "Solving…" : result ? "Generate another" : "Generate timetable"}
            </Button>
            {(running || progress) && progress && (
              <div className="space-y-1">
                <Progress value={(100 * progress.placed) / Math.max(1, progress.total)} />
                <div className="flex justify-between text-xs text-muted-foreground tabular-nums">
                  <span>
                    {progress.phase === "construct" ? "Placing classes" : "Improving quality"} · {progress.placed}/
                    {progress.total}
                  </span>
                  {progress.quality != null && <span>quality {progress.quality}</span>}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {error && (
        <p className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          <XCircle className="mt-0.5 size-4 shrink-0" /> {error}
        </p>
      )}

      {result && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat
              ok={result.violations.length === 0}
              value={result.violations.length === 0 ? "0 clashes" : `${result.violations.length} problems`}
              label="Hard rules checked independently"
            />
            <Stat
              ok={!result.unscheduled.length}
              value={`${placedLessons}/${problem.lessons.length}`}
              label="Classes placed"
            />
            <Stat value={`${result.score.quality}/100`} label="Quality (soft goals)" />
            <Stat value={`${(result.ms / 1000).toFixed(1)} s`} label="Solve time" />
          </div>

          {result.unscheduled.length > 0 && (
            <Card className="border-amber-500/50">
              <CardHeader>
                <CardTitle>Why some classes could not be placed</CardTitle>
                <CardDescription>Every other class is clash-free. Here is exactly what blocked these:</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {Object.entries(result.explanations).map(([id, reasons]) => (
                  <div key={id}>
                    <div className="font-medium">{lessonsById.get(id)?.label}</div>
                    <ul className="ml-4 list-disc text-muted-foreground">
                      {reasons.map((r, i) => (
                        <li key={i}>{r}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle>Preview</CardTitle>
                <CardDescription>
                  Soft-goal penalties:{" "}
                  {Object.entries(result.score.penalties)
                    .map(([k, v]) => `${GOAL_LABELS[k] ?? k} ${v}`)
                    .join(" · ")}
                </CardDescription>
              </div>
              {canSave ? (
                <Button onClick={save} disabled={saving || result.violations.length > 0}>
                  {saving ? <Loader2 className="animate-spin" /> : <Save />} Save as draft
                </Button>
              ) : (
                <span className="text-xs text-muted-foreground">The shared demo can&apos;t be saved. Make your own copy to keep timetables.</span>
              )}
            </CardHeader>
            <CardContent>
              <TimetableExplorer problem={problem} assignment={result.assignment} title="Unsaved preview" />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function Stat({ value, label, ok }: { value: string; label: string; ok?: boolean }) {
  return (
    <Card size="sm">
      <CardContent>
        <div className="flex items-center gap-1.5 text-xl font-semibold tabular-nums">
          {ok === true && <CheckCircle2 className="size-5 text-emerald-600" />}
          {ok === false && <XCircle className="size-5 text-amber-600" />}
          {value}
        </div>
        <div className="text-xs text-muted-foreground">{label}</div>
      </CardContent>
    </Card>
  );
}
