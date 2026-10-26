"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAction, AccessError, type Access } from "@/lib/access";
import { addDays, todayIso } from "@/lib/calendar";
import { toDate } from "@/lib/cover-db";
import { prisma } from "@/lib/db";
import { isoDate as isoDateSchema, MAX_DAYS_AHEAD } from "@/lib/dates";
import { countsFromRolls, parseRolls, type Attendance, type RollRow } from "@/lib/placements";
import { loadImpactContext, roundHits } from "@/lib/placements-db";
import { notify, submitBooking, withdrawBooking } from "@/lib/venue-ops";

export type DriveResult = { ok: true; id: string; warnings: string[] } | { ok: false; error: string };

const isoDate = isoDateSchema();
const driveInput = z.object({
  id: z.string().nullable(),
  company: z.string().trim().min(2, "Company name?").max(80),
  role: z.string().trim().max(80).default(""),
  notes: z.string().trim().max(500).default(""),
  attending: z.array(z.object({ sectionId: z.string(), count: z.number().int().min(0) })).max(200),
  /** Pasted "roll, section" lines; when given they replace the counts. */
  rollsText: z.string().max(200_000).default(""),
  rounds: z
    .array(
      z.object({
        id: z.string().nullable(),
        name: z.string().trim().min(2, "Name each round").max(60),
        date: isoDate,
        start: z.number().int().min(0),
        end: z.number().int().min(0),
        roomId: z.string().nullable(),
      }),
    )
    .min(1, "Add at least one round")
    .max(20),
});

async function officer(slug: string): Promise<Access | string> {
  try {
    return await requireAction(slug, "placement.manage");
  } catch (e) {
    if (e instanceof AccessError) return e.message;
    throw e;
  }
}

