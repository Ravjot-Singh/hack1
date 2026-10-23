import { demoCollege } from "../src/lib/demo/demo-college";
import { buildProblem, precheck, solve } from "../src/lib/solver";

for (const drop of [["r-cs2"], ["r-cs2", "r-m106", "r-m105", "r-m104"], ["r-cs2", "r-m106", "r-m105", "r-m104", "r-m103", "r-e204", "r-w301"]]) {
  const input = demoCollege();
  input.rooms = input.rooms.filter((r) => !drop.includes(r.id));
  const problem = buildProblem(input);
  const errs = precheck(problem).filter((i) => i.severity === "error").length;
  const r = solve(problem, { seed: 1, constructMs: 15000, improveMs: 1000 });
  console.log(`drop ${drop.length}: precheckErrors=${errs} ${r.ms}ms iters=${r.iterations} unscheduled=${r.unscheduled.length} violations=${r.violations.length} q=${r.score.quality}`);
  for (const [id, reasons] of Object.entries(r.explanations).slice(0, 2)) console.log("  ", problem.lessons.find((l) => l.id === id)!.label, "->", reasons.join(" | "));
}
