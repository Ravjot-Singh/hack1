import { describe, expect, it } from "vitest";
import { demoCollege } from "@/lib/demo/demo-college";
import { aiRuleSchema, cacheKey, contextPrompt, resolveAiRule, type AiRule } from "./ai-spec";
import { describe as summary, emptyTarget, halves, lunchPeriod, toCustomRule, type SlotDraft } from "./draft";

const ctx = demoCollege();
const ai = (r: Partial<AiRule>): AiRule => ({
  understood: true,
  problem: "",
  kind: "slots",
  strength: "hard",
  only: false,
  teachers: [],
  sections: [],
  years: [],
  lessonKinds: [],
  subjects: [],
  days: [],
  periods: [],
  limitWho: "none",
  limitMax: 0,
  ...r,
});

describe("rule drafts", () => {
  it("finds the lunch break and the two halves of the day", () => {
    expect(lunchPeriod(ctx)).toBe(4);
    expect(halves(ctx)).toEqual({ morning: [0, 1, 2, 3], afternoon: [5, 6, 7] });
    // Without a closed period, noon splits the day.
    const open = { ...ctx, grids: ctx.grids.map((g) => ({ ...g, open: g.open.map((d) => d.map(() => true)) })) };
    expect(lunchPeriod(open)).toBeNull();
    expect(halves(open).afternoon[0]).toBe(4); // 12:30
  });

  it("turns 'only' into every other slot", () => {
    const d: SlotDraft = { kind: "slots", strength: "hard", only: true, target: emptyTarget(), days: [0], periods: [0, 1] };
    const r = toCustomRule(d, "x", ctx, "id");
    expect(r.slots).toHaveLength(ctx.days.length * ctx.periods.length - 2);
    expect(r.slots).not.toContainEqual([0, 0]);
  });

  it("writes plain summaries with names and times", () => {
    const t = { ...emptyTarget(), kinds: ["P" as const], years: [2] };
    expect(summary({ kind: "slots", strength: "soft", only: false, target: t, days: [0, 1, 2, 3, 4], periods: [] }, ctx)).toBe("Labs for year 2: avoid on Mon–Fri");
    expect(summary({ kind: "limit", who: "teachers", max: 3 }, ctx)).toBe("At most 3 periods in a row for teachers");
    expect(summary({ kind: "slots", strength: "hard", only: true, target: emptyTarget(), days: [], periods: [0, 1] }, ctx)).toBe("All classes: only in P1, P2 (09:00–10:40)");
  });
});

describe("AI answers", () => {
  it("resolves names to ids", () => {
    const r = resolveAiRule(ai({ teachers: ["Dr. Rajesh Kumar"], sections: ["cse 2a"], subjects: ["CS201"], days: ["Tuesday"], periods: [1, 2], lessonKinds: ["lab"] }), ctx);
    expect(r.ok).toBe(true);
    if (r.ok && r.draft.kind === "slots") {
      expect(r.draft.target).toMatchObject({ teacherIds: ["t-rajesh"], sectionIds: ["s-cse2a"], kinds: ["P"] });
      expect(r.draft.days).toEqual([1]);
      expect(r.draft.periods).toEqual([0, 1]);
    }
  });

  it("refuses names, years and periods that aren't in the setup", () => {
    const r = resolveAiRule(ai({ teachers: ["Prof. Nobody"], years: [9], periods: [42], days: ["Mon"] }), ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/teacher "Prof\. Nobody".*year 9.*period 42/);
  });

  it("passes on the model's own refusal and checks limits", () => {
    expect(resolveAiRule(ai({ understood: false, problem: "Exceptions aren't supported." }), ctx)).toEqual({ ok: false, reason: "Exceptions aren't supported." });
    expect(resolveAiRule(ai({ kind: "limit", limitWho: "students", limitMax: 4 }), ctx)).toEqual({ ok: true, draft: { kind: "limit", who: "students", max: 4 } });
    expect(resolveAiRule(ai({ kind: "limit", limitWho: "none", limitMax: 4 }), ctx).ok).toBe(false);
    expect(resolveAiRule(ai({ days: [], periods: [] }), ctx).ok).toBe(false);
  });

  it("caches by normalised sentence and prompt version", () => {
    expect(cacheKey("  No LABS   on Monday ")).toBe(cacheKey("no labs on monday"));
    expect(cacheKey("x")).toMatch(/^v\d+:/);
  });

  it("gives the model the college's names and bell schedule, and a strict schema", () => {
    const p = contextPrompt(ctx);
    expect(p).toContain("Dr. Rajesh Kumar");
    expect(p).toContain("P1 09:00–09:50");
    expect(p).toContain("CS201 Data Structures");
    expect(aiRuleSchema.safeParse({ ...ai({}), extra: 1 }).success).toBe(false);
  });
});
