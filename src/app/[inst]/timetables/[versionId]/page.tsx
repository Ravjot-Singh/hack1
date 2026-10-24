import { Suspense } from "react";
import { notFound } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { NoAccess } from "@/components/no-access";
import { PageSkeleton } from "@/components/page-skeleton";
import { StatusBadge } from "@/components/timetable/status-badge";
import { VersionWorkspace } from "@/components/timetable/version-workspace";
import { WorkflowPanel } from "@/components/timetable/workflow-panel";
import { checkPage } from "@/lib/access";
import { prisma } from "@/lib/db";
import { buildProblem, validate } from "@/lib/solver";
import type { Assignment, InstituteInput } from "@/lib/solver";

async function VersionPageContent({ params }: Pick<PageProps<"/[inst]/timetables/[versionId]">, "params">) {
  const { inst: slug, versionId } = await params;
  const access = await checkPage(slug);
  if ("denied" in access) return <NoAccess reason={access.denied} next={`/${slug}/timetables/${versionId}`} />;
  const version = await prisma.timetableVersion.findFirst({
    where: { id: versionId, institutionId: access.inst.id },
    include: { placements: true, signoffs: true },
  });
  if (!version) notFound();
  // Teachers, students and other roles only see published (and archived) timetables.
  if (!["PUBLISHED", "ARCHIVED"].includes(version.status) && !access.can("timetable.viewDrafts")) {
    return <NoAccess reason="role" next={`/${slug}/timetables/${versionId}`} />;
  }

  // The snapshot is the data the version was solved from, so it always renders consistently.
  const snapshot = version.snapshot as unknown as InstituteInput;
  const problem = buildProblem(snapshot);
  const assignment: Assignment = {};
  for (const p of version.placements) assignment[p.lessonId] = { day: p.day, period: p.period, roomId: p.roomId };
  const { violations, unscheduled } = validate(problem, assignment);

  // Departments that must sign off: those with an HOD account.
  const hods = await prisma.membership.findMany({
    where: { institutionId: access.inst.id, role: "HOD", departmentId: { not: null } },
    select: { departmentId: true },
  });
  const reviewDepts = [...new Set(hods.map((h) => h.departmentId!))];
  const departments = await prisma.department.findMany({ where: { id: { in: reviewDepts } }, select: { id: true, name: true, code: true } });
  const reviewers = await prisma.user.findMany({
    where: { id: { in: version.signoffs.map((s) => s.userId) } },
    select: { id: true, name: true },
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4 print:hidden">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{version.name}</h1>
            <StatusBadge status={version.status} />
          </div>
          <p className="text-muted-foreground">
            Quality {version.quality}/100 · {problem.lessons.length - unscheduled.length}/{problem.lessons.length} classes ·
            saved {version.createdAt.toLocaleString("en-IN")}
            {version.publishedAt && ` · published ${version.publishedAt.toLocaleDateString("en-IN")}`}
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
      {access.can("timetable.viewDrafts") && !access.publicDemo && (
        <WorkflowPanel
          slug={slug}
          versionId={version.id}
          status={version.status}
          departments={departments.map((d) => {
            const s = version.signoffs.find((x) => x.departmentId === d.id);
            return {
              id: d.id,
              name: d.name,
              code: d.code,
              signoff: s
                ? { status: s.status, comment: s.comment, by: reviewers.find((r) => r.id === s.userId)?.name ?? "", at: s.createdAt.toISOString() }
                : null,
            };
          })}
          myDepartment={access.member?.role === "HOD" ? access.member.departmentId : null}
          can={{
            submit: access.can("timetable.submit"),
            signoff: access.can("timetable.signoff"),
            publish: access.can("timetable.publish"),
          }}
        />
      )}
      <VersionWorkspace
        slug={slug}
        versionId={version.id}
        title={version.name}
        snapshot={snapshot}
        assignment={assignment}
        pinned={version.placements.filter((p) => p.pinned).map((p) => p.lessonId)}
        editable={access.can("timetable.editDraft") && version.status === "DRAFT"}
        canShare={access.can("timetable.share") && !access.publicDemo}
        published={version.status === "PUBLISHED"}
        readOnlyReason={
          access.publicDemo
            ? "Make your own copy of the demo to edit by hand."
            : access.can("timetable.editDraft") && version.status !== "DRAFT"
              ? "Send it back to draft to edit by hand."
              : undefined
        }
      />
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
