import { demoCollege } from "@/lib/demo/demo-college";
import { prisma } from "@/lib/db";
import { createInstitute } from "@/lib/institute";
import type { Role } from "@/lib/permissions";
import { buildProblem, solve } from "@/lib/solver";
import { runAs, signInAs } from "./session";

let n = 0;
/** Unique per run, so ids never collide with an earlier run's leftovers. */
const RUN = Date.now().toString(36).slice(-5);

/**
 * A full demo college with a published timetable. Ids are prefixed per college (as the app
 * does for demo copies), so several colleges can live side by side in one database.
 */
export async function makeCollege(tag: string) {
  const prefix = `${tag}${RUN}${++n}-`;
  const input = demoCollege(prefix);
  const slug = `it-${prefix.slice(0, -1)}`;
  const institutionId = await createInstitute(input, slug);
  const problem = buildProblem(input);
  const result = solve(problem, { seed: 7, constructMs: 20000, improveMs: 200 });
  if (result.violations.length || result.unscheduled.length) throw new Error("test college didn't solve cleanly");
  await prisma.timetableVersion.create({
    data: {
      institutionId,
      name: "Published",
      status: "PUBLISHED",
      publishedAt: new Date(),
      quality: result.score.quality,
      stats: {},
      snapshot: input as object,
      placements: { create: Object.entries(result.assignment).map(([lessonId, a]) => ({ lessonId, ...a })) },
    },
  });
  const id = (s: string) => `${prefix}${s}`;
  return { slug, institutionId, input, problem, assignment: result.assignment, id };
}

export type College = Awaited<ReturnType<typeof makeCollege>>;

/** A user with a membership in the college; returns it signed in. */
export async function member(c: College, role: Role, links: { departmentId?: string; teacherId?: string; sectionId?: string } = {}, name = role.toLowerCase()) {
  const uid = `${c.slug}-${name}-${++n}`;
  const user = await prisma.user.create({ data: { id: uid, name, email: `${uid}@it.test`, emailVerified: true } });
  await prisma.membership.create({
    data: { userId: user.id, institutionId: c.institutionId, role, departmentId: links.departmentId ?? null, teacherId: links.teacherId ?? null, sectionId: links.sectionId ?? null },
  });
  const u = { id: user.id, name: user.name, email: user.email };
  signInAs(u);
  return u;
}

export const as = (u: { id: string; name: string; email: string } | null) => signInAs(u);
export { runAs };

/** A date this many days from today ("YYYY-MM-DD"), moved forward to the next weekday index wanted (0 = Monday). */
export function nextWeekday(dayIndex: number, minDaysAhead = 1): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + minDaysAhead);
  while ((d.getUTCDay() + 6) % 7 !== dayIndex) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export const notificationsFor = (userId: string) => prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }).then((r) => r.map((x) => x.text));
