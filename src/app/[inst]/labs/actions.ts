"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAction, AccessError, type Access } from "@/lib/access";
import { addDays, todayIso } from "@/lib/calendar";
import { toDate } from "@/lib/cover-db";
import { prisma } from "@/lib/db";
import { isoDate as isoDateSchema } from "@/lib/dates";
import { canManageRoom, labTypes } from "@/lib/downtime";
import { loadConflicts } from "@/lib/downtime-db";
import { loadImpactContext } from "@/lib/placements-db";
import { notify, withdrawBooking } from "@/lib/venue-ops";
import { periodRange } from "@/lib/venues";

export type LabResult = { ok: true; message?: string } | { ok: false; error: string };

const isoDate = isoDateSchema();
const pretty = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });

async function manager(slug: string): Promise<Access | string> {
  try {
    return await requireAction(slug, "labs.manage");
  } catch (e) {
    if (e instanceof AccessError) return e.message;
    throw e;
  }
}

async function roomFor(access: Access, roomId: string) {
  const institutionId = access.inst.id;
  const [room, subjects] = await Promise.all([
    prisma.room.findFirst({ where: { id: roomId, institutionId } }),
    prisma.subject.findMany({ where: { institutionId }, select: { P: true, labRoomType: true, theoryRoomType: true } }),
  ]);
  if (!room) return { error: "That room no longer exists." };
  if (!canManageRoom(access.member, room, labTypes(subjects))) return { error: "You can only mark the labs you look after." };
  return { room };
}

const downtimeInput = z.object({
  roomId: z.string().min(1, "Pick a room"),
  from: isoDate,
  to: isoDate,
  periods: z.array(z.number().int().min(0).max(20)).max(20),
  reason: z.string().trim().min(3, "Say what's wrong").max(140),
});

export async function markDowntime(slug: string, input: unknown): Promise<LabResult> {
  const access = await manager(slug);
  if (typeof access === "string") return { ok: false, error: access };
  const parsed = downtimeInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const v = parsed.data;
  if (v.to < v.from) return { ok: false, error: "The end date is before the start." };
  if (v.to < todayIso()) return { ok: false, error: "Those dates have passed." };
  if (v.to > addDays(v.from, 180)) return { ok: false, error: "Mark at most 180 days at a time." };
  const found = await roomFor(access, v.roomId);
  if ("error" in found) return { ok: false, error: found.error! };
  const { room } = found;
  const institutionId = access.inst.id;
  await prisma.roomDowntime.create({
    data: { institutionId, roomId: room.id, fromDate: toDate(v.from), toDate: toDate(v.to), periods: v.periods, reason: v.reason, createdBy: access.user!.id },
  });

  // Room bookings in that time are off; tell their requesters.
  const inst = await prisma.institution.findUniqueOrThrow({ where: { id: institutionId }, select: { periods: true } });
  const periods = inst.periods as { start: string; end: string }[];
  const bookings = await prisma.venueBooking.findMany({
    where: { institutionId, roomId: room.id, status: { in: ["PENDING", "APPROVED"] }, date: { gte: toDate(v.from), lte: toDate(v.to) } },
  });
  for (const b of bookings) {
    if (v.periods.length && !v.periods.some((p) => p >= b.startPeriod && p <= b.endPeriod)) continue;
    await withdrawBooking(institutionId, b.id, `${room.name} is out of service: ${v.reason}.`);
    const date = b.date.toISOString().slice(0, 10);
    await notify(institutionId, [b.requestedBy], `Your booking "${b.title}" (${room.name}, ${pretty(date)}, ${periodRange(b.startPeriod, b.endPeriod, periods)}) is off: the room is out of service (${v.reason}). Please book another room.`, `/${slug}/venues?date=${date}`);
  }

  // Teachers whose classes are affected hear about it; the lab staff then move the classes.
  const ctx = await loadImpactContext(institutionId);
  let affected = 0;
  if (ctx) {
    const days = Math.min(60, Math.round((toDate(v.to).getTime() - toDate(v.from).getTime()) / 86400_000) + 1);
    const conflicts = (await loadConflicts(institutionId, ctx, v.from < todayIso() ? todayIso() : v.from, days)).map((d) => ({ ...d, open: d.open.filter((c) => c.roomId === room.id) }));
    const teacherIds = new Set<string>();
    for (const d of conflicts) for (const c of d.open) for (const t of ctx.problem.lessons.find((l) => l.id === c.lessonId)?.teacherIds ?? []) teacherIds.add(t);
    affected = conflicts.reduce((n, d) => n + d.open.length, 0);
    const members = await prisma.membership.findMany({ where: { institutionId, teacherId: { in: [...teacherIds] } }, select: { userId: true } });
    await notify(
      institutionId,
      members.map((m) => m.userId),
      `${room.name} is out of service ${v.from === v.to ? `on ${pretty(v.from)}` : `from ${pretty(v.from)} to ${pretty(v.to)}`} (${v.reason}). Your classes there need another room; Today shows where they go.`,
      `/${slug}/today?date=${v.from}`,
    );
  }
  revalidatePath(`/${slug}`, "layout");
  return {
    ok: true,
    message: `${room.name} marked out of service.${affected ? ` ${affected} class${affected === 1 ? "" : "es"} need${affected === 1 ? "s" : ""} another room (below).` : ""}${bookings.length ? " Bookings in that time were called off." : ""}`,
  };
}

