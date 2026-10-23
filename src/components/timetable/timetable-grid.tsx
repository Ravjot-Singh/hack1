import type { Assignment, Lesson, Problem } from "@/lib/solver/types";
import { cn } from "@/lib/utils";

export type ViewKind = "section" | "teacher" | "room";

const KIND_TAG: Record<Lesson["kind"], string | null> = { L: null, T: "Tut", P: "Lab", H: null };

/** Stable hue per subject code so a subject has the same colour everywhere. */
export function subjectHue(code: string): number {
  let h = 0;
  for (const c of code) h = (h * 31 + c.charCodeAt(0)) % 360;
  return (h * 7) % 360;
}

const shortName = (name: string) => name.replace(/^(Dr|Mr|Ms|Mrs|Prof)\.?\s+/, "");

interface Props {
  problem: Problem;
  assignment: Assignment;
  view: ViewKind;
  entityId: string;
}

/** Week grid: days down, periods across, lab blocks spanning periods, parallel classes stacked. */
export function TimetableGrid({ problem, assignment, view, entityId }: Props) {
  const { input } = problem;
  const P = input.periods.length;
  const rooms = new Map(input.rooms.map((r) => [r.id, r]));
  const teachers = new Map(input.teachers.map((t) => [t.id, t]));
  const sections = new Map(input.sections.map((s) => [s.id, s]));
  const batchName = new Map(input.sections.flatMap((s) => s.batches.map((b) => [b.id, b.name] as const)));

  const entries = problem.lessons
    .filter((l) => assignment[l.id])
    .filter((l) =>
      view === "section"
        ? l.sectionIds.includes(entityId)
        : view === "teacher"
          ? l.teacherIds.includes(entityId)
          : assignment[l.id].roomId === entityId,
    )
    .map((l) => ({ lesson: l, ...assignment[l.id] }));

  // Which periods are breaks: the section's own grid, or closed in every grid for other views.
  const open = (d: number, p: number) => {
    if (view === "section") {
      const g = input.grids.find((x) => x.id === sections.get(entityId)?.gridId);
      return !!g?.open[d]?.[p];
    }
    return input.grids.some((g) => g.open[d]?.[p]);
  };

  return (
    <div className="overflow-x-auto rounded-lg border print:overflow-visible print:border-0">
      <div
        className="grid min-w-[56rem] text-xs print:min-w-0"
        style={{ gridTemplateColumns: `4.5rem repeat(${P}, minmax(0, 1fr))` }}
      >
        <div className="border-b bg-muted/50" />
        {input.periods.map((p, i) => (
          <div key={i} className="border-b border-l bg-muted/50 px-1 py-1.5 text-center">
            <div className="font-medium">P{i + 1}</div>
            <div className="text-[10px] text-muted-foreground tabular-nums">
              {p.start}–{p.end}
            </div>
          </div>
        ))}

        {input.days.map((day, d) => {
          const dayEntries = entries.filter((e) => e.day === d).sort((a, b) => a.period - b.period);
          return (
            <div key={day} className="contents">
              <div className="flex items-center border-b px-2 font-medium">{day}</div>
              <div className="relative border-b border-l" style={{ gridColumn: `2 / span ${P}` }}>
                {/* Background: breaks and closed periods */}
                <div className="absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${P}, minmax(0, 1fr))` }}>
                  {input.periods.map((_, p) => (
                    <div
                      key={p}
                      className={cn(
                        "flex items-center justify-center border-l first:border-l-0",
                        !open(d, p) && "tt-closed text-[10px] uppercase tracking-wide text-muted-foreground",
                      )}
                    >
                      {!open(d, p) && p > 0 && p < P - 1 && open(d, p - 1) && open(d, p + 1) ? "Lunch" : null}
                    </div>
                  ))}
                </div>
                {/* Foreground: classes; parallel classes stack into extra rows */}
                <div
                  className="relative grid min-h-16 gap-1 p-1"
                  style={{ gridTemplateColumns: `repeat(${P}, minmax(0, 1fr))`, gridAutoFlow: "row dense" }}
                >
                  {dayEntries.map(({ lesson: l, period, roomId }) => {
                    const room = rooms.get(roomId);
                    const tag = KIND_TAG[l.kind];
                    const elective = l.unitId !== l.id;
                    const who =
                      view === "teacher"
                        ? l.sectionIds.map((s) => sections.get(s)?.name).join(", ")
                        : l.teacherIds.map((t) => shortName(teachers.get(t)?.name ?? "")).join(", ");
                    const batch = l.batchId ? batchName.get(l.batchId) : null;
                    const title = `${l.subjectCode} ${l.subjectName}\n${l.label}\nTeacher: ${l.teacherIds
                      .map((t) => teachers.get(t)?.name)
                      .join(", ")}\nRoom: ${room?.name}`;
                    return (
                      <div
                        key={l.id}
                        title={title}
                        className="lesson-card min-w-0 rounded-md border px-1.5 py-1 leading-tight"
                        style={{ gridColumn: `${period + 1} / span ${l.duration}`, ["--h" as string]: subjectHue(l.subjectCode) }}
                      >
                        <div className="flex items-center gap-1">
                          <span className="font-semibold">{l.subjectCode}</span>
                          {tag && <span className="rounded bg-black/10 px-1 text-[10px] dark:bg-white/15">{tag}</span>}
                          {batch && <span className="rounded bg-black/10 px-1 text-[10px] dark:bg-white/15">{batch}</span>}
                          {elective && <span className="rounded bg-black/10 px-1 text-[10px] dark:bg-white/15">Elective</span>}
                        </div>
                        <div className="truncate">{view === "room" ? l.sectionIds.map((s) => sections.get(s)?.name).join(", ") : l.subjectName}</div>
                        <div className="truncate opacity-75">
                          {view === "room" ? who : `${who}${view === "section" || view === "teacher" ? ` · ${room?.name ?? ""}` : ""}`}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Subject key printed under a section's timetable, as on college notice boards. */
export function SubjectLegend({ problem, sectionId }: { problem: Problem; sectionId: string }) {
  const { input } = problem;
  const teachers = new Map(input.teachers.map((t) => [t.id, t.name]));
  const rows = new Map<string, { code: string; name: string; ltp: string; theory: Set<string>; lab: Set<string> }>();
  for (const l of problem.lessons) {
    if (!l.sectionIds.includes(sectionId)) continue;
    const subj = input.subjects.find((s) => s.id === l.subjectId);
    const key = l.offeringId;
    const row = rows.get(key) ?? {
      code: l.subjectCode,
      name: l.subjectName,
      ltp: subj ? (subj.mode === "LTP" ? `${subj.L}-${subj.T}-${subj.P}` : `${subj.hoursPerWeek} h`) : "",
      theory: new Set<string>(),
      lab: new Set<string>(),
    };
    for (const t of l.teacherIds) (l.kind === "P" ? row.lab : row.theory).add(teachers.get(t) ?? t);
    rows.set(key, row);
  }
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="border-b text-left text-muted-foreground">
          <th className="py-1 pr-2 font-medium">Code</th>
          <th className="py-1 pr-2 font-medium">Subject</th>
          <th className="py-1 pr-2 font-medium">L-T-P</th>
          <th className="py-1 font-medium">Faculty</th>
        </tr>
      </thead>
      <tbody>
        {[...rows.values()].map((r) => (
          <tr key={r.code + r.name} className="border-b last:border-0">
            <td className="py-1 pr-2 font-medium">
              <span className="lesson-card mr-1.5 inline-block size-2.5 rounded-sm border align-middle" style={{ ["--h" as string]: subjectHue(r.code) }} />
              {r.code}
            </td>
            <td className="py-1 pr-2">{r.name}</td>
            <td className="py-1 pr-2 tabular-nums">{r.ltp}</td>
            <td className="py-1">
              {[...r.theory].join(", ")}
              {[...r.lab].filter((x) => !r.theory.has(x)).length > 0 && (
                <span className="text-muted-foreground"> · Lab: {[...r.lab].filter((x) => !r.theory.has(x)).join(", ")}</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
