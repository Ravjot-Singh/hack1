import { Suspense } from "react";
import { NoAccess } from "@/components/no-access";
import { PageSkeleton } from "@/components/page-skeleton";
import { RoomHeatmap } from "@/components/insights/room-heatmap";
import { checkPage } from "@/lib/access";
import { prisma } from "@/lib/db";
import type { Assignment, InstituteInput } from "@/lib/solver";

export default function InsightsPage({ params, searchParams }: PageProps<"/[inst]/insights">) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Room use</h1>
        <p className="text-muted-foreground">
          When each room is busy or empty. Use it to find space for events and extra sections, or to see whether a new building is
          really needed.
        </p>
      </div>
      <Suspense fallback={<PageSkeleton rows={2} />}>
        <Insights params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Insights({ params, searchParams }: Pick<PageProps<"/[inst]/insights">, "params" | "searchParams">) {
  const { inst: slug } = await params;
  const sp = await searchParams;
  const access = await checkPage(slug, "setup.view");
  if ("denied" in access) return <NoAccess reason={access.denied} next={`/${slug}/insights`} />;
  const versions = await prisma.timetableVersion.findMany({
    where: { institutionId: access.inst.id },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, status: true, createdAt: true },
  });
  if (!versions.length) return <p className="text-muted-foreground">Generate a timetable first.</p>;
  // Default: the published timetable, otherwise the newest one.
  const chosen =
    versions.find((v) => v.id === sp.v) ?? versions.find((v) => v.status === "PUBLISHED") ?? versions[0];
  const version = await prisma.timetableVersion.findUniqueOrThrow({ where: { id: chosen.id }, include: { placements: true } });
  const assignment: Assignment = {};
  for (const p of version.placements) assignment[p.lessonId] = { day: p.day, period: p.period, roomId: p.roomId };
  return (
    <RoomHeatmap
      snapshot={version.snapshot as unknown as InstituteInput}
      assignment={assignment}
      versions={versions.map((v) => ({ id: v.id, label: `${v.name} (${v.status.toLowerCase()})` }))}
      versionId={chosen.id}
    />
  );
}
