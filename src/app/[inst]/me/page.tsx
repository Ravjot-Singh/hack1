import { Suspense } from "react";
import { NoAccess } from "@/components/no-access";
import { PageSkeleton } from "@/components/page-skeleton";
import { SharedTimetable } from "@/components/timetable/shared-timetable";
import { checkPage } from "@/lib/access";
import { prisma } from "@/lib/db";
import type { Assignment, InstituteInput } from "@/lib/solver";

export default function MyTimetablePage({ params }: PageProps<"/[inst]/me">) {
  return (
    <Suspense fallback={<PageSkeleton rows={2} />}>
      <Mine params={params} />
    </Suspense>
  );
}

async function Mine({ params }: Pick<PageProps<"/[inst]/me">, "params">) {
  const { inst: slug } = await params;
  const access = await checkPage(slug);
  if ("denied" in access) return <NoAccess reason={access.denied} next={`/${slug}/me`} />;
  const member = access.member;
  const fixed = member?.teacherId
    ? { view: "teacher" as const, entityId: member.teacherId }
    : member?.sectionId
      ? { view: "section" as const, entityId: member.sectionId }
      : null;
  if (!fixed) {
    return <p className="text-muted-foreground">Your account isn&apos;t linked to a teacher or section. Ask the admin to link it on the People page.</p>;
  }

  const version = await prisma.timetableVersion.findFirst({
    where: { institutionId: access.inst.id, status: "PUBLISHED" },
    include: { placements: true },
    orderBy: { publishedAt: "desc" },
  });
  if (!version) return <p className="text-muted-foreground">No timetable has been published yet. You&apos;ll see yours here once it is.</p>;

  const snapshot = version.snapshot as unknown as InstituteInput;
  const exists =
    fixed.view === "teacher" ? snapshot.teachers.some((t) => t.id === fixed.entityId) : snapshot.sections.some((s) => s.id === fixed.entityId);
  if (!exists) return <p className="text-muted-foreground">You aren&apos;t in the published timetable yet; it was made before you were added.</p>;
  const assignment: Assignment = {};
  for (const p of version.placements) assignment[p.lessonId] = { day: p.day, period: p.period, roomId: p.roomId };
  const name =
    fixed.view === "teacher"
      ? snapshot.teachers.find((t) => t.id === fixed.entityId)?.name
      : snapshot.sections.find((s) => s.id === fixed.entityId)?.name;

  return (
    <div className="space-y-4">
      <div className="print:hidden">
        <h1 className="text-2xl font-semibold tracking-tight">My timetable</h1>
        <p className="text-sm text-muted-foreground">
          {name} · {version.name}, published {version.publishedAt?.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
        </p>
      </div>
      <SharedTimetable snapshot={snapshot} assignment={assignment} title={version.name} fixed={fixed} />
    </div>
  );
}
