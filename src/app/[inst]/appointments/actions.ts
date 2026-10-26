"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getAccess, type Access } from "@/lib/access";
import { SLOT_LENGTHS, slotProblem, subSlots, teachingSlots, weekCount, weekStart } from "@/lib/appointments";
import { BOOKING_WINDOW, dateInfos, loadWorld, sweepAppointments, toBooked, toConfig } from "@/lib/appointments-db";
import { addDays, todayIso } from "@/lib/calendar";
import { toDate } from "@/lib/cover-db";
import { prisma } from "@/lib/db";
import { isoDate as isoDateSchema } from "@/lib/dates";

/** A booking refused by our own checks; its message is shown as is. */
class Refusal extends Error {}

export type AppointmentResult = { ok: true; message?: string } | { ok: false; error: string };

async function member(slug: string): Promise<Access | string> {
  const access = await getAccess(slug);
  if (access.publicDemo) return "The shared demo is read-only.";
  if (!access.member || !access.user) return "Please sign in as a member of this college.";
  return access;
}

const hoursInput = z.object({
  slots: z.array(z.tuple([z.number().int().min(0), z.number().int().min(0)])).max(100),
  slotMinutes: z.number().refine((n) => (SLOT_LENGTHS as readonly number[]).includes(n), "Slots are 10, 15 or 20 minutes."),
  perStudentWeek: z.number().int().min(1, "Allow at least one booking a week").max(10),
  location: z.string().trim().max(80),
});

export async function saveOfficeHours(slug: string, input: unknown): Promise<AppointmentResult> {
  const access = await member(slug);
  if (typeof access === "string") return { ok: false, error: access };
  const teacherId = access.member!.teacherId;
  if (!access.can("appointments.host") || !teacherId) return { ok: false, error: "Only teachers linked to a teacher record can offer office hours." };
  const parsed = hoursInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const v = parsed.data;
  const institutionId = access.inst.id;
  const world = await loadWorld(institutionId, todayIso(), 1);
  if (!world) return { ok: false, error: "Office hours are set on the published timetable; none is published yet." };
  const D = world.snapshot.days.length;
  const P = world.snapshot.periods.length;
  const teaching = teachingSlots(world.problem, world.assignment, teacherId);
  const slots = [...new Map(v.slots.map((s) => [`${s[0]}:${s[1]}`, s])).values()];
  const clash = slots.find(([d, p]) => d >= D || p >= P || teaching.has(`${d}:${p}`));
  if (clash) return { ok: false, error: `${world.snapshot.days[clash[0]] ?? "?"} P${clash[1] + 1} isn't a free period for you.` };
  await prisma.officeHours.upsert({
    where: { teacherId },
    create: { institutionId, teacherId, slots, slotMinutes: v.slotMinutes, perStudentWeek: v.perStudentWeek, location: v.location },
    update: { slots, slotMinutes: v.slotMinutes, perStudentWeek: v.perStudentWeek, location: v.location },
  });
  const flagged = await sweepAppointments(institutionId, slug);
  revalidatePath(`/${slug}`, "layout");
  return { ok: true, message: `Saved.${flagged ? ` ${flagged} booking${flagged === 1 ? " no longer fits and was" : "s no longer fit and were"} called off; the students were told.` : ""}` };
}

const bookInput = z.object({
  teacherId: z.string().min(1),
  date: isoDateSchema(),
  period: z.number().int().min(0),
  offset: z.number().int().min(0),
  topic: z.string().trim().min(3, "Say briefly what it's about").max(140),
});

