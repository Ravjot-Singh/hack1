import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { demoCollege } from "@/lib/demo/demo-college";
import { buildProblem, precheck, solve, validate } from "@/lib/solver";
import { construct } from "@/lib/solver/construct";
import { Engine } from "@/lib/solver/engine";
import { fromInstituteInput, lookupsOf, toInstituteInput, type SetupData } from "./convert";
import { mapRows, mergeRows, parseCsv, type Entity } from "./import";

// Real-world data: GNDEC Ludhiana's CSE and IT timetables, scraped from gndec.ac.in into
// data/gndec by scripts/gndec/build.ts. Big enough to catch problems the demo college can't.
function importGndec() {
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri"];
  const periods = Array.from({ length: 9 }, (_, i) => ({ start: `${String(8 + i).padStart(2, "0")}:30`, end: `${String(9 + i).padStart(2, "0")}:30` }));
  const base = fromInstituteInput(demoCollege());
  const data: SetupData = {
    ...base,
    settings: { ...base.settings, days, periods, passingMinutes: 0 },
    rules: { ...base.rules, maxConsecutiveSection: 5, maxConsecutiveTeacher: 4, travelTimeHard: false },
    grids: [{ id: "g", name: "Standard", open: days.map(() => periods.map(() => true)) }],
    departments: [], buildings: [], rooms: [], teachers: [], programs: [], sections: [], subjects: [], baskets: [], offerings: [], batches: {},
  };
  let seq = 0;
  const save = <T extends { id?: string }>(rows: T[]) => rows.map((r) => ({ ...r, id: r.id?.startsWith("new:") || !r.id ? `id${++seq}` : r.id }));
  const errors: string[] = [];
  for (const [entity, key] of [["departments", "departments"], ["buildings", "buildings"], ["rooms", "rooms"], ["teachers", "teachers"], ["programs", "programs"], ["sections", "sections"], ["subjects", "subjects"], ["allocation", "offerings"]] as [Entity, keyof SetupData][]) {
    const file = entity === "allocation" ? "allocation" : entity;
    const res = mapRows(entity, parseCsv(readFileSync(`data/gndec/${file}.csv`, "utf8").replace(/^﻿/, "")), lookupsOf(data));
    errors.push(...res.errors);
    if (res.baskets) data.baskets = save(res.baskets);
    (data as unknown as Record<string, unknown>)[key] = save(mergeRows(entity, [], res.rows as { id?: string }[], "merge"));
  }
  return { input: toInstituteInput(data), errors };
}

describe("GNDEC Ludhiana data", () => {
  const { input, errors } = importGndec();
  const problem = buildProblem(input);

  it("imports without errors and passes the readiness check", () => {
    expect(errors).toEqual([]);
    // Published CSE/IT classes plus the generated curriculum for every other section.
    expect(problem.lessons.length).toBeGreaterThan(2500);
    expect(precheck(problem).filter((i) => i.severity === "error")).toEqual([]);
  });

  it("construction never stops while a class still has a free legal slot", () => {
    // Regression: two units ejecting each other used to be chosen forever, leaving hundreds
    // of easy classes unplaced.
    const engine = new Engine(problem);
    construct(engine, { seed: 1 });
    const waiting = engine.uDur.map((_, u) => u).filter((u) => engine.unitStart[u] < 0 && engine.uStarts[u].some((s) => engine.tryPlace(u, s)));
    expect(waiting).toEqual([]);
  });

  it("solves with 0 violations and nearly everything placed, the rest explained", () => {
    const result = solve(problem, { seed: 2, constructMs: 30000, improveMs: 300 });
    expect(validate(problem, result.assignment).violations).toEqual([]);
    expect(result.unscheduled.length).toBeLessThan(problem.lessons.length * 0.03);
    for (const id of result.unscheduled) expect(result.explanations[id]?.length ?? 0).toBeGreaterThan(0);
  });
});
