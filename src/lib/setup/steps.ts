import type { SetupData } from "./convert";

export const STEPS = [
  { slug: "institute", title: "Week & bell schedule", help: "Working days, period timings and walking grace time." },
  { slug: "grids", title: "Time grids", help: "Which periods are open for classes, e.g. a different lunch for 1st years." },
  { slug: "departments", title: "Departments", help: "Departments own teachers, subjects, programs and (optionally) rooms." },
  { slug: "rooms", title: "Buildings & rooms", help: "Classrooms and labs the solver can use; seminar halls are kept for events." },
  { slug: "teachers", title: "Teachers", help: "Load limits and when each teacher is unavailable or prefers to teach." },
  { slug: "sections", title: "Programs & sections", help: "Classes of students, their size, time grid and lab batches." },
  { slug: "subjects", title: "Subjects", help: "Weekly L-T-P hours and the room types they need." },
  { slug: "allocation", title: "Allocation", help: "Who teaches which subject to which section, and elective baskets." },
  { slug: "rules", title: "Rules", help: "Hard limits and what makes a timetable better." },
  { slug: "review", title: "Review", help: "Readiness check before generating." },
] as const;

export type StepSlug = (typeof STEPS)[number]["slug"];

export const isStep = (s: string): s is StepSlug => STEPS.some((x) => x.slug === s);

/** Where to fix a readiness issue. */
export function stepForIssue(rule: string): StepSlug {
  if (rule === "teacher-availability") return "teachers";
  if (rule.startsWith("teacher") || rule.startsWith("basket") || rule === "no-teacher" || rule === "section-capacity") return "allocation";
  if (rule.startsWith("room")) return "rooms";
  if (rule === "block-length") return "subjects";
  return "review";
}

export function stepCounts(d: SetupData): Partial<Record<StepSlug, number>> {
  return {
    grids: d.grids.length,
    departments: d.departments.length,
    rooms: d.rooms.length,
    teachers: d.teachers.length,
    sections: d.sections.length,
    subjects: d.subjects.length,
    allocation: d.offerings.length,
  };
}

/** Common room types offered as suggestions. */
export const ROOM_TYPES = [
  "Classroom",
  "Computer Lab",
  "Physics Lab",
  "Chemistry Lab",
  "Electronics Lab",
  "Mechanical Lab",
  "Workshop",
  "Drawing Hall",
  "Tutorial Room",
  "Seminar Hall",
  "Auditorium",
];

/** Steps an HOD may edit for their own department; the rest are institute-wide (admin only). */
export const DEPARTMENT_STEPS: StepSlug[] = ["teachers", "sections", "subjects", "allocation"];
