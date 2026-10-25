import { cache } from "react";
import { prisma } from "@/lib/db";
import type { RuleSettings, SlotPref } from "@/lib/solver/types";
import type { SetupData } from "./convert";

/** The shared demo can be viewed and solved but never edited. */
export const isReadOnly = (inst: { slug: string }) => inst.slug === "demo";

/** All editable rows for one institute, shaped for the setup wizard. */
export async function loadSetup(institutionId: string): Promise<SetupData> {
  const inst = await prisma.institution.findUniqueOrThrow({
    where: { id: institutionId },
    include: {
      departments: { orderBy: { code: "asc" } },
      buildings: { orderBy: { name: "asc" } },
      rooms: { orderBy: [{ type: "asc" }, { name: "asc" }] },
      grids: { orderBy: { name: "asc" } },
      teachers: { orderBy: [{ departmentId: "asc" }, { name: "asc" }] },
      programs: { orderBy: { name: "asc" } },
      sections: { include: { batches: { orderBy: { name: "asc" } } }, orderBy: [{ year: "asc" }, { name: "asc" }] },
      subjects: { orderBy: { code: "asc" } },
      baskets: { include: { sections: { select: { id: true } } }, orderBy: { name: "asc" } },
      offerings: {
        include: {
          sections: { select: { id: true } },
          teachers: { select: { id: true } },
          labTeachers: { select: { id: true } },
          subject: { select: { code: true } },
        },
      },
    },
  });

  return {
    settings: {
      name: inst.name,
      days: inst.days as string[],
      periods: inst.periods as { start: string; end: string }[],
      passingMinutes: inst.passingMinutes,
    },
    rules: inst.rules as unknown as RuleSettings,
    grids: inst.grids.map((g) => ({ id: g.id, name: g.name, open: g.open as boolean[][] })),
    batches: Object.fromEntries(inst.sections.map((s) => [s.id, s.batches.map((b) => ({ id: b.id, name: b.name, size: b.size }))])),
    departments: inst.departments.map((d) => ({ id: d.id, name: d.name, code: d.code })),
    buildings: inst.buildings.map((b) => ({ id: b.id, name: b.name, travelMinutes: b.travelMinutes as Record<string, number> })),
    rooms: inst.rooms.map((r) => ({
      id: r.id,
      name: r.name,
      type: r.type,
      capacity: r.capacity,
      buildingId: r.buildingId,
      ownerDeptId: r.ownerDeptId,
      isEventVenue: r.isEventVenue,
    })),
    teachers: inst.teachers.map((t) => ({
      id: t.id,
      name: t.name,
      email: t.email ?? "",
      deptId: t.departmentId,
      designation: t.designation,
      maxPerDay: t.maxPerDay,
      maxPerWeek: t.maxPerWeek,
      unavailable: t.unavailable as [number, number][],
      prefs: t.prefs as unknown as SlotPref[],
    })),
    programs: inst.programs.map((p) => ({ id: p.id, name: p.name, deptId: p.departmentId })),
    sections: inst.sections.map((s) => ({
      id: s.id,
      name: s.name,
      programId: s.programId,
      year: s.year,
      size: s.size,
      gridId: s.gridId,
      batchCount: s.batches.length,
    })),
    subjects: inst.subjects.map((s) => ({
      id: s.id,
      code: s.code,
      name: s.name,
      deptId: s.departmentId,
      mode: s.mode,
      L: s.L,
      T: s.T,
      P: s.P,
      hoursPerWeek: s.hoursPerWeek,
      theoryRoomType: s.theoryRoomType,
      labRoomType: s.labRoomType,
      labBlockLen: s.labBlockLen,
    })),
    baskets: inst.baskets.map((b) => ({ id: b.id, name: b.name, sectionIds: b.sections.map((s) => s.id) })),
    offerings: inst.offerings
      .sort((a, b) => a.subject.code.localeCompare(b.subject.code))
      .map((o) => ({
        id: o.id,
        subjectId: o.subjectId,
        sectionIds: o.sections.map((s) => s.id),
        teacherIds: o.teachers.map((t) => t.id),
        labTeacherIds: o.labTeachers.map((t) => t.id),
        batchwiseLab: o.batchwiseLab,
        splitLabBatches: o.splitLabBatches,
        basketId: o.basketId,
        expectedSize: o.expectedSize,
      })),
  };
}

/** Per-request cached loader so the setup layout and page share one query. */
export const getSetup = cache(loadSetup);
