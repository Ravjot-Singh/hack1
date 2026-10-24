import type { Assignment, Problem } from "@/lib/solver/types";
import { subjectHue, type ViewKind } from "./timetable-grid";

const KIND: Record<string, string> = { T: "Tutorial", P: "Lab" };

/** Day-by-day agenda of one timetable; easier to read than the week grid on a phone. */
export function DayList({
  problem,
  assignment,
  view,
  entityId,
  onlyDay,
}: {
  problem: Problem;
  assignment: Assignment;
  view: ViewKind;
  entityId: string;
  /** Show just this day (no day heading), e.g. for the Today view. */
  onlyDay?: number;
}) {
  const { input } = problem;
  const rooms = new Map(input.rooms.map((r) => [r.id, r.name]));
  const teachers = new Map(input.teachers.map((t) => [t.id, t.name]));
  const sections = new Map(input.sections.map((s) => [s.id, s.name]));
  const batches = new Map(input.sections.flatMap((s) => s.batches.map((b) => [b.id, b.name] as const)));

  const items = problem.lessons
    .filter((l) => assignment[l.id])
    .filter((l) =>
      view === "section" ? l.sectionIds.includes(entityId) : view === "teacher" ? l.teacherIds.includes(entityId) : assignment[l.id].roomId === entityId,
    )
    .map((l) => ({ l, a: assignment[l.id] }));

  return (
    <div className="space-y-4">
      {input.days.map((day, d) => {
        if (onlyDay !== undefined && d !== onlyDay) return null;
        const today = items.filter((x) => x.a.day === d).sort((x, y) => x.a.period - y.a.period || x.l.label.localeCompare(y.l.label));
        return (
          <section key={day}>
            {onlyDay === undefined && <h3 className="mb-1.5 text-sm font-semibold">{day}</h3>}
            {today.length === 0 ? (
              <p className="text-sm text-muted-foreground">No classes</p>
            ) : (
              <ul className="space-y-1.5">
                {today.map(({ l, a }) => {
                  const start = input.periods[a.period]?.start;
                  const end = input.periods[a.period + l.duration - 1]?.end;
                  const who =
                    view === "teacher"
                      ? l.sectionIds.map((s) => sections.get(s)).join(", ")
                      : l.teacherIds.map((t) => teachers.get(t)).join(", ");
                  const extra = [KIND[l.kind], l.batchId ? batches.get(l.batchId) : null, l.unitId !== l.id ? "Elective" : null].filter(Boolean);
                  return (
                    <li key={l.id} className="lesson-card flex gap-3 rounded-md border px-3 py-2 text-sm" style={{ ["--h" as string]: subjectHue(l.subjectCode) }}>
                      <div className="w-24 shrink-0 tabular-nums">
                        <div className="font-medium">{start}–{end}</div>
                        <div className="text-xs opacity-75">
                          P{a.period + 1}
                          {l.duration > 1 ? `–P${a.period + l.duration}` : ""}
                        </div>
                      </div>
                      <div className="min-w-0">
                        <div className="font-medium">
                          {l.subjectCode} · {l.subjectName}
                          {extra.length > 0 && <span className="ml-1 text-xs opacity-75">({extra.join(", ")})</span>}
                        </div>
                        <div className="text-xs opacity-80">
                          {view === "room" ? `${l.sectionIds.map((s) => sections.get(s)).join(", ")} · ${who}` : `${who} · ${rooms.get(a.roomId) ?? ""}`}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
