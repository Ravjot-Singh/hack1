"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getAccess, type Access } from "@/lib/access";
import { todayIso } from "@/lib/calendar";
import { toDate } from "@/lib/cover-db";
import { prisma } from "@/lib/db";
import { alternatives, allowedPriorities, approverLabel, canDecide, checkRequest, periodRange, PRIORITIES, PRIORITY_LABEL, PRIORITY_RANK, type Room } from "@/lib/venues";
import { loadVenueDay } from "@/lib/venues-db";

export type VenueResult = { ok: true; message?: string } | { ok: false; error: string };

const requestInput = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  roomId: z.string().min(1, "Pick a room"),
  start: z.number().int().min(0),
  end: z.number().int().min(0),
  title: z.string().trim().min(3, "Say what the booking is for").max(120),
  attendees: z.number().int().min(1, "How many people?").max(5000),
  priority: z.enum(PRIORITIES as [string, ...string[]]),
  override: z.boolean().default(false),
});

async function memberAccess(slug: string): Promise<Access | string> {
  const access = await getAccess(slug);
  if (access.publicDemo) return "The shared demo is read-only.";
  if (!access.member || !access.user) return "Please sign in as a member of this college.";
  return access;
}

const noVenueManager = async (institutionId: string) => !(await prisma.membership.count({ where: { institutionId, role: "VENUE_MANAGER" } }));

/** Members who decide requests for `room`. */
async function approvers(institutionId: string, room: Room) {
  const owned = room.ownerDeptId && !room.isEventVenue;
  const where = owned
    ? { institutionId, role: "HOD" as const, departmentId: room.ownerDeptId }
    : (await noVenueManager(institutionId))
      ? { institutionId, role: "INSTITUTE_ADMIN" as const }
      : { institutionId, role: "VENUE_MANAGER" as const };
  return prisma.membership.findMany({ where, select: { userId: true } });
}

async function notify(institutionId: string, userIds: string[], text: string, link: string) {
  const unique = [...new Set(userIds)];
  if (unique.length) await prisma.notification.createMany({ data: unique.map((userId) => ({ institutionId, userId, text, link })) });
}

const altText = (rooms: Room[]) => (rooms.length ? ` Free instead: ${rooms.map((r) => `${r.name} (${r.capacity})`).join(", ")}.` : "");

export async function requestBooking(slug: string, input: unknown): Promise<VenueResult> {
  const access = await memberAccess(slug);
  if (typeof access === "string") return { ok: false, error: access };
  if (!access.can("venue.request")) return { ok: false, error: "Your role can't book rooms." };
  const parsed = requestInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const v = parsed.data;
  const member = access.member!;
  const priority = v.priority as (typeof PRIORITIES)[number];
  if (!allowedPriorities(member.role).includes(priority)) return { ok: false, error: `Your role can't book at "${PRIORITY_LABEL[priority]}" priority.` };
  if (v.date < todayIso()) return { ok: false, error: "That date has passed." };
  const institutionId = access.inst.id;

  const day = await loadVenueDay(institutionId, v.date);
  const room = day.rooms.find((r) => r.id === v.roomId);
  if (!room) return { ok: false, error: "That room no longer exists." };
  if (v.start > v.end || v.end >= day.periods.length) return { ok: false, error: "Pick a valid run of periods." };
  const req = { roomId: room.id, start: v.start, end: v.end, priority, attendees: v.attendees };
  const check = checkRequest(req, room, day.use, day.bookings);
  const when = periodRange(v.start, v.end, day.periods);
  const alts = alternatives(req, day.rooms, day.use, day.bookings);

  if (check.tooSmall) return { ok: false, error: `${room.name} holds ${room.capacity}, not ${v.attendees}.${altText(alts)}` };
  const override = v.override && member.role === "HEAD_OF_INSTITUTE";
  if (check.classes.length && !override) {
    const c = check.classes[0];
    return { ok: false, error: `${room.name} has a class then (${c.label}, P${c.period + 1}). Only the Head of Institute can book over classes.${altText(alts)}` };
  }
  if (check.blockers.length) {
    const b = check.blockers[0];
    return { ok: false, error: `${room.name} is already booked for "${b.title}" (${PRIORITY_LABEL[b.priority]}).${altText(alts)}` };
  }

  // A request from someone who decides for this room is approved at once, unless a
  // higher-priority request for the same time is waiting.
  const waitingAbove = check.competing.filter((b) => PRIORITY_RANK[b.priority] > PRIORITY_RANK[priority]);
  const selfApprove = canDecide(member, room, { noVenueManager: await noVenueManager(institutionId) }) && !waitingAbove.length;
  const created = await prisma.venueBooking.create({
    data: {
      institutionId,
      roomId: room.id,
      date: toDate(v.date),
      startPeriod: v.start,
      endPeriod: v.end,
      title: v.title,
      attendees: v.attendees,
      priority,
      classOverride: override && check.classes.length > 0,
      requestedBy: access.user!.id,
      status: selfApprove ? "APPROVED" : "PENDING",
      decidedBy: selfApprove ? access.user!.id : null,
      decidedAt: selfApprove ? new Date() : null,
    },
  });
  const link = `/${slug}/venues?date=${v.date}`;
  if (selfApprove) {
    await settleLosers(institutionId, slug, created.id);
  } else {
    const who = await approvers(institutionId, room);
    await notify(institutionId, who.map((m) => m.userId), `New room request: ${room.name} on ${v.date}, ${when}, "${v.title}".`, link);
  }
  revalidatePath(`/${slug}`, "layout");
  const dept = room.ownerDeptId ? await prisma.department.findUnique({ where: { id: room.ownerDeptId }, select: { code: true } }) : null;
  const approver = approverLabel(room, () => dept?.code ?? "the department");
  return {
    ok: true,
    message: selfApprove ? `Booked ${room.name}, ${when}.` : `Requested. The ${approver} has been notified.${waitingAbove.length ? " A higher-priority request for the same time is waiting." : ""}`,
  };
}

