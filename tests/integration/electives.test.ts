import { beforeAll, describe, expect, it } from "vitest";
import { applyCounts, chooseElective, saveWindow, withdrawChoice } from "@/app/[inst]/electives/actions";
import { todayIso, addDays } from "@/lib/calendar";
import { prisma } from "@/lib/db";
import { as, makeCollege, member, runAs, type College } from "./helpers";

let c: College;
let basketId: string;
let oe: Record<string, string>;
const students: Awaited<ReturnType<typeof member>>[] = [];

beforeAll(async () => {
  c = await makeCollege("ele");
  basketId = c.id("bk-oe3");
  const subj = (id: string) => c.input.subjects.find((s) => s.id === id)!.code;
  oe = Object.fromEntries(c.input.offerings.filter((o) => o.basketId === basketId).map((o) => [subj(o.subjectId), o.id]));
  for (let i = 0; i < 4; i++) students.push(await member(c, "STUDENT", { sectionId: c.id(i % 2 ? "s-ece3a" : "s-cse3a") }, `s${i}`));
});

describe("elective registration", () => {
  it("only admins (or a single-department HOD) open registration", async () => {
    await member(c, "HOD", { departmentId: c.id("d-cse") });
    const window = { basketId, opensOn: todayIso(), closesOn: addDays(todayIso(), 5), seats: { [oe.OE301]: 1, [oe.OE303]: 1 } };
    expect(await saveWindow(c.slug, window)).toMatchObject({ ok: false, error: expect.stringContaining("Only the Institute Admin") });
    await member(c, "INSTITUTE_ADMIN");
    expect(await saveWindow(c.slug, { ...window, closesOn: addDays(todayIso(), -1) })).toMatchObject({ ok: false });
    expect(await saveWindow(c.slug, window)).toEqual({ ok: true, message: "Saved." });
  });

  it("checks section, seats and switching", async () => {
    await member(c, "STUDENT", { sectionId: c.id("s-cse2a") }, "second-year");
    expect(await chooseElective(c.slug, basketId, oe.OE301)).toEqual({ ok: false, error: "This basket isn't offered to your section." });
    as(students[0]);
    expect(await chooseElective(c.slug, basketId, oe.OE301)).toEqual({ ok: true });
    as(students[1]);
    expect(await chooseElective(c.slug, basketId, oe.OE301)).toMatchObject({ ok: false, error: expect.stringContaining("is full (1 seats)") });
    // Switching away frees the seat.
    as(students[0]);
    expect(await chooseElective(c.slug, basketId, oe.OE302)).toEqual({ ok: true });
    as(students[1]);
    expect(await chooseElective(c.slug, basketId, oe.OE301)).toEqual({ ok: true });
    expect(await prisma.electiveChoice.count({ where: { basketId } })).toBe(2);
  });

  it("gives the last seat to only one of two students", async () => {
    const choose = (i: number) => runAs(students[i], () => chooseElective(c.slug, basketId, oe.OE303));
    const results = await Promise.all([choose(2), choose(3)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const rows = await prisma.electiveChoice.findMany({ where: { basketId, offeringId: oe.OE303 } });
    expect(rows).toHaveLength(1);
    expect([students[2].id, students[3].id]).toContain(rows[0].studentId);
  });

  it("turns the counts into class sizes", async () => {
    as(students[3]);
    await withdrawChoice(c.slug, basketId);
    await chooseElective(c.slug, basketId, oe.OE302);
    await member(c, "INSTITUTE_ADMIN");
    const res = await applyCounts(c.slug, basketId, "registered");
    expect(res.ok).toBe(true);
    const sizes = Object.fromEntries((await prisma.offering.findMany({ where: { basketId } })).map((o) => [o.id, o.expectedSize]));
    const counts = Object.fromEntries((await prisma.electiveChoice.groupBy({ by: ["offeringId"], where: { basketId }, _count: true })).map((g) => [g.offeringId, g._count]));
    for (const id of Object.values(oe)) expect(sizes[id]).toBe(Math.max(1, counts[id] ?? 0));
  });
});
