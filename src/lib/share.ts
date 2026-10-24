import { cache } from "react";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import type { Assignment, InstituteInput } from "@/lib/solver/types";
import type { ViewKind } from "@/components/timetable/timetable-grid";

/** Everything a public share link shows. 404 for unknown or revoked tokens. */
export const getShared = cache(async (token: string) => {
  const link = await prisma.shareLink.findUnique({
    where: { token },
    include: { institution: true, version: { include: { placements: true } } },
  });
  if (!link) notFound();
  const snapshot = link.version.snapshot as unknown as InstituteInput;
  const assignment: Assignment = {};
  for (const p of link.version.placements) assignment[p.lessonId] = { day: p.day, period: p.period, roomId: p.roomId };
  const view = (link.view as ViewKind | null) ?? null;
  const entityName =
    view === "section"
      ? snapshot.sections.find((s) => s.id === link.entityId)?.name
      : view === "teacher"
        ? snapshot.teachers.find((t) => t.id === link.entityId)?.name
        : view === "room"
          ? snapshot.rooms.find((r) => r.id === link.entityId)?.name
          : null;
  return {
    collegeName: link.institution.name,
    versionName: link.version.name,
    savedAt: link.version.createdAt,
    snapshot,
    assignment,
    fixed: view && link.entityId ? { view, entityId: link.entityId } : null,
    title: entityName ? `${entityName} · ${view === "section" ? "Class" : view === "teacher" ? "Faculty" : "Room"} timetable` : "All timetables",
  };
});