/**
 * After `winnerId` is approved: cancel lower-priority approved bookings it overlaps and
 * reject overlapping pending requests, telling each requester what is still free.
 */
async function settleLosers(institutionId: string, slug: string, winnerId: string) {
  const winner = await prisma.venueBooking.findUniqueOrThrow({ where: { id: winnerId }, include: { room: true } });
  const date = winner.date.toISOString().slice(0, 10);
  const day = await loadVenueDay(institutionId, date);
  const losers = day.rows.filter(
    (b) =>
      b.id !== winner.id &&
      b.roomId === winner.roomId &&
      b.startPeriod <= winner.endPeriod &&
      winner.startPeriod <= b.endPeriod &&
      (b.status === "PENDING" || (b.status === "APPROVED" && PRIORITY_RANK[b.priority] < PRIORITY_RANK[winner.priority])),
  );
  for (const b of losers) {
    const req = { roomId: b.roomId, start: b.startPeriod, end: b.endPeriod, priority: b.priority, attendees: b.attendees };
    const alts = alternatives(req, day.rooms, day.use, day.bookings.map((x) => (x.id === b.id ? { ...x, status: "CANCELLED" as const } : x)));
    const note = `${winner.room.name} went to "${winner.title}" (${PRIORITY_LABEL[winner.priority]}).`;
    await prisma.venueBooking.update({
      where: { id: b.id },
      data: { status: b.status === "APPROVED" ? "CANCELLED" : "REJECTED", note, decidedAt: new Date() },
    });
    await notify(
      institutionId,
      [b.requestedBy],
      `Your booking "${b.title}" (${winner.room.name}, ${date}) was ${b.status === "APPROVED" ? "cancelled" : "declined"}: ${note}${altText(alts)}`,
      `/${slug}/venues?date=${date}`,
    );
  }
}

export async function decideBooking(slug: string, id: string, approve: boolean, note: string): Promise<VenueResult> {
  const access = await memberAccess(slug);
  if (typeof access === "string") return { ok: false, error: access };
  const institutionId = access.inst.id;
  const b = await prisma.venueBooking.findFirst({ where: { id, institutionId }, include: { room: true } });
  if (!b) return { ok: false, error: "That request no longer exists." };
  if (b.status !== "PENDING") return { ok: false, error: "That request was already decided." };
  if (!canDecide(access.member, b.room, { noVenueManager: await noVenueManager(institutionId) })) return { ok: false, error: "You don't decide requests for this room." };
  const date = b.date.toISOString().slice(0, 10);
  const link = `/${slug}/venues?date=${date}`;
  const when = `${b.room.name} on ${date}`;

  if (!approve) {
    await prisma.venueBooking.update({ where: { id }, data: { status: "REJECTED", decidedBy: access.user!.id, decidedAt: new Date(), note: note.trim() || null } });
    await notify(institutionId, [b.requestedBy], `Your booking "${b.title}" (${when}) was declined${note.trim() ? `: ${note.trim()}` : "."}`, link);
  } else {
    if (date < todayIso()) return { ok: false, error: "That date has passed." };
    const day = await loadVenueDay(institutionId, date);
    const req = { roomId: b.roomId, start: b.startPeriod, end: b.endPeriod, priority: b.priority, attendees: b.attendees };
    const check = checkRequest(req, b.room, day.use, day.bookings, b.id);
    if (check.classes.length && !b.classOverride) return { ok: false, error: `A class now uses ${b.room.name} then (${check.classes[0].label}).` };
    if (check.blockers.length) return { ok: false, error: `${b.room.name} is already booked then for "${check.blockers[0].title}".` };
    const above = check.competing.find((x) => PRIORITY_RANK[x.priority] > PRIORITY_RANK[b.priority]);
    if (above) return { ok: false, error: `A higher-priority request ("${above.title}", ${PRIORITY_LABEL[above.priority]}) wants the same time. Decide that one first.` };
    await prisma.venueBooking.update({ where: { id }, data: { status: "APPROVED", decidedBy: access.user!.id, decidedAt: new Date(), note: note.trim() || null } });
    await notify(institutionId, [b.requestedBy], `Your booking "${b.title}" (${when}) was approved.`, link);
    await settleLosers(institutionId, slug, b.id);
  }
  revalidatePath(`/${slug}`, "layout");
  return { ok: true };
}

export async function cancelBooking(slug: string, id: string): Promise<VenueResult> {
  const access = await memberAccess(slug);
  if (typeof access === "string") return { ok: false, error: access };
  const institutionId = access.inst.id;
  const b = await prisma.venueBooking.findFirst({ where: { id, institutionId }, include: { room: true } });
  if (!b) return { ok: false, error: "That booking no longer exists." };
  const mine = b.requestedBy === access.user!.id;
  if (!mine && !canDecide(access.member, b.room, { noVenueManager: await noVenueManager(institutionId) })) return { ok: false, error: "You can only cancel your own bookings." };
  if (b.status === "REJECTED" || b.status === "CANCELLED") return { ok: false, error: "It is already off." };
  await prisma.venueBooking.update({ where: { id }, data: { status: "CANCELLED", decidedAt: new Date(), note: mine ? "Cancelled by the requester." : "Cancelled by the room's approver." } });
  if (!mine) await notify(institutionId, [b.requestedBy], `Your booking "${b.title}" (${b.room.name}, ${b.date.toISOString().slice(0, 10)}) was cancelled.`, `/${slug}/venues`);
  revalidatePath(`/${slug}`, "layout");
  return { ok: true };
}
