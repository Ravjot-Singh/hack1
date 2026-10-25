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
  const budget = opts.constructMs ?? 20000;
  // Good starts finish in well under a second; a stuck one is cut short so more starts fit.
  const perAttempt = Math.max(1500, Math.min(3000, budget / 4));
  // A run that gets stuck with classes left over is restarted from a different random start
  // while the construction budget lasts; the best attempt (fewest classes left) is kept.
  let engine = new Engine(problem);
  let { iterations } = construct(engine, {
    seed: opts.seed,
    timeLimitMs: Math.min(budget, perAttempt),
    onProgress: (iteration, placed, total) => opts.onProgress?.({ phase: "construct", iteration, placed, total }),
  });
  for (let attempt = 1; engine.placedCount() < engine.uDur.length && Date.now() - t0 < budget; attempt++) {
    const next = new Engine(problem);
    const run = construct(next, {
      seed: (opts.seed ?? 1) + attempt * 7919,
      timeLimitMs: Math.min(perAttempt, budget - (Date.now() - t0)),
      onProgress: (iteration, placed, total) => opts.onProgress?.({ phase: "construct", iteration: iterations + iteration, placed, total }),
    });
    iterations += run.iterations;
    if (next.placedCount() > engine.placedCount()) engine = next;
  }

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
  // Parallel lessons (an elective basket) share their unit's reasons.
  const byUnit = new Map<number, string[]>();
  for (const id of unscheduled) {
    const li = problem.lessons.findIndex((l) => l.id === id);
    const u = engine.lUnit[li];
    if (!byUnit.has(u)) byUnit.set(u, engine.blockReasons(u));
    explanations[id] = byUnit.get(u)!;
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
