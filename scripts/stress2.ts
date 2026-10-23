import { demoCollege } from "../src/lib/demo/demo-college";
import { buildProblem, precheck, solve } from "../src/lib/solver";

for (const keepClassrooms of [5, 4, 3]) {
  const input = demoCollege();
  // Five-day week and only a few classrooms: genuinely tight.
  input.days = input.days.slice(0, 5);
  input.grids = input.grids.map((g) => ({ ...g, open: g.open.slice(0, 5) }));
  input.teachers.forEach((t) => (t.unavailable = t.unavailable.filter(([d]) => d < 5)));
  let kept = 0;
  input.rooms = input.rooms.filter((r) => r.type !== "Classroom" || kept++ < keepClassrooms);
  input.rooms = input.rooms.filter((r) => r.id !== "r-cs2");
  const problem = buildProblem(input);
  const errs = precheck(problem);
  const r = solve(problem, { seed: 1, constructMs: 15000, improveMs: 1000 });
  console.log(`classrooms=${keepClassrooms}: precheck=${errs.map((e) => e.severity[0] + ":" + e.message).join(" / ")} ${r.ms}ms iters=${r.iterations} unscheduled=${r.unscheduled.length} violations=${r.violations.length} q=${r.score.quality}`);
  for (const [id, reasons] of Object.entries(r.explanations).slice(0, 2)) console.log("  ", problem.lessons.find((l) => l.id === id)!.label, "->", reasons.join(" | "));
}
