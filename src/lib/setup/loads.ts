import type { Problem } from "@/lib/solver/types";

export interface TeacherLoad {
  id: string;
  name: string;
  deptId: string;
  load: number;
  maxPerWeek: number;
}

/** Weekly periods per teacher, counting parallel basket lessons once (same as the pre-check). */
export function teacherLoads(problem: Problem): TeacherLoad[] {
  const load = new Map<string, number>();
  const seen = new Set<string>();
  for (const l of problem.lessons) {
    for (const t of l.teacherIds) {
      const key = `${t}|${l.unitId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      load.set(t, (load.get(t) ?? 0) + l.duration);
    }
  }
  return problem.input.teachers.map((t) => ({
    id: t.id,
    name: t.name,
    deptId: t.deptId,
    load: load.get(t.id) ?? 0,
    maxPerWeek: t.maxPerWeek,
  }));
}
