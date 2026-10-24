import type { Assignment, Lesson, Problem } from "@/lib/solver/types";

// Day-to-day substitution logic on top of the published timetable. Pure; no DB.

export interface AbsenceInfo {
  teacherId: string;
  /** 0-based periods; empty = the whole day. */
  periods: number[];
}

export interface CoverInfo {
  lessonId: string;
  action: "SUBSTITUTE" | "CANCEL";
  substituteId: string | null;
}

export interface DayContext {
  problem: Problem;
  assignment: Assignment;
  /** Timetable day running on the date (from the academic calendar). */
  dayIndex: number;
  absences: AbsenceInfo[];
  covers: CoverInfo[];
  /** Covers each teacher has done this month (fairness). */
  coversThisMonth: Record<string, number>;
}

const span = (l: Lesson, period: number) => Array.from({ length: l.duration }, (_, k) => period + k);

function isAbsentAt(absences: AbsenceInfo[], teacherId: string, periods: number[]): boolean {
  const a = absences.find((x) => x.teacherId === teacherId);
  return !!a && (a.periods.length === 0 || periods.some((p) => a.periods.includes(p)));
}

/** Classes on this day that an absent teacher was due to take. */
export function affectedLessons(ctx: DayContext, teacherId: string): { lesson: Lesson; period: number; roomId: string }[] {
  const { problem, assignment, dayIndex, absences } = ctx;
  return problem.lessons
    .filter((l) => l.teacherIds.includes(teacherId) && assignment[l.id]?.day === dayIndex)
    .map((l) => ({ lesson: l, period: assignment[l.id].period, roomId: assignment[l.id].roomId }))
    .filter((x) => isAbsentAt(absences, teacherId, span(x.lesson, x.period)))
    .sort((a, b) => a.period - b.period);
}

export interface Candidate {
  teacherId: string;
  name: string;
  reasons: string[];
  /** Periods they'd teach that day including this cover. */
  dayLoad: number;
}

/** Teachers who can take `lessonId` on this day, best first. */
export function suggestSubstitutes(ctx: DayContext, lessonId: string, limit = 5): Candidate[] {
  const { problem, assignment, dayIndex, absences, covers, coversThisMonth } = ctx;
  const lesson = problem.lessons.find((l) => l.id === lessonId);
  const placed = assignment[lessonId];
  if (!lesson || !placed || placed.day !== dayIndex) return [];
  const periods = span(lesson, placed.period);

  // Periods each teacher is busy today: their own classes (minus cancelled/covered ones) plus covers they take.
  const busy = new Map<string, Set<number>>();
  const mark = (t: string, ps: number[]) => {
    const s = busy.get(t) ?? new Set<number>();
    ps.forEach((p) => s.add(p));
    busy.set(t, s);
  };
  const coverOf = new Map(covers.map((c) => [c.lessonId, c]));
  for (const l of problem.lessons) {
    const a = assignment[l.id];
    if (!a || a.day !== dayIndex) continue;
    const ps = span(l, a.period);
    const c = coverOf.get(l.id);
    if (!c) l.teacherIds.forEach((t) => mark(t, ps));
    else if (c.action === "SUBSTITUTE" && c.substituteId) mark(c.substituteId, ps);
  }

  const out: (Candidate & { score: number })[] = [];
  for (const t of problem.input.teachers) {
    if (lesson.teacherIds.includes(t.id)) continue;
    if (isAbsentAt(absences, t.id, periods)) continue;
    const mine = busy.get(t.id) ?? new Set<number>();
    if (periods.some((p) => mine.has(p))) continue;
    if (t.unavailable.some(([d, p]) => d === dayIndex && periods.includes(p))) continue;
    const dayLoad = mine.size + lesson.duration;
    if (dayLoad > t.maxPerDay) continue;

    const sameSubject = problem.lessons.some((l) => l.subjectId === lesson.subjectId && l.teacherIds.includes(t.id));
    const sameDept = t.deptId === lesson.deptId;
    const done = coversThisMonth[t.id] ?? 0;
    const reasons = [
      sameSubject ? `teaches ${lesson.subjectCode}` : sameDept ? "same department" : "free then",
      `${dayLoad}/${t.maxPerDay} periods that day`,
      done ? `${done} cover${done === 1 ? "" : "s"} this month` : "no covers this month",
    ];
    // Subject fit first, then fairness, then a lighter day.
    const score = (sameSubject ? 100 : sameDept ? 50 : 0) - done * 5 - dayLoad;
    out.push({ teacherId: t.id, name: t.name, reasons, dayLoad, score });
  }
  return out
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((c) => ({ teacherId: c.teacherId, name: c.name, reasons: c.reasons, dayLoad: c.dayLoad }));
}
