import { beforeAll, describe, expect, it } from "vitest";
import { createBlankInstitute, createDemoCopy } from "@/app/actions";
import { markAbsent, setCover } from "@/app/[inst]/absences/actions";
import { bookAppointment } from "@/app/[inst]/appointments/actions";
import { saveDepartments, saveRooms, saveTeachers } from "@/app/[inst]/setup/actions";
import { createShareLink, publish } from "@/app/[inst]/timetables/actions";
import { requestBooking } from "@/app/[inst]/venues/actions";
import { acceptInvite } from "@/app/invite/[token]/actions";
import { prisma } from "@/lib/db";
import { getShared } from "@/lib/share";
import { classUse } from "@/lib/venues";
import { as, makeCollege, member, nextWeekday, runAs, type College } from "./helpers";

// "Try to break it" probes, kept as regression tests: each one is an attack that must fail.
// See docs/SECURITY-TESTING.md for the plan and the findings.

let c: College;
let admin: Awaited<ReturnType<typeof member>>;

beforeAll(async () => {
  c = await makeCollege("atk");
  admin = await member(c, "INSTITUTE_ADMIN");
});

async function stranger(name: string) {
  const uid = `${c.slug}-${name}-${Math.random().toString(36).slice(2, 8)}`;
  return prisma.user.create({ data: { id: uid, name, email: `${uid}@it.test`, emailVerified: true } });
}
/** Server actions end in redirect(), which throws; we only care that it didn't fail otherwise. */
const settle = (p: Promise<unknown>) => p.catch((e: Error) => (String(e.message).includes("NEXT_REDIRECT") ? "redirected" : { thrown: e.message }));

describe("H4: single-use invites", () => {
  it("lets only one of two people racing for the same invite link join", async () => {
    as(admin);
    const invite = await prisma.invite.create({
      data: { token: `race-${c.slug}`, institutionId: c.institutionId, name: "Shared link", role: "INSTITUTE_ADMIN", invitedBy: admin.id, expiresAt: new Date(Date.now() + 86400_000) },
    });
    const [a, b] = await Promise.all([stranger("racer-a"), stranger("racer-b")]);
    await Promise.all([a, b].map((u) => runAs(u, () => settle(acceptInvite(invite.token)))));
    const joined = await prisma.membership.count({ where: { institutionId: c.institutionId, userId: { in: [a.id, b.id] } } });
    expect(joined).toBe(1);
  });
});

describe("H1: impossible calendar dates", () => {
  it("refuses 31 November instead of quietly booking 1 December past the lab's downtime", async () => {
    const manager = await member(c, "VENUE_MANAGER");
    const lab = c.input.rooms.find((r) => r.type !== "Classroom" && !r.isEventVenue)!;
    await prisma.roomDowntime.create({
      data: { institutionId: c.institutionId, roomId: lab.id, fromDate: new Date("2026-12-01"), toDate: new Date("2026-12-01"), reason: "Rewiring", createdBy: admin.id },
    });
    // A period with no class in the lab on 1 December, so only the downtime should stop it.
    const day = (new Date("2026-12-01T00:00:00Z").getUTCDay() + 6) % 7;
    const busy = classUse(c.problem, c.assignment, day).get(lab.id);
    const free = [...Array(c.input.periods.length).keys()].find((p) => !busy?.has(p) && c.input.grids[1].open[day][p])!;
    as(manager);
    const res = await settle(requestBooking(c.slug, { date: "2026-11-31", roomId: lab.id, start: free, end: free, title: "Sneaky", attendees: 5, priority: "CLUB", override: false }));
    expect(res).toMatchObject({ ok: false });
    expect(await prisma.venueBooking.count({ where: { institutionId: c.institutionId, title: "Sneaky" } })).toBe(0);
  });

  it("answers nonsense dates with a message, not a server crash", async () => {
    const teacher = await member(c, "TEACHER", { teacherId: c.id("t-anita") });
    expect(await settle(markAbsent(c.slug, { teacherId: c.id("t-anita"), date: "2026-02-30", periods: [] }))).toMatchObject({ ok: false });
    expect(await settle(markAbsent(c.slug, { teacherId: c.id("t-anita"), date: "2026-13-01", periods: [] }))).toMatchObject({ ok: false });
    as(teacher);
    const student = await member(c, "STUDENT", { sectionId: c.id("s-cse2a") });
    as(student);
    expect(await settle(bookAppointment(c.slug, { teacherId: c.id("t-anita"), date: "2026-10-32", period: 0, offset: 0, topic: "x" }))).toMatchObject({ ok: false });
  });
});

