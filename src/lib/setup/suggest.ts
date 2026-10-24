import { buildProblem } from "@/lib/solver/lessons";
import { toInstituteInput, type SetupData } from "./convert";
import type { OfferingRow } from "./schemas";

export interface Suggestion {
  offeringId: string;
  teacherId: string | null;
  /** Weekly periods this offering adds to the teacher. */
  periods: number;
  /** Teacher's weekly load after this (and earlier) suggestions. */
  loadAfter: number;
  maxPerWeek: number;
  reason: string;
}

/**
 * Propose a teacher for every offering that has none. Prefers teachers already teaching the
 * subject, then the subject's own department, then anyone; never exceeds a teacher's weekly
 * limit or puts one teacher on two electives of the same basket; among equals, the least-loaded
 * teacher wins so work is spread evenly. Pure: no DB.
 */
export function suggestTeachers(data: SetupData, onlyOfferings?: Set<string>): Suggestion[] {
  const problem = buildProblem(toInstituteInput(data));
  const subjects = new Map(data.subjects.map((s) => [s.id!, s]));

  // Weekly periods per offering, counting parallel basket lessons once (like the pre-check).
  const periodsOf = new Map<string, number>();
  for (const l of problem.lessons) periodsOf.set(l.offeringId, (periodsOf.get(l.offeringId) ?? 0) + l.duration);

  // Current loads and basket memberships from offerings that already have teachers.
  const load = new Map<string, number>();
  const basketTeachers = new Map<string, Set<string>>();
  const teaches = new Map<string, Set<string>>(); // subjectId -> teacher ids
  const addLoad = (o: OfferingRow, teacherId: string, periods: number) => {
    load.set(teacherId, (load.get(teacherId) ?? 0) + periods);
    if (o.basketId) basketTeachers.set(o.basketId, new Set([...(basketTeachers.get(o.basketId) ?? []), teacherId]));
    teaches.set(o.subjectId, new Set([...(teaches.get(o.subjectId) ?? []), teacherId]));
  };
  for (const o of data.offerings) {
    const ids = new Set([...(o.teacherIds ?? []), ...(o.labTeacherIds ?? [])]);
    for (const t of ids) addLoad(o, t, periodsOf.get(o.id!) ?? 0);
  }

  const todo = data.offerings
    .filter((o) => !(o.teacherIds ?? []).length && (!onlyOfferings || onlyOfferings.has(o.id!)))
    // Biggest jobs first, so they still find someone with enough room.
    .sort((a, b) => (periodsOf.get(b.id!) ?? 0) - (periodsOf.get(a.id!) ?? 0));

  const out: Suggestion[] = [];
  for (const o of todo) {
    const periods = periodsOf.get(o.id!) ?? 0;
    const subject = subjects.get(o.subjectId);
    let best: { id: string; score: number; reason: string } | null = null;
    for (const t of data.teachers) {
      const max = Number(t.maxPerWeek);
      const after = (load.get(t.id!) ?? 0) + periods;
      if (after > max) continue;
      if (o.basketId && basketTeachers.get(o.basketId)?.has(t.id!)) continue;
      const sameSubject = teaches.get(o.subjectId)?.has(t.id!) ?? false;
      const sameDept = t.deptId === subject?.deptId;
      const fit = sameSubject ? 2 : sameDept ? 1 : 0;
      // Fit dominates; within the same fit, lower utilisation after assignment wins.
      const score = fit * 10 - after / max;
      if (!best || score > best.score) {
        best = {
          id: t.id!,
          score,
          reason: sameSubject ? `already teaches ${subject?.code}` : sameDept ? "same department, has room" : "only teacher with room (other department)",
        };
      }
    }
    if (!best) {
      out.push({ offeringId: o.id!, teacherId: null, periods, loadAfter: 0, maxPerWeek: 0, reason: "No teacher has enough free periods left" });
      continue;
    }
    addLoad(o, best.id, periods);
    const t = data.teachers.find((x) => x.id === best.id)!;
    out.push({ offeringId: o.id!, teacherId: best.id, periods, loadAfter: load.get(best.id)!, maxPerWeek: Number(t.maxPerWeek), reason: best.reason });
  }
  return out;
}
