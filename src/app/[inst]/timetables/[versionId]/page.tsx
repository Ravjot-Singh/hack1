import { Suspense } from "react";
import { PageSkeleton } from "@/components/page-skeleton";
import { notFound } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { TimetableExplorer } from "@/components/timetable/timetable-explorer";
import { prisma } from "@/lib/db";
import { getInstitution } from "@/lib/inst";
import { buildProblem, validate } from "@/lib/solver";
import type { Assignment, InstituteInput } from "@/lib/solver";

async function VersionPageContent({ params }: Pick<PageProps<"/[inst]/timetables/[versionId]">, "params">) {
  const { inst: slug, versionId } = await params;
  const inst = await getInstitution(slug);
  const version = await prisma.timetableVersion.findFirst({
    where: { id: versionId, institutionId: inst.id },
    include: { placements: true },
  });
  if (!version) notFound();

  // The snapshot is the data the version was solved from, so it always renders consistently.
  const problem = buildProblem(version.snapshot as unknown as InstituteInput);
  const assignment: Assignment = {};
  for (const p of version.placements) assignment[p.lessonId] = { day: p.day, period: p.period, roomId: p.roomId };
  const { violations, unscheduled } = validate(problem, assignment);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4 print:hidden">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{version.name}</h1>
            <Badge variant="secondary">{version.status.toLowerCase()}</Badge>
          </div>
          <p className="text-muted-foreground">
            Quality {version.quality}/100 · {problem.lessons.length - unscheduled.length}/{problem.lessons.length} classes ·
            saved {version.createdAt.toLocaleString("en-IN")}
          </p>
        </div>
        <p
          className={
            violations.length
              ? "text-sm text-destructive"
              : "flex items-center gap-1.5 text-sm text-emerald-700 dark:text-emerald-400"
          }
        >
          {violations.length ? (
            `${violations.length} rule violations`
          ) : (
            <>
              <ShieldCheck className="size-4" /> Re-checked just now: no teacher, room or student clashes
            </>
          )}
        </p>
      </div>
      <TimetableExplorer problem={problem} assignment={assignment} title={version.name} />
    </div>
  );
}

// Data streams in under a Suspense boundary so navigation between pages is instant.
export default function VersionPage({ params }: PageProps<"/[inst]/timetables/[versionId]">) {
  return (
    <Suspense fallback={<PageSkeleton rows={3} />}>
      <VersionPageContent params={params} />
    </Suspense>
  );
}
