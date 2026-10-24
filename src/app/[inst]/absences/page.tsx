import { Suspense } from "react";
import { AbsenceBoard, type AbsenceView } from "@/components/absences/absence-board";
import { NoAccess } from "@/components/no-access";
import { PageSkeleton } from "@/components/page-skeleton";
import { checkPage } from "@/lib/access";
import { todayIso } from "@/lib/calendar";
import { affectedLessons, suggestSubstitutes } from "@/lib/cover";
import { loadDay } from "@/lib/cover-db";

export default function AbsencesPage({ params, searchParams }: PageProps<"/[inst]/absences">) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Absences & cover</h1>
        <p className="text-muted-foreground">
          Mark a teacher absent and the classes they miss appear below, each with substitutes who are free, present and under their
          daily limit. Everyone affected is notified.
        </p>
      </div>
      <Suspense fallback={<PageSkeleton rows={2} />}>
        <Board params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Board({ params, searchParams }: Pick<PageProps<"/[inst]/absences">, "params" | "searchParams">) {
  const { inst: slug } = await params;
  const sp = await searchParams;
  const date = typeof sp.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : todayIso();
  const access = await checkPage(slug);
  if ("denied" in access) return <NoAccess reason={access.denied} next={`/${slug}/absences`} />;
  const manage = access.can("absence.manage");
  if (!manage && !access.can("absence.self")) return <NoAccess reason="role" next={`/${slug}/absences`} />;

  const day = await loadDay(access.inst.id, date);
  if (day.kind !== "ok") return <p className="text-muted-foreground">Publish a timetable first; cover is arranged against the published one.</p>;
  const teachers = day.snapshot.teachers;
  const member = access.member!;
  const mayHandle = (teacherId: string) =>
    member.role === "INSTITUTE_ADMIN" ||
    (manage && access.canEditDepartment(teachers.find((t) => t.id === teacherId)?.deptId)) ||
    member.teacherId === teacherId;

  const absences: AbsenceView[] = day.absences
    .filter((a) => manage || a.teacherId === member.teacherId)
    .map((a) => ({
      id: a.id,
      teacherId: a.teacherId,
      teacherName: teachers.find((t) => t.id === a.teacherId)?.name ?? "Former teacher",
      periods: a.periods as number[],
      reason: a.reason,
      canManage: mayHandle(a.teacherId),
      affected: day.ctx
        ? affectedLessons(day.ctx, a.teacherId).map(({ lesson, period, roomId }) => {
            const cover = day.covers.find((c) => c.lessonId === lesson.id);
            const others = { ...day.ctx!, covers: day.ctx!.covers.filter((c) => c.lessonId !== lesson.id) };
            return {
              lessonId: lesson.id,
              label: lesson.label,
              time: `P${period + 1}${lesson.duration > 1 ? `–P${period + lesson.duration}` : ""} · ${day.snapshot.periods[period]?.start}`,
              room: day.snapshot.rooms.find((r) => r.id === roomId)?.name ?? "",
              cover: cover
                ? { action: cover.action, substitute: teachers.find((t) => t.id === cover.substituteId)?.name ?? null }
                : null,
              candidates: manage ? suggestSubstitutes(others, lesson.id, 5) : [],
            };
          })
        : [],
    }));

  const markable = teachers.filter((t) => mayHandle(t.id)).map((t) => ({ id: t.id, name: t.name }));
  return (
    <AbsenceBoard
      slug={slug}
      date={date}
      dayNote={day.plan.kind === "classes" ? `${day.snapshot.days[day.plan.dayIndex]} timetable${day.plan.note ? ` · ${day.plan.note}` : ""}` : day.plan.reason}
      hasClasses={day.plan.kind === "classes"}
      periods={day.snapshot.periods}
      markable={markable}
      absences={absences}
      canArrange={manage}
    />
  );
}