export async function bookAppointment(slug: string, input: unknown): Promise<AppointmentResult> {
  const access = await member(slug);
  if (typeof access === "string") return { ok: false, error: access };
  if (!access.can("appointments.book")) return { ok: false, error: "Only students book office hours." };
  const parsed = bookInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const v = parsed.data;
  const institutionId = access.inst.id;
  const studentId = access.user!.id;
  const today = todayIso();
  if (v.date < today || v.date > addDays(today, BOOKING_WINDOW - 1)) return { ok: false, error: `You can book up to ${BOOKING_WINDOW} days ahead.` };

  const cfg = await prisma.officeHours.findFirst({ where: { institutionId, teacherId: v.teacherId } });
  if (!cfg) return { ok: false, error: "That teacher doesn't offer office hours." };
  const config = toConfig(cfg);
  const world = await loadWorld(institutionId, v.date, 1);
  if (!world) return { ok: false, error: "No timetable is published yet." };
  const info = dateInfos(world, v.teacherId)[0];
  const week = weekStart(v.date);

  // Check and insert in one serializable transaction so two students can't take the same slot.
  try {
    await prisma.$transaction(
      async (tx) => {
        const rows = await tx.appointment.findMany({
          where: { institutionId, teacherId: v.teacherId, status: "BOOKED", date: { gte: toDate(week), lte: toDate(addDays(week, 6)) } },
        });
        const booked = rows.map(toBooked);
        const problem = slotProblem(v, config, info, world.snapshot.periods, booked);
        if (problem) throw new Refusal(problem);
        if (weekCount(booked, v.teacherId, studentId, v.date) >= config.perStudentWeek) {
          throw new Refusal(`You already have ${config.perStudentWeek} booking${config.perStudentWeek === 1 ? "" : "s"} with this teacher that week (their limit).`);
        }
        await tx.appointment.create({
          data: { institutionId, teacherId: v.teacherId, studentId, date: toDate(v.date), period: v.period, offset: v.offset, minutes: config.slotMinutes, topic: v.topic },
        });
      },
      { isolationLevel: "Serializable" },
    );
  } catch (e) {
    // Our own checks explain themselves; anything else is the database refusing a write that
    // raced with another one (only one of them may win). Other failures are logged.
    if (!(e instanceof Refusal) && (e as { code?: string }).code !== "P2034") console.error(e);
    return { ok: false, error: e instanceof Refusal ? e.message : "Someone has just booked that slot." };
  }

  const p = world.snapshot.periods[v.period];
  const start = subSlots(p, config.slotMinutes).find((s) => s.offset === v.offset)?.start ?? p.start;
  const teacherUsers = await prisma.membership.findMany({ where: { institutionId, teacherId: v.teacherId }, select: { userId: true } });
  if (teacherUsers.length) {
    await prisma.notification.createMany({
      data: teacherUsers.map((m) => ({
        institutionId,
        userId: m.userId,
        link: `/${slug}/appointments`,
        text: `${access.user!.name} booked office hours on ${v.date} at ${start}: "${v.topic}".`,
      })),
    });
  }
  revalidatePath(`/${slug}`, "layout");
  return { ok: true, message: `Booked for ${v.date} at ${start}${config.location ? `, ${config.location}` : ""}.` };
}

export async function cancelAppointment(slug: string, id: string): Promise<AppointmentResult> {
  const access = await member(slug);
  if (typeof access === "string") return { ok: false, error: access };
  const institutionId = access.inst.id;
  const a = await prisma.appointment.findFirst({ where: { id, institutionId } });
  if (!a) return { ok: false, error: "That appointment no longer exists." };
  const byStudent = a.studentId === access.user!.id;
  const byTeacher = !!access.member!.teacherId && a.teacherId === access.member!.teacherId;
  if (!byStudent && !byTeacher) return { ok: false, error: "That isn't your appointment." };
  if (a.status !== "BOOKED") return { ok: false, error: "It is already off." };
  await prisma.appointment.update({ where: { id }, data: { status: "CANCELLED", note: byStudent ? "Cancelled by the student." : "Cancelled by the teacher." } });
  const date = a.date.toISOString().slice(0, 10);
  const others = byStudent
    ? (await prisma.membership.findMany({ where: { institutionId, teacherId: a.teacherId }, select: { userId: true } })).map((m) => m.userId)
    : [a.studentId];
  if (others.length) {
    await prisma.notification.createMany({
      data: others.map((userId) => ({
        institutionId,
        userId,
        link: `/${slug}/appointments`,
        text: `The appointment on ${date} ("${a.topic}") was cancelled by ${byStudent ? "the student" : "the teacher"}.`,
      })),
    });
  }
  revalidatePath(`/${slug}`, "layout");
  return { ok: true };
}
