import { beforeAll, describe, expect, it } from "vitest";
import { createInvites, markSent, resendInvites } from "@/app/[inst]/people/actions";
import { prisma } from "@/lib/db";
import { as, makeCollege, member, type College } from "./helpers";

let c: College;
let admin: Awaited<ReturnType<typeof member>>;
let teacher: Awaited<ReturnType<typeof member>>;

beforeAll(async () => {
  c = await makeCollege("ppl");
  teacher = await member(c, "TEACHER", { teacherId: c.id("t-anita") });
  admin = await member(c, "INSTITUTE_ADMIN");
});

const row = (r: Record<string, unknown>) => ({ email: "", departmentId: null, teacherId: null, sectionId: null, ...r });
const open = () => prisma.invite.findMany({ where: { institutionId: c.institutionId, acceptedAt: null }, orderBy: { name: "asc" } });

describe("inviting several people at once", () => {
  it("refuses the whole batch when a row is wrong, naming each bad row", async () => {
    as(admin);
    const res = await createInvites(c.slug, [row({ name: "Fine Person", role: "STUDENT", sectionId: c.id("s-cse2a") }), row({ name: "No Dept", role: "HOD" }), row({ name: "X", role: "TEACHER" })]);
    expect(res).toMatchObject({ ok: false, error: "2 rows need fixing; nothing was created." });
    expect(!res.ok && res.rowErrors).toEqual(["Row 2 (No Dept): Pick the HOD's department.", "Row 3: Enter the person's name."]);
    expect(await open()).toHaveLength(0);
  });

  it("creates the rest and skips people who already have an account or appear twice", async () => {
    as(admin);
    const res = await createInvites(c.slug, [
      row({ name: "Anita again", role: "TEACHER", teacherId: c.id("t-anita") }), // already a member
      row({ name: "Student One", email: "One@x.edu", role: "STUDENT", sectionId: c.id("s-cse2a") }),
      row({ name: "Student Dup", email: "one@x.edu", role: "STUDENT", sectionId: c.id("s-cse2a") }),
      row({ name: "Head CSE", role: "HOD", departmentId: c.id("d-cse") }),
      row({ name: "Other college", role: "STUDENT", sectionId: "not-ours" }),
    ]);
    // A link to another college's record is a row error, so nothing is created yet.
    expect(res.ok).toBe(false);
    const ok = await createInvites(c.slug, [
      row({ name: "Anita again", role: "TEACHER", teacherId: c.id("t-anita") }),
      row({ name: "Student One", email: "One@x.edu", role: "STUDENT", sectionId: c.id("s-cse2a") }),
      row({ name: "Student Dup", email: "one@x.edu", role: "STUDENT", sectionId: c.id("s-cse2a") }),
      row({ name: "Head CSE", role: "HOD", departmentId: c.id("d-cse") }),
    ]);
    expect(ok).toMatchObject({ ok: true, created: 2 });
    expect(ok.ok && ok.skipped).toHaveLength(2);
    expect((await open()).map((i) => [i.name, i.email, i.sentAt])).toEqual([
      ["Head CSE", null, null],
      ["Student One", "one@x.edu", null],
    ]);
    // Running the same batch again creates nothing new.
    expect(await createInvites(c.slug, [row({ name: "Student One", email: "one@x.edu", role: "STUDENT" })])).toMatchObject({ ok: true, created: 0 });
  });

  it("tracks what was sent and renews only those links on a reminder", async () => {
    as(admin);
    const [hod, student] = await open();
    await prisma.invite.update({ where: { id: student.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await markSent(c.slug, [student.id])).toEqual({ ok: true });
    const res = await resendInvites(c.slug);
    expect(res.ok && res.invites.map((i) => i.name)).toEqual(["Student One"]);
    const after = await open();
    expect(after.find((i) => i.id === student.id)!.expiresAt.getTime()).toBeGreaterThan(Date.now() + 13 * 86400_000);
    expect(after.find((i) => i.id === hod.id)!.sentAt).toBeNull();
  });

  it("is for admins only", async () => {
    as(teacher);
    expect((await createInvites(c.slug, [row({ name: "Sneaky", role: "INSTITUTE_ADMIN" })])).ok).toBe(false);
    expect((await resendInvites(c.slug)).ok).toBe(false);
  });
});
