"use client";

import { useMemo } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { IssueList } from "@/components/issue-list";
import { buttonVariants } from "@/components/ui/button";
import { buildProblem, precheck } from "@/lib/solver";
import { toInstituteInput } from "@/lib/setup/convert";
import { stepForIssue } from "@/lib/setup/steps";
import type { StepProps } from "../step-view";

export function ReviewStep({ slug, data }: StepProps) {
  const { problem, issues } = useMemo(() => {
    const problem = buildProblem(toInstituteInput(data));
    return { problem, issues: precheck(problem) };
  }, [data]);
  const errors = issues.filter((i) => i.severity === "error").length;
  const empty = !problem.lessons.length;

  const stats = [
    ["Departments", data.departments.length],
    ["Teachers", data.teachers.length],
    ["Sections", data.sections.length],
    ["Rooms & labs", data.rooms.filter((r) => !r.isEventVenue).length],
    ["Subjects", data.subjects.length],
    ["Classes to place / week", problem.lessons.length],
  ] as const;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {stats.map(([label, n]) => (
          <div key={label} className="rounded-lg border p-3">
            <div className="text-xl font-semibold tabular-nums">{n}</div>
            <div className="text-xs text-muted-foreground">{label}</div>
          </div>
        ))}
      </div>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Readiness check</h2>
        {empty ? (
          <p className="text-sm text-muted-foreground">No classes to schedule yet. Allocate subjects to sections first.</p>
        ) : (
          <IssueList issues={issues} fixHref={(i) => `/${slug}/setup/${stepForIssue(i.rule)}`} />
        )}
      </section>

      {!empty && (
        <div className="flex flex-wrap items-center gap-3">
          <Link href={`/${slug}/solve`} className={buttonVariants({ size: "lg" })}>
            Generate timetable <ArrowRight />
          </Link>
          {errors > 0 && (
            <span className="text-sm text-muted-foreground">
              With {errors} error{errors > 1 ? "s" : ""} left, some classes may not be placed. The solver will say which and why.
            </span>
          )}
        </div>
      )}
    </div>
  );
}
