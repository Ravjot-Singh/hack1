import { demoCollege } from "../src/lib/demo/demo-college";
import { buildProblem, solve } from "../src/lib/solver";

const problem = buildProblem(demoCollege());
console.log(`lessons=${problem.lessons.length} units=${problem.units.length}`);
for (const seed of [1, 2, 3]) {
  const r = solve(problem, { seed, constructMs: 20000, improveMs: 2000 });
  console.log(`seed ${seed}: ${r.ms}ms iters=${r.iterations} unscheduled=${r.unscheduled.length} violations=${r.violations.length} quality=${r.score.quality}`, JSON.stringify(r.score.penalties));
}
