import { beforeAll, describe, expect, it } from "vitest";
import { addSpecialDays } from "@/app/[inst]/calendar/actions";
import { saveWindow } from "@/app/[inst]/electives/actions";
import { saveDrive } from "@/app/[inst]/placements/actions";
import { saveAllocation, saveGrids, saveRules, saveSettings } from "@/app/[inst]/setup/actions";
import { createShareLink, revokeShareLink, saveEdits } from "@/app/[inst]/timetables/actions";
import { requestBooking } from "@/app/[inst]/venues/actions";
import { addDays, todayIso } from "@/lib/calendar";
import { prisma } from "@/lib/db";
import type { RuleSettings } from "@/lib/solver/types";
import { as, makeCollege, member, nextWeekday, type College } from "./helpers";

// Low-severity findings from the break-it review (docs/SECURITY-TESTING.md), kept as tests.

let c: College;
let admin: Awaited<ReturnType<typeof member>>;

beforeAll(async () => {
  c = await makeCollege("low");
  admin = await member(c, "INSTITUTE_ADMIN");
});

describe("HOD scope", () => {
  it("won't let an HOD put their subject into an elective basket", async () => {
    await member(c, "HOD", { departmentId: c.id("d-cse") });
    const cse = new Set(c.input.subjects.filter((s) => s.deptId === c.id("d-cse")).map((s) => s.id));
    const own = c.input.offerings.filter((o) => cse.has(o.subjectId));
    const plain = own.find((o) => !o.basketId)!;
    const rows = own.map((o) => ({ ...o, splitLabBatches: !!o.splitLabBatches, expectedSize: o.expectedSize ?? null, basketId: o.id === plain.id ? c.id("bk-oe3") : o.basketId }));
    const res = await saveAllocation(c.slug, { baskets: [], offerings: rows });
    expect(res).toMatchObject({ ok: false });
    expect(JSON.stringify(res)).toContain("Only the Institute Admin");
  });

  it("won't let an HOD configure an elective basket that has no sections", async () => {
    const empty = await prisma.electiveBasket.create({ data: { institutionId: c.institutionId, name: "Empty basket" } });
    await member(c, "HOD", { departmentId: c.id("d-cse") });
    const res = await saveWindow(c.slug, { basketId: empty.id, opensOn: todayIso(), closesOn: addDays(todayIso(), 3), seats: {} });
    expect(res).toMatchObject({ ok: false });
  });
});

describe("share links", () => {
  it("can be revoked only by whoever made them, an admin or the Head of Institute", async () => {
    const version = await prisma.timetableVersion.findFirstOrThrow({ where: { institutionId: c.institutionId, status: "PUBLISHED" } });
    await member(c, "HOD", { departmentId: c.id("d-cse") }, "hod-maker");
    const made = await createShareLink(c.slug, version.id, "section", c.id("s-cse2a"), true);
    expect(made.ok).toBe(true);
    const token = (made as { token: string }).token;
    await member(c, "HOD", { departmentId: c.id("d-ece") }, "hod-other");
    expect(await revokeShareLink(c.slug, token)).toEqual({ ok: false });
    as(admin);
    expect(await revokeShareLink(c.slug, token)).toEqual({ ok: true });
  });
});

describe("hand edits", () => {
  it("are checked against today's setup, not only the draft's copy of it", async () => {
    const draft = await prisma.timetableVersion.create({
      data: {
        institutionId: c.institutionId,
        name: "Old draft",
        status: "DRAFT",
        quality: 0,
        stats: { unscheduled: 0 },
        snapshot: c.input as object,
        placements: { create: Object.entries(c.assignment).map(([lessonId, a]) => ({ lessonId, ...a })) },
      },
    });
    // Since the draft was made, Anita has become unavailable when she teaches.
    const lesson = c.problem.lessons.find((l) => l.teacherIds.includes(c.id("t-anita")))!;
    const { day, period } = c.assignment[lesson.id];
    const anita = await prisma.teacher.findUniqueOrThrow({ where: { id: c.id("t-anita") } });
    await prisma.teacher.update({ where: { id: anita.id }, data: { unavailable: [[day, period]] } });
    as(admin);
    const res = await saveEdits(c.slug, draft.id, c.assignment, []);
    await prisma.teacher.update({ where: { id: anita.id }, data: { unavailable: anita.unavailable ?? [] } });
    expect(res).toMatchObject({ ok: false, error: expect.stringContaining("current setup") });
  });
});

