import { describe, expect, it } from "vitest";
import { can, canEditDepartment, type Member, type Role } from "./permissions";

const m = (role: Role, departmentId: string | null = null): Member => ({ role, departmentId, teacherId: null, sectionId: null });

describe("permission matrix", () => {
  it("lets only admins run the solver, edit drafts and manage people", () => {
    for (const role of ["HEAD_OF_INSTITUTE", "HOD", "TEACHER", "STUDENT"] as Role[]) {
      expect(can(m(role), "timetable.generate")).toBe(false);
      expect(can(m(role), "people.manage")).toBe(false);
    }
    expect(can(m("INSTITUTE_ADMIN"), "timetable.generate")).toBe(true);
  });

  it("lets the Head of Institute publish, and the admin only when there is no HOI", () => {
    expect(can(m("HEAD_OF_INSTITUTE"), "timetable.publish")).toBe(true);
    expect(can(m("INSTITUTE_ADMIN"), "timetable.publish")).toBe(false);
    expect(can(m("INSTITUTE_ADMIN"), "timetable.publish", { noHeadOfInstitute: true })).toBe(true);
    expect(can(m("HOD"), "timetable.publish", { noHeadOfInstitute: true })).toBe(false);
  });

  it("keeps drafts away from teachers and students", () => {
    expect(can(m("TEACHER"), "timetable.viewDrafts")).toBe(false);
    expect(can(m("STUDENT"), "timetable.viewDrafts")).toBe(false);
    expect(can(null, "timetable.viewDrafts")).toBe(false);
  });

  it("scopes HOD edits to their own department", () => {
    expect(canEditDepartment(m("HOD", "cse"), "cse")).toBe(true);
    expect(canEditDepartment(m("HOD", "cse"), "ece")).toBe(false);
    expect(canEditDepartment(m("INSTITUTE_ADMIN"), "ece")).toBe(true);
    expect(canEditDepartment(m("TEACHER", "cse"), "cse")).toBe(false);
  });
});
