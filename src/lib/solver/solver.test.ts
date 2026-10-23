import { describe, expect, it } from "vitest";
import { demoCollege } from "@/lib/demo/demo-college";
import { mulberry32 } from "./engine";
import { precheck } from "./explain";
import { buildProblem } from "./lessons";
import { solve } from "./solve";
import type { InstituteInput } from "./types";
import { validate } from "./validate";

describe("lesson expansion", () => {
  const problem = buildProblem(demoCollege());

  it("expands L-T-P into lectures, tutorials and per-batch lab blocks", () => {
    const ds = problem.lessons.filter((l) => l.subjectCode === "CS201" && l.sectionIds[0] === "s-cse2a");
    expect(ds.filter((l) => l.kind === "L")).toHaveLength(3);
    const labs = ds.filter((l) => l.kind === "P");
    expect(labs).toHaveLength(2); // one 2-period block per batch
    expect(labs.every((l) => l.duration === 2 && l.atoms.length === 1 && l.roomType === "Computer Lab")).toBe(true);
  });

  it("uses a 3-period block for CAD", () => {
    const cad = problem.lessons.filter((l) => l.subjectCode === "ME203" && l.kind === "P");
    expect(cad.map((l) => l.duration)).toEqual([3, 3]);
  });

  it("groups basket electives into parallel units over all member sections", () => {
    const oe = problem.lessons.filter((l) => l.subjectCode.startsWith("OE"));
    expect(oe).toHaveLength(9);
    const units = new Set(oe.map((l) => l.unitId));
    expect(units.size).toBe(3);
    expect(oe[0].atoms).toHaveLength(6); // 3 sections x 2 batches
  });
});

describe("demo college", () => {
  const problem = buildProblem(demoCollege());

  it("passes the feasibility pre-checks", () => {
    expect(precheck(problem).filter((i) => i.severity === "error")).toEqual([]);
  });

  it("solves completely with zero hard violations", () => {
    const result = solve(problem, { seed: 42, constructMs: 20000, improveMs: 1500 });
    expect(result.unscheduled).toEqual([]);
    expect(result.violations).toEqual([]);
    // The validator must agree independently.
    expect(validate(problem, result.assignment).violations).toEqual([]);
    expect(result.score.quality).toBeGreaterThan(0);
  });
});

/** Random small college for property testing. */
function randomCollege(seed: number): InstituteInput {
  const rand = mulberry32(seed);
  const base = demoCollege(`r${seed}-`);
  const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
  // Randomly drop some offerings and reassign teachers within the department.
  const offerings = base.offerings
    .filter((o) => o.basketId || rand() > 0.25)
    .map((o) => {
      if (o.basketId) return o;
      const subj = base.subjects.find((s) => s.id === o.subjectId)!;
      const pool = base.teachers.filter((t) => t.deptId === subj.deptId);
      return rand() > 0.5 ? { ...o, teacherIds: [pick(pool).id], labTeacherIds: [] } : o;
    });
  return { ...base, offerings };
}

describe("property: any feasible random college gets a valid timetable", () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    it(`seed ${seed}`, () => {
      const problem = buildProblem(randomCollege(seed));
      const result = solve(problem, { seed, constructMs: 8000, improveMs: 300 });
      // Never any hard violation among placed lessons, complete or not.
      expect(validate(problem, result.assignment).violations).toEqual([]);
      // Anything left unscheduled must come with an explanation.
      for (const id of result.unscheduled) {
        const unit = problem.lessons.find((l) => l.id === id)!.unitId;
        const explained = Object.keys(result.explanations).some(
          (k) => problem.lessons.find((l) => l.id === k)!.unitId === unit,
        );
        expect(explained).toBe(true);
      }
    });
  }
});

describe("explaining failure", () => {
  it("reports an overloaded teacher and an impossible room before solving", () => {
    const input = demoCollege();
    input.teachers.find((t) => t.name === "Dr. Rajesh Kumar")!.maxPerWeek = 6;
    input.rooms = input.rooms.filter((r) => r.type !== "Electronics Lab");
    const issues = precheck(buildProblem(input)).map((i) => i.message);
    expect(issues.some((m) => m.includes("Dr. Rajesh Kumar is assigned 12 periods"))).toBe(true);
    expect(issues.some((m) => m.includes('needs a "Electronics Lab"'))).toBe(true);
  });

  it("explains lessons that cannot be placed", () => {
    const input = demoCollege();
    // Only one Physics Lab slot per day is open to 1st years -> labs cannot all fit.
    input.rooms.find((r) => r.type === "Physics Lab")!.capacity = 20;
    const problem = buildProblem(input);
    const result = solve(problem, { seed: 1, constructMs: 3000, improveMs: 100 });
    expect(result.unscheduled.length).toBeGreaterThan(0);
    const reasons = Object.values(result.explanations).flat().join(" ");
    expect(reasons).toMatch(/Physics Lab can hold 33 students/);
    expect(validate(problem, result.assignment).violations).toEqual([]);
  });
});
