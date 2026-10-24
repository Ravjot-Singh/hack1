"use client";

import { useMemo } from "react";
import { buildProblem } from "@/lib/solver";
import type { Assignment, InstituteInput } from "@/lib/solver";
import { TimetableExplorer } from "./timetable-explorer";
import type { ViewKind } from "./timetable-grid";

/** Read-only timetable for a public share link. */
export function SharedTimetable({
  snapshot,
  assignment,
  title,
  fixed,
}: {
  snapshot: InstituteInput;
  assignment: Assignment;
  title: string;
  fixed: { view: ViewKind; entityId: string } | null;
}) {
  const problem = useMemo(() => buildProblem(snapshot), [snapshot]);
  return <TimetableExplorer problem={problem} assignment={assignment} title={title} fixed={fixed ?? undefined} />;
}
