import { cache } from "react";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import type { Assignment, InstituteInput } from "@/lib/solver/types";
import type { ViewKind } from "@/components/timetable/timetable-grid";

/**
 * Everything a public share link shows. A link either pins one version or follows the
 * institute's latest published timetable. 404 for unknown or revoked tokens.
 */
export const getShared = cache(async (token: string) => {
  const link = await prisma.shareLink.findUnique({ where: { token }, include: { institution: true } });
  if (!link) notFound();
  const follows = !link.versionId;
  const version = await prisma.timetableVersion.findFirst({
    where: follows ? { institutionId: link.institutionId, status: "PUBLISHED" } : { id: link.versionId! },
    include: { placements: true },
    orderBy: { publishedAt: "desc" },
  });
  const view = (link.view as ViewKind | null) ?? null;
  const base = { collegeName: link.institution.name, follows };
  if (!version) return { ...base, version: null };

  const snapshot = version.snapshot as unknown as InstituteInput;
  const assignment: Assignment = {};
  for (const p of version.placements) assignment[p.lessonId] = { day: p.day, period: p.period, roomId: p.roomId };
  const entityName =
    view === "section"
      ? snapshot.sections.find((s) => s.id === link.entityId)?.name
      : view === "teacher"
        ? snapshot.teachers.find((t) => t.id === link.entityId)?.name
        : view === "room"
          ? snapshot.rooms.find((r) => r.id === link.entityId)?.name
          : null;
  return {
    ...base,
    version: {
      name: version.name,
      updatedAt: version.publishedAt ?? version.createdAt,
      snapshot,
      assignment,
      // A followed link whose section/teacher no longer exists falls back to the full explorer.
      fixed: view && link.entityId && entityName ? { view, entityId: link.entityId } : null,
      title: entityName ? `${entityName} · ${view === "section" ? "Class" : view === "teacher" ? "Faculty" : "Room"} timetable` : "All timetables",
    },
  };
});
