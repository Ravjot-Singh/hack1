// Solver input/output types. Pure data: no DB or framework imports, so this module
// can run in a Web Worker, on the server and in tests.

export type WorkloadMode = "LTP" | "HOURS";
export type LessonKind = "L" | "T" | "P" | "H"; // Lecture, Tutorial, Practical, plain Hours

/** Soft-goal weights: 0 = off, 1 = low, 2 = medium, 3 = high. */
export interface SoftWeights {
  teacherPrefs: number;
  balancedDays: number;
  idleGaps: number;
  subjectSpread: number;
  roomUtilization: number;
}

export interface RuleSettings {
  /** Max periods in a row for any student group (null = no limit). */
  maxConsecutiveSection: number | null;
  /** Max periods in a row for a teacher (null = no limit). */
  maxConsecutiveTeacher: number | null;
  /** If true, consecutive classes in buildings further apart than the gap allows are forbidden. */
  travelTimeHard: boolean;
  /** "compact" packs classes into fewer rooms, "spread" uses rooms evenly. */
  roomUtilizationMode: "compact" | "spread";
  weights: SoftWeights;
  /** Rules the admin typed in plain English, already resolved to ids and slots. */
  custom?: CustomRule[];
}

/**
 * "Lessons matching `target` must not (hard) / should not (soft) be in `slots`."
 * Target filters combine: (any of teachers/sections/years, or everyone when all three are empty)
 * AND (kind in kinds, if any) AND (subject in subjects, if any).
 */
export interface CustomRule {
  id: string;
  /** What the admin typed. */
  text: string;
  /** Plain description generated from the structured rule (what the admin confirmed). */
  summary: string;
  strength: "hard" | "soft";
  target: {
    teacherIds: string[];
    sectionIds: string[];
    years: number[];
    kinds: LessonKind[];
    subjectIds: string[];
  };
  /** [day, period] pairs. */
  slots: [number, number][];
}

export interface DepartmentInput {
  id: string;
  name: string;
  code: string;
}

export interface BuildingInput {
  id: string;
  name: string;
  /** Walking minutes to other buildings, keyed by building id. */
  travelMinutes: Record<string, number>;
}

export interface RoomInput {
  id: string;
  name: string;
  type: string;
  capacity: number;
  buildingId: string | null;
  ownerDeptId: string | null;
  /** Seminar halls / auditoriums: bookable for events, never used by the solver. */
  isEventVenue: boolean;
}

export interface GridInput {
  id: string;
  name: string;
  /** open[day][period] = true when classes may be held (false = break / closed). */
  open: boolean[][];
}

export interface SlotPref {
  day: number;
  period: number;
  value: "PREFER" | "AVOID";
}

export interface TeacherInput {
  id: string;
  name: string;
  deptId: string;
  designation: string;
  maxPerDay: number;
  maxPerWeek: number;
  /** [day, period] pairs the teacher can never be scheduled in. */
  unavailable: [number, number][];
  prefs: SlotPref[];
}

export interface BatchInput {
  id: string;
  name: string;
  size: number;
}

export interface SectionInput {
  id: string;
  name: string;
  deptId: string;
  programName: string;
  year: number;
  size: number;
  gridId: string;
  batches: BatchInput[];
}

export interface SubjectInput {
  id: string;
  code: string;
  name: string;
  deptId: string;
  mode: WorkloadMode;
  L: number;
  T: number;
  P: number;
  hoursPerWeek: number;
  theoryRoomType: string;
  labRoomType: string;
  /** Consecutive periods per practical session. */
  labBlockLen: number;
}

export interface OfferingInput {
  id: string;
  subjectId: string;
  /** Usually one section; several = combined class. For a basket offering, the basket's sections. */
  sectionIds: string[];
  teacherIds: string[];
  /** Teachers for practicals; falls back to teacherIds when empty. */
  labTeacherIds: string[];
  /** Practicals run per batch (G1, G2...) instead of for the whole section. */
  batchwiseLab: boolean;
  /** Elective basket: all offerings in a basket run in parallel. */
  basketId: string | null;
  /** Expected enrolment for electives (defaults to an even share of the basket). */
  expectedSize: number | null;
}

export interface BasketInput {
  id: string;
  name: string;
  sectionIds: string[];
}

export interface PinInput {
  lessonId: string;
  day: number;
  period: number;
  roomId: string;
}

/** Everything about one institute that the solver needs. DB-agnostic. */
export interface InstituteInput {
  name: string;
  days: string[];
  /** Shared bell schedule: every grid uses the same period boundaries ("HH:MM"). */
  periods: { start: string; end: string }[];
  /** Grace minutes allowed for walking between consecutive periods. */
  passingMinutes: number;
  rules: RuleSettings;
  departments: DepartmentInput[];
  buildings: BuildingInput[];
  rooms: RoomInput[];
  grids: GridInput[];
  teachers: TeacherInput[];
  sections: SectionInput[];
  subjects: SubjectInput[];
  offerings: OfferingInput[];
  baskets: BasketInput[];
  pins?: PinInput[];
}

/** One schedulable meeting: occupies `duration` consecutive periods on one day. */
export interface Lesson {
  id: string;
  offeringId: string;
  subjectId: string;
  subjectCode: string;
  subjectName: string;
  kind: LessonKind;
  teacherIds: string[];
  sectionIds: string[];
  batchId: string | null;
  /** Student-group atoms this lesson occupies (batch ids, or section id when no batches). */
  atoms: string[];
  size: number;
  duration: number;
  roomType: string;
  deptId: string;
  /** Lessons sharing a unit are placed at the same time (elective baskets). */
  unitId: string;
  /** Human label, e.g. "CS201 Lab · CSE-2A G1". */
  label: string;
}

export interface Unit {
  id: string;
  lessonIds: string[];
  duration: number;
}

export interface Problem {
  input: InstituteInput;
  lessons: Lesson[];
  units: Unit[];
  /** atom id -> display name ("CSE-2A G1" or "CSE-2A"). */
  atomNames: Record<string, string>;
  /** atom id -> section id. */
  atomSection: Record<string, string>;
}

export interface LessonPlacement {
  day: number;
  period: number;
  roomId: string;
}

/** lessonId -> placement. Lessons missing from the map are unscheduled. */
export type Assignment = Record<string, LessonPlacement>;

export interface Violation {
  rule: string;
  message: string;
  lessonIds: string[];
}

export interface Issue {
  severity: "error" | "warning";
  rule: string;
  message: string;
  /** Hint for the admin on how to fix it. */
  fix?: string;
}

export interface ScoreBreakdown {
  quality: number; // 0..100
  /** customRules: periods placed in slots an "avoid" custom rule names (only when such rules exist). */
  penalties: Record<keyof SoftWeights, number> & { customRules?: number };
}

export interface SolveProgress {
  phase: "construct" | "improve";
  iteration: number;
  placed: number;
  total: number;
  quality?: number;
}

export interface SolveResult {
  assignment: Assignment;
  unscheduled: string[];
  /** Reasons each unscheduled lesson could not be placed. */
  explanations: Record<string, string[]>;
  violations: Violation[];
  score: ScoreBreakdown;
  iterations: number;
  ms: number;
}