describe("placements and bookings", () => {
  const hall = () => c.input.rooms.find((r) => r.isEventVenue)!;
  const cse3a = () => c.input.sections.find((s) => s.id === c.id("s-cse3a"))!;
  const drive = (over: object) => ({ id: null, company: "Acme", role: "", notes: "", attending: [], rollsText: "", rounds: [], ...over });

  it("adds up a section listed twice before checking its size", async () => {
    await member(c, "PLACEMENT_OFFICER");
    const s = cse3a();
    const res = await saveDrive(c.slug, drive({ attending: [{ sectionId: s.id, count: s.size }, { sectionId: s.id, count: s.size }], rounds: [{ id: null, name: "Test", date: nextWeekday(1, 3), start: 0, end: 0, roomId: null }] }));
    expect(res).toMatchObject({ ok: false, error: expect.stringContaining(`only ${s.size}`) });
  });

  it("won't move an existing round into the past, or plan more than a year ahead", async () => {
    await member(c, "PLACEMENT_OFFICER");
    const s = cse3a();
    const first = await saveDrive(c.slug, drive({ attending: [{ sectionId: s.id, count: 10 }], rounds: [{ id: null, name: "Test", date: nextWeekday(1, 3), start: 0, end: 0, roomId: null }] }));
    expect(first.ok).toBe(true);
    const saved = await prisma.placementDrive.findUniqueOrThrow({ where: { id: (first as { id: string }).id }, include: { rounds: true } });
    const round = saved.rounds[0];
    const past = await saveDrive(c.slug, drive({ id: saved.id, attending: [{ sectionId: s.id, count: 10 }], rounds: [{ id: round.id, name: "Test", date: "2020-01-06", start: 0, end: 0, roomId: null }] }));
    expect(past).toMatchObject({ ok: false, error: expect.stringContaining("passed") });
    const far = await saveDrive(c.slug, drive({ id: saved.id, attending: [{ sectionId: s.id, count: 10 }], rounds: [{ id: round.id, name: "Test", date: addDays(todayIso(), 500), start: 0, end: 0, roomId: null }] }));
    expect(far).toMatchObject({ ok: false, error: expect.stringContaining("year") });
  });

  it("won't book a room more than a year ahead", async () => {
    await member(c, "VENUE_MANAGER");
    const res = await requestBooking(c.slug, { date: addDays(todayIso(), 500), roomId: hall().id, start: 0, end: 0, title: "Far away", attendees: 10, priority: "CLUB", override: false });
    expect(res).toMatchObject({ ok: false, error: expect.stringContaining("year") });
  });

  it("refuses a century-long holiday range at once", async () => {
    as(admin);
    const started = Date.now();
    const res = await addSpecialDays(c.slug, { date: "2000-01-01", until: "2100-12-31", kind: "HOLIDAY", label: "Forever", followsDay: null });
    expect(res).toMatchObject({ ok: false, error: expect.stringContaining("too long") });
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe("week shape", () => {
  it("stores every time grid as exactly days × periods", async () => {
    as(admin);
    const grids = await prisma.timeGrid.findMany({ where: { institutionId: c.institutionId } });
    const rows = grids.map((g, i) => ({ id: g.id, name: g.name, open: i === 0 ? [[true]] : (g.open as boolean[][]) }));
    expect(await saveGrids(c.slug, rows, grids.map((g) => g.id))).toEqual({ ok: true });
    const saved = await prisma.timeGrid.findUniqueOrThrow({ where: { id: grids[0].id } });
    const open = saved.open as boolean[][];
    expect(open).toHaveLength(c.input.days.length);
    expect(open.every((row) => row.length === c.input.periods.length)).toBe(true);
  });

  it("refuses periods that end before they start or overlap the one before", async () => {
    as(admin);
    const base = { name: c.input.name, days: c.input.days, passingMinutes: 5 };
    expect(await saveSettings(c.slug, { ...base, periods: [{ start: "10:00", end: "09:00" }] })).toMatchObject({ ok: false });
    expect(await saveSettings(c.slug, { ...base, periods: [{ start: "09:00", end: "10:00" }, { start: "09:30", end: "10:30" }] })).toMatchObject({ ok: false });
    expect(await saveSettings(c.slug, { ...base, periods: [{ start: "99:99", end: "10:00" }] })).toMatchObject({ ok: false });
  });

  it("drops custom-rule slots that fall outside a smaller week", async () => {
    as(admin);
    const lastDay = c.input.days.length - 1;
    const rule = { id: "r1", text: "No classes last day P1", summary: "x", strength: "hard" as const, target: { teacherIds: [], sectionIds: [], years: [], kinds: [], subjectIds: [] }, slots: [[0, 0], [lastDay, 0]] as [number, number][] };
    expect(await saveRules(c.slug, { ...c.input.rules, custom: [rule] })).toEqual({ ok: true });
    expect(await saveSettings(c.slug, { name: c.input.name, days: c.input.days.slice(0, -1), periods: c.input.periods, passingMinutes: 5 })).toEqual({ ok: true });
    const rules = (await prisma.institution.findUniqueOrThrow({ where: { id: c.institutionId } })).rules as unknown as RuleSettings;
    expect(rules.custom?.[0].slots).toEqual([[0, 0]]);
  });
});
