import { z } from "zod";
import { ROLE_LABEL, type Role } from "./permissions";
import { norm, stripTitle } from "./setup/import";

// Inviting many people at once: rows typed in a table, imported from CSV/Excel or generated
// for a group (a department's teachers, one HOD per department). Pure: no DB, no DOM.

export interface InviteDraft {
  name: string;
  email: string;
  role: Role;
  departmentId: string | null;
  teacherId: string | null;
  sectionId: string | null;
}

export interface InviteLookups {
  departments: { id: string; name: string; code: string }[];
  teachers: { id: string; name: string; departmentId: string }[];
  sections: { id: string; name: string }[];
}

/** Who already has an account or an open invite, so they aren't invited twice. */
export interface Taken {
  emails: Set<string>;
  teacherIds: Set<string>;
}

export const MAX_BULK_INVITES = 2000;

const email = z.string().trim().toLowerCase().email().or(z.literal(""));

const ROLE_WORDS: Record<Role, string[]> = {
  INSTITUTE_ADMIN: ["institute admin", "admin", "administrator"],
  HEAD_OF_INSTITUTE: ["head of institute", "principal", "director", "hoi"],
  HOD: ["head of department", "hod"],
  TEACHER: ["teacher", "faculty", "professor", "lecturer"],
  STUDENT: ["student"],
  PLACEMENT_OFFICER: ["placement officer", "placement", "tpo"],
  VENUE_MANAGER: ["venue manager", "venue"],
  LAB_ASSISTANT: ["lab assistant", "lab technician", "lab"],
};

export function parseRole(s: string): Role | null {
  const v = norm(s);
  const hit = (Object.keys(ROLE_WORDS) as Role[]).find((r) => norm(r) === v || ROLE_WORDS[r].some((w) => norm(w) === v));
  return hit ?? null;
}

/** Only the links that make sense for the role are kept (same rule as the server). */
export function linksFor(d: Pick<InviteDraft, "role" | "departmentId" | "teacherId" | "sectionId">) {
  return {
    // A lab assistant looks after one department's labs, or the common labs when none is set.
    departmentId: d.role === "HOD" || d.role === "LAB_ASSISTANT" ? d.departmentId : null,
    teacherId: d.role === "TEACHER" || d.role === "HOD" ? d.teacherId : null,
    sectionId: d.role === "STUDENT" ? d.sectionId : null,
  };
}

/** What is wrong with one row, in words an admin can act on; null when it's fine. */
export function draftProblem(d: InviteDraft): string | null {
  if (d.name.trim().length < 2) return "Enter the person's name.";
  if (d.name.trim().length > 80) return "Name is too long.";
  if (!email.safeParse(d.email).success) return `"${d.email}" is not a valid email.`;
  if (d.role === "HOD" && !d.departmentId) return "Pick the HOD's department.";
  return null;
}

/**
 * Rows that would invite someone twice: an email or teacher record already used by a member,
 * an open invite or an earlier row. Returns row index → reason.
 */
export function duplicates(drafts: InviteDraft[], taken: Taken, teacherName: (id: string) => string): Map<number, string> {
  const out = new Map<number, string>();
  const emails = new Map<string, number>();
  const teacherIds = new Map<string, number>();
  drafts.forEach((d, i) => {
    const e = d.email.trim().toLowerCase();
    const t = linksFor(d).teacherId;
    if (e && taken.emails.has(e)) out.set(i, `${e} already has an account here or an open invite.`);
    else if (t && taken.teacherIds.has(t)) out.set(i, `${teacherName(t)} already has an account here or an open invite.`);
    else if (e && emails.has(e)) out.set(i, `Same email as row ${emails.get(e)! + 1}.`);
    else if (t && teacherIds.has(t)) out.set(i, `Same teacher as row ${teacherIds.get(t)! + 1}.`);
    if (e && !emails.has(e)) emails.set(e, i);
    if (t && !teacherIds.has(t)) teacherIds.set(t, i);
  });
  return out;
}

export const INVITE_COLUMNS = ["name", "email", "role", "department", "teacher", "section"];

export const INVITE_TEMPLATE: string[][] = [
  INVITE_COLUMNS,
  ["Dr. Priya Nair", "priya@college.edu", "Teacher", "", "Dr. Priya Nair", ""],
  ["Rajesh Kumar", "rajesh@college.edu", "HOD", "CSE", "Rajesh Kumar", ""],
  ["Gurleen Kaur", "gurleen@student.college.edu", "Student", "", "", "CSE-2A"],
  ["Lakhan Singh", "", "Lab assistant", "CSE", "", ""],
];

const HEADER_ALIASES: Record<string, string[]> = {
  name: ["name", "full name", "person"],
  email: ["email", "e-mail", "email address", "mail"],
  role: ["role", "type", "as"],
  department: ["department", "dept", "department code"],
  teacher: ["teacher", "teacher record", "faculty"],
  section: ["section", "class", "class section"],
};

/**
 * Map a parsed table (first non-empty row = headers) to invite rows, resolving department,
 * teacher and section names to ids. Row numbers in errors match the spreadsheet (header = row 1).
 * A blank name is taken from the teacher record.
 */
