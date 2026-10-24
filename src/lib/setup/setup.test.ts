import { describe, expect, it } from "vitest";
import { demoCollege } from "@/lib/demo/demo-college";
import { buildProblem, solve } from "@/lib/solver";
import { fromInstituteInput, lookupsOf, toInstituteInput, type SetupData } from "./convert";
import { exportTable, mapRows, mergeRows, parseCsv, toCsv, type Entity } from "./import";
import { designationLimits, splitBatches } from "./schemas";
import { formatSlots, parseSlots } from "./slots";

const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

describe("slot specs", () => {
  it("parses days, single periods and ranges", () => {
    expect(parseSlots("Sat", days, 8).slots).toHaveLength(8);
    expect(parseSlots("fri P5-P8; Mon p1", days, 8).slots).toEqual([[4, 4], [4, 5], [4, 6], [4, 7], [0, 0]]);
    expect(parseSlots("Funday", days, 8).error).toMatch(/not like/);
    expect(parseSlots("Mon P9", days, 8).error).toMatch(/between P1 and P8/);
  });
  it("round-trips through the text format", () => {
    const slots = parseSlots("Mon P1-P3; Fri P8; Sat", days, 8).slots;
    expect(formatSlots(slots, days, 8)).toBe("Mon P1-P3; Fri P8; Sat");
  });
});

describe("helpers", () => {
  it("splits batches evenly", () => {
    expect(splitBatches(65, 2)).toEqual([{ name: "G1", size: 33 }, { name: "G2", size: 32 }]);
    expect(splitBatches(60, 0)).toEqual([]);
  });
  it("derives load limits from designation", () => {
    expect(designationLimits("Professor")).toEqual([4, 14]);
    expect(designationLimits("Associate Professor")).toEqual([4, 16]);
    expect(designationLimits("Asst. Prof.")).toEqual([5, 18]);
    expect(designationLimits("Guest Faculty")).toEqual([3, 8]);
  });
});

describe("mapping imported tables", () => {
  const data = fromInstituteInput(demoCollege());
  const lk = lookupsOf(data);

  it("accepts header aliases in any case and order", () => {
    const res = mapRows("rooms", parseCsv("Seats,Room No,Room Type,Block\n40,X-1,Classroom,Main Block"), lk);
    expect(res.errors).toEqual([]);
    expect(res.rows[0]).toMatchObject({ name: "X-1", capacity: 40, type: "Classroom", buildingId: "b-main", ownerDeptId: null });
  });

  it("reports missing columns and unknown names with spreadsheet row numbers", () => {
    expect(mapRows("rooms", [["name", "capacity"]], lk).errors[0]).toMatch(/Missing column: type/);
    const res = mapRows("teachers", parseCsv("name,department,designation\nA,CS,Professor\nB,CSE,Professor"), lk);
    expect(res.errors[0]).toMatch(/^Row 2: department "CS" not found \(known: AS, CSE, ECE, ME\)/);
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0]).toMatchObject({ name: "B", maxPerDay: 4, maxPerWeek: 14 });
  });

  it("matches teachers with or without their title", () => {
    const res = mapRows("allocation", parseCsv("section,subject_code,teachers\nCSE-2A,CS201,Anita Desai"), lk);
    expect(res.errors).toEqual([]);
    expect(res.rows[0].teacherIds).toEqual(["t-anita"]);
  });

  it("creates elective baskets from the basket column", () => {
    const csv = "section,subject_code,teachers,basket\nCSE-3A; ECE-3A,OE301,Priya Nair,New Elective\nME-3A,OE302,Ananya Ghosh,New Elective";
    const res = mapRows("allocation", parseCsv(csv), lk);
    expect(res.baskets).toHaveLength(1);
    expect(res.baskets![0].sectionIds).toHaveLength(3);
    expect(res.rows.every((r) => r.basketId === res.baskets![0].id && (r.sectionIds as string[]).length === 3)).toBe(true);
  });

  it("re-importing updates matching rows instead of duplicating them", () => {
    const imported: { id?: string; name: string; code: string }[] = [
      { name: "Applied Sciences", code: "AS" },
      { name: "Civil Engineering", code: "CE" },
    ];
    const merged = mergeRows("departments", data.departments, imported, "merge");
    expect(merged).toHaveLength(5);
    expect(merged.find((d) => d.code === "AS")!.id).toBe("d-as");
    expect(mergeRows("departments", data.departments, imported, "replace")).toHaveLength(2);
  });
});

