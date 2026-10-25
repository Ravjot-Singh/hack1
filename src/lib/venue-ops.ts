// Server-side venue booking operations shared by the Venues page and placement drives.
// Callers check who may act; these apply the booking rules and send notifications.

import { todayIso } from "@/lib/calendar";
import { toDate } from "@/lib/cover-db";
import { prisma } from "@/lib/db";
import type { Member } from "@/lib/permissions";
import { alternatives, approverLabel, canDecide, checkRequest, periodRange, PRIORITY_LABEL, PRIORITY_RANK, type Priority, type Room } from "@/lib/venues";
import { loadVenueDay } from "@/lib/venues-db";

export const noVenueManager = async (institutionId: string) => !(await prisma.membership.count({ where: { institutionId, role: "VENUE_MANAGER" } }));

/** Members who decide requests for `room`. */
export async function approvers(institutionId: string, room: Room) {
  const owned = room.ownerDeptId && !room.isEventVenue;
  const where = owned
    ? { institutionId, role: "HOD" as const, departmentId: room.ownerDeptId }
    : (await noVenueManager(institutionId))
      ? { institutionId, role: "INSTITUTE_ADMIN" as const }
      : { institutionId, role: "VENUE_MANAGER" as const };
  return prisma.membership.findMany({ where, select: { userId: true } });
}

export async function notify(institutionId: string, userIds: string[], text: string, link: string) {
  const unique = [...new Set(userIds)];
  if (unique.length) await prisma.notification.createMany({ data: unique.map((userId) => ({ institutionId, userId, text, link })) });
}

export const altText = (rooms: Room[]) => (rooms.length ? ` Free instead: ${rooms.map((r) => `${r.name} (${r.capacity})`).join(", ")}.` : "");

export interface BookingRequest {
  date: string;
  roomId: string;
  start: number;
  end: number;
  title: string;
  attendees: number;
  priority: Priority;
  override: boolean;
}

export type SubmitResult = { ok: true; id: string; approved: boolean; message: string } | { ok: false; error: string };

/**
 * Check and file a booking request. Approved at once when the requester decides for the
 * room (and no higher-priority request is waiting); otherwise the approvers are notified.
 */
export async function submitBooking(institutionId: string, slug: string, userId: string, member: Member, v: BookingRequest): Promise<SubmitResult> {
  if (v.date < todayIso()) return { ok: false, error: "That date has passed." };
  const day = await loadVenueDay(institutionId, v.date);
  const room = day.rooms.find((r) => r.id === v.roomId);
  if (!room) return { ok: false, error: "That room no longer exists." };
  if (v.start > v.end || v.end >= day.periods.length) return { ok: false, error: "Pick a valid run of periods." };
  const req = { roomId: room.id, start: v.start, end: v.end, priority: v.priority, attendees: v.attendees };
  const check = checkRequest(req, room, day.use, day.bookings, undefined, day.down);
  const when = periodRange(v.start, v.end, day.periods);
  const alts = alternatives(req, day.rooms, day.use, day.bookings, 4, day.down);

  if (check.outOfService.length) return { ok: false, error: `${room.name} is out of service then (${check.outOfService[0].reason}).${altText(alts)}` };
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

  const waitingAbove = check.competing.filter((b) => PRIORITY_RANK[b.priority] > PRIORITY_RANK[v.priority]);
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
      priority: v.priority,
      classOverride: override && check.classes.length > 0,
      requestedBy: userId,
      status: selfApprove ? "APPROVED" : "PENDING",
      decidedBy: selfApprove ? userId : null,
      decidedAt: selfApprove ? new Date() : null,
    },
  });
  const link = `/${slug}/venues?date=${v.date}`;
  if (selfApprove) await settleLosers(institutionId, slug, created.id);
  else {
    const who = await approvers(institutionId, room);
    await notify(institutionId, who.map((m) => m.userId), `New room request: ${room.name} on ${v.date}, ${when}, "${v.title}".`, link);
  }
  const dept = room.ownerDeptId ? await prisma.department.findUnique({ where: { id: room.ownerDeptId }, select: { code: true } }) : null;
  const approver = approverLabel(room, () => dept?.code ?? "the department");
  return {
    ok: true,
    id: created.id,
    approved: selfApprove,
    message: selfApprove
      ? `Booked ${room.name}, ${when}.`
      : `Requested ${room.name}, ${when}. The ${approver} has been notified.${waitingAbove.length ? " A higher-priority request for the same time is waiting." : ""}`,
  };
}

/**
 * After `winnerId` is approved: cancel lower-priority approved bookings it overlaps and
 * reject overlapping pending requests, telling each requester what is still free.
 */
export async function settleLosers(institutionId: string, slug: string, winnerId: string) {
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
    const alts = alternatives(req, day.rooms, day.use, day.bookings.map((x) => (x.id === b.id ? { ...x, status: "CANCELLED" as const } : x)), 4, day.down);
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

/** Withdraw a booking (by its requester or a system change); no-op if already off. */
export async function withdrawBooking(institutionId: string, id: string, note: string) {
  await prisma.venueBooking.updateMany({ where: { id, institutionId, status: { in: ["PENDING", "APPROVED"] } }, data: { status: "CANCELLED", note, decidedAt: new Date() } });
}
