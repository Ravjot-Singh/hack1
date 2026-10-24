// Health check: load the demo institute from DATABASE_URL, solve it and validate.
//   npx tsx scripts/check-db.ts            (local)
//   npm run db:prod -- npx tsx scripts/check-db.ts   (Neon)
import "dotenv/config";
import { prisma } from "../src/lib/db";
import { loadInstituteInput } from "../src/lib/institute";
import { buildProblem, precheck, solve } from "../src/lib/solver";

async function main() {
  const inst = await prisma.institution.findUniqueOrThrow({ where: { slug: "demo" } });
  const input = await loadInstituteInput(inst.id);
  const problem = buildProblem(input);
  const errors = precheck(problem).filter((i) => i.severity === "error");
  const r = solve(problem, { seed: 1, improveMs: 500 });
  console.log(
    `${inst.name}: ${input.teachers.length} teachers, ${input.sections.length} sections, ${problem.lessons.length} classes | ` +
      `precheck errors ${errors.length} | placed ${problem.lessons.length - r.unscheduled.length}/${problem.lessons.length} | ` +
      `violations ${r.violations.length} | quality ${r.score.quality}`,
  );
  if (errors.length || r.unscheduled.length || r.violations.length) process.exit(1);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
