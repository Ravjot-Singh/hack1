"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { AccessError, requireAction } from "@/lib/access";
import { aiProvider, interpretWithAi } from "@/lib/rules/ai";
import { cacheKey, resolveAiRule, type AiRule } from "@/lib/rules/ai-spec";
import type { RuleDraft } from "@/lib/rules/draft";
import { toInstituteInput } from "@/lib/setup/convert";
import { loadSetup } from "@/lib/setup/load";
import { gridLunch, moveLunch } from "@/lib/setup/lunch";
import {
  basketRow,
  buildingRow,
  departmentRow,
  gridRow,
  instituteSettings,
  isNewId,
  offeringRow,
  programRow,
  roomRow,
  rowIssues,
  ruleSettings,
  sectionRow,
  splitBatches,
  subjectRow,
  teacherRow,
} from "@/lib/setup/schemas";

export type SaveResult = { ok: true } | { ok: false; error: string; rowErrors?: Record<number, string> };

type Tx = Prisma.TransactionClient;

/** A friendly, expected failure (bad input, guarded delete); shown to the admin as-is. */
class UserError extends Error {}

/**
 * Runs a save in one transaction after checking permissions. `scope` is the HOD's department
 * for department-level saves (null = the whole institute, for admins).
 */
async function run(
  slug: string,
  action: "setup.institute" | "setup.department",
  work: (institutionId: string, tx: Tx, scope: string | null) => Promise<void>,
): Promise<SaveResult> {
  let institutionId: string;
  let scope: string | null = null;
  try {
    const access = await requireAction(slug, action);
    institutionId = access.inst.id;
    if (access.member?.role === "HOD") {
      if (!access.member.departmentId) return { ok: false, error: "Your HOD account isn't linked to a department; ask the admin." };
      scope = access.member.departmentId;
    }
  } catch (e) {
    if (e instanceof AccessError) return { ok: false, error: e.message };
    throw e;
  }
  try {
    await prisma.$transaction((tx) => work(institutionId, tx, scope), { timeout: 30000 });
  } catch (e) {
    if (e instanceof UserError) return { ok: false, error: e.message };
    if (e instanceof RowsError) return { ok: false, error: e.message, rowErrors: e.rowErrors };
    console.error(e);
    return { ok: false, error: "Saving failed unexpectedly. Please try again." };
  }
  revalidatePath(`/${slug}`, "layout");
  return { ok: true };
}

class RowsError extends Error {
  constructor(public rowErrors: Record<number, string>) {
    const n = Object.keys(rowErrors).length;
    super(`${n} row${n > 1 ? "s need" : " needs"} fixing before saving.`);
  }
}

function parseRows<S extends z.ZodTypeAny>(schema: S, rows: unknown): z.output<S>[] {
  const res = z.array(schema).safeParse(rows);
  if (!res.success) throw new RowsError(rowIssues(res.error));
  return res.data;
}

function noDuplicates<T>(rows: T[], key: (r: T) => string, what: string) {
  const seen = new Map<string, number>();
  const errors: Record<number, string> = {};
  rows.forEach((r, i) => {
    const k = key(r).toLowerCase();
    if (seen.has(k)) errors[i] = `Duplicate ${what} "${key(r)}" (also row ${seen.get(k)! + 1})`;
    else seen.set(k, i);
  });
  if (Object.keys(errors).length) throw new RowsError(errors);
}

/** Ids from the client must already belong to this institute (or be new). */
function checkIds(ids: (string | undefined)[], existing: Set<string>, what: string) {
  for (const id of ids) if (id && !isNewId(id) && !existing.has(id)) throw new UserError(`Unknown ${what}; reload the page and try again.`);
}

