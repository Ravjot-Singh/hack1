import Link from "next/link";
import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import type { Issue } from "@/lib/solver/types";

/** Readiness / feasibility issues with plain-language fixes. */
export function IssueList({ issues, fixHref }: { issues: Issue[]; fixHref?: (issue: Issue) => string }) {
  if (!issues.length) {
    return (
      <p className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-400">
        <CheckCircle2 className="size-4" /> No problems found. The data is ready to schedule.
      </p>
    );
  }
  return (
    <ul className="space-y-2">
      {issues.map((i, k) => (
        <li key={k} className="flex gap-2 text-sm">
          {i.severity === "error" ? (
            <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
          ) : (
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
          )}
          <span>
            {i.message}
            {i.fix && (
              <span className="block text-muted-foreground">
                Fix: {i.fix}
                {fixHref && (
                  <Link href={fixHref(i)} className="ml-1.5 font-medium text-foreground underline-offset-2 hover:underline">
                    Fix →
                  </Link>
                )}
              </span>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}
