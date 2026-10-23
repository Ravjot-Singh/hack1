"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getInstitution } from "@/lib/inst";
import { loadInstituteInput } from "@/lib/institute";
import { buildProblem, score, validate } from "@/lib/solver";
import type { Assignment } from "@/lib/solver";

export type SaveResult = { ok: true; versionId: string } | { ok: false; error: string };

/**
 * Save a timetable produced in the browser. The server never trusts the client: it reloads
 * the institute's data, rebuilds the problem and re-validates every hard rule first.
 */
export async function saveVersion(slug: string, assignment: Assignment, solveMs: number): Promise<SaveResult> {
  const inst = await getInstitution(slug);
  const input = await loadInstituteInput(inst.id);
  const problem = buildProblem(input);
  const known = new Set(problem.lessons.map((l) => l.id));
  const clean: Assignment = {};
  for (const [id, a] of Object.entries(assignment)) if (known.has(id)) clean[id] = a;

  const { violations, unscheduled } = validate(problem, clean);
  if (violations.length) {
    return { ok: false, error: `Not saved: ${violations.length} rule violation(s), e.g. ${violations[0].message} The data may have changed since solving; generate again.` };
  }
  const breakdown = score(problem, clean);
  const count = await prisma.timetableVersion.count({ where: { institutionId: inst.id } });
  const version = await prisma.timetableVersion.create({
    data: {
      institutionId: inst.id,
      name: `Draft ${count + 1}`,
      quality: breakdown.quality,
      stats: { ...breakdown, unscheduled: unscheduled.length, lessons: problem.lessons.length, solveMs },
      snapshot: input as object,
      placements: {
        createMany: {
          data: Object.entries(clean).map(([lessonId, a]) => ({ lessonId, day: a.day, period: a.period, roomId: a.roomId })),
        },
      },
    },
  });
  revalidatePath(`/${slug}`, "layout");
  return { ok: true, versionId: version.id };
}
