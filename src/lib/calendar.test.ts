import { describe, expect, it } from "vitest";
import { addDays, resolveDay, weekdayOf, type CalendarInfo } from "./calendar";

const cal: CalendarInfo = {
  days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
  termStart: "2026-07-20",
  termEnd: "2026-11-30",
  specials: [
    { date: "2026-10-20", kind: "HOLIDAY", label: "Diwali", followsDay: null },
    { date: "2026-11-23", kind: "EXAM", label: "Mid-semester", followsDay: null },
    { date: "2026-10-24", kind: "FOLLOWS", label: "Compensatory day", followsDay: 1 },
  ],
};

describe("academic calendar", () => {
  it("maps ordinary dates to their weekday", () => {
    expect(weekdayOf("2026-10-26")).toBe("Mon");
    expect(resolveDay("2026-10-26", cal)).toEqual({ kind: "classes", dayIndex: 0, note: null });
  });
  it("has no classes on Sundays, holidays, exams or outside the term", () => {
    expect(resolveDay("2026-10-25", cal)).toMatchObject({ kind: "off", reason: "No classes on Sun" });
    expect(resolveDay("2026-10-20", cal)).toMatchObject({ kind: "off", reason: "Holiday: Diwali" });
    expect(resolveDay("2026-11-23", cal)).toMatchObject({ kind: "off" });
    expect(resolveDay("2026-07-01", cal)).toMatchObject({ kind: "off", reason: "Before the term starts" });
    expect(resolveDay("2026-12-01", cal)).toMatchObject({ kind: "off" });
  });
  it("runs another weekday's timetable on swapped days", () => {
    expect(resolveDay("2026-10-24", cal)).toMatchObject({ kind: "classes", dayIndex: 1 });
  });
  it("adds days across month ends", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-11-01", -1)).toBe("2026-10-31");
  });
});
