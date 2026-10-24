import { Suspense } from "react";
import { PageSkeleton } from "@/components/page-skeleton";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { IssueList } from "@/components/issue-list";
import { prisma } from "@/lib/db";
import { getInstitution } from "@/lib/inst";
import { loadInstituteInput } from "@/lib/institute";
import { buildProblem, precheck } from "@/lib/solver";
import { stepForIssue } from "@/lib/setup/steps";

async function OverviewPageContent({ params }: Pick<PageProps<"/[inst]">, "params">) {
  const { inst: slug } = await params;
  const inst = await getInstitution(slug);
  const input = await loadInstituteInput(inst.id);
  const problem = buildProblem(input);
  const issues = precheck(problem);
  const versions = await prisma.timetableVersion.findMany({
    where: { institutionId: inst.id },
    orderBy: { createdAt: "desc" },
    take: 5,
  });

  const stats = [
    { label: "Departments", value: input.departments.length },
    { label: "Teachers", value: input.teachers.length },
    { label: "Sections", value: input.sections.length },
    { label: "Lab batches", value: input.sections.reduce((n, s) => n + s.batches.length, 0) },
    { label: "Rooms & labs", value: input.rooms.filter((r) => !r.isEventVenue).length },
    { label: "Classes to place / week", value: problem.lessons.length },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{inst.name}</h1>
          <p className="text-muted-foreground">
            {input.days.length}-day week · {input.periods.length} periods a day ({input.periods[0]?.start}–
            {input.periods.at(-1)?.end})
          </p>
        </div>
        {problem.lessons.length ? (
          <div className="flex gap-2">
            <Link href={`/${slug}/setup`} className={buttonVariants({ size: "lg", variant: "outline" })}>
              Edit data
            </Link>
            <Link href={`/${slug}/solve`} className={buttonVariants({ size: "lg" })}>
              Generate timetable <ArrowRight />
            </Link>
          </div>
        ) : (
          <Link href={`/${slug}/setup`} className={buttonVariants({ size: "lg" })}>
            Start setup <ArrowRight />
          </Link>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {stats.map((s) => (
          <Card key={s.label} size="sm">
            <CardContent>
              <div className="text-2xl font-semibold tabular-nums">{s.value}</div>
              <div className="text-xs text-muted-foreground">{s.label}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Readiness check</CardTitle>
            <CardDescription>
              Catches impossible setups before solving: overloaded teachers, missing rooms, too many hours for a section.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {problem.lessons.length ? (
              <IssueList issues={issues} fixHref={(i) => `/${slug}/setup/${stepForIssue(i.rule)}`} />
            ) : (
              <p className="text-sm text-muted-foreground">
                Nothing to schedule yet.{" "}
                <Link href={`/${slug}/setup`} className="font-medium text-foreground underline-offset-2 hover:underline">
                  Set up departments, rooms, teachers, sections and subjects →
                </Link>
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Recent timetables</CardTitle>
          </CardHeader>
          <CardContent>
            {versions.length ? (
              <ul className="space-y-2 text-sm">
                {versions.map((v) => (
                  <li key={v.id}>
                    <Link href={`/${slug}/timetables/${v.id}`} className="flex justify-between hover:underline">
                      <span>{v.name}</span>
                      <span className="text-muted-foreground">quality {v.quality}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">None yet. Generate your first timetable.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Departments</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {input.departments.map((d) => {
            const secs = input.sections.filter((s) => s.deptId === d.id);
            const teachers = input.teachers.filter((t) => t.deptId === d.id);
            return (
              <div key={d.id} className="rounded-lg border p-3">
                <div className="font-medium">{d.name}</div>
                <div className="text-xs text-muted-foreground">
                  {teachers.length} teachers · {secs.length} sections
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {secs.map((s) => (
                    <span key={s.id} className="rounded bg-muted px-1.5 py-0.5 text-xs">
                      {s.name}
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}

// Data streams in under a Suspense boundary so navigation between pages is instant.
export default function OverviewPage({ params }: PageProps<"/[inst]">) {
  return (
    <Suspense fallback={<PageSkeleton rows={3} />}>
      <OverviewPageContent params={params} />
    </Suspense>
  );
}