describe("round trip: demo -> CSV files -> empty institute -> timetable", () => {
  it("imports every sample file and solves with zero violations", () => {
    const demo = fromInstituteInput(demoCollege());
    const target: SetupData = {
      ...demo,
      departments: [], buildings: [], rooms: [], teachers: [], programs: [],
      sections: [], subjects: [], baskets: [], offerings: [], batches: {},
    };
    let seq = 0;
    // Mimic the server: "new:" ids become real ids on save.
    const save = <T extends { id?: string }>(rows: T[]) => rows.map((r) => ({ ...r, id: r.id?.startsWith("new:") || !r.id ? `id${++seq}` : r.id }));
    const order: [Entity, keyof SetupData][] = [
      ["departments", "departments"], ["buildings", "buildings"], ["rooms", "rooms"], ["teachers", "teachers"],
      ["programs", "programs"], ["sections", "sections"], ["subjects", "subjects"], ["allocation", "offerings"],
    ];
    for (const [entity, key] of order) {
      const csv = toCsv(exportTable(entity, demo, lookupsOf(demo)));
      const res = mapRows(entity, parseCsv(csv), lookupsOf(target));
      expect(res.errors, entity).toEqual([]);
      if (res.baskets) target.baskets = save(res.baskets);
      const rows = mergeRows(entity, [], res.rows as { id?: string }[], "merge");
      (target as unknown as Record<string, unknown>)[key] = save(rows);
    }

    const input = toInstituteInput(target);
    const problem = buildProblem(input);
    expect(problem.lessons).toHaveLength(buildProblem(demoCollege()).lessons.length);
    const result = solve(problem, { seed: 3, improveMs: 200 });
    expect(result.unscheduled).toEqual([]);
    expect(result.violations).toEqual([]);
  });
});

describe("new college bell schedule", () => {
  it("builds periods with a short break and keeps lunch as a closed period", async () => {
    const { buildPeriods, defaultGrid } = await import("./bell");
    const periods = buildPeriods({ start: "09:00", periodMinutes: 50, periods: 8, breakAfter: 2, breakMinutes: 10, lunchPeriod: 5 });
    expect(periods[0]).toEqual({ start: "09:00", end: "09:50" });
    expect(periods[2]).toEqual({ start: "10:50", end: "11:40" });
    expect(periods[7]).toEqual({ start: "15:00", end: "15:50" });
    const grid = defaultGrid(["Mon", "Sat"], 8, 5, true);
    expect(grid[0].filter(Boolean)).toHaveLength(7);
    expect(grid[0][4]).toBe(false);
    expect(grid[1]).toEqual([true, true, true, true, false, false, false, false]);
  });
});

describe("suggest allocation", () => {
  it("fills every missing teacher within load limits, and the result solves cleanly", async () => {
    const { suggestTeachers } = await import("./suggest");
    const { precheck } = await import("@/lib/solver");
    const data = fromInstituteInput(demoCollege());
    // Forget who teaches what, except one existing CS201 teacher.
    data.offerings = data.offerings.map((o) =>
      o.id === "o-27" ? o : { ...o, teacherIds: [], labTeacherIds: [] },
    );
    const suggestions = suggestTeachers(data);
    expect(suggestions.length).toBe(data.offerings.length - 1);
    expect(suggestions.every((s) => s.teacherId && s.loadAfter <= s.maxPerWeek)).toBe(true);
    // The other CS201 section goes to the teacher who already teaches CS201.
    const cs201 = data.offerings.find((o) => o.subjectId === "sub-cs201" && o.id !== "o-27")!;
    const kept = data.offerings.find((o) => o.id === "o-27")!.teacherIds![0];
    expect(suggestions.find((s) => s.offeringId === cs201.id)?.teacherId).toBe(kept);

    const applied = {
      ...data,
      offerings: data.offerings.map((o) => {
        const s = suggestions.find((x) => x.offeringId === o.id);
        return s ? { ...o, teacherIds: [s.teacherId!] } : o;
      }),
    };
    const problem = buildProblem(toInstituteInput(applied));
    expect(precheck(problem).filter((i) => i.severity === "error")).toEqual([]);
    const result = solve(problem, { seed: 2, improveMs: 200 });
    expect(result.unscheduled).toEqual([]);
    expect(result.violations).toEqual([]);
  });

  it("never gives one teacher two electives of the same basket", async () => {
    const { suggestTeachers } = await import("./suggest");
    const data = fromInstituteInput(demoCollege());
    data.offerings = data.offerings.map((o) => (o.basketId ? { ...o, teacherIds: [], labTeacherIds: [] } : o));
    const picks = suggestTeachers(data).map((s) => s.teacherId);
    expect(new Set(picks).size).toBe(picks.length);
  });
});
