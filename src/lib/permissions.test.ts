import { describe, expect, it } from "vitest";
import { can, canEditDepartment, type Action, type Member, type Role } from "./permissions";

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

describe("full role x action matrix", () => {
  const A = "INSTITUTE_ADMIN", HOI = "HEAD_OF_INSTITUTE", HOD = "HOD", T = "TEACHER", S = "STUDENT", PO = "PLACEMENT_OFFICER", VM = "VENUE_MANAGER", LA = "LAB_ASSISTANT";
  const ROLES = [A, HOI, HOD, T, S, PO, VM, LA] as Role[];
  // The spec (docs/PLAN.md "Roles & permissions"), written out so any change is deliberate.
  const EXPECTED: Record<Action, Role[]> = {
    "setup.institute": [A],
    "setup.department": [A, HOD],
    "setup.view": [A, HOI, HOD],
    "timetable.generate": [A],
    "timetable.editDraft": [A],
    "timetable.viewDrafts": [A, HOI, HOD],
    "timetable.submit": [A],
    "timetable.signoff": [HOD],
    "timetable.publish": [HOI],
    "timetable.share": [A, HOI, HOD],
    "people.manage": [A],
    "calendar.manage": [A],
    "absence.manage": [A, HOD],
    "absence.self": [T, HOD],
    "venue.request": [A, HOI, HOD, T, PO, VM],
    "appointments.host": [T, HOD],
    "appointments.book": [S],
    "placement.manage": [PO],
    "placement.view": [A, HOI, HOD, T, S, PO],
    "electives.configure": [A, HOD],
    "electives.register": [S],
    "labs.manage": [A, VM, LA],
  };

  for (const [action, allowed] of Object.entries(EXPECTED) as [Action, Role[]][]) {
    it(action, () => {
      for (const role of ROLES) expect([role, can(m(role), action)]).toEqual([role, allowed.includes(role)]);
    });
  }

  it("nobody without a membership can do anything", () => {
    for (const action of Object.keys(EXPECTED) as Action[]) expect(can(null, action)).toBe(false);
  });
});
