import { beforeAll, describe, expect, it } from "vitest";
import { markAbsent } from "@/app/[inst]/absences/actions";
import { bookAppointment, cancelAppointment, saveOfficeHours } from "@/app/[inst]/appointments/actions";
import { teachingSlots } from "@/lib/appointments";
import { prisma } from "@/lib/db";
import { as, makeCollege, member, nextWeekday, notificationsFor, runAs, type College } from "./helpers";

let c: College;
let teacher: Awaited<ReturnType<typeof member>>;
const students: Awaited<ReturnType<typeof member>>[] = [];
const monday = nextWeekday(0, 1);
let freeP: number;

beforeAll(async () => {
  c = await makeCollege("apt");
  // Dr. Anita Desai's first free, open Monday period.
  const busy = teachingSlots(c.problem, c.assignment, c.id("t-anita"));
  freeP = [...Array(c.input.periods.length).keys()].find((p) => !busy.has(`0:${p}`) && c.input.grids[1].open[0][p])!;
  for (let i = 0; i < 4; i++) students.push(await member(c, "STUDENT", { sectionId: c.id("s-cse2a") }, `student${i}`));
  teacher = await member(c, "TEACHER", { teacherId: c.id("t-anita") });
});

describe("office hours and appointments", () => {
  it("lets a teacher open only free periods", async () => {
    const teaching = [...teachingSlots(c.problem, c.assignment, c.id("t-anita"))][0].split(":").map(Number) as [number, number];
    as(teacher);
    expect(await saveOfficeHours(c.slug, { slots: [teaching], slotMinutes: 15, perStudentWeek: 1, location: "Staff room" })).toMatchObject({
      ok: false,
      error: expect.stringContaining("isn't a free period"),
    });
    expect(await saveOfficeHours(c.slug, { slots: [[0, freeP]], slotMinutes: 15, perStudentWeek: 1, location: "Staff room" })).toMatchObject({ ok: true });
    as(students[0]);
    expect((await saveOfficeHours(c.slug, { slots: [[0, freeP]], slotMinutes: 15, perStudentWeek: 1, location: "" })).ok).toBe(false);
  });

  it("books a slot, tells the teacher, and enforces the weekly limit", async () => {
    as(students[0]);
    const first = await bookAppointment(c.slug, { teacherId: c.id("t-anita"), date: monday, period: freeP, offset: 0, topic: "Doubt in trees" });
    expect(first).toMatchObject({ ok: true });
    expect((await notificationsFor(teacher.id)).at(-1)).toContain("Doubt in trees");
    expect(await bookAppointment(c.slug, { teacherId: c.id("t-anita"), date: monday, period: freeP, offset: 15, topic: "Another one" })).toMatchObject({
      ok: false,
      error: expect.stringContaining("limit"),
    });
    as(students[1]);
    expect(await bookAppointment(c.slug, { teacherId: c.id("t-anita"), date: monday, period: freeP, offset: 0, topic: "Same slot" })).toEqual({ ok: false, error: "Someone has just booked that slot." });
    as(teacher);
    expect(await bookAppointment(c.slug, { teacherId: c.id("t-anita"), date: monday, period: freeP, offset: 30, topic: "Teacher booking" })).toEqual({ ok: false, error: "Only students book office hours." });
  });

  it("lets only one of two students racing for a slot have it", async () => {
    // Two different students at once; the serializable transaction lets exactly one through.
    const book = (i: number) => runAs(students[i], () => bookAppointment(c.slug, { teacherId: c.id("t-anita"), date: monday, period: freeP, offset: 15, topic: `Race ${i}` }));
    const results = await Promise.all([book(2), book(3)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)).toEqual({ ok: false, error: "Someone has just booked that slot." });
    const rows = await prisma.appointment.findMany({ where: { institutionId: c.institutionId, offset: 15, status: "BOOKED" } });
    expect(rows).toHaveLength(1);
    expect([students[2].id, students[3].id]).toContain(rows[0].studentId);
  });

  it("calls bookings off when the teacher goes on leave, and tells both sides", async () => {
    await member(c, "INSTITUTE_ADMIN");
    expect(await markAbsent(c.slug, { teacherId: c.id("t-anita"), date: monday, periods: [], reason: "Conference" })).toEqual({ ok: true });
    const rows = await prisma.appointment.findMany({ where: { institutionId: c.institutionId } });
    expect(rows.every((r) => r.status === "INVALID" && r.note === "The teacher is on leave then.")).toBe(true);
    expect((await notificationsFor(students[0].id)).at(-1)).toMatch(/can't go ahead: The teacher is on leave then/);
    // A called-off appointment can't be cancelled again.
    as(students[0]);
    expect(await cancelAppointment(c.slug, rows.find((r) => r.studentId === students[0].id)!.id)).toEqual({ ok: false, error: "It is already off." });
  });
});
