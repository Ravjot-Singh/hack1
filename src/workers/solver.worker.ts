// Runs the solver off the main thread so the UI stays responsive and can show progress.
import { buildProblem, precheck, solve } from "@/lib/solver";
import type { InstituteInput, SolveProgress, SolveResult } from "@/lib/solver";

export type WorkerRequest = { input: InstituteInput; seed: number };
export type WorkerMessage =
  | { type: "progress"; progress: SolveProgress }
  | { type: "done"; result: SolveResult; issues: ReturnType<typeof precheck> }
  | { type: "error"; message: string };

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const post = (m: WorkerMessage) => self.postMessage(m);
  try {
    const problem = buildProblem(e.data.input);
    let last = 0;
    const result = solve(problem, {
      seed: e.data.seed,
      constructMs: 25000,
      improveMs: 2000,
      onProgress: (progress) => {
        // Throttle progress messages to ~20/s.
        const now = Date.now();
        if (now - last > 50 || progress.phase === "improve") {
          last = now;
          post({ type: "progress", progress });
        }
      },
    });
    post({ type: "done", result, issues: precheck(problem) });
  } catch (err) {
    post({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
