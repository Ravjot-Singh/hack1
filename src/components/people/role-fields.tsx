"use client";

import { ROLE_LABEL, type Role } from "@/lib/permissions";

export interface RoleLink {
  role: Role;
  departmentId: string | null;
  teacherId: string | null;
  sectionId: string | null;
}

export interface PeopleLookups {
  departments: { id: string; name: string; code: string }[];
  teachers: { id: string; name: string; departmentId: string }[];
  sections: { id: string; name: string }[];
}

const ROLES = Object.keys(ROLE_LABEL) as Role[];
export const selectClass = "h-8 w-full rounded-md border bg-background px-2 text-sm sm:w-auto";

/** Role picker plus the department / teacher / section link that role needs. */
export function RoleFields({ value, onChange, departments, teachers, sections }: { value: RoleLink; onChange: (v: RoleLink) => void } & PeopleLookups) {
  return (
    <>
      <select aria-label="Role" className={selectClass} value={value.role} onChange={(e) => onChange({ ...value, role: e.target.value as Role })}>
        {ROLES.map((r) => (
          <option key={r} value={r}>
            {ROLE_LABEL[r]}
          </option>
        ))}
      </select>
      {(value.role === "HOD" || value.role === "LAB_ASSISTANT") && (
        <select aria-label="Department" className={selectClass} value={value.departmentId ?? ""} onChange={(e) => onChange({ ...value, departmentId: e.target.value || null })}>
          <option value="">{value.role === "HOD" ? "Department…" : "Common labs (no department)"}</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.code} · {d.name}
            </option>
          ))}
        </select>
      )}
      {(value.role === "TEACHER" || value.role === "HOD") && (
        <select aria-label="Teacher record" className={selectClass} value={value.teacherId ?? ""} onChange={(e) => onChange({ ...value, teacherId: e.target.value || null })}>
          <option value="">{value.role === "HOD" ? "Also teaches as… (optional)" : "Which teacher…"}</option>
          {teachers.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      )}
      {value.role === "STUDENT" && (
        <select aria-label="Section" className={selectClass} value={value.sectionId ?? ""} onChange={(e) => onChange({ ...value, sectionId: e.target.value || null })}>
          <option value="">Section…</option>
          {sections.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      )}
    </>
  );
}
