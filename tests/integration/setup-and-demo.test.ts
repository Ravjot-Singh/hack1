import { beforeAll, describe, expect, it } from "vitest";
import { saveRules } from "@/app/[inst]/setup/actions";
import { requestBooking } from "@/app/[inst]/venues/actions";
import { demoCollege } from "@/lib/demo/demo-college";
import { prisma } from "@/lib/db";
import { createInstitute } from "@/lib/institute";
import type { RuleSettings } from "@/lib/solver/types";
import { makeCollege, member, type College } from "./helpers";

let c: College;

beforeAll(async () => {
  c = await makeCollege("set");
});

describe("setup", () => {
  it("saves plain-English rules with the other rules, admins only", async () => {
    const rules: RuleSettings = {
      ...c.input.rules,
      custom: [
        { id: "r1", text: "No labs on Saturday", summary: "Labs: never on Sat", strength: "hard", target: { teacherIds: [], sectionIds: [], years: [], kinds: ["P"], subjectIds: [] }, slots: [[5, 0]] },
      ],
    };
    await member(c, "HOD", { departmentId: c.id("d-cse") });
    expect(await saveRules(c.slug, rules)).toEqual({ ok: false, error: "Your role doesn't allow this." });
    await member(c, "INSTITUTE_ADMIN");
    expect(await saveRules(c.slug, rules)).toEqual({ ok: true });
    const saved = (await prisma.institution.findUniqueOrThrow({ where: { id: c.institutionId } })).rules as unknown as RuleSettings;
    expect(saved.custom?.[0]).toMatchObject({ text: "No labs on Saturday", strength: "hard" });
    expect(await saveRules(c.slug, { ...rules, maxConsecutiveSection: 99 })).toMatchObject({ ok: false });
  });
});

describe("the shared demo", () => {
  it("is read-only even for its own members", async () => {
    let demo = await prisma.institution.findUnique({ where: { slug: "demo" } });
    if (!demo) demo = await prisma.institution.findUniqueOrThrow({ where: { id: await createInstitute(demoCollege("demo-"), "demo", true) } });
    const fake = { ...c, slug: "demo", institutionId: demo.id };
    await member(fake, "INSTITUTE_ADMIN");
    expect(await saveRules("demo", c.input.rules)).toMatchObject({ ok: false, error: expect.stringContaining("read-only") });
    expect(await requestBooking("demo", { date: "2030-01-07", roomId: "x", start: 0, end: 0, title: "x", attendees: 1, priority: "CLUB", override: false })).toEqual({
      ok: false,
      error: "The shared demo is read-only.",
    });
    await prisma.membership.deleteMany({ where: { institutionId: demo.id, user: { email: { endsWith: "@it.test" } } } });
  });
});
