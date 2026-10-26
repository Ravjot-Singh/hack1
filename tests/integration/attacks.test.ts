import { beforeAll, describe, expect, it } from "vitest";
import { createBlankInstitute, createDemoCopy } from "@/app/actions";
import { markAbsent } from "@/app/[inst]/absences/actions";
import { bookAppointment } from "@/app/[inst]/appointments/actions";
import { createShareLink } from "@/app/[inst]/timetables/actions";
import { requestBooking } from "@/app/[inst]/venues/actions";
import { acceptInvite } from "@/app/invite/[token]/actions";
import { prisma } from "@/lib/db";
import { getShared } from "@/lib/share";
import { classUse } from "@/lib/venues";
import { as, makeCollege, member, runAs, type College } from "./helpers";

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
