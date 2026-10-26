import { describe, expect, it } from "vitest";
import { demoCollege } from "@/lib/demo/demo-college";
import { classesHit, countsFromRolls, parseRolls, sectionImpact, splitSeats } from "./placements";
import { buildProblem } from "./solver/lessons";
import { solve } from "./solver/solve";

const input = demoCollege();
const problem = buildProblem(input);
const { assignment } = solve(problem, { seed: 9, constructMs: 20000, improveMs: 200 });

describe("seating a round across several rooms", () => {
  const rooms = [
    { id: "hall", capacity: 200 },
    { id: "lab1", capacity: 60 },
    { id: "lab2", capacity: 40 },
  ];

  it("spreads students by capacity and seats everyone", () => {
    const { seats, short } = splitSeats(150, rooms);
    expect(short).toBe(0);
    expect(seats.reduce((n, s) => n + s.seats, 0)).toBe(150);
    expect(seats.map((s) => s.seats)).toEqual([100, 30, 20]);
    seats.forEach((s, i) => expect(s.seats).toBeLessThanOrEqual(rooms[i].capacity));
  });

  it("hands out the remainder without overfilling a room", () => {
    const { seats } = splitSeats(7, [{ id: "a", capacity: 3 }, { id: "b", capacity: 3 }, { id: "c", capacity: 3 }]);
    expect(seats.map((s) => s.seats).sort()).toEqual([2, 2, 3]);
  });

  it("fills every room and reports who doesn't fit", () => {
    expect(splitSeats(350, rooms)).toEqual({ seats: [{ roomId: "hall", seats: 200 }, { roomId: "lab1", seats: 60 }, { roomId: "lab2", seats: 40 }], short: 50 });
    expect(splitSeats(10, [])).toEqual({ seats: [], short: 10 });
  });
});

describe("placement drives", () => {
  it("parses roll lists and counts per section", () => {
    const { rows, errors } = parseRolls("Roll No,Section\n2215001, CSE-2A\n2215002\tcse 2a\n2215001,CSE-2A\n2215003;CSE-2B\n9;XYZ\nbad line", input.sections);
    expect(rows).toHaveLength(3);
    expect(errors).toEqual(['Line 6: no section called "XYZ".', 'Line 7: expected "roll number, section".']);
    expect(countsFromRolls(rows)).toEqual([
      { sectionId: "s-cse2a", count: 2 },
      { sectionId: "s-cse2b", count: 1 },
    ]);
  });

  it("finds classes that lose students, with batch shares", () => {
    const sec = input.sections.find((s) => s.id === "s-cse2a")!;
    const attending = [{ sectionId: sec.id, count: 32 }];
    const hits = classesHit(problem, assignment, 0, 0, input.periods.length - 1, attending);
    const mine = problem.lessons.filter((l) => l.sectionIds.includes(sec.id) && assignment[l.id].day === 0);
    expect(hits.map((h) => h.lessonId).sort()).toEqual(mine.map((l) => l.id).sort());
    for (const h of hits) {
      const l = problem.lessons.find((x) => x.id === h.lessonId)!;
      expect(h.away).toBe(l.batchId ? 16 : 32); // two equal batches
      expect(h.away).toBeLessThanOrEqual(h.size);
    }
    // A narrower window only catches overlapping classes; cancelled classes don't count.
    const first = hits[0];
    const narrow = classesHit(problem, assignment, 0, first.period, first.period, attending, new Set([first.lessonId]));
    expect(narrow.some((h) => h.lessonId === first.lessonId)).toBe(false);
    const impact = sectionImpact(problem, attending, hits);
    expect(impact[0]).toMatchObject({ sectionId: sec.id, away: 32, size: sec.size, classes: hits.length });
  });
});
