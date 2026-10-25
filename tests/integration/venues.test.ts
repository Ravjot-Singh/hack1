import { beforeAll, describe, expect, it } from "vitest";
import { cancelBooking, decideBooking, requestBooking } from "@/app/[inst]/venues/actions";
import { prisma } from "@/lib/db";
import { classUse } from "@/lib/venues";
import { as, makeCollege, member, nextWeekday, notificationsFor, type College } from "./helpers";

let a: College;
let b: College;
const monday = nextWeekday(0, 2);

/** First period with no class in the room on Monday. */
const freePeriod = (c: College, roomId: string) => {
  const use = classUse(c.problem, c.assignment, 0);
  return [...Array(c.input.periods.length).keys()].find((p) => !use.get(roomId)?.has(p) && c.input.grids[1].open[0][p])!;
};

beforeAll(async () => {
  a = await makeCollege("ven");
  b = await makeCollege("venb");
});

describe("venue booking", () => {
  it("files a request, routes it to the approver and refuses roles that can't book", async () => {
    const admin = await member(a, "INSTITUTE_ADMIN");
    const teacher = await member(a, "TEACHER", { teacherId: a.id("t-anita") });
    const hall = a.input.rooms.find((r) => r.isEventVenue)!;
    const res = await requestBooking(a.slug, { date: monday, roomId: hall.id, start: 0, end: 1, title: "Coding club meet", attendees: 80, priority: "CLUB", override: false });
    expect(res).toMatchObject({ ok: true });
    const row = await prisma.venueBooking.findFirstOrThrow({ where: { title: "Coding club meet" } });
    expect(row.status).toBe("PENDING");
    expect(row.requestedBy).toBe(teacher.id);
    // No Venue Manager in this college, so the admin is notified.
    expect(await notificationsFor(admin.id)).toEqual([expect.stringContaining("New room request: Seminar Hall")]);

    await member(a, "STUDENT", { sectionId: a.id("s-cse2a") });
    expect(await requestBooking(a.slug, { date: monday, roomId: hall.id, start: 3, end: 3, title: "Party", attendees: 10, priority: "CLUB", override: false })).toEqual({
      ok: false,
      error: "Your role can't book rooms.",
    });
    as(teacher);
    expect((await requestBooking(a.slug, { date: monday, roomId: hall.id, start: 3, end: 3, title: "Big event", attendees: 10, priority: "INSTITUTE", override: false })).ok).toBe(false);
  });

  it("refuses a room's class time, its capacity and dates in the past", async () => {
    await member(a, "TEACHER", { teacherId: a.id("t-priya") });
    const [lessonId, at] = Object.entries(a.assignment).find(([, x]) => x.day === 0)!;
    const room = a.input.rooms.find((r) => r.id === at.roomId)!;
    const res = await requestBooking(a.slug, { date: monday, roomId: room.id, start: at.period, end: at.period, title: "Clash", attendees: 5, priority: "CLUB", override: false });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain(a.problem.lessons.find((l) => l.id === lessonId)!.label);
    const p = freePeriod(a, room.id);
    const big = await requestBooking(a.slug, { date: monday, roomId: room.id, start: p, end: p, title: "Too many", attendees: room.capacity + 1, priority: "CLUB", override: false });
    expect(big).toMatchObject({ ok: false, error: expect.stringContaining(`holds ${room.capacity}`) });
    expect(await requestBooking(a.slug, { date: "2020-01-06", roomId: room.id, start: p, end: p, title: "Old", attendees: 5, priority: "CLUB", override: false })).toEqual({ ok: false, error: "That date has passed." });
  });

  it("resolves overlaps by priority and offers the loser free rooms", async () => {
    const lab = a.input.rooms.find((r) => r.type === "Computer Lab" && r.ownerDeptId === a.id("d-cse"))!;
    const p = freePeriod(a, lab.id);
    const teacher = await member(a, "TEACHER", { teacherId: a.id("t-rohit") });
    await requestBooking(a.slug, { date: monday, roomId: lab.id, start: p, end: p, title: "Club coding", attendees: 20, priority: "CLUB", override: false });
    await member(a, "PLACEMENT_OFFICER");
    await requestBooking(a.slug, { date: monday, roomId: lab.id, start: p, end: p, title: "Online test", attendees: 30, priority: "PLACEMENT", override: false });
    const club = await prisma.venueBooking.findFirstOrThrow({ where: { title: "Club coding" } });
    const drive = await prisma.venueBooking.findFirstOrThrow({ where: { title: "Online test" } });

    // An HOD of another department can't decide; the owner HOD must take the higher priority first.
    await member(a, "HOD", { departmentId: a.id("d-ece") });
    expect(await decideBooking(a.slug, drive.id, true, "")).toEqual({ ok: false, error: "You don't decide requests for this room." });
    await member(a, "HOD", { departmentId: a.id("d-cse") }, "hodcse");
    expect(await decideBooking(a.slug, club.id, true, "")).toMatchObject({ ok: false, error: expect.stringContaining("higher-priority") });
    expect(await decideBooking(a.slug, drive.id, true, "")).toEqual({ ok: true });

    expect((await prisma.venueBooking.findUniqueOrThrow({ where: { id: drive.id } })).status).toBe("APPROVED");
    const lost = await prisma.venueBooking.findUniqueOrThrow({ where: { id: club.id } });
    expect(lost.status).toBe("REJECTED");
    expect(lost.note).toContain("Online test");
    expect((await notificationsFor(teacher.id)).at(-1)).toMatch(/declined.*Free instead: /);

    // The requester can cancel their own booking; a stranger can't.
    as(teacher);
    expect((await cancelBooking(a.slug, drive.id)).ok).toBe(false);
  });

  it("keeps colleges apart", async () => {
    await member(b, "INSTITUTE_ADMIN");
    const roomOfA = a.input.rooms.find((r) => r.isEventVenue)!;
    expect(await requestBooking(b.slug, { date: monday, roomId: roomOfA.id, start: 6, end: 6, title: "Sneaky", attendees: 5, priority: "INSTITUTE", override: false })).toEqual({
      ok: false,
      error: "That room no longer exists.",
    });
    const bookingOfA = await prisma.venueBooking.findFirstOrThrow({ where: { institutionId: a.institutionId } });
    expect(await decideBooking(b.slug, bookingOfA.id, true, "")).toEqual({ ok: false, error: "That request no longer exists." });
    expect(await cancelBooking(b.slug, bookingOfA.id)).toEqual({ ok: false, error: "That booking no longer exists." });
  });

  it("refuses everyone when signed out", async () => {
    as(null);
    expect(await requestBooking(a.slug, { date: monday, roomId: "x", start: 0, end: 0, title: "x", attendees: 1, priority: "CLUB", override: false })).toEqual({
      ok: false,
      error: "Please sign in as a member of this college.",
    });
  });
});