function mustExist(id: string | null | undefined, valid: Set<string>, what: string) {
  if (id && !valid.has(id)) throw new UserError(`The selected ${what} no longer exists; reload the page.`);
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

// ---------------------------------------------------------------- Institute & rules

export async function saveSettings(slug: string, input: unknown): Promise<SaveResult> {
  const parsed = instituteSettings.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const s = parsed.data;
  return run(slug, "setup.institute", async (institutionId, tx) => {
    const D = s.days.length;
    const P = s.periods.length;
    // Keep every grid and teacher's availability in step with the new week shape.
    const grids = await tx.timeGrid.findMany({ where: { institutionId } });
    for (const g of grids) {
      const open = g.open as boolean[][];
      const resized = Array.from({ length: D }, (_, d) => Array.from({ length: P }, (_, p) => open[d]?.[p] ?? true));
      await tx.timeGrid.update({ where: { id: g.id }, data: { open: resized } });
    }
    const teachers = await tx.teacher.findMany({ where: { institutionId } });
    for (const t of teachers) {
      const un = (t.unavailable as [number, number][]).filter(([d, p]) => d < D && p < P);
      const prefs = (t.prefs as { day: number; period: number }[]).filter((x) => x.day < D && x.period < P);
      await tx.teacher.update({ where: { id: t.id }, data: { unavailable: un, prefs } });
    }
    await tx.institution.update({
      where: { id: institutionId },
      data: { name: s.name, days: s.days, periods: s.periods, passingMinutes: s.passingMinutes },
    });
  });
}

export async function saveRules(slug: string, input: unknown): Promise<SaveResult> {
  const parsed = ruleSettings.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  return run(slug, "setup.institute", async (institutionId, tx) => {
    await tx.institution.update({ where: { id: institutionId }, data: { rules: parsed.data } });
  });
}

// ---------------------------------------------------------------- Departments

export async function saveDepartments(slug: string, input: unknown): Promise<SaveResult> {
  return run(slug, "setup.institute", async (institutionId, tx) => {
    const rows = parseRows(departmentRow, input);
    noDuplicates(rows, (r) => r.code, "code");
    const existing = await tx.department.findMany({
      where: { institutionId },
      include: { _count: { select: { sections: true, teachers: true, subjects: true, programs: true } } },
    });
    checkIds(rows.map((r) => r.id), new Set(existing.map((d) => d.id)), "department");
    const keep = new Set(rows.map((r) => r.id));
    const removed = existing.filter((d) => !keep.has(d.id));
    for (const d of removed) {
      const c = d._count;
      const uses = [
        c.programs && plural(c.programs, "program"),
        c.sections && plural(c.sections, "section"),
        c.teachers && plural(c.teachers, "teacher"),
        c.subjects && plural(c.subjects, "subject"),
      ].filter(Boolean);
      if (uses.length) throw new UserError(`Can't delete ${d.code}: it still has ${uses.join(", ")}. Move or delete those first.`);
    }
    await tx.department.deleteMany({ where: { id: { in: removed.map((d) => d.id) } } });
    // Two passes so swapping codes between rows doesn't hit the unique constraint.
    for (const r of rows) if (!isNewId(r.id)) await tx.department.update({ where: { id: r.id }, data: { code: `~${r.id}` } });
    for (const r of rows) {
      if (isNewId(r.id)) await tx.department.create({ data: { institutionId, name: r.name, code: r.code } });
      else await tx.department.update({ where: { id: r.id }, data: { name: r.name, code: r.code } });
    }
  });
}

// ---------------------------------------------------------------- Buildings & rooms

export async function saveBuildings(slug: string, input: unknown): Promise<SaveResult> {
  return run(slug, "setup.institute", async (institutionId, tx) => {
    const rows = parseRows(buildingRow, input);
    noDuplicates(rows, (r) => r.name, "building");
    const existing = await tx.building.findMany({ where: { institutionId } });
    checkIds(rows.map((r) => r.id), new Set(existing.map((b) => b.id)), "building");
    const keep = new Set(rows.map((r) => r.id));
    await tx.building.deleteMany({ where: { institutionId, id: { in: existing.filter((b) => !keep.has(b.id)).map((b) => b.id) } } });
    // Create first, then write travel times with temporary ids mapped to real ones.
    const idMap = new Map<string, string>();
    for (const r of rows) {
      if (isNewId(r.id)) {
        const b = await tx.building.create({ data: { institutionId, name: r.name } });
        idMap.set(r.id ?? "", b.id);
      } else idMap.set(r.id!, r.id!);
    }
    for (const r of rows) {
      const travel: Record<string, number> = {};
      for (const [k, v] of Object.entries(r.travelMinutes)) if (idMap.has(k)) travel[idMap.get(k)!] = v;
      await tx.building.update({ where: { id: idMap.get(r.id ?? "")! }, data: { name: r.name, travelMinutes: travel } });
    }
  });
}

export async function saveRooms(slug: string, input: unknown): Promise<SaveResult> {
  return run(slug, "setup.institute", async (institutionId, tx) => {
    const rows = parseRows(roomRow, input);
    noDuplicates(rows, (r) => r.name, "room");
    const [existing, buildings, depts] = await Promise.all([
      tx.room.findMany({ where: { institutionId }, select: { id: true } }),
      tx.building.findMany({ where: { institutionId }, select: { id: true } }),
      tx.department.findMany({ where: { institutionId }, select: { id: true } }),
    ]);
    checkIds(rows.map((r) => r.id), new Set(existing.map((x) => x.id)), "room");
    const bIds = new Set(buildings.map((b) => b.id));
    const dIds = new Set(depts.map((d) => d.id));
    const keep = new Set(rows.map((r) => r.id));
    await tx.room.deleteMany({ where: { institutionId, id: { in: existing.filter((x) => !keep.has(x.id)).map((x) => x.id) } } });
    for (const r of rows) {
      mustExist(r.buildingId, bIds, "building");
      mustExist(r.ownerDeptId, dIds, "department");
      const data = {
        name: r.name,
        type: r.type,
        capacity: r.capacity,
        buildingId: r.buildingId,
        ownerDeptId: r.ownerDeptId,
        isEventVenue: r.isEventVenue,
      };
      if (isNewId(r.id)) await tx.room.create({ data: { institutionId, ...data } });
      else await tx.room.update({ where: { id: r.id }, data });
    }
  });
}

// ---------------------------------------------------------------- Time grids

export async function saveGrids(slug: string, input: unknown): Promise<SaveResult> {
  return run(slug, "setup.institute", async (institutionId, tx) => {
    const rows = parseRows(gridRow, input);
    if (!rows.length) throw new UserError("Keep at least one time grid.");
    noDuplicates(rows, (r) => r.name, "grid");
    const existing = await tx.timeGrid.findMany({ where: { institutionId }, include: { _count: { select: { sections: true } } } });
    checkIds(rows.map((r) => r.id), new Set(existing.map((g) => g.id)), "grid");
    const keep = new Set(rows.map((r) => r.id));
    const removed = existing.filter((g) => !keep.has(g.id));
    const used = removed.find((g) => g._count.sections);
    if (used) throw new UserError(`Can't delete grid "${used.name}": ${plural(used._count.sections, "section")} still use it.`);
    await tx.timeGrid.deleteMany({ where: { id: { in: removed.map((g) => g.id) } } });
    for (const r of rows) {
      if (isNewId(r.id)) await tx.timeGrid.create({ data: { institutionId, name: r.name, open: r.open } });
      else await tx.timeGrid.update({ where: { id: r.id }, data: { name: r.name, open: r.open } });
    }
  });
}

// ---------------------------------------------------------------- Lunch by department

const lunchPlan = z.object({ lunches: z.record(z.string(), z.number().int().min(0).max(20).nullable()) });
const LUNCH_SUFFIX = / · lunch P\d+$/;

/**
 * Give each department its own lunch period: every section of the department moves to a copy
 * of its current grid with lunch at that period (half days and other breaks are kept).
 * Grids made this way that no section uses any more are removed.
 */
export async function applyLunchPlan(slug: string, input: unknown): Promise<SaveResult & { message?: string }> {
  const parsed = lunchPlan.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Bad lunch plan." };
  let moved = 0;
  let created = 0;
  const res = await run(slug, "setup.institute", async (institutionId, tx) => {
    const [inst, grids, sections, programs] = await Promise.all([
      tx.institution.findUniqueOrThrow({ where: { id: institutionId }, select: { periods: true } }),
      tx.timeGrid.findMany({ where: { institutionId } }),
      tx.section.findMany({ where: { institutionId } }),
      tx.program.findMany({ where: { institutionId } }),
    ]);
    const P = (inst.periods as unknown[]).length;
    const deptOf = new Map(programs.map((p) => [p.id, p.departmentId]));
    const all = grids.map((g) => ({ id: g.id, name: g.name, open: g.open as boolean[][] }));
    const same = (a: boolean[][], b: boolean[][]) => JSON.stringify(a) === JSON.stringify(b);
    for (const s of sections) {
      const lunch = parsed.data.lunches[deptOf.get(s.programId) ?? ""];
      if (lunch == null) continue;
      if (lunch >= P) throw new UserError("That lunch period isn't in the bell schedule.");
      const grid = all.find((g) => g.id === s.gridId)!;
      if (gridLunch(grid.open) === lunch) continue;
      const open = moveLunch(grid.open, lunch);
      let target = all.find((g) => same(g.open, open));
      if (!target) {
        const base = `${grid.name.replace(LUNCH_SUFFIX, "")} · lunch P${lunch + 1}`;
        let name = base;
        for (let i = 2; all.some((g) => g.name === name); i++) name = `${base} (${i})`;
        const row = await tx.timeGrid.create({ data: { institutionId, name, open } });
        target = { id: row.id, name, open };
        all.push(target);
        created++;
      }
      await tx.section.update({ where: { id: s.id }, data: { gridId: target.id } });
      s.gridId = target.id;
      moved++;
    }
    const used = new Set(sections.map((s) => s.gridId));
    await tx.timeGrid.deleteMany({ where: { institutionId, id: { in: all.filter((g) => LUNCH_SUFFIX.test(g.name) && !used.has(g.id)).map((g) => g.id) } } });
  });
  if (!res.ok) return res;
  return { ok: true, message: moved ? `Moved ${plural(moved, "section")} to their department's lunch${created ? ` (${plural(created, "new grid")})` : ""}.` : "Nothing to change." };
}

// ---------------------------------------------------------------- Teachers

export async function saveTeachers(slug: string, input: unknown): Promise<SaveResult> {
  return run(slug, "setup.department", async (institutionId, tx, scope) => {
    const rows = parseRows(teacherRow, input);
    noDuplicates(rows, (r) => r.name, "teacher");
    if (scope && rows.some((r) => r.deptId !== scope)) throw new UserError("You can only change your own department's teachers.");
    const [existing, depts] = await Promise.all([
      tx.teacher.findMany({
        where: { institutionId, ...(scope ? { departmentId: scope } : {}) },
        include: { _count: { select: { offerings: true, labOfferings: true } } },
      }),
      tx.department.findMany({ where: { institutionId }, select: { id: true } }),
    ]);
    checkIds(rows.map((r) => r.id), new Set(existing.map((t) => t.id)), "teacher");
    const dIds = new Set(depts.map((d) => d.id));
    const keep = new Set(rows.map((r) => r.id));
    const removed = existing.filter((t) => !keep.has(t.id));
    const busy = removed.find((t) => t._count.offerings + t._count.labOfferings > 0);
    if (busy) {
      const n = busy._count.offerings + busy._count.labOfferings;
      throw new UserError(`${busy.name} teaches ${plural(n, "class")}; remove them from Allocation first.`);
    }
    await tx.teacher.deleteMany({ where: { id: { in: removed.map((t) => t.id) } } });
    for (const r of rows) {
      mustExist(r.deptId, dIds, "department");
      const data = {
        name: r.name,
        email: r.email || null,
        departmentId: r.deptId,
        designation: r.designation,
        maxPerDay: r.maxPerDay,
        maxPerWeek: r.maxPerWeek,
        unavailable: r.unavailable,
        prefs: r.prefs,
      };
      if (isNewId(r.id)) await tx.teacher.create({ data: { institutionId, ...data } });
      else await tx.teacher.update({ where: { id: r.id }, data });
    }
  });
}

// ---------------------------------------------------------------- Programs & sections

export async function savePrograms(slug: string, input: unknown): Promise<SaveResult> {
  return run(slug, "setup.department", async (institutionId, tx, scope) => {
    const rows = parseRows(programRow, input);
    noDuplicates(rows, (r) => r.name, "program");
    if (scope && rows.some((r) => r.deptId !== scope)) throw new UserError("You can only change your own department's programs.");
    const [existing, depts] = await Promise.all([
      tx.program.findMany({
        where: { institutionId, ...(scope ? { departmentId: scope } : {}) },
        include: { _count: { select: { sections: true } } },
      }),
      tx.department.findMany({ where: { institutionId }, select: { id: true } }),
    ]);
    checkIds(rows.map((r) => r.id), new Set(existing.map((p) => p.id)), "program");
    const dIds = new Set(depts.map((d) => d.id));
    const keep = new Set(rows.map((r) => r.id));
    const removed = existing.filter((p) => !keep.has(p.id));
    const used = removed.find((p) => p._count.sections);
    if (used) throw new UserError(`Can't delete "${used.name}": it still has ${plural(used._count.sections, "section")}.`);
    await tx.program.deleteMany({ where: { id: { in: removed.map((p) => p.id) } } });
    for (const r of rows) {
      mustExist(r.deptId, dIds, "department");
      if (isNewId(r.id)) await tx.program.create({ data: { institutionId, name: r.name, departmentId: r.deptId } });
      else {
        await tx.program.update({ where: { id: r.id }, data: { name: r.name, departmentId: r.deptId } });
        // Sections follow their program's department.
        await tx.section.updateMany({ where: { programId: r.id }, data: { departmentId: r.deptId } });
      }
    }
  });
}

export async function saveSections(slug: string, input: unknown): Promise<SaveResult> {
  return run(slug, "setup.department", async (institutionId, tx, scope) => {
    const rows = parseRows(sectionRow, input);
    noDuplicates(rows, (r) => r.name, "section");
    const [existing, programs, grids] = await Promise.all([
      tx.section.findMany({
        where: { institutionId, ...(scope ? { departmentId: scope } : {}) },
        include: { batches: { orderBy: { name: "asc" } }, _count: { select: { offerings: true, baskets: true } } },
      }),
      tx.program.findMany({ where: { institutionId } }),
      tx.timeGrid.findMany({ where: { institutionId }, select: { id: true } }),
    ]);
    checkIds(rows.map((r) => r.id), new Set(existing.map((s) => s.id)), "section");
    const programDept = new Map(programs.map((p) => [p.id, p.departmentId]));
    if (scope && rows.some((r) => programDept.get(r.programId) !== scope)) throw new UserError("You can only change your own department's sections.");
    const gIds = new Set(grids.map((g) => g.id));
    const keep = new Set(rows.map((r) => r.id));
    const removed = existing.filter((s) => !keep.has(s.id));
    const used = removed.find((s) => s._count.offerings || s._count.baskets);
    if (used) {
      throw new UserError(`Can't delete ${used.name}: it still has ${plural(used._count.offerings, "subject")} in Allocation. Remove those first.`);
    }
    await tx.section.deleteMany({ where: { id: { in: removed.map((s) => s.id) } } });
    for (const r of rows) {
      mustExist(r.programId, new Set(programDept.keys()), "program");
      mustExist(r.gridId, gIds, "time grid");
      const data = {
        name: r.name,
        programId: r.programId,
        departmentId: programDept.get(r.programId)!,
        year: r.year,
        size: r.size,
        gridId: r.gridId,
      };
      const wanted = splitBatches(r.size, r.batchCount);
      if (isNewId(r.id)) {
        await tx.section.create({ data: { institutionId, ...data, batches: { create: wanted } } });
        continue;
      }
      await tx.section.update({ where: { id: r.id }, data });
      const current = existing.find((s) => s.id === r.id)!.batches;
      if (current.length === wanted.length) {
        // Same number of batches: keep ids (lesson ids stay stable), just resize.
        for (let i = 0; i < current.length; i++) {
          if (current[i].size !== wanted[i].size || current[i].name !== wanted[i].name) {
            await tx.batch.update({ where: { id: current[i].id }, data: wanted[i] });
          }
        }
      } else {
        await tx.batch.deleteMany({ where: { sectionId: r.id } });
        if (wanted.length) await tx.batch.createMany({ data: wanted.map((b) => ({ ...b, sectionId: r.id! })) });
      }
    }
  });
}

// ---------------------------------------------------------------- Subjects

export async function saveSubjects(slug: string, input: unknown): Promise<SaveResult> {
  return run(slug, "setup.department", async (institutionId, tx, scope) => {
    const rows = parseRows(subjectRow, input);
    noDuplicates(rows, (r) => r.code, "subject code");
    if (scope && rows.some((r) => r.deptId !== scope)) throw new UserError("You can only change your own department's subjects.");
    const [existing, depts] = await Promise.all([
      tx.subject.findMany({
        where: { institutionId, ...(scope ? { departmentId: scope } : {}) },
        include: { _count: { select: { offerings: true } } },
      }),
      tx.department.findMany({ where: { institutionId }, select: { id: true } }),
    ]);
    if (scope) {
      // Subject codes are unique across the whole college.
      const others = await tx.subject.findMany({ where: { institutionId, NOT: { departmentId: scope } }, select: { code: true } });
      const taken = new Set(others.map((o) => o.code));
      const clash = rows.find((r) => taken.has(r.code));
      if (clash) throw new UserError(`Subject code ${clash.code} is already used by another department.`);
    }
    checkIds(rows.map((r) => r.id), new Set(existing.map((s) => s.id)), "subject");
    const dIds = new Set(depts.map((d) => d.id));
    const keep = new Set(rows.map((r) => r.id));
    const removed = existing.filter((s) => !keep.has(s.id));
    const used = removed.find((s) => s._count.offerings);
    if (used) throw new UserError(`Can't delete ${used.code}: it is allocated to ${plural(used._count.offerings, "section")}. Remove it from Allocation first.`);
    await tx.subject.deleteMany({ where: { id: { in: removed.map((s) => s.id) } } });
    for (const r of rows) if (!isNewId(r.id)) await tx.subject.update({ where: { id: r.id }, data: { code: `~${r.id}` } });
    for (const r of rows) {
      mustExist(r.deptId, dIds, "department");
      const { id, deptId, ...rest } = r;
      const data = { ...rest, departmentId: deptId };
      if (isNewId(id)) await tx.subject.create({ data: { institutionId, ...data } });
      else await tx.subject.update({ where: { id }, data });
    }
  });
}

// ---------------------------------------------------------------- Allocation (offerings + baskets)

export async function saveAllocation(slug: string, input: { baskets: unknown; offerings: unknown }): Promise<SaveResult> {
  return run(slug, "setup.department", async (institutionId, tx, scope) => {
    const offerings = parseRows(offeringRow, input.offerings);
    const [exO, exB, subjects, sections, teachers] = await Promise.all([
      // An HOD allocates their own department's subjects (to any section).
      tx.offering.findMany({ where: { institutionId, ...(scope ? { subject: { departmentId: scope } } : {}) }, select: { id: true } }),
      tx.electiveBasket.findMany({ where: { institutionId }, select: { id: true, name: true, sections: { select: { id: true } } } }),
      tx.subject.findMany({ where: { institutionId, ...(scope ? { departmentId: scope } : {}) }, select: { id: true } }),
      tx.section.findMany({ where: { institutionId }, select: { id: true } }),
      tx.teacher.findMany({ where: { institutionId }, select: { id: true } }),
    ]);
    // Elective baskets span departments, so only admins change them; HOD saves keep them as they are.
    const baskets = scope
      ? exB.map((b) => ({ id: b.id, name: b.name, sectionIds: b.sections.map((x) => x.id) }))
      : parseRows(basketRow, input.baskets);
    noDuplicates(baskets, (b) => b.name, "basket");
    checkIds(offerings.map((o) => o.id), new Set(exO.map((x) => x.id)), "allocation row");
    checkIds(baskets.map((b) => b.id), new Set(exB.map((x) => x.id)), "basket");
    const subIds = new Set(subjects.map((s) => s.id));
    const secIds = new Set(sections.map((s) => s.id));
    const tIds = new Set(teachers.map((t) => t.id));

    // Offerings first (they reference baskets), then baskets.
    const keepO = new Set(offerings.map((o) => o.id));
    await tx.offering.deleteMany({ where: { institutionId, id: { in: exO.filter((x) => !keepO.has(x.id)).map((x) => x.id) } } });
    const basketIds = new Map<string, string>();
    const keepB = new Set(baskets.map((b) => b.id));
    await tx.electiveBasket.deleteMany({ where: { institutionId, id: { in: exB.filter((x) => !keepB.has(x.id)).map((x) => x.id) } } });
    for (const b of baskets) {
      for (const s of b.sectionIds) mustExist(s, secIds, "section");
      const sectionsSet = { set: b.sectionIds.map((id) => ({ id })) };
      if (isNewId(b.id)) {
        const created = await tx.electiveBasket.create({
          data: { institutionId, name: b.name, sections: { connect: b.sectionIds.map((id) => ({ id })) } },
        });
        basketIds.set(b.id ?? "", created.id);
      } else {
        await tx.electiveBasket.update({ where: { id: b.id }, data: { name: b.name, sections: sectionsSet } });
        basketIds.set(b.id!, b.id!);
      }
    }

    const rowErrors: Record<number, string> = {};
    offerings.forEach((o, i) => {
      if (o.basketId && !basketIds.has(o.basketId)) rowErrors[i] = "Its elective basket was removed; pick another or clear it.";
      if (!subIds.has(o.subjectId)) rowErrors[i] = scope ? "You can only allocate your own department's subjects." : "Subject no longer exists.";
      if (o.sectionIds.some((s) => !secIds.has(s))) rowErrors[i] = "A section no longer exists.";
      if ([...o.teacherIds, ...o.labTeacherIds].some((t) => !tIds.has(t))) rowErrors[i] = "A teacher no longer exists.";
    });
    if (Object.keys(rowErrors).length) throw new RowsError(rowErrors);

    for (const o of offerings) {
      const basketId = o.basketId ? basketIds.get(o.basketId)! : null;
      const base = { subjectId: o.subjectId, batchwiseLab: o.batchwiseLab, splitLabBatches: o.splitLabBatches, basketId, expectedSize: o.expectedSize };
      const links = (ids: string[]) => ids.map((id) => ({ id }));
      if (isNewId(o.id)) {
        await tx.offering.create({
          data: {
            institutionId,
            ...base,
            sections: { connect: links(o.sectionIds) },
            teachers: { connect: links(o.teacherIds) },
            labTeachers: { connect: links(o.labTeacherIds) },
          },
        });
      } else {
        await tx.offering.update({
          where: { id: o.id },
          data: {
            ...base,
            sections: { set: links(o.sectionIds) },
            teachers: { set: links(o.teacherIds) },
            labTeachers: { set: links(o.labTeacherIds) },
          },
        });
      }
    }
  });
}

// ---------------------------------------------------------------- Plain-English rules (AI fallback)

/** Guard rail on the API key: calls per college per 24 hours. */
const AI_DAILY_LIMIT = 30;

export type InterpretResult =
  | { ok: true; draft: RuleDraft; source: string; cached: boolean; calls: number }
  | { ok: false; error: string; calls?: number };

/**
 * Reads a rule the built-in parser couldn't, using the configured AI provider. The same
 * sentence is answered from the AiCall log instead of calling again. Nothing is saved here:
 * the admin confirms the code-generated summary first.
 */
export async function interpretRuleWithAi(slug: string, text: string): Promise<InterpretResult> {
  let institutionId: string;
  let userId: string | null;
  try {
    const access = await requireAction(slug, "setup.institute");
    institutionId = access.inst.id;
    userId = access.user?.id ?? null;
  } catch (e) {
    if (e instanceof AccessError) return { ok: false, error: e.message };
    throw e;
  }
  const sentence = text.trim();
  if (sentence.length < 5 || sentence.length > 300) return { ok: false, error: "Write the rule as one sentence (5–300 characters)." };
  const provider = aiProvider();
  if (!provider) return { ok: false, error: "No AI key is set up. Add ANTHROPIC_API_KEY or XAI_API_KEY to the server's environment." };

  const ctx = toInstituteInput(await loadSetup(institutionId));
  const input = cacheKey(sentence);
  const calls = () => prisma.aiCall.count({ where: { institutionId } });

  const cached = await prisma.aiCall.findFirst({
    where: { institutionId, input, provider: provider.id, error: null },
    orderBy: { createdAt: "desc" },
  });
  if (cached?.output) {
    const r = resolveAiRule(cached.output as unknown as AiRule, ctx);
    return r.ok ? { ok: true, draft: r.draft, source: provider.label, cached: true, calls: await calls() } : { ok: false, error: r.reason, calls: await calls() };
  }

  const recent = await prisma.aiCall.count({ where: { institutionId, createdAt: { gte: new Date(Date.now() - 86_400_000) } } });
  if (recent >= AI_DAILY_LIMIT) return { ok: false, error: `The AI has been used ${recent} times in the last 24 hours (limit ${AI_DAILY_LIMIT}). Try again tomorrow or rephrase for the built-in reader.` };

  const res = await interpretWithAi(provider, sentence, ctx);
  await prisma.aiCall.create({
    data: {
      institutionId,
      userId,
      provider: provider.id,
      model: provider.model,
      input,
      output: res.ok ? (res.rule as unknown as Prisma.InputJsonValue) : undefined,
      error: res.ok ? null : res.error,
      inputTokens: res.ok ? res.inputTokens : null,
      outputTokens: res.ok ? res.outputTokens : null,
    },
  });
  if (!res.ok) return { ok: false, error: res.error, calls: await calls() };
  const r = resolveAiRule(res.rule, ctx);
  return r.ok ? { ok: true, draft: r.draft, source: provider.label, cached: false, calls: await calls() } : { ok: false, error: r.reason, calls: await calls() };
}