describe("H2: creating colleges", () => {
  it("caps how many colleges one account can create", async () => {
    const spammer = await stranger("spammer");
    as(spammer);
    for (let i = 0; i < 8; i++) await settle(i % 2 ? createDemoCopy() : createBlankInstitute({ name: `Spam ${i}`, days: ["Mon"], start: "09:00", periodMinutes: 60, periods: 6, breakAfter: 0, breakMinutes: 0, lunchPeriod: 0, halfSaturday: false }));
    const owned = await prisma.membership.count({ where: { userId: spammer.id, role: "INSTITUTE_ADMIN" } });
    expect(owned).toBeLessThanOrEqual(5);
  });

  it("refuses made-up or repeated working days", async () => {
    as(await stranger("days"));
    const base = { name: "Odd week", start: "09:00", periodMinutes: 60, periods: 6, breakAfter: 0, breakMinutes: 0, lunchPeriod: 0, halfSaturday: false };
    // Server actions take any JSON, whatever the TypeScript types say.
    expect(await settle(createBlankInstitute({ ...base, days: ["Funday"] as never }))).toMatchObject({ error: expect.any(String) });
    expect(await settle(createBlankInstitute({ ...base, days: Array(5000).fill("Mon") }))).toMatchObject({ error: expect.any(String) });
    expect(await settle(createBlankInstitute({ ...base, days: ["Mon"], start: "99:99" }))).toMatchObject({ error: expect.any(String) });
  });
});

describe("M: races", () => {
  it("never approves two bookings of the same room and time made at the same moment", async () => {
    const managers = await Promise.all([member(c, "VENUE_MANAGER", {}, "vm-a"), member(c, "VENUE_MANAGER", {}, "vm-b")]);
    const hall = c.input.rooms.find((r) => r.isEventVenue)!;
    const req = (title: string) => ({ date: "2026-12-14", roomId: hall.id, start: 1, end: 2, title, attendees: 50, priority: "CLUB", override: false });
    await Promise.all(managers.map((m, i) => runAs(m, () => requestBooking(c.slug, req(`Race ${i}`)))));
    const approved = await prisma.venueBooking.count({ where: { institutionId: c.institutionId, roomId: hall.id, status: "APPROVED", title: { startsWith: "Race" } } });
    expect(approved).toBe(1);
  });

  it("never leaves two published timetables when two are published at once", async () => {
    const hoi = await member(c, "HEAD_OF_INSTITUTE");
    const approved = await Promise.all(
      [1, 2].map((i) =>
        prisma.timetableVersion.create({ data: { institutionId: c.institutionId, name: `Ready ${i}`, status: "APPROVED", quality: 0, stats: {}, snapshot: c.input as object } }),
      ),
    );
    await Promise.all(approved.map((v) => runAs(hoi, () => publish(c.slug, v.id))));
    expect(await prisma.timetableVersion.count({ where: { institutionId: c.institutionId, status: "PUBLISHED" } })).toBe(1);
    // Put the original published version back for the other probes.
    await prisma.timetableVersion.updateMany({ where: { id: { in: approved.map((v) => v.id) } }, data: { status: "ARCHIVED" } });
    await prisma.timetableVersion.updateMany({ where: { institutionId: c.institutionId, name: "Published" }, data: { status: "PUBLISHED" } });
  });
});