export function mapInviteTable(table: string[][], lk: InviteLookups): { rows: InviteDraft[]; errors: string[] } {
  const headerIdx = table.findIndex((r) => r.some((c) => c.trim()));
  if (headerIdx < 0) return { rows: [], errors: ["The file is empty."] };
  const header = table[headerIdx].map(norm);
  const col: Record<string, number> = {};
  for (const [key, names] of Object.entries(HEADER_ALIASES)) {
    const i = header.findIndex((h) => names.some((n) => norm(n) === h));
    if (i >= 0) col[key] = i;
  }
  if (col.role === undefined || (col.name === undefined && col.teacher === undefined)) {
    return { rows: [], errors: [`Missing columns. Expected: ${INVITE_COLUMNS.join(", ")} (name or teacher, and role, are required).`] };
  }

  const roles = Object.values(ROLE_LABEL).join(", ");
  const findDept = (v: string) => lk.departments.find((d) => norm(d.code) === norm(v) || norm(d.name) === norm(v));
  const findTeacher = (v: string) =>
    lk.teachers.find((t) => norm(t.name) === norm(v)) ?? lk.teachers.find((t) => stripTitle(t.name) === stripTitle(v));
  const findSection = (v: string) => lk.sections.find((s) => norm(s.name) === norm(v));

  const rows: InviteDraft[] = [];
  const errors: string[] = [];
  for (let r = headerIdx + 1; r < table.length; r++) {
    const line = table[r];
    if (!line.some((c) => c.trim())) continue;
    const cell = (k: string) => (col[k] === undefined ? "" : (line[col[k]] ?? "").trim());
    const at = `Row ${r + 1}`;
    const role = parseRole(cell("role"));
    if (!role) {
      errors.push(`${at}: role '${cell("role")}' not recognised (use one of: ${roles}).`);
      continue;
    }
    const draft: InviteDraft = { name: cell("name"), email: cell("email").toLowerCase(), role, departmentId: null, teacherId: null, sectionId: null };
    const problems: string[] = [];
    if (cell("department")) {
      const d = findDept(cell("department"));
      if (d) draft.departmentId = d.id;
      else problems.push(`department '${cell("department")}' not found`);
    }
    if (cell("teacher")) {
      const t = findTeacher(cell("teacher"));
      if (t) draft.teacherId = t.id;
      else problems.push(`teacher '${cell("teacher")}' not found in Setup → Teachers`);
    } else if (role === "TEACHER" || role === "HOD") {
      // No teacher column: match the person's own name to a teacher record when there is one.
      draft.teacherId = findTeacher(draft.name)?.id ?? null;
    }
    if (cell("section")) {
      const s = findSection(cell("section"));
      if (s) draft.sectionId = s.id;
      else problems.push(`section '${cell("section")}' not found`);
    }
    if (!draft.name && draft.teacherId) draft.name = lk.teachers.find((t) => t.id === draft.teacherId)!.name;
    if (role === "HOD" && !draft.departmentId && draft.teacherId) {
      draft.departmentId = lk.teachers.find((t) => t.id === draft.teacherId)!.departmentId;
    }
    Object.assign(draft, linksFor(draft));
    const p = draftProblem(draft);
    if (p) problems.push(p.replace(/\.$/, "").replace(/^./, (c) => c.toLowerCase()));
    if (problems.length) errors.push(`${at}: ${problems.join("; ")}.`);
    else rows.push(draft);
  }
  if (rows.length + errors.length > MAX_BULK_INVITES) {
    return { rows: [], errors: [`At most ${MAX_BULK_INVITES} people per import; split the file.`] };
  }
  return { rows, errors };
}

/** One teacher invite per teacher (optionally only some departments) not already taken. */
export function teacherDrafts(lk: InviteLookups, departmentIds: string[] | null, taken: Taken): InviteDraft[] {
  return lk.teachers
    .filter((t) => (!departmentIds || departmentIds.includes(t.departmentId)) && !taken.teacherIds.has(t.id))
    .map((t) => ({ name: t.name, email: "", role: "TEACHER", departmentId: null, teacherId: t.id, sectionId: null }));
}

/** One HOD row per department; the admin picks who heads it. */
export function hodDrafts(lk: InviteLookups, departmentIds: string[] | null): InviteDraft[] {
  return lk.departments
    .filter((d) => !departmentIds || departmentIds.includes(d.id))
    .map((d) => ({ name: "", email: "", role: "HOD", departmentId: d.id, teacherId: null, sectionId: null }));
}

export function shareText(role: Role, url: string): string {
  return `Join our college timetable as ${ROLE_LABEL[role]}: ${url}`;
}

/** Rows for the invite-links CSV (mail merge, WhatsApp broadcast lists). */
export function linksTable(invites: { name: string; email: string | null; role: Role; token: string }[], urlOf: (token: string) => string): string[][] {
  return [
    ["name", "email", "role", "link", "message"],
    ...invites.map((i) => [i.name, i.email ?? "", ROLE_LABEL[i.role], urlOf(i.token), shareText(i.role, urlOf(i.token))]),
  ];
}
