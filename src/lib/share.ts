import { cache } from "react";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { publicView, sharedEntityName, type ShareView } from "@/lib/share-view";
import type { Assignment, InstituteInput } from "@/lib/solver/types";

/**
 * Everything a public share link shows. A link either pins one version or follows the
 * institute's latest published timetable. 404 for unknown or revoked tokens, and for a
 * section/teacher/room that no longer exists (never the whole college instead).
 */
export const getShared = cache(async (token: string) => {
  const link = await prisma.shareLink.findUnique({ where: { token }, include: { institution: true } });
  if (!link) notFound();
  const follows = !link.versionId;
  const version = await prisma.timetableVersion.findFirst({
    where: follows ? { institutionId: link.institutionId, status: "PUBLISHED" } : { id: link.versionId!, institutionId: link.institutionId },
    include: { placements: true },
    orderBy: { publishedAt: "desc" },
  });
  const view = (link.view as ShareView | null) ?? null;
  const base = { collegeName: link.institution.name, follows };
  if (!version) return { ...base, version: null };

  const full = version.snapshot as unknown as InstituteInput;
  const all: Assignment = {};
  for (const p of version.placements) all[p.lessonId] = { day: p.day, period: p.period, roomId: p.roomId };
  const entityName = view && link.entityId ? sharedEntityName(full, view, link.entityId) : null;
  if (view && !entityName) notFound();
  const fixed = view && link.entityId ? { view, entityId: link.entityId } : null;
  // Only what the link is for, without teachers' availability, preferences or custom rules.
  const { snapshot, assignment } = publicView(full, all, fixed);
  return {
    ...base,
    version: {
      name: version.name,
      updatedAt: version.publishedAt ?? version.createdAt,
      snapshot,
      assignment,
      fixed,
      title: entityName ? `${entityName} · ${view === "section" ? "Class" : view === "teacher" ? "Faculty" : "Room"} timetable` : "All timetables",
    },
  };
});
