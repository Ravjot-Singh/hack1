import { buildProblem } from "@/lib/solver";
import type { Assignment, InstituteInput } from "@/lib/solver/types";

export type ShareView = "section" | "teacher" | "room";

/** Name of the shared section/teacher/room in this snapshot, or undefined when it isn't there. */
export function sharedEntityName(snapshot: InstituteInput, view: ShareView, entityId: string): string | undefined {
  const list = view === "section" ? snapshot.sections : view === "teacher" ? snapshot.teachers : snapshot.rooms;
  return list.find((x) => x.id === entityId)?.name;
}

/** Lesson ids start with their offering's id ("<offering>:L1", "<offering>:P1:<batch>"). */
const offeringOf = (lessonId: string) => lessonId.split(":")[0];

/**
 * What a public share link may reveal: only the shared section's, teacher's or room's classes
 * (the whole timetable for a college-wide link), and none of the planning data behind them:
 * teachers' unavailability and preferences, custom rules and pins. Lesson ids are unchanged, so
 * the assignment still lines up with the reduced snapshot.
 */
export function publicView(
  snapshot: InstituteInput,
  assignment: Assignment,
  fixed: { view: ShareView; entityId: string } | null,
): { snapshot: InstituteInput; assignment: Assignment } {
  let offerings = snapshot.offerings;
  if (fixed?.view === "section") {
    // Combined classes and electives are shown as this section's own classes.
    offerings = offerings.filter((o) => o.sectionIds.includes(fixed.entityId)).map((o) => ({ ...o, sectionIds: [fixed.entityId] }));
  } else if (fixed?.view === "teacher") {
    offerings = offerings.filter((o) => o.teacherIds.includes(fixed.entityId) || o.labTeacherIds.includes(fixed.entityId));
  } else if (fixed?.view === "room") {
    const used = new Set(Object.entries(assignment).flatMap(([id, a]) => (a.roomId === fixed.entityId ? [offeringOf(id)] : [])));
    offerings = offerings.filter((o) => used.has(o.id));
  }
  const kept = new Set(offerings.map((o) => o.id));
  // A teacher link shows only the lessons they teach (not a co-teacher's labs); a room link only that room's.
  const theirs =
    fixed?.view === "teacher" ? new Set(buildProblem({ ...snapshot, offerings }).lessons.filter((l) => l.teacherIds.includes(fixed.entityId)).map((l) => l.id)) : null;
  const shown: Assignment = Object.fromEntries(
    Object.entries(assignment).filter(
      ([id, a]) => kept.has(offeringOf(id)) && (!theirs || theirs.has(id)) && (fixed?.view !== "room" || a.roomId === fixed.entityId),
    ),
  );

  const sectionIds = new Set(offerings.flatMap((o) => o.sectionIds));
  if (fixed?.view === "section") sectionIds.add(fixed.entityId);
  const teacherIds = new Set(offerings.flatMap((o) => [...o.teacherIds, ...o.labTeacherIds]));
  const roomIds = new Set(Object.values(shown).map((a) => a.roomId));
  if (fixed?.view === "room") roomIds.add(fixed.entityId);
  const subjectIds = new Set(offerings.map((o) => o.subjectId));
  const scoped = fixed !== null;
  const sections = snapshot.sections.filter((s) => !scoped || sectionIds.has(s.id));
  const rooms = snapshot.rooms.filter((r) => !scoped || roomIds.has(r.id));
  const teachers = snapshot.teachers
    .filter((t) => !scoped || teacherIds.has(t.id))
    .map((t) => ({ ...t, unavailable: [], prefs: [] }));
  const deptIds = new Set([...sections.map((s) => s.deptId), ...teachers.map((t) => t.deptId), ...rooms.flatMap((r) => (r.ownerDeptId ? [r.ownerDeptId] : []))]);
  const buildingIds = new Set(rooms.flatMap((r) => (r.buildingId ? [r.buildingId] : [])));
  const gridIds = new Set(sections.map((s) => s.gridId));

  return {
    snapshot: {
      ...snapshot,
      rules: { ...snapshot.rules, custom: [] },
      pins: [],
      departments: snapshot.departments.filter((d) => !scoped || deptIds.has(d.id)),
      buildings: snapshot.buildings.filter((b) => !scoped || buildingIds.has(b.id)),
      grids: snapshot.grids.filter((g) => !scoped || gridIds.has(g.id)),
      rooms,
      teachers,
      sections,
      subjects: snapshot.subjects.filter((s) => !scoped || subjectIds.has(s.id)),
      offerings,
      baskets: snapshot.baskets.filter((b) => !scoped || offerings.some((o) => o.basketId === b.id)).map((b) => ({ ...b, sectionIds: b.sectionIds.filter((id) => sectionIds.has(id)) })),
    },
    assignment: shown,
  };
}