describe("M: cover", () => {
  it("won't cancel a class the teacher isn't absent for", async () => {
    // Anita's lessons on one weekday: absent for the first only, then try to cancel the last.
    const day = c.assignment[c.problem.lessons.find((l) => l.teacherIds.includes(c.id("t-anita")))!.id].day;
    const date = nextWeekday(day, 2);
    const hers = c.problem.lessons
      .filter((l) => l.teacherIds.includes(c.id("t-anita")) && c.assignment[l.id].day === day)
      .sort((a, b) => c.assignment[a.id].period - c.assignment[b.id].period);
    expect(hers.length).toBeGreaterThan(1);
    as(admin);
    const first = c.assignment[hers[0].id].period;
    expect(await markAbsent(c.slug, { teacherId: c.id("t-anita"), date, periods: [first] })).toMatchObject({ ok: true });
    const last = hers.at(-1)!;
    expect(await setCover(c.slug, { date, lessonId: last.id, action: "CANCEL", substituteId: null })).toMatchObject({ ok: false });
  });

  it("asks a signed-out visitor to sign in before looking anything up", async () => {
    as(null);
    const lesson = c.problem.lessons[0];
    const date = nextWeekday(c.assignment[lesson.id].day, 2);
    const res = await setCover(c.slug, { date, lessonId: "made-up", action: "CANCEL", substituteId: null });
    const real = await setCover(c.slug, { date, lessonId: lesson.id, action: "CANCEL", substituteId: null });
    // Same answer whether or not the class exists: nothing to learn without signing in.
    expect(res).toEqual(real);
    expect(res).toMatchObject({ ok: false, error: expect.stringMatching(/sign in/i) });
  });
});

describe("M: setup saves", () => {
  const roomRows = async () =>
    (await prisma.room.findMany({ where: { institutionId: c.institutionId } })).map((r) => ({
      id: r.id, name: r.name, type: r.type, capacity: r.capacity, buildingId: r.buildingId, ownerDeptId: r.ownerDeptId, isEventVenue: r.isEventVenue,
    }));

  it("doesn't wipe a room a colleague added after the page was loaded", async () => {
    as(admin);
    const page = await roomRows(); // what the admin's page shows
    await prisma.room.create({ data: { institutionId: c.institutionId, name: "Added meanwhile", type: "Classroom", capacity: 40 } });
    expect(await saveRooms(c.slug, page, page.map((r) => r.id))).toEqual({ ok: true });
    expect(await prisma.room.count({ where: { institutionId: c.institutionId, name: "Added meanwhile" } })).toBe(1);
  });

  it("won't delete a room with an upcoming booking, or a department people belong to", async () => {
    as(admin);
    const rows = await roomRows();
    const hall = rows.find((r) => r.name === "Seminar Hall")!;
    await prisma.venueBooking.create({
      data: { institutionId: c.institutionId, roomId: hall.id, date: new Date(`${nextWeekday(2, 3)}T00:00:00Z`), startPeriod: 0, endPeriod: 0, title: "Guest talk", attendees: 30, priority: "CLUB", requestedBy: admin.id, status: "APPROVED" },
    });
    const res = await saveRooms(c.slug, rows.filter((r) => r.id !== hall.id), rows.map((r) => r.id));
    expect(res).toMatchObject({ ok: false, error: expect.stringContaining("upcoming booking") });

    const depts = await prisma.department.findMany({ where: { institutionId: c.institutionId } });
    const lonely = await prisma.department.create({ data: { institutionId: c.institutionId, name: "Library", code: "LIB" } });
    await member(c, "LAB_ASSISTANT", { departmentId: lonely.id }, "librarian");
    as(admin);
    const all = [...depts, lonely].map((d) => ({ id: d.id, name: d.name, code: d.code }));
    expect(await saveDepartments(c.slug, all.filter((d) => d.id !== lonely.id), all.map((d) => d.id))).toMatchObject({
      ok: false,
      error: expect.stringContaining("member account"),
    });
  });

  it("won't delete a teacher record someone signs in as", async () => {
    as(admin);
    const teachers = await prisma.teacher.findMany({ where: { institutionId: c.institutionId } });
    // Anita has an account (made in the cover probes) but no classes after this.
    const idle = await prisma.teacher.create({ data: { institutionId: c.institutionId, name: "Idle Teacher", departmentId: teachers[0].departmentId, designation: "Lecturer", maxPerDay: 4, maxPerWeek: 20 } });
    await member(c, "TEACHER", { teacherId: idle.id }, "idle");
    as(admin);
    const rows = [...teachers, idle].map((t) => ({ id: t.id, name: t.name, email: "", deptId: t.departmentId, designation: t.designation, maxPerDay: t.maxPerDay, maxPerWeek: t.maxPerWeek, unavailable: [], prefs: [] }));
    expect(await saveTeachers(c.slug, rows.filter((r) => r.id !== idle.id), rows.map((r) => r.id))).toMatchObject({
      ok: false,
      error: expect.stringContaining("member account"),
    });
  });

  it("refuses oversized saves instead of tying up the database", async () => {
    as(admin);
    const huge = Array.from({ length: 6000 }, (_, i) => ({ name: `Room ${i}`, type: "Classroom", capacity: 30, buildingId: null, ownerDeptId: null, isEventVenue: false }));
    expect(await saveRooms(c.slug, huge)).toMatchObject({ ok: false, error: expect.stringContaining("At most") });
    const teacher = await prisma.teacher.findFirstOrThrow({ where: { institutionId: c.institutionId } });
    const row = { id: teacher.id, name: teacher.name, email: "", deptId: teacher.departmentId, designation: teacher.designation, maxPerDay: 4, maxPerWeek: 20, unavailable: Array(5000).fill([0, 0]), prefs: [] };
    const all = (await prisma.teacher.findMany({ where: { institutionId: c.institutionId } })).map((t) => (t.id === teacher.id ? row : { id: t.id, name: t.name, email: "", deptId: t.departmentId, designation: t.designation, maxPerDay: t.maxPerDay, maxPerWeek: t.maxPerWeek, unavailable: [], prefs: [] }));
    expect((await saveTeachers(c.slug, all)).ok).toBe(false);
  });
});

