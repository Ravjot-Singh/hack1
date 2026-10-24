"use client";

import type { InstituteInput, SolveProgress, SolveResult } from "@/lib/solver";
import type { WorkerMessage, WorkerRequest } from "@/workers/solver.worker";

/** Run the solver in a Web Worker. Call `cancel()` to stop it. */
export function runSolver(
  input: InstituteInput,
  onProgress?: (p: SolveProgress) => void,
): { result: Promise<SolveResult>; cancel: () => void } {
  const worker = new Worker(new URL("../workers/solver.worker.ts", import.meta.url), { type: "module" });
  const result = new Promise<SolveResult>((resolve, reject) => {
    worker.onmessage = (e: MessageEvent<WorkerMessage>) => {
      const msg = e.data;
      if (msg.type === "progress") onProgress?.(msg.progress);
      else {
        worker.terminate();
        if (msg.type === "done") resolve(msg.result);
        else reject(new Error(msg.message));
      }
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message));
    };
  });
  worker.postMessage({ input, seed: Math.floor(Math.random() * 1e9) } satisfies WorkerRequest);
  return { result, cancel: () => worker.terminate() };
}
