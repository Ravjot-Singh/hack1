"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getAccess, type Access } from "@/lib/access";
import { todayIso } from "@/lib/calendar";
import { prisma } from "@/lib/db";
import { isoDate as isoDateSchema } from "@/lib/dates";
import { withLock } from "@/lib/locks";
import { notify, noVenueManager, settleLosers, submitBooking, venueKey } from "@/lib/venue-ops";
import { allowedPriorities, canDecide, checkRequest, PRIORITIES, PRIORITY_LABEL, PRIORITY_RANK } from "@/lib/venues";
import { loadVenueDay } from "@/lib/venues-db";

export type VenueResult = { ok: true; message?: string } | { ok: false; error: string };

const requestInput = z.object({
  date: isoDateSchema(),
  roomId: z.string().min(1, "Pick a room"),
  start: z.number().int().min(0),
  end: z.number().int().min(0),
  title: z.string().trim().min(3, "Say what the booking is for").max(120),
  attendees: z.number().int().min(1, "How many people?").max(5000),
  priority: z.enum(PRIORITIES as [string, ...string[]]),
  override: z.boolean().default(false),
});

/** Open (undecided) room requests one person may have at a time. */
const MAX_PENDING = 10;

async function memberAccess(slug: string): Promise<Access | string> {
  const access = await getAccess(slug);
  if (access.publicDemo) return "The shared demo is read-only.";
  if (!access.member || !access.user) return "Please sign in as a member of this college.";
  return access;
}

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
  // Each pending request notifies every approver, so one person can't keep piling them up.
  const waiting = await prisma.venueBooking.count({ where: { institutionId: access.inst.id, requestedBy: access.user!.id, status: "PENDING" } });
  if (waiting >= MAX_PENDING) return { ok: false, error: `You already have ${MAX_PENDING} requests waiting for a decision. Wait for those first.` };
  const res = await submitBooking(access.inst.id, slug, access.user!.id, member, { ...v, priority });
  if (!res.ok) return res;
  revalidatePath(`/${slug}`, "layout");
  return { ok: true, message: res.message };
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

  const text = typeof note === "string" ? note.trim().slice(0, 300) : "";
  // Only a request still pending is decided, and only once, even if two approvers click together.
  const decide = (status: "APPROVED" | "REJECTED") =>
    prisma.venueBooking.updateMany({ where: { id, institutionId, status: "PENDING" }, data: { status, decidedBy: access.user!.id, decidedAt: new Date(), note: text || null } });

  if (approve !== true) {
    if (!(await decide("REJECTED")).count) return { ok: false, error: "That request was already decided." };
    await notify(institutionId, [b.requestedBy], `Your booking "${b.title}" (${when}) was declined${text ? `: ${text}` : "."}`, link);
  } else {
    if (date < todayIso()) return { ok: false, error: "That date has passed." };
    const error = await withLock(venueKey(b.roomId, date), async () => {
      const day = await loadVenueDay(institutionId, date);
      const req = { roomId: b.roomId, start: b.startPeriod, end: b.endPeriod, priority: b.priority, attendees: b.attendees };
      const check = checkRequest(req, b.room, day.use, day.bookings, b.id, day.down);
      if (check.outOfService.length) return `${b.room.name} is out of service then (${check.outOfService[0].reason}).`;
      if (check.classes.length && !b.classOverride) return `A class now uses ${b.room.name} then (${check.classes[0].label}).`;
      if (check.blockers.length) return `${b.room.name} is already booked then for "${check.blockers[0].title}".`;
      const above = check.competing.find((x) => PRIORITY_RANK[x.priority] > PRIORITY_RANK[b.priority]);
      if (above) return `A higher-priority request ("${above.title}", ${PRIORITY_LABEL[above.priority]}) wants the same time. Decide that one first.`;
      if (!(await decide("APPROVED")).count) return "That request was already decided.";
      await settleLosers(institutionId, slug, b.id);
      return null;
    });
    if (error) return { ok: false, error };
    await notify(institutionId, [b.requestedBy], `Your booking "${b.title}" (${when}) was approved.`, link);
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
