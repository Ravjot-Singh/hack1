import type { InstituteInput, RuleSettings } from "@/lib/solver/types";
import type { Lookups, SetupRows } from "./import";
import { splitBatches, type GridRow, type InstituteSettings } from "./schemas";

/** Everything the setup wizard edits for one institute. */
export interface SetupData extends SetupRows {
  settings: InstituteSettings;
  rules: RuleSettings;
  grids: GridRow[];
  /** Existing batches per section (keeps ids stable when the batch count is unchanged). */
  batches: Record<string, { id: string; name: string; size: number }[]>;
}

export function lookupsOf(data: SetupData): Lookups {
  const named = <T extends { id?: string; name: string }>(xs: T[]) => xs.map((x) => ({ id: x.id ?? "", name: x.name }));
  return {
    days: data.settings.days,
    periods: data.settings.periods.length,
    departments: data.departments.map((d) => ({ id: d.id ?? "", name: d.name, code: d.code })),
    buildings: named(data.buildings),
    grids: named(data.grids),
    programs: named(data.programs),
    sections: named(data.sections),
    subjects: data.subjects.map((s) => ({ id: s.id ?? "", code: s.code, name: s.name })),
    teachers: named(data.teachers),
    baskets: named(data.baskets),
  };
}

/** Build the solver input from (possibly unsaved) setup rows. */
export function toInstituteInput(data: SetupData): InstituteInput {
  const programs = new Map(data.programs.map((p) => [p.id, p]));
  return {
    name: data.settings.name,
    days: data.settings.days,
    periods: data.settings.periods,
    passingMinutes: Number(data.settings.passingMinutes),
    rules: data.rules,
    departments: data.departments.map((d) => ({ id: d.id!, name: d.name, code: d.code })),
    buildings: data.buildings.map((b) => ({ id: b.id!, name: b.name, travelMinutes: (b.travelMinutes ?? {}) as Record<string, number> })),
    rooms: data.rooms.map((r) => ({
      id: r.id!,
      name: r.name,
      type: r.type,
      capacity: Number(r.capacity),
      buildingId: r.buildingId ?? null,
      ownerDeptId: r.ownerDeptId ?? null,
      isEventVenue: !!r.isEventVenue,
    })),
    grids: data.grids.map((g) => ({ id: g.id!, name: g.name, open: g.open })),
    teachers: data.teachers.map((t) => ({
      id: t.id!,
      name: t.name,
      deptId: t.deptId,
      designation: t.designation,
      maxPerDay: Number(t.maxPerDay),
      maxPerWeek: Number(t.maxPerWeek),
      unavailable: (t.unavailable ?? []) as [number, number][],
      prefs: t.prefs ?? [],
    })),
    sections: data.sections.map((s) => {
      const existing = data.batches[s.id ?? ""] ?? [];
      const n = Number(s.batchCount);
      const batches =
        existing.length === n
          ? existing
          : splitBatches(Number(s.size), n).map((b) => ({ id: `${s.id}-${b.name}`, ...b }));
      const program = programs.get(s.programId);
      return {
        id: s.id!,
        name: s.name,
        deptId: program?.deptId ?? "",
        programName: program?.name ?? "",
        year: Number(s.year),
        size: Number(s.size),
        gridId: s.gridId,
        batches,
      };
    }),
    subjects: data.subjects.map((s) => ({
      id: s.id!,
      code: s.code,
      name: s.name,
      deptId: s.deptId,
      mode: s.mode,
      L: Number(s.L),
      T: Number(s.T),
      P: Number(s.P),
      hoursPerWeek: Number(s.hoursPerWeek),
      theoryRoomType: s.theoryRoomType ?? "Classroom",
      labRoomType: s.labRoomType ?? "Classroom",
      labBlockLen: Number(s.labBlockLen),
    })),
    offerings: data.offerings.map((o) => ({
      id: o.id!,
      subjectId: o.subjectId,
      sectionIds: o.sectionIds,
      teacherIds: o.teacherIds ?? [],
      labTeacherIds: o.labTeacherIds ?? [],
      batchwiseLab: o.batchwiseLab ?? true,
      basketId: o.basketId ?? null,
      expectedSize: o.expectedSize == null ? null : Number(o.expectedSize),
    })),
    baskets: data.baskets.map((b) => ({ id: b.id!, name: b.name, sectionIds: b.sectionIds })),
  };
}

/** The reverse: setup rows from a solver input (used for the demo, samples and tests). */
export function fromInstituteInput(input: InstituteInput): SetupData {
  const programs = new Map<string, { id: string; name: string; deptId: string }>();
  for (const s of input.sections) {
    if (!programs.has(s.programName)) programs.set(s.programName, { id: `p-${programs.size + 1}`, name: s.programName, deptId: s.deptId });
  }
  return {
    settings: { name: input.name, days: input.days, periods: input.periods, passingMinutes: input.passingMinutes },
    rules: input.rules,
    grids: input.grids,
    batches: Object.fromEntries(input.sections.map((s) => [s.id, s.batches])),
    departments: input.departments,
    buildings: input.buildings,
    rooms: input.rooms,
    teachers: input.teachers.map((t) => ({ ...t, email: "" })),
    programs: [...programs.values()],
    sections: input.sections.map((s) => ({
      id: s.id,
      name: s.name,
      programId: programs.get(s.programName)!.id,
      year: s.year,
      size: s.size,
      gridId: s.gridId,
      batchCount: s.batches.length,
    })),
    subjects: input.subjects,
    baskets: input.baskets,
    offerings: input.offerings,
  };
}
