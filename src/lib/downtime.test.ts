import { describe, expect, it } from "vitest";
import { demoCollege } from "@/lib/demo/demo-college";
import { canManageRoom, clashes, downMap, labTypes, replacementRooms, type Downtime } from "./downtime";
import type { Member } from "./permissions";
import { buildProblem } from "./solver/lessons";
import { solve } from "./solver/solve";
import { classUse } from "./venues";

const input = demoCollege();
const problem = buildProblem(input);
const { assignment } = solve(problem, { seed: 11, constructMs: 20000, improveMs: 200 });
const P = input.periods.length;
const member = (m: Partial<Member>): Member => ({ role: "LAB_ASSISTANT", departmentId: null, teacherId: null, sectionId: null, ...m });

describe("lab downtime", () => {
  it("maps downtime ranges onto a date", () => {
    const d: Downtime[] = [
      { id: "a", roomId: "r1", from: "2026-10-26", to: "2026-10-28", periods: [], reason: "Rewiring" },
      { id: "b", roomId: "r2", from: "2026-10-27", to: "2026-10-27", periods: [2, 3], reason: "Projector" },
    ];
    expect(downMap(d, "2026-10-25", P).size).toBe(0);
    expect(downMap(d, "2026-10-26", P).get("r1")?.size).toBe(P);
    expect([...(downMap(d, "2026-10-27", P).get("r2")?.keys() ?? [])]).toEqual([2, 3]);
  });

  it("scopes lab assistants to their department's labs", () => {
    const labs = labTypes(input.subjects);
    expect(labs.has("Computer Lab")).toBe(true);
    expect(labs.has("Classroom")).toBe(false);
    const csLab = input.rooms.find((r) => r.type === "Computer Lab" && r.ownerDeptId)!;
    const classroom = input.rooms.find((r) => r.type === "Classroom")!;
    expect(canManageRoom(member({ departmentId: csLab.ownerDeptId }), csLab, labs)).toBe(true);
    expect(canManageRoom(member({ departmentId: "other" }), csLab, labs)).toBe(false);
    expect(canManageRoom(member({ departmentId: classroom.ownerDeptId }), classroom, labs)).toBe(false);
    expect(canManageRoom(member({ role: "VENUE_MANAGER" }), classroom, labs)).toBe(true);
    expect(canManageRoom(member({ role: "TEACHER" }), csLab, labs)).toBe(false);
  });

  it("finds classes hit by downtime and free replacement rooms", () => {
    const lab = problem.lessons.find((l) => l.kind === "P" && assignment[l.id])!;
    const a = assignment[lab.id];
    const down = new Map([[a.roomId, new Map([[a.period, "Server crash"]])]]);
    const hit = clashes(problem, assignment, a.day, down);
    expect(hit.map((c) => c.lessonId)).toContain(lab.id);
    expect(hit.find((c) => c.lessonId === lab.id)!.reason).toBe("Server crash");
    // Cancelled or moved classes are no longer a clash.
    expect(clashes(problem, assignment, a.day, down, { cancelled: new Set([lab.id]) }).some((c) => c.lessonId === lab.id)).toBe(false);
    const use = classUse(problem, assignment, a.day);
    const clash = hit.find((c) => c.lessonId === lab.id)!;
    const alts = replacementRooms(clash, input.rooms, (roomId, p) => !!use.get(roomId)?.has(p) || !!down.get(roomId)?.has(p));
    for (const r of alts) {
      expect(r.id).not.toBe(a.roomId);
      expect(r.capacity).toBeGreaterThanOrEqual(lab.size);
    }
    if (alts[0]) expect(clashes(problem, assignment, a.day, down, { moves: new Map([[lab.id, alts[0].id]]) }).some((c) => c.lessonId === lab.id)).toBe(false);
  });
});
