import { describe, expect, it } from "vitest";
import { demoCollege } from "@/lib/demo/demo-college";
import { describe as summary, toCustomRule, type SlotDraft } from "./draft";
import { parseRule } from "./parse";

const ctx = demoCollege();
const ok = (text: string) => {
  const r = parseRule(text, ctx);
  if (!r.ok) throw new Error(`${text}: ${r.reason}`);
  return r.draft;
};
const slots = (text: string) => {
  const d = ok(text);
  if (d.kind !== "slots") throw new Error("expected a slot rule");
  return d;
};

describe("built-in rule parser", () => {
  it("reads a teacher's unavailable day", () => {
    const d = slots("Dr. Rajesh Kumar is not available on Wednesdays");
    expect(d).toMatchObject({ strength: "hard", only: false, days: [2], periods: [] });
    expect(d.target.teacherIds).toEqual(["t-rajesh"]);
    expect(summary(d, ctx)).toBe("Classes taught by Dr. Rajesh Kumar: never on Wed");
  });

  it("matches a teacher by one unique word of their name", () => {
    expect(slots("Prof Iyer can't teach before 10am").target.teacherIds).toEqual(["t-meera"]);
    expect(slots("Prof Iyer can't teach before 10am").periods).toEqual([0]);
  });

  it("refuses an ambiguous name instead of guessing", () => {
    const r = parseRule("No classes for Kaur on Friday", ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("Simran Kaur");
  });

  it("reads kinds, day ranges and 'after lunch' as soft avoid", () => {
    const d = slots("Avoid labs on Mon-Wed after lunch");
    expect(d).toMatchObject({ strength: "soft", only: false, days: [0, 1, 2] });
    expect(d.target.kinds).toEqual(["P"]);
    expect(d.periods).toEqual([5, 6, 7]);
  });

  it("reads years and 'only' rules", () => {
    const d = slots("First years only have classes in the morning");
    expect(d).toMatchObject({ strength: "hard", only: true, periods: [0, 1, 2, 3] });
    expect(d.target.years).toEqual([1]);
    const rule = toCustomRule(d, "x", ctx, "r");
    // Only mornings = every non-morning slot is forbidden.
    expect(rule.slots).toContainEqual([0, 7]);
    expect(rule.slots).not.toContainEqual([0, 0]);
  });

  it("reads sections, subjects and period ranges", () => {
    const d = slots("No CS201 for CSE-2A in P1-P2 on Saturday");
    expect(d.target.subjectIds).toEqual([ctx.subjects.find((s) => s.code === "CS201")!.id]);
    expect(d.target.sectionIds).toEqual(["s-cse2a"]);
    expect(d).toMatchObject({ days: [5], periods: [0, 1] });
  });

  it("reads 'after period N' and clock times", () => {
    expect(slots("No classes after period 6 on Fridays").periods).toEqual([6, 7]);
    expect(slots("Keep Friday free after 3 pm for 2nd years").periods).toEqual([7]);
    expect(slots("No lectures between 12:30 and 14:10").periods).toEqual([4, 5]);
  });

  it("reads department codes as their sections, only when written in capitals", () => {
    const d = slots("No ECE labs on Saturday");
    expect(d.target.sectionIds.length).toBeGreaterThan(0);
    expect(d.target.sectionIds.every((id) => ctx.sections.find((s) => s.id === id)?.deptId === "d-ece")).toBe(true);
  });

  it("reads back-to-back limits", () => {
    expect(ok("Teachers shouldn't teach more than 3 periods back to back")).toEqual({ kind: "limit", who: "teachers", max: 3 });
    expect(ok("Max 4 classes in a row for students")).toEqual({ kind: "limit", who: "students", max: 4 });
  });

  it("gives up on words it doesn't know", () => {
    const r = parseRule("No labs on Monday except for the mechanical people", ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('"except"');
  });

  it("gives up without a time", () => {
    expect(parseRule("Dr. Rajesh Kumar should not teach", ctx).ok).toBe(false);
  });

  it("rejects days the college doesn't work", () => {
    const r = parseRule("No classes on Sunday", ctx);
    expect(r.ok).toBe(false);
  });

  it("builds summaries with times", () => {
    const d: SlotDraft = { ...slots("No classes for 2nd years on Friday after lunch") };
    expect(summary(d, ctx)).toBe("Classes for year 2: never on Fri in P6–P8 (13:20–15:50)");
  });
});
