import { construct, improve } from "./construct";
import { Engine } from "./engine";
import { score } from "./score";
import type { Problem, SolveProgress, SolveResult } from "./types";
import { validate } from "./validate";

export interface SolveOptions {
  seed?: number;
  constructMs?: number;
  improveMs?: number;
  onProgress?: (p: SolveProgress) => void;
}

/** Full pipeline: construct, improve, then independently validate and score. */
export function solve(problem: Problem, opts: SolveOptions = {}): SolveResult {
  const t0 = Date.now();
  const engine = new Engine(problem);
  const { iterations } = construct(engine, {
    seed: opts.seed,
    timeLimitMs: opts.constructMs ?? 20000,
    onProgress: (iteration, placed, total) => opts.onProgress?.({ phase: "construct", iteration, placed, total }),
  });

  improve(engine, {
    seed: opts.seed,
    timeLimitMs: opts.improveMs ?? 3000,
    onPass: (pass) =>
      opts.onProgress?.({
        phase: "improve",
        iteration: pass,
        placed: engine.placedCount(),
        total: engine.uDur.length,
        quality: score(problem, engine.toAssignment()).quality,
      }),
  });

  const assignment = engine.toAssignment();
  const { violations, unscheduled } = validate(problem, assignment);
  const explanations: Record<string, string[]> = {};
  const done = new Set<number>();
  for (const id of unscheduled) {
    const li = problem.lessons.findIndex((l) => l.id === id);
    const u = engine.lUnit[li];
    if (done.has(u)) continue;
    done.add(u);
    explanations[id] = engine.blockReasons(u);
  }

  return {
    assignment,
    unscheduled,
    explanations,
    violations,
    score: score(problem, assignment),
    iterations,
    ms: Date.now() - t0,
  };
}
