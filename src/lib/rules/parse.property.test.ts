import { describe, expect, it } from "vitest";
import { demoCollege } from "@/lib/demo/demo-college";
import { mulberry32 } from "@/lib/solver/engine";
import { describe as summary, toCustomRule } from "./draft";
import { parseRule } from "./parse";

// Fuzzing the built-in rule reader: it must never crash, and anything it accepts must be in range.
const ctx = demoCollege();
const D = ctx.days.length;
const P = ctx.periods.length;

const WORDS = [
  "no", "not", "never", "only", "avoid", "rather", "prefer", "should", "must", "classes", "labs", "lectures", "tutorials",
  "on", "in", "after", "before", "from", "to", "between", "and", "the", "for", "teachers", "students", "max", "3", "in a row",
  "monday", "tue", "wednesdays", "fri", "saturday", "sunday", "weekdays", "morning", "afternoon", "after lunch",
  "p1", "p3-p5", "period 7", "first period", "last two periods", "2pm", "10:30", "after 3 pm", "before 11",
  "2nd years", "final year", "CSE-2A", "FY-B", "ECE", "CS201", "Data Structures", "Dr. Rajesh Kumar", "Kumar", "Kaur", "Prof Iyer",
  "except", "!!", "?", "", "12", "99", "p0", "period 42", "13th period",
];

function check(text: string) {
  const r = parseRule(text, ctx);
  if (!r.ok) {
    expect(r.reason.length).toBeGreaterThan(0);
    return;
  }
  if (r.draft.kind === "limit") {
    expect(r.draft.max).toBeGreaterThanOrEqual(1);
    expect(r.draft.max).toBeLessThanOrEqual(12);
    return;
  }
  for (const d of r.draft.days) expect(d >= 0 && d < D).toBe(true);
  for (const p of r.draft.periods) expect(p >= 0 && p < P).toBe(true);
  const rule = toCustomRule(r.draft, text, ctx, "x");
  for (const [d, p] of rule.slots) expect(d >= 0 && d < D && p >= 0 && p < P).toBe(true);
  expect(summary(r.draft, ctx).length).toBeGreaterThan(0);
}

describe("rule parser fuzzing", () => {
  it("never crashes on random characters (500 inputs)", () => {
    const rand = mulberry32(1);
    const chars = "abcdefghijklmnopqrstuvwxyz ABCDEFGHIJ0123456789-:.,'!?()[]{}*+$^\\/|&%";
    for (let i = 0; i < 500; i++) {
      const s = Array.from({ length: Math.floor(rand() * 60) }, () => chars[Math.floor(rand() * chars.length)]).join("");
      expect(() => check(s)).not.toThrow();
    }
  });

  it("never crashes on random rule-like sentences, and accepted ones are in range (2000 inputs)", () => {
    const rand = mulberry32(2);
    let accepted = 0;
    for (let i = 0; i < 2000; i++) {
      const s = Array.from({ length: 2 + Math.floor(rand() * 8) }, () => WORDS[Math.floor(rand() * WORDS.length)]).join(" ");
      expect(() => check(s), s).not.toThrow();
      if (parseRule(s, ctx).ok) accepted++;
    }
    // Most word salads are refused (the reader doesn't guess), but some do parse.
    expect(accepted).toBeGreaterThan(0);
    expect(accepted).toBeLessThan(2000);
  });
});
