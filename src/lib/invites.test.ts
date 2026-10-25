import { describe, expect, it } from "vitest";
import { duplicates, hodDrafts, linksTable, mapInviteTable, parseRole, teacherDrafts, type InviteDraft, type InviteLookups } from "./invites";

const lk: InviteLookups = {
  departments: [
    { id: "cse", name: "Computer Science", code: "CSE" },
    { id: "me", name: "Mechanical", code: "ME" },
  ],
  teachers: [
    { id: "t1", name: "Dr. Priya Nair", departmentId: "cse" },
    { id: "t2", name: "Rajesh Kumar", departmentId: "cse" },
    { id: "t3", name: "Er. Aman Gill", departmentId: "me" },
  ],
  sections: [{ id: "s1", name: "CSE-2A" }],
};
const none = { emails: new Set<string>(), teacherIds: new Set<string>() };
const draft = (d: Partial<InviteDraft>): InviteDraft => ({ name: "X Y", email: "", role: "TEACHER", departmentId: null, teacherId: null, sectionId: null, ...d });

describe("bulk invites", () => {
  it("reads role words admins actually type", () => {
    expect(parseRole("HOD")).toBe("HOD");
    expect(parseRole("Head of Department")).toBe("HOD");
    expect(parseRole("principal")).toBe("HEAD_OF_INSTITUTE");
    expect(parseRole("Lab Assistant")).toBe("LAB_ASSISTANT");
    expect(parseRole("TEACHER")).toBe("TEACHER");
    expect(parseRole("janitor")).toBeNull();
  });

  it("maps a spreadsheet to invites, resolving names and filling blanks from the teacher record", () => {
    const { rows, errors } = mapInviteTable(
      [
        ["Name", "E-mail", "Role", "Dept", "Teacher", "Section"],
        ["", "PRIYA@x.edu", "Teacher", "", "Priya Nair", ""],
        ["Rajesh Kumar", "", "HOD", "", "", ""],
        ["Gurleen", "g@x.edu", "student", "CSE", "", "cse-2a"],
      ],
      lk,
    );
    expect(errors).toEqual([]);
    expect(rows).toEqual([
      { name: "Dr. Priya Nair", email: "priya@x.edu", role: "TEACHER", departmentId: null, teacherId: "t1", sectionId: null },
      // HOD: teacher matched by name, department taken from the teacher.
      { name: "Rajesh Kumar", email: "", role: "HOD", departmentId: "cse", teacherId: "t2", sectionId: null },
      // A student keeps only the section.
      { name: "Gurleen", email: "g@x.edu", role: "STUDENT", departmentId: null, teacherId: null, sectionId: "s1" },
    ]);
  });

  it("explains bad rows with the spreadsheet row number", () => {
    const { rows, errors } = mapInviteTable(
      [
        ["name", "email", "role", "department", "teacher", "section"],
        ["A B", "", "janitor", "", "", ""],
        ["C D", "not-an-email", "Teacher", "", "", ""],
        ["E F", "", "Student", "", "", "CSE-9Z"],
        ["G H", "", "HOD", "", "", ""],
      ],
      lk,
    );
    expect(rows).toEqual([]);
    expect(errors[0]).toMatch(/^Row 2: role 'janitor' not recognised/);
    expect(errors[1]).toBe(`Row 3: "not-an-email" is not a valid email.`);
    expect(errors[2]).toBe("Row 4: section 'CSE-9Z' not found.");
    expect(errors[3]).toBe("Row 5: pick the HOD's department.");
  });

  it("refuses a file without a role column", () => {
    expect(mapInviteTable([["name", "email"], ["A B", ""]], lk).errors[0]).toMatch(/Missing columns/);
  });

  it("flags people invited twice, against existing accounts and within the list", () => {
    const taken = { emails: new Set(["old@x.edu"]), teacherIds: new Set(["t3"]) };
    const name = (id: string) => lk.teachers.find((t) => t.id === id)!.name;
    const dup = duplicates(
      [
        draft({ email: "old@x.edu" }),
        draft({ teacherId: "t3" }),
        draft({ email: "new@x.edu", teacherId: "t1" }),
        draft({ email: "NEW@x.edu" }),
        draft({ teacherId: "t1" }),
        // A student row's stray teacher link doesn't count.
        draft({ role: "STUDENT", teacherId: "t1" }),
      ],
      taken,
      name,
    );
    expect([...dup.entries()]).toEqual([
      [0, "old@x.edu already has an account here or an open invite."],
      [1, "Er. Aman Gill already has an account here or an open invite."],
      [3, "Same email as row 3."],
      [4, "Same teacher as row 3."],
    ]);
  });

  it("builds group rows: teachers of chosen departments not yet invited, one HOD row per department", () => {
    const taken = { emails: new Set<string>(), teacherIds: new Set(["t2"]) };
    expect(teacherDrafts(lk, ["cse"], taken).map((d) => d.teacherId)).toEqual(["t1"]);
    expect(teacherDrafts(lk, null, none).map((d) => d.teacherId)).toEqual(["t1", "t2", "t3"]);
    expect(hodDrafts(lk, null).map((d) => [d.role, d.departmentId])).toEqual([
      ["HOD", "cse"],
      ["HOD", "me"],
    ]);
  });

  it("exports links with a ready-to-send message", () => {
    const t = linksTable([{ name: "A", email: null, role: "STUDENT", token: "abc" }], (k) => `https://x/invite/${k}`);
    expect(t[1]).toEqual(["A", "", "Student", "https://x/invite/abc", "Join our college timetable as Student: https://x/invite/abc"]);
  });
});