export async function removeDowntime(slug: string, id: string): Promise<LabResult> {
  const access = await manager(slug);
  if (typeof access === "string") return { ok: false, error: access };
  const d = await prisma.roomDowntime.findFirst({ where: { id, institutionId: access.inst.id } });
  if (!d) return { ok: false, error: "That entry no longer exists." };
  const found = await roomFor(access, d.roomId);
  if ("error" in found) return { ok: false, error: found.error! };
  await prisma.roomDowntime.delete({ where: { id } });
  revalidatePath(`/${slug}`, "layout");
  return { ok: true, message: "Back in service. Classes already moved stay in their new rooms; undo them below if needed." };
}

const moveInput = z.object({ date: isoDate, lessonId: z.string(), roomId: z.string().nullable() });

/** Hold a class in another room on one date (roomId null = back to its usual room). */
export async function moveClass(slug: string, input: unknown): Promise<LabResult> {
  const access = await manager(slug);
  if (typeof access === "string") return { ok: false, error: access };
  const parsed = moveInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Bad request." };
  const v = parsed.data;
  const institutionId = access.inst.id;
  const ctx = await loadImpactContext(institutionId);
  if (!ctx) return { ok: false, error: "No timetable is published." };
  const lesson = ctx.problem.lessons.find((l) => l.id === v.lessonId);
  const placed = ctx.assignment[v.lessonId];
  if (!lesson || !placed) return { ok: false, error: "That class isn't in the published timetable." };
  // Permission is judged on the class's usual room (the one that is out of service).
  const found = await roomFor(access, placed.roomId);
  if ("error" in found) return { ok: false, error: found.error! };

  const key = { institutionId_date_lessonId: { institutionId, date: toDate(v.date), lessonId: v.lessonId } };
  if (!v.roomId) {
    const undone = await prisma.roomMove.deleteMany({ where: { institutionId, date: toDate(v.date), lessonId: v.lessonId } });
    // Nothing was moved, so there is nothing to tell anyone (and no way to spam them).
    if (!undone.count) return { ok: true };
  } else {
    const day = (await loadConflicts(institutionId, ctx, v.date, 1))[0];
    const clash = day?.open.find((c) => c.lessonId === v.lessonId);
    if (!clash) return { ok: false, error: "That class doesn't need another room that day." };
    if (!clash.options.some((o) => o.id === v.roomId)) return { ok: false, error: "That room isn't free for the whole class any more. Pick another." };
    await prisma.roomMove.upsert({
      where: key,
      create: { institutionId, date: toDate(v.date), versionId: ctx.versionId, lessonId: v.lessonId, roomId: v.roomId, createdBy: access.user!.id },
      update: { roomId: v.roomId, versionId: ctx.versionId },
    });
  }
  const newRoom = v.roomId ? ctx.snapshot.rooms.find((r) => r.id === v.roomId)?.name ?? "another room" : ctx.snapshot.rooms.find((r) => r.id === placed.roomId)?.name ?? "its usual room";
  const members = await prisma.membership.findMany({
    where: { institutionId, OR: [{ teacherId: { in: lesson.teacherIds } }, { sectionId: { in: lesson.sectionIds } }] },
    select: { userId: true },
  });
  const time = periodRange(placed.period, placed.period + lesson.duration - 1, ctx.snapshot.periods);
  await notify(institutionId, members.map((m) => m.userId), `${lesson.label} on ${pretty(v.date)}, ${time}: now in ${newRoom}.`, `/${slug}/today?date=${v.date}`);
  revalidatePath(`/${slug}`, "layout");
  return { ok: true };
}