describe("M: notification spam", () => {
  it("caps how many room requests one person can leave waiting", async () => {
    const teacher = await member(c, "TEACHER", { teacherId: c.id("t-anita") }, "requester");
    const hall = c.input.rooms.find((r) => r.isEventVenue)!;
    const results = [];
    for (let i = 0; i < 12; i++) {
      results.push(await requestBooking(c.slug, { date: nextWeekday(i % 5, 7 + i), roomId: hall.id, start: 0, end: 0, title: `Club meet ${i}`, attendees: 20, priority: "CLUB", override: false }));
    }
    expect(results.filter((r) => r.ok).length).toBeLessThanOrEqual(10);
    expect(results.at(-1)).toMatchObject({ ok: false, error: expect.stringContaining("waiting") });
    void teacher;
  });
});

describe("H3: public share links", () => {
  it("shows a stranger only the shared section's timetable, without private planning data", async () => {
    as(admin);
    const version = await prisma.timetableVersion.findFirstOrThrow({ where: { institutionId: c.institutionId, status: "PUBLISHED" } });
    const res = await createShareLink(c.slug, version.id, "section", c.id("s-cse2a"), true);
    expect(res.ok).toBe(true);
    const shared = await getShared((res as { token: string }).token);
    const snap = shared.version!.snapshot;
    expect(snap.sections.map((s) => s.id)).toEqual([c.id("s-cse2a")]);
    for (const t of snap.teachers) expect(t.unavailable ?? []).toEqual([]);
    expect(snap.rules.custom ?? []).toEqual([]);
    // Every placement shown belongs to the shared section.
    expect(Object.keys(shared.version!.assignment).length).toBeLessThan(Object.keys(c.assignment).length);
  });

  it("won't let an HOD publish an unapproved draft as a link, or link a section that doesn't exist", async () => {
    const draft = await prisma.timetableVersion.create({
      data: { institutionId: c.institutionId, name: "Draft", status: "DRAFT", quality: 0, stats: {}, snapshot: c.input as object },
    });
    await member(c, "HOD", { departmentId: c.id("d-cse") });
    expect(await createShareLink(c.slug, draft.id, null, null, false)).toMatchObject({ ok: false });
    as(admin);
    const published = await prisma.timetableVersion.findFirstOrThrow({ where: { institutionId: c.institutionId, status: "PUBLISHED" } });
    expect(await createShareLink(c.slug, published.id, "section", "no-such-section", true)).toMatchObject({ ok: false });
  });
});
