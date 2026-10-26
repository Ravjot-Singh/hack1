// Seeds the fixed "demo" institute used by the landing page and README, with a published
// timetable so visitors see one straight away (the demo is read-only, so they can't save one).
import "dotenv/config";
import { prisma } from "../src/lib/db";
import { demoCollege } from "../src/lib/demo/demo-college";
import { createInstitute } from "../src/lib/institute";
import { buildProblem, score, solve, validate } from "../src/lib/solver";

async function main() {
  await prisma.institution.deleteMany({ where: { slug: "demo" } });
  const input = demoCollege("demo-");
  const id = await createInstitute(input, "demo", true);

  const problem = buildProblem(input);
  const started = Date.now();
  const { assignment } = solve(problem, { seed: 1, constructMs: 20000, improveMs: 2000 });
  // Same rule as saving in the app: nothing is published unless every hard rule holds.
  const { violations, unscheduled } = validate(problem, assignment);
  if (violations.length) throw new Error(`Demo timetable broke a rule: ${violations[0].message}`);
  const breakdown = score(problem, assignment);
  await prisma.timetableVersion.create({
    data: {
      institutionId: id,
      name: "Published timetable",
      status: "PUBLISHED",
      publishedAt: new Date(),
      quality: breakdown.quality,
      stats: { ...breakdown, unscheduled: unscheduled.length, lessons: problem.lessons.length, solveMs: Date.now() - started },
      snapshot: input as object,
      placements: { create: Object.entries(assignment).map(([lessonId, a]) => ({ lessonId, ...a })) },
    },
  });
  console.log(`Seeded demo institute ${id} at /demo with a published timetable (${problem.lessons.length - unscheduled.length}/${problem.lessons.length} classes placed).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
