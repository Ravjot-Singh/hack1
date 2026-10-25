import { describe, expect, it } from "vitest";
import { choiceProblem, countChoices, roomWarnings, sizesFromChoices, windowState } from "./electives";

const window = { opensOn: "2026-10-20", closesOn: "2026-10-30", seats: { ai: 2 } };
const base = {
  window,
  today: "2026-10-25",
  studentSectionId: "s1",
  basketSectionIds: ["s1", "s2"],
  offeringId: "ai",
  offeringIds: ["ai", "iot", "energy"],
  counts: {},
  current: null,
  label: (id: string) => id.toUpperCase(),
};

describe("elective registration", () => {
  it("opens and closes on the window dates", () => {
    expect(windowState(window, "2026-10-19")).toBe("upcoming");
    expect(windowState(window, "2026-10-20")).toBe("open");
    expect(windowState(window, "2026-10-30")).toBe("open");
    expect(windowState(window, "2026-10-31")).toBe("closed");
  });

  it("enforces window, section, basket and seats", () => {
    expect(choiceProblem(base)).toBeNull();
    expect(choiceProblem({ ...base, today: "2026-10-31" })).toContain("closed");
    expect(choiceProblem({ ...base, studentSectionId: "s9" })).toContain("isn't offered");
    expect(choiceProblem({ ...base, offeringId: "x" })).toContain("isn't in this basket");
    expect(choiceProblem({ ...base, counts: { ai: 2 } })).toBe("AI is full (2 seats).");
    expect(choiceProblem({ ...base, offeringId: "iot", counts: { iot: 500 } })).toBeNull(); // no limit
    expect(choiceProblem({ ...base, current: "ai" })).toContain("already");
    expect(choiceProblem({ ...base, window: null })).toContain("isn't set up");
  });

  it("counts choices", () => {
    expect(countChoices([{ offeringId: "ai" }, { offeringId: "ai" }, { offeringId: "iot" }])).toEqual({ ai: 2, iot: 1 });
  });

  it("turns counts into class sizes, scaled with an exact total", () => {
    const ids = ["ai", "iot", "energy"];
    expect(sizesFromChoices(ids, { ai: 30, iot: 10 }, "registered", 200)).toEqual({ ai: 30, iot: 10, energy: 1 });
    const scaled = sizesFromChoices(ids, { ai: 2, iot: 1 }, "scaled", 200);
    expect(scaled.ai + scaled.iot + (scaled.energy - 1)).toBe(200);
    expect(scaled.ai).toBe(133);
    expect(scaled.iot).toBe(67);
    // Seat limits cap scaling; the rest of the students go to the others.
    expect(sizesFromChoices(ids, { ai: 2, iot: 1, energy: 1 }, "scaled", 200, { ai: 60 })).toEqual({ ai: 60, iot: 70, energy: 70 });
    // Nothing registered: scaled falls back to the raw (minimum) sizes.
    expect(sizesFromChoices(ids, {}, "scaled", 200)).toEqual({ ai: 1, iot: 1, energy: 1 });
  });

  it("warns when an elective outgrows its rooms", () => {
    const rooms = [
      { type: "Classroom", capacity: 70, isEventVenue: false },
      { type: "Classroom", capacity: 200, isEventVenue: true },
    ];
    expect(roomWarnings({ ai: 90, iot: 40 }, [{ id: "ai", label: "OE301", roomType: "Classroom" }, { id: "iot", label: "OE302", roomType: "Classroom" }], rooms)).toEqual([
      "OE301: 90 students but the largest Classroom holds 70.",
    ]);
  });
});
