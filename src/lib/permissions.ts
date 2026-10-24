// The single place that decides who may do what. Used by pages (to hide/show) and by every
// server action (to enforce). Pure: no DB or framework imports.

export type Role =
  | "INSTITUTE_ADMIN"
  | "HEAD_OF_INSTITUTE"
  | "HOD"
  | "TEACHER"
  | "STUDENT"
  | "PLACEMENT_OFFICER"
  | "VENUE_MANAGER"
  | "LAB_ASSISTANT";

export const ROLE_LABEL: Record<Role, string> = {
  INSTITUTE_ADMIN: "Institute Admin",
  HEAD_OF_INSTITUTE: "Head of Institute",
  HOD: "Head of Department",
  TEACHER: "Teacher",
  STUDENT: "Student",
  PLACEMENT_OFFICER: "Placement Officer",
  VENUE_MANAGER: "Venue Manager",
  LAB_ASSISTANT: "Lab Assistant",
};

export const ROLE_HELP: Record<Role, string> = {
  INSTITUTE_ADMIN: "Sets up the college, runs the solver, edits drafts and manages people.",
  HEAD_OF_INSTITUTE: "Reviews timetables and publishes them.",
  HOD: "Edits their department's teachers, subjects, sections and allocation; signs off timetables.",
  TEACHER: "Sees their own timetable and the college's published timetables.",
  STUDENT: "Sees their section's published timetable.",
  PLACEMENT_OFFICER: "Sees published timetables (placement drives come later).",
  VENUE_MANAGER: "Sees published timetables and room schedules (venue booking comes later).",
  LAB_ASSISTANT: "Sees published timetables and lab schedules.",
};

export type Action =
  /** Institute-wide setup: week, grids, departments, rooms, rules. */
  | "setup.institute"
  /** Department data: teachers, programs, sections, subjects, allocation (HOD: own department only). */
  | "setup.department"
  /** See the setup wizard at all. */
  | "setup.view"
  | "timetable.generate"
  | "timetable.editDraft"
  | "timetable.viewDrafts"
  | "timetable.submit"
  | "timetable.signoff"
  | "timetable.publish"
  | "timetable.share"
  | "people.manage"
  /** Term dates, holidays, exam days and day swaps. */
  | "calendar.manage";

export interface Member {
  role: Role;
  departmentId: string | null;
  teacherId: string | null;
  sectionId: string | null;
}

const GRANTS: Record<Action, Role[]> = {
  "setup.institute": ["INSTITUTE_ADMIN"],
  "setup.department": ["INSTITUTE_ADMIN", "HOD"],
  "setup.view": ["INSTITUTE_ADMIN", "HEAD_OF_INSTITUTE", "HOD"],
  "timetable.generate": ["INSTITUTE_ADMIN"],
  "timetable.editDraft": ["INSTITUTE_ADMIN"],
  "timetable.viewDrafts": ["INSTITUTE_ADMIN", "HEAD_OF_INSTITUTE", "HOD"],
  "timetable.submit": ["INSTITUTE_ADMIN"],
  "timetable.signoff": ["HOD"],
  "timetable.publish": ["HEAD_OF_INSTITUTE"],
  "timetable.share": ["INSTITUTE_ADMIN", "HEAD_OF_INSTITUTE", "HOD"],
  "people.manage": ["INSTITUTE_ADMIN"],
  "calendar.manage": ["INSTITUTE_ADMIN"],
};

export interface PermissionContext {
  /** True when the institute has no Head of Institute yet; the admin may then publish. */
  noHeadOfInstitute?: boolean;
}

export function can(member: Member | null, action: Action, ctx: PermissionContext = {}): boolean {
  if (!member) return false;
  if (action === "timetable.publish" && ctx.noHeadOfInstitute && member.role === "INSTITUTE_ADMIN") return true;
  return GRANTS[action].includes(member.role);
}

/** Department-scoped rows: admins may touch any; HODs only their own department. */
export function canEditDepartment(member: Member | null, departmentId: string | null | undefined): boolean {
  if (!member) return false;
  if (member.role === "INSTITUTE_ADMIN") return true;
  return member.role === "HOD" && !!departmentId && member.departmentId === departmentId;
}