export async function saveDrive(slug: string, input: unknown): Promise<DriveResult> {
  const access = await officer(slug);
  if (typeof access === "string") return { ok: false, error: access };
  const parsed = driveInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const v = parsed.data;
  const institutionId = access.inst.id;
  const userId = access.user!.id;

  const [sections, rooms, inst, existing] = await Promise.all([
    prisma.section.findMany({ where: { institutionId }, select: { id: true, name: true, size: true } }),
    prisma.room.findMany({ where: { institutionId }, select: { id: true } }),
    prisma.institution.findUniqueOrThrow({ where: { id: institutionId }, select: { periods: true } }),
    v.id ? prisma.placementDrive.findFirst({ where: { id: v.id, institutionId }, include: { rounds: true } }) : null,
  ]);
  if (v.id && !existing) return { ok: false, error: "That drive no longer exists." };
  const P = (inst.periods as unknown[]).length;

  let attending: Attendance[];
  let rolls: RollRow[] = [];
  if (v.rollsText.trim()) {
    const res = parseRolls(v.rollsText, sections);
    if (res.errors.length) return { ok: false, error: `Roll list: ${res.errors.slice(0, 3).join(" ")}${res.errors.length > 3 ? ` (+${res.errors.length - 3} more)` : ""}` };
    rolls = res.rows;
    attending = countsFromRolls(rolls);
  } else {
    // A section listed twice counts once, with its numbers added, before checking its size.
    const merged = new Map<string, number>();
    for (const a of v.attending) if (a.count > 0) merged.set(a.sectionId, (merged.get(a.sectionId) ?? 0) + a.count);
    attending = [...merged].map(([sectionId, count]) => ({ sectionId, count }));
  }
  for (const a of attending) {
    const s = sections.find((x) => x.id === a.sectionId);
    if (!s) return { ok: false, error: "A chosen section no longer exists." };
    if (a.count > s.size) return { ok: false, error: `${s.name} has only ${s.size} students.` };
  }
  if (!attending.length) return { ok: false, error: "Choose who takes part: sections with a number of students, or paste roll numbers." };
  for (const r of v.rounds) {
    if (r.start > r.end || r.end >= P) return { ok: false, error: `${r.name}: pick a valid run of periods.` };
    if (r.roomId && !rooms.some((x) => x.id === r.roomId)) return { ok: false, error: `${r.name}: that room no longer exists.` };
    // A new round, or one whose date changes, must be today or later (and within a year).
    const old = existing?.rounds.find((x) => x.id === r.id);
    const moved = !old || old.date.toISOString().slice(0, 10) !== r.date;
    if (moved && r.date < todayIso()) return { ok: false, error: `${r.name}: that date has passed.` };
    if (moved && r.date > addDays(todayIso(), MAX_DAYS_AHEAD)) return { ok: false, error: `${r.name}: plan at most a year ahead.` };
  }

  const data = { company: v.company, role: v.role, notes: v.notes, attending: attending as object[], rolls: rolls as object[] };
  const drive = existing
    ? await prisma.placementDrive.update({ where: { id: existing.id }, data: v.rollsText.trim() ? data : { ...data, rolls: existing.rolls as object[] } })
    : await prisma.placementDrive.create({ data: { ...data, institutionId, createdBy: userId } });

  // Rounds: keep, update or remove; (re)request the venue when the room or time changed.
  const warnings: string[] = [];
  const total = attending.reduce((n, a) => n + a.count, 0);
  const keep = new Set(v.rounds.map((r) => r.id).filter(Boolean));
  for (const old of existing?.rounds ?? []) {
    if (keep.has(old.id)) continue;
    if (old.bookingId) await withdrawBooking(institutionId, old.bookingId, "The placement round was removed.");
    await prisma.placementRound.delete({ where: { id: old.id } });
  }
  const changed: string[] = [];
  const changedIds: string[] = [];
  for (const r of v.rounds) {
    const old = existing?.rounds.find((x) => x.id === r.id);
    const sameSlot = old && old.date.toISOString().slice(0, 10) === r.date && old.startPeriod === r.start && old.endPeriod === r.end;
    const sameRoom = old && old.roomId === r.roomId;
    let bookingId = old?.bookingId ?? null;
    if (!sameSlot || !sameRoom) {
      changed.push(r.name);
      if (bookingId) await withdrawBooking(institutionId, bookingId, "The placement round moved.");
      bookingId = null;
      if (r.roomId) {
        const res = await submitBooking(institutionId, slug, userId, access.member!, {
          date: r.date,
          roomId: r.roomId,
          start: r.start,
          end: r.end,
          title: `${v.company}: ${r.name}`,
          attendees: total,
          priority: "PLACEMENT",
          override: false,
        });
        if (res.ok) bookingId = res.id;
        else warnings.push(`${r.name}: ${res.error}`);
      }
    }
    const row = { name: r.name, date: toDate(r.date), startPeriod: r.start, endPeriod: r.end, roomId: r.roomId, bookingId };
    const saved = old ? await prisma.placementRound.update({ where: { id: old.id }, data: row }) : await prisma.placementRound.create({ data: { ...row, driveId: drive.id } });
    if (!sameSlot || !sameRoom) changedIds.push(saved.id);
  }

  // Tell the teachers whose classes lose students, and the students taking part, when a round is new or moved.
  if (changed.length || !existing) {
    const link = `/${slug}/placements#${drive.id}`;
    const ctx = await loadImpactContext(institutionId);
    const rounds = await prisma.placementRound.findMany({ where: { driveId: drive.id } });
    if (ctx) {
      const hits = await roundHits(institutionId, ctx, rounds.filter((r) => changedIds.includes(r.id)).map((r) => ({ ...r, attending })));
      const teacherIds = [...new Set([...hits.values()].flat().flatMap((h) => h.teacherIds))];
      const teachers = await prisma.membership.findMany({ where: { institutionId, teacherId: { in: teacherIds } }, select: { userId: true } });
      await notify(institutionId, teachers.map((t) => t.userId), `${v.company} placement drive takes students from some of your classes. See which ones and how many.`, link);
    }
    const students = await prisma.membership.findMany({ where: { institutionId, role: "STUDENT", sectionId: { in: attending.map((a) => a.sectionId) } }, select: { userId: true } });
    await notify(institutionId, students.map((s) => s.userId), `${v.company} placement drive${v.role ? ` (${v.role})` : ""}: ${existing ? "rounds updated" : "your section can take part"}.`, link);
  }

  revalidatePath(`/${slug}`, "layout");
  return { ok: true, id: drive.id, warnings };
}

export async function deleteDrive(slug: string, id: string): Promise<DriveResult> {
  const access = await officer(slug);
  if (typeof access === "string") return { ok: false, error: access };
  const drive = await prisma.placementDrive.findFirst({ where: { id, institutionId: access.inst.id }, include: { rounds: true } });
  if (!drive) return { ok: false, error: "That drive no longer exists." };
  for (const r of drive.rounds) if (r.bookingId) await withdrawBooking(access.inst.id, r.bookingId, "The placement drive was removed.");
  await prisma.placementDrive.delete({ where: { id } });
  revalidatePath(`/${slug}`, "layout");
  return { ok: true, id, warnings: [] };
}
