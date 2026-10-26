import { beforeAll, describe, expect, it } from "vitest";
import { markDowntime, moveClass, removeDowntime } from "@/app/[inst]/labs/actions";
import { deleteDrive, saveDrive } from "@/app/[inst]/placements/actions";
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
      rounds: [{ id: null, name: "Aptitude test", date: monday, start: 0, end: 1, roomIds: [hall.id] }],
    };
    await member(c, "TEACHER", { teacherId: c.id("t-anita") });
    expect(await saveDrive(c.slug, draft)).toMatchObject({ ok: false });
    await member(c, "PLACEMENT_OFFICER");
    expect(await saveDrive(c.slug, { ...draft, rollsText: "101,NOPE" })).toMatchObject({ ok: false, error: expect.stringContaining('no section called "NOPE"') });
    const res = await saveDrive(c.slug, draft);
    expect(res).toMatchObject({ ok: true, warnings: [] });
    const drive = await prisma.placementDrive.findFirstOrThrow({ where: { institutionId: c.institutionId }, include: { rounds: { include: { venues: true } } } });
    expect(drive.attending).toEqual([
      { sectionId: c.id("s-cse3a"), count: 2 },
      { sectionId: c.id("s-ece3a"), count: 1 },
    ]);
    const booking = await prisma.venueBooking.findUniqueOrThrow({ where: { id: drive.rounds[0].venues[0].bookingId! } });
    expect(booking).toMatchObject({ priority: "PLACEMENT", attendees: 3, title: "Infosys: Aptitude test" });

    // Replace the round: the old venue request is withdrawn.
    const again = await saveDrive(c.slug, { ...draft, id: drive.id, rollsText: "", attending: drive.attending as never, rounds: [{ id: null, name: "Interviews", date: monday, start: 5, end: 6, roomIds: [] }] });
    expect(again.ok).toBe(true);
    expect((await prisma.venueBooking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe("CANCELLED");
  });

  it("seats a big round across several rooms, each booked for its share", async () => {
    await member(c, "PLACEMENT_OFFICER", {}, "po-multi");
    const hall = c.input.rooms.find((r) => r.isEventVenue)!;
    // A classroom with no class on Monday P5–P6, so it can be booked too.
    const busy = (roomId: string) => Object.values(c.assignment).some((a) => a.day === 0 && a.roomId === roomId && a.period >= 3 && a.period <= 5);
    const room = c.input.rooms.find((r) => r.type === "Classroom" && !busy(r.id))!;
    const roundIn = (roomIds: string[], id: string | null = null, name = "Coding test") => ({ id, name, date: monday, start: 4, end: 5, roomIds });
    const draft = { id: null, company: "TCS", role: "", notes: "", attending: [{ sectionId: c.id("s-cse3a"), count: 3 }], rollsText: "", rounds: [roundIn([hall.id, room.id])] };
    const res = await saveDrive(c.slug, draft);
    expect(res).toMatchObject({ ok: true, warnings: [] });
    const load = () => prisma.placementDrive.findFirstOrThrow({ where: { institutionId: c.institutionId, company: "TCS" }, include: { rounds: { include: { venues: true } } } });
    const first = (await load()).rounds[0];
    // 3 students over 200 + classroom seats: both rooms used, everyone seated, each booking sized to its share.
    expect(first.venues.reduce((n, v) => n + v.seats, 0)).toBe(3);
    for (const v of first.venues) {
      const b = await prisma.venueBooking.findUniqueOrThrow({ where: { id: v.bookingId! } });
      expect(b).toMatchObject({ roomId: v.roomId, attendees: Math.max(1, v.seats), priority: "PLACEMENT" });
    }

    // Renaming the round keeps both bookings.
    const drive = await load();
    await saveDrive(c.slug, { ...draft, id: drive.id, rounds: [roundIn([hall.id, room.id], first.id, "Coding round")] });
    expect((await load()).rounds[0].venues.map((v) => v.bookingId).sort()).toEqual(first.venues.map((v) => v.bookingId).sort());

    // Dropping the classroom withdraws its booking; the hall now seats everyone.
    await saveDrive(c.slug, { ...draft, id: drive.id, rounds: [roundIn([hall.id], first.id)] });
    const dropped = first.venues.find((v) => v.roomId === room.id)!;
    expect((await prisma.venueBooking.findUniqueOrThrow({ where: { id: dropped.bookingId! } })).status).toBe("CANCELLED");
    expect((await load()).rounds[0].venues).toEqual([expect.objectContaining({ roomId: hall.id, seats: 3 })]);

    // Deleting the drive withdraws what is left.
    const left = (await load()).rounds[0].venues[0].bookingId!;
    expect((await deleteDrive(c.slug, drive.id)).ok).toBe(true);
    expect((await prisma.venueBooking.findUniqueOrThrow({ where: { id: left } })).status).toBe("CANCELLED");
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
