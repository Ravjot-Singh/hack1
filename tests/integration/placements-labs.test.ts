import { beforeAll, describe, expect, it } from "vitest";
import { markDowntime, moveClass, removeDowntime } from "@/app/[inst]/labs/actions";
import { saveDrive } from "@/app/[inst]/placements/actions";
import { requestBooking } from "@/app/[inst]/venues/actions";
import { addDays } from "@/lib/calendar";
import { prisma } from "@/lib/db";
import { loadConflicts } from "@/lib/downtime-db";
import { loadImpactContext } from "@/lib/placements-db";
import { as, makeCollege, member, nextWeekday, notificationsFor, type College } from "./helpers";

let c: College;
const monday = nextWeekday(0, 2);

beforeAll(async () => {
  c = await makeCollege("pl");
});

describe("placement drives", () => {
  it("counts a pasted roll list, requests the venue at placement priority and withdraws it when the round goes", async () => {
    const hall = c.input.rooms.find((r) => r.isEventVenue)!;
    const draft = {
      id: null,
      company: "Infosys",
      role: "Systems Engineer",
      notes: "",
      attending: [],
      rollsText: "roll,section\n101,CSE-3A\n102,CSE-3A\n103,ECE-3A",
      rounds: [{ id: null, name: "Aptitude test", date: monday, start: 0, end: 1, roomId: hall.id }],
    };
    await member(c, "TEACHER", { teacherId: c.id("t-anita") });
    expect(await saveDrive(c.slug, draft)).toMatchObject({ ok: false });
    await member(c, "PLACEMENT_OFFICER");
    expect(await saveDrive(c.slug, { ...draft, rollsText: "101,NOPE" })).toMatchObject({ ok: false, error: expect.stringContaining('no section called "NOPE"') });
    const res = await saveDrive(c.slug, draft);
    expect(res).toMatchObject({ ok: true, warnings: [] });
    const drive = await prisma.placementDrive.findFirstOrThrow({ where: { institutionId: c.institutionId }, include: { rounds: true } });
    expect(drive.attending).toEqual([
      { sectionId: c.id("s-cse3a"), count: 2 },
      { sectionId: c.id("s-ece3a"), count: 1 },
    ]);
    const booking = await prisma.venueBooking.findUniqueOrThrow({ where: { id: drive.rounds[0].bookingId! } });
    expect(booking).toMatchObject({ priority: "PLACEMENT", attendees: 3, title: "Infosys: Aptitude test" });

    // Replace the round: the old venue request is withdrawn.
    const again = await saveDrive(c.slug, { ...draft, id: drive.id, rollsText: "", attending: drive.attending as never, rounds: [{ id: null, name: "Interviews", date: monday, start: 5, end: 6, roomId: null }] });
    expect(again.ok).toBe(true);
    expect((await prisma.venueBooking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe("CANCELLED");
  });
});

describe("lab downtime", () => {
  it("scopes lab assistants, calls off bookings, lists classes, moves one and blocks booking", async () => {
    const lab = c.input.rooms.find((r) => r.type === "Computer Lab" && r.ownerDeptId === c.id("d-cse"))!;
    const classroom = c.input.rooms.find((r) => r.type === "Classroom")!;
    // A club booking in the lab at a free Monday period.
    const teacher = await member(c, "TEACHER", { teacherId: c.id("t-rohit") });
    const ctx = (await loadImpactContext(c.institutionId))!;
    const busy = new Set(Object.values(c.assignment).filter((a) => a.day === 0 && a.roomId === lab.id).map((a) => a.period));
    const freeP = [...Array(c.input.periods.length).keys()].find((p) => !busy.has(p) && c.input.grids[1].open[0][p] && !Object.values(c.assignment).some((a) => a.day === 0 && a.roomId === lab.id && p === a.period + 1))!;
    expect((await requestBooking(c.slug, { date: monday, roomId: lab.id, start: freeP, end: freeP, title: "Hackathon prep", attendees: 20, priority: "CLUB", override: false })).ok).toBe(true);

    const assistant = await member(c, "LAB_ASSISTANT", { departmentId: c.id("d-cse") });
    expect(await markDowntime(c.slug, { roomId: classroom.id, from: monday, to: monday, periods: [], reason: "Painting" })).toEqual({ ok: false, error: "You can only mark the labs you look after." });
    const friday = addDays(monday, 4);
    const res = await markDowntime(c.slug, { roomId: lab.id, from: monday, to: friday, periods: [], reason: "Network down" });
    expect(res.ok).toBe(true);
    expect((await prisma.venueBooking.findFirstOrThrow({ where: { title: "Hackathon prep" } })).status).toBe("CANCELLED");
    expect((await notificationsFor(teacher.id)).at(-1)).toContain("out of service");

    // The lab's classes that week are listed; at least one has a free room of the same type to go to.
    const week = await loadConflicts(c.institutionId, ctx, monday, 5);
    expect(week.flatMap((d) => d.open).filter((x) => x.roomId === lab.id).length).toBeGreaterThan(0);
    const day = week.find((d) => d.open.some((x) => x.roomId === lab.id && x.options.length))!;
    expect(day).toBeDefined();
    const hit = day.open.find((x) => x.roomId === lab.id && x.options.length)!;
    {
      expect(await moveClass(c.slug, { date: day.date, lessonId: hit.lessonId, roomId: hit.options[0].id })).toEqual({ ok: true });
      // A room that isn't free (the broken lab itself) is refused.
      expect((await moveClass(c.slug, { date: day.date, lessonId: hit.lessonId, roomId: lab.id })).ok).toBe(false);
      const after = (await loadConflicts(c.institutionId, ctx, day.date, 1))[0];
      expect(after.moved).toContainEqual({ lessonId: hit.lessonId, roomId: hit.options[0].id });
      expect(after.open.some((x) => x.lessonId === hit.lessonId)).toBe(false);
    }

    as(teacher);
    expect(await requestBooking(c.slug, { date: monday, roomId: lab.id, start: freeP, end: freeP, title: "Retry", attendees: 20, priority: "CLUB", override: false })).toMatchObject({
      ok: false,
      error: expect.stringContaining("out of service"),
    });
    as(assistant);
    const d = await prisma.roomDowntime.findFirstOrThrow({ where: { institutionId: c.institutionId } });
    expect((await removeDowntime(c.slug, d.id)).ok).toBe(true);
  });
});
