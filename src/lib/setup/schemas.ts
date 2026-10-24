import { z } from "zod";

// Editable row shapes for the setup wizard. Shared by the tables (client), the importer and
// the server actions. `id` is missing or starts with "new:" for rows not yet saved.

export const isNewId = (id: string | undefined) => !id || id.startsWith("new:");
export const newId = () => `new:${Math.random().toString(36).slice(2, 10)}`;

const name = z.string().trim().min(1, "Name is required").max(120);
const count = (label: string, max = 100) => z.coerce.number().int(`${label} must be a whole number`).min(0).max(max);
const slot = z.tuple([z.number().int().min(0), z.number().int().min(0)]);

export const departmentRow = z.object({
  id: z.string().optional(),
  name,
  code: z.string().trim().min(1, "Code is required").max(12).transform((s) => s.toUpperCase()),
});

export const buildingRow = z.object({
  id: z.string().optional(),
  name,
  travelMinutes: z.record(z.string(), z.coerce.number().min(0).max(120)).default({}),
});

export const roomRow = z.object({
  id: z.string().optional(),
  name,
  type: z.string().trim().min(1, "Room type is required").max(60),
  capacity: z.coerce.number().int().min(1, "Capacity must be at least 1").max(5000),
  buildingId: z.string().nullable().default(null),
  ownerDeptId: z.string().nullable().default(null),
  isEventVenue: z.boolean().default(false),
});

export const gridRow = z.object({
  id: z.string().optional(),
  name,
  open: z.array(z.array(z.boolean())),
});

export const slotPref = z.object({
  day: z.number().int().min(0),
  period: z.number().int().min(0),
  value: z.enum(["PREFER", "AVOID"]),
});

export const teacherRow = z.object({
  id: z.string().optional(),
  name,
  email: z.string().trim().email("Not a valid email").or(z.literal("")).default(""),
  deptId: z.string().min(1, "Department is required"),
  designation: z.string().trim().min(1, "Designation is required").max(60),
  maxPerDay: count("Max per day", 12).pipe(z.number().min(1, "Max per day must be at least 1")),
  maxPerWeek: count("Max per week", 80).pipe(z.number().min(1, "Max per week must be at least 1")),
  unavailable: z.array(slot).default([]),
  prefs: z.array(slotPref).default([]),
});

export const programRow = z.object({
  id: z.string().optional(),
  name,
  deptId: z.string().min(1, "Department is required"),
});

export const sectionRow = z.object({
  id: z.string().optional(),
  name,
  programId: z.string().min(1, "Program is required"),
  year: count("Year", 10).pipe(z.number().min(1, "Year must be at least 1")),
  size: count("Size", 2000).pipe(z.number().min(1, "Size must be at least 1")),
  gridId: z.string().min(1, "Time grid is required"),
  batchCount: count("Batches", 10),
});

export const subjectRow = z
  .object({
    id: z.string().optional(),
    code: z.string().trim().min(1, "Code is required").max(20).transform((s) => s.toUpperCase()),
    name,
    deptId: z.string().min(1, "Department is required"),
    mode: z.enum(["LTP", "HOURS"]),
    L: count("L", 20),
    T: count("T", 20),
    P: count("P", 20),
    hoursPerWeek: count("Hours", 40),
    theoryRoomType: z.string().trim().min(1).max(60).default("Classroom"),
    labRoomType: z.string().trim().min(1).max(60).default("Classroom"),
    labBlockLen: count("Lab block", 6).pipe(z.number().min(1, "Lab block must be at least 1")),
  })
  .refine((s) => (s.mode === "LTP" ? s.L + s.T + s.P > 0 : s.hoursPerWeek > 0), {
    message: "Subject needs at least one hour a week",
  });

export const basketRow = z.object({
  id: z.string().optional(),
  name,
  sectionIds: z.array(z.string()).min(2, "A basket needs at least two sections"),
});

export const offeringRow = z.object({
  id: z.string().optional(),
  subjectId: z.string().min(1, "Subject is required"),
  sectionIds: z.array(z.string()).min(1, "Pick at least one section"),
  teacherIds: z.array(z.string()).default([]),
  labTeacherIds: z.array(z.string()).default([]),
  batchwiseLab: z.boolean().default(true),
  basketId: z.string().nullable().default(null),
  expectedSize: z.coerce.number().int().min(1).nullable().default(null),
});

export const instituteSettings = z.object({
  name,
  days: z.array(z.string().trim().min(1)).min(1, "Pick at least one working day").max(7),
  periods: z
    .array(z.object({ start: z.string().regex(/^\d{1,2}:\d{2}$/), end: z.string().regex(/^\d{1,2}:\d{2}$/) }))
    .min(1, "Add at least one period")
    .max(16),
  passingMinutes: count("Passing minutes", 30),
});

export const ruleSettings = z.object({
  maxConsecutiveSection: z.coerce.number().int().min(1).max(12).nullable(),
  maxConsecutiveTeacher: z.coerce.number().int().min(1).max(12).nullable(),
  travelTimeHard: z.boolean(),
  roomUtilizationMode: z.enum(["compact", "spread"]),
  weights: z.object({
    teacherPrefs: z.number().int().min(0).max(3),
    balancedDays: z.number().int().min(0).max(3),
    idleGaps: z.number().int().min(0).max(3),
    subjectSpread: z.number().int().min(0).max(3),
    roomUtilization: z.number().int().min(0).max(3),
  }),
});

export type DepartmentRow = z.input<typeof departmentRow>;
export type BuildingRow = z.input<typeof buildingRow>;
export type RoomRow = z.input<typeof roomRow>;
export type GridRow = z.input<typeof gridRow>;
export type TeacherRow = z.input<typeof teacherRow>;
export type ProgramRow = z.input<typeof programRow>;
export type SectionRow = z.input<typeof sectionRow>;
export type SubjectRow = z.input<typeof subjectRow>;
export type BasketRow = z.input<typeof basketRow>;
export type OfferingRow = z.input<typeof offeringRow>;
export type InstituteSettings = z.input<typeof instituteSettings>;

/** Typical UGC/AICTE teaching-load limits by designation: [per day, per week]. */
export const DESIGNATIONS: { name: string; match: RegExp; limits: [number, number] }[] = [
  { name: "Professor", match: /^prof/i, limits: [4, 14] },
  { name: "Associate Professor", match: /assoc/i, limits: [4, 16] },
  { name: "Assistant Professor", match: /assist|asst/i, limits: [5, 18] },
  { name: "Lecturer", match: /lect/i, limits: [5, 20] },
  { name: "Guest Faculty", match: /guest|visit|adjunct/i, limits: [3, 8] },
];

export function designationLimits(designation: string): [number, number] {
  return DESIGNATIONS.find((d) => d.match.test(designation.trim()))?.limits ?? [5, 18];
}

/** Split a section of `size` students into `n` near-equal batches (G1..Gn). */
export function splitBatches(size: number, n: number): { name: string; size: number }[] {
  if (n <= 0) return [];
  const base = Math.floor(size / n);
  const extra = size % n;
  return Array.from({ length: n }, (_, i) => ({ name: `G${i + 1}`, size: base + (i < extra ? 1 : 0) }));
}

/** Turn zod issues for an array of rows into "Row 3: Capacity must be at least 1" messages. */
export function rowIssues(error: z.ZodError): Record<number, string> {
  const out: Record<number, string> = {};
  for (const issue of error.issues) {
    const row = typeof issue.path[0] === "number" ? issue.path[0] : -1;
    if (!(row in out)) out[row] = issue.message;
  }
  return out;
}
