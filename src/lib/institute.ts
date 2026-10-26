import { prisma } from "@/lib/db";
import type { InstituteInput, RuleSettings, SlotPref } from "@/lib/solver/types";

/** Load everything the solver needs for one institute and map it to InstituteInput. */
export async function loadInstituteInput(institutionId: string): Promise<InstituteInput> {
  const inst = await prisma.institution.findUniqueOrThrow({
    where: { id: institutionId },
    include: {
      departments: true,
      buildings: true,
      rooms: true,
      grids: true,
      teachers: true,
      sections: { include: { batches: { orderBy: { name: "asc" } }, program: true } },
      subjects: true,
      baskets: { include: { sections: { select: { id: true } } } },
      offerings: {
        include: {
          sections: { select: { id: true } },
          teachers: { select: { id: true } },
          labTeachers: { select: { id: true } },
        },
      },
    },
  });

  return {
    name: inst.name,
    days: inst.days as string[],
    periods: inst.periods as { start: string; end: string }[],
    passingMinutes: inst.passingMinutes,
    rules: inst.rules as unknown as RuleSettings,
    departments: inst.departments.map((d) => ({ id: d.id, name: d.name, code: d.code })),
    buildings: inst.buildings.map((b) => ({
      id: b.id,
      name: b.name,
      travelMinutes: b.travelMinutes as Record<string, number>,
    })),
    rooms: inst.rooms.map((r) => ({
      id: r.id,
      name: r.name,
      type: r.type,
      capacity: r.capacity,
      buildingId: r.buildingId,
      ownerDeptId: r.ownerDeptId,
      isEventVenue: r.isEventVenue,
    })),
    grids: inst.grids.map((g) => ({ id: g.id, name: g.name, open: g.open as boolean[][] })),
    teachers: inst.teachers.map((t) => ({
      id: t.id,
      name: t.name,
      deptId: t.departmentId,
      designation: t.designation,
      maxPerDay: t.maxPerDay,
      maxPerWeek: t.maxPerWeek,
      unavailable: t.unavailable as [number, number][],
      prefs: t.prefs as unknown as SlotPref[],
    })),
    sections: inst.sections.map((s) => ({
      id: s.id,
      name: s.name,
      deptId: s.departmentId,
      programName: s.program.name,
      year: s.year,
      size: s.size,
      gridId: s.gridId,
      batches: s.batches.map((b) => ({ id: b.id, name: b.name, size: b.size })),
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
    offerings: inst.offerings.map((o) => ({
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
    baskets: inst.baskets.map((b) => ({ id: b.id, name: b.name, sectionIds: b.sections.map((s) => s.id) })),
  };
}

/** Persist an InstituteInput as a new institute (ids are kept, so prefix them per institute). */
export async function createInstitute(input: InstituteInput, slug: string, isDemo = false): Promise<string> {
  return prisma.$transaction(
    async (tx) => {
      const inst = await tx.institution.create({
        data: {
          name: input.name,
          slug,
          isDemo,
          days: input.days,
          periods: input.periods,
          passingMinutes: input.passingMinutes,
          rules: input.rules as object,
        },
      });
      const institutionId = inst.id;
      await tx.department.createMany({ data: input.departments.map((d) => ({ ...d, institutionId })) });
      await tx.building.createMany({ data: input.buildings.map((b) => ({ ...b, institutionId })) });
      await tx.room.createMany({ data: input.rooms.map((r) => ({ ...r, institutionId })) });
      await tx.timeGrid.createMany({ data: input.grids.map((g) => ({ ...g, institutionId })) });

      // Everything is written in bulk, a few statements per table rather than one per row, so a
      // large college copies quickly even to a database on another continent.
      const firstDept = new Map<string, string>();
      for (const s of input.sections) if (!firstDept.has(s.programName)) firstDept.set(s.programName, s.deptId);
      const created = await tx.program.createManyAndReturn({
        data: [...firstDept].map(([name, departmentId]) => ({ institutionId, departmentId, name })),
        select: { id: true, name: true },
      });
      const programs = new Map(created.map((p) => [p.name, p.id]));
      await tx.section.createMany({
        data: input.sections.map((s) => ({
          id: s.id,
          institutionId,
          programId: programs.get(s.programName)!,
          departmentId: s.deptId,
          gridId: s.gridId,
          year: s.year,
          name: s.name,
          size: s.size,
        })),
      });
      await tx.batch.createMany({
        data: input.sections.flatMap((s) => s.batches.map((b) => ({ ...b, sectionId: s.id }))),
      });
      await tx.teacher.createMany({
        data: input.teachers.map(({ deptId, ...t }) => ({
          ...t,
          departmentId: deptId,
          institutionId,
          prefs: t.prefs as object[],
        })),
      });
      await tx.subject.createMany({
        data: input.subjects.map(({ deptId, ...s }) => ({ ...s, departmentId: deptId, institutionId })),
      });
      await tx.electiveBasket.createMany({ data: input.baskets.map((b) => ({ id: b.id, name: b.name, institutionId })) });
      await tx.offering.createMany({
        data: input.offerings.map((o) => ({
          id: o.id,
          institutionId,
          subjectId: o.subjectId,
          batchwiseLab: o.batchwiseLab,
          splitLabBatches: o.splitLabBatches ?? false,
          basketId: o.basketId,
          expectedSize: o.expectedSize,
        })),
      });
      // Many-to-many links go straight into Prisma's join tables: "A" is the offering or basket,
      // "B" the section or teacher (models in alphabetical order).
      const link = async (table: string, pairs: [string, string][]) => {
        if (!pairs.length) return;
        await tx.$executeRawUnsafe(
          `INSERT INTO "${table}" ("A", "B") SELECT * FROM unnest($1::text[], $2::text[]) ON CONFLICT DO NOTHING`,
          pairs.map((p) => p[0]),
          pairs.map((p) => p[1]),
        );
      };
      await link("_ElectiveBasketToSection", input.baskets.flatMap((b) => b.sectionIds.map((s): [string, string] => [b.id, s])));
      await link("_OfferingSections", input.offerings.flatMap((o) => o.sectionIds.map((s): [string, string] => [o.id, s])));
      await link("_OfferingTeachers", input.offerings.flatMap((o) => o.teacherIds.map((t): [string, string] => [o.id, t])));
      await link("_OfferingLabTeachers", input.offerings.flatMap((o) => o.labTeacherIds.map((t): [string, string] => [o.id, t])));
      return institutionId;
    },
    { timeout: 60000 },
  );
}
