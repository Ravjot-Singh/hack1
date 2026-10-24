import { Suspense } from "react";
import { NoAccess } from "@/components/no-access";
import { PageSkeleton } from "@/components/page-skeleton";
import { TodayView } from "@/components/timetable/today-view";
import { checkPage } from "@/lib/access";
import { loadCalendar } from "@/lib/calendar-db";
import { loadRecentCovers } from "@/lib/cover-db";
import { prisma } from "@/lib/db";
import { loadEvents } from "@/lib/venues-db";
import type { Assignment, InstituteInput } from "@/lib/solver";

export default function TodayPage({ params }: PageProps<"/[inst]/today">) {
  return (
    <Suspense fallback={<PageSkeleton rows={2} />}>
      <Today params={params} />
    </Suspense>
  );
}

async function Today({ params }: Pick<PageProps<"/[inst]/today">, "params">) {
  const { inst: slug } = await params;
  const access = await checkPage(slug);
  if ("denied" in access) return <NoAccess reason={access.denied} next={`/${slug}/today`} />;
  const version = await prisma.timetableVersion.findFirst({
    where: { institutionId: access.inst.id, status: "PUBLISHED" },
    include: { placements: true },
    orderBy: { publishedAt: "desc" },
  });
  if (!version) return <p className="text-muted-foreground">No timetable has been published yet.</p>;

  const snapshot = version.snapshot as unknown as InstituteInput;
  const assignment: Assignment = {};
  for (const p of version.placements) assignment[p.lessonId] = { day: p.day, period: p.period, roomId: p.roomId };
  const m = access.member;
  const fixed =
    m?.teacherId && snapshot.teachers.some((t) => t.id === m.teacherId)
      ? { view: "teacher" as const, entityId: m.teacherId }
      : m?.sectionId && snapshot.sections.some((s) => s.id === m.sectionId)
        ? { view: "section" as const, entityId: m.sectionId }
        : null;
  const { specials, ...rest } = await loadCalendar(access.inst.id);
  const covers = await loadRecentCovers(access.inst.id, version.id, snapshot);
  const events = await loadEvents(access.inst.id, snapshot.periods);
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Today</h1>
      <Suspense>
        <TodayView
          snapshot={snapshot}
          assignment={assignment}
          calendar={{ ...rest, specials: specials.map(({ date, kind, label, followsDay }) => ({ date, kind, label, followsDay })) }}
          fixed={fixed}
          versionName={version.name}
          covers={covers}
          events={events}
        />
      </Suspense>
    </div>
  );
}
