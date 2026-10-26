"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getAccess, type Access } from "@/lib/access";
import { affectedLessons, suggestSubstitutes } from "@/lib/cover";
import { loadDay, toDate } from "@/lib/cover-db";
import { sweepAppointments } from "@/lib/appointments-db";
import { prisma } from "@/lib/db";
import { isoDate as isoDateSchema } from "@/lib/dates";

export type AbsenceResult = { ok: true } | { ok: false; error: string };

const isoDate = isoDateSchema();

/** Who may handle absences for `teacherId`: admins, that teacher's HOD, or the teacher themself. */
async function allowedFor(slug: string, teacherId: string): Promise<{ access: Access } | { error: string }> {
  const access = await getAccess(slug);
  if (access.publicDemo) return { error: "The shared demo is read-only." };
  if (!access.member) return { error: "Please sign in as a member of this college." };
  const teacher = await prisma.teacher.findFirst({ where: { id: teacherId, institutionId: access.inst.id } });
  if (!teacher) return { error: "That teacher no longer exists." };
  if (access.can("absence.manage") && (access.member.role === "INSTITUTE_ADMIN" || access.canEditDepartment(teacher.departmentId))) {
    return { access };
  }
  if (access.can("absence.self") && access.member.teacherId === teacherId) return { access };
  return { error: "You can only manage absences for your own department (or yourself)." };
}

/** In-app notifications for the people a cover change affects. */
async function notify(institutionId: string, slug: string, date: string, lessonId: string, text: (who: "sub" | "teacher" | "student") => string, substituteId: string | null) {
  const day = await loadDay(institutionId, date);
  if (day.kind !== "ok") return;
  const lesson = day.problem.lessons.find((l) => l.id === lessonId);
  if (!lesson) return;
  const members = await prisma.membership.findMany({
    where: {
      institutionId,
      OR: [
        { teacherId: { in: [...lesson.teacherIds, ...(substituteId ? [substituteId] : [])] } },
        { sectionId: { in: lesson.sectionIds } },
      ],
    },
  });
  const link = `/${slug}/today?date=${date}`;
  await prisma.notification.createMany({
    data: members.map((m) => ({
      institutionId,
      userId: m.userId,
      link,
      text: text(m.teacherId && m.teacherId === substituteId ? "sub" : m.teacherId && lesson.teacherIds.includes(m.teacherId) ? "teacher" : "student"),
    })),
  });
}

const absenceInput = z.object({
  teacherId: z.string().min(1, "Pick a teacher"),
  date: isoDate,
  /** 0-based periods; empty = whole day. */
  periods: z.array(z.number().int().min(0).max(20)).max(20),
  reason: z.string().trim().max(200).default(""),
});

export async function markAbsent(slug: string, input: unknown): Promise<AbsenceResult> {
  const parsed = absenceInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const v = parsed.data;
  const check = await allowedFor(slug, v.teacherId);
  if ("error" in check) return { ok: false, error: check.error };
  const { inst, user } = check.access;
  await prisma.absence.upsert({
    where: { institutionId_teacherId_date: { institutionId: inst.id, teacherId: v.teacherId, date: toDate(v.date) } },
    create: { institutionId: inst.id, teacherId: v.teacherId, date: toDate(v.date), periods: v.periods, reason: v.reason || null, createdBy: user!.id },
    update: { periods: v.periods, reason: v.reason || null },
  });
  await sweepAppointments(inst.id, slug);
  revalidatePath(`/${slug}`, "layout");
  return { ok: true };
}

export async function removeAbsence(slug: string, absenceId: string): Promise<AbsenceResult> {
  const access = await getAccess(slug);
  const absence = await prisma.absence.findFirst({ where: { id: absenceId, institutionId: access.inst.id } });
  if (!absence) return { ok: true };
  const check = await allowedFor(slug, absence.teacherId);
  if ("error" in check) return { ok: false, error: check.error };
  const date = absence.date.toISOString().slice(0, 10);
  // Drop the covers that only existed because of this absence.
  const day = await loadDay(access.inst.id, date);
  const theirLessons = day.kind === "ok" ? day.problem.lessons.filter((l) => l.teacherIds.includes(absence.teacherId)).map((l) => l.id) : [];
  await prisma.$transaction([
    prisma.cover.deleteMany({ where: { institutionId: access.inst.id, date: absence.date, lessonId: { in: theirLessons } } }),
    prisma.absence.delete({ where: { id: absence.id } }),
  ]);
  revalidatePath(`/${slug}`, "layout");
  return { ok: true };
}

/** Why this visitor can't arrange cover at all, before any lookup reveals what runs when. */
function coverDenied(access: Access): string | null {
  if (access.publicDemo) return "The shared demo is read-only.";
  if (!access.user || !access.member) return "Please sign in as a member of this college.";
  if (!access.can("absence.manage")) return "Only admins and HODs arrange cover.";
  return null;
}

const coverInput = z.object({
  date: isoDate,
  lessonId: z.string().min(1),
  action: z.enum(["SUBSTITUTE", "CANCEL"]),
  substituteId: z.string().nullable(),
  note: z.string().trim().max(200).default(""),
});

export async function setCover(slug: string, input: unknown): Promise<AbsenceResult> {
  const parsed = coverInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const v = parsed.data;
  const access = await getAccess(slug);
  // Who may arrange cover at all is settled before loading anything about the day.
  const denied = coverDenied(access);
  if (denied) return { ok: false, error: denied };
  const day = await loadDay(access.inst.id, v.date);
  if (day.kind !== "ok" || !day.ctx) return { ok: false, error: "There are no classes on that date." };
  const lesson = day.problem.lessons.find((l) => l.id === v.lessonId);
  if (!lesson || day.assignment[lesson.id]?.day !== day.ctx.dayIndex) return { ok: false, error: "That class doesn't run on that date." };
  // Permission is judged on the class's absent teacher, who must be away for this class's periods.
  const ctx = day.ctx;
  const absentTeacher = lesson.teacherIds.find((t) => affectedLessons(ctx, t).some((x) => x.lesson.id === lesson.id));
  if (!absentTeacher) return { ok: false, error: "Mark the teacher absent for this class's period first." };
  const check = await allowedFor(slug, absentTeacher);
  if ("error" in check || !check.access.can("absence.manage")) {
    return { ok: false, error: "error" in check ? check.error : "Only admins and HODs arrange cover." };
  }

  if (v.action === "SUBSTITUTE") {
    if (!v.substituteId) return { ok: false, error: "Pick a substitute." };
    // Re-check on the server: the substitute must still be free, present and under their daily limit.
    const others = { ...day.ctx, covers: day.ctx.covers.filter((c) => c.lessonId !== v.lessonId) };
    const ok = suggestSubstitutes(others, v.lessonId, 1000).some((c) => c.teacherId === v.substituteId);
    if (!ok) return { ok: false, error: "That teacher is no longer free then. Pick another." };
  }

  await prisma.cover.upsert({
    where: { institutionId_date_lessonId: { institutionId: access.inst.id, date: toDate(v.date), lessonId: v.lessonId } },
    create: {
      institutionId: access.inst.id,
      date: toDate(v.date),
      versionId: day.version.id,
      lessonId: v.lessonId,
      action: v.action,
      substituteId: v.action === "SUBSTITUTE" ? v.substituteId : null,
      note: v.note || null,
      createdBy: check.access.user!.id,
    },
    // Tie it to the version published now, or it disappears from view after a republish.
    update: { versionId: day.version.id, action: v.action, substituteId: v.action === "SUBSTITUTE" ? v.substituteId : null, note: v.note || null },
  });

  const period = day.assignment[lesson.id].period;
  const when = `${new Date(`${v.date}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" })}, P${period + 1} (${day.snapshot.periods[period]?.start})`;
  const subName = day.snapshot.teachers.find((t) => t.id === v.substituteId)?.name;
  await notify(
    access.inst.id,
    slug,
    v.date,
    lesson.id,
    (who) =>
      v.action === "CANCEL"
        ? `${lesson.label} on ${when} is cancelled.`
        : who === "sub"
          ? `Please take ${lesson.label} on ${when} (cover).`
          : `${lesson.label} on ${when} will be taken by ${subName}.`,
    v.action === "SUBSTITUTE" ? v.substituteId : null,
  );
  // A substitute's cover duty can clash with their office-hour bookings.
  await sweepAppointments(access.inst.id, slug);
  revalidatePath(`/${slug}`, "layout");
  return { ok: true };
}

export async function clearCover(slug: string, date: string, lessonId: string): Promise<AbsenceResult> {
  const access = await getAccess(slug);
  const denied = coverDenied(access);
  if (denied) return { ok: false, error: denied };
  if (!isoDate.safeParse(date).success) return { ok: false, error: "Bad date." };
  const day = await loadDay(access.inst.id, date);
  const lesson = day.kind === "ok" ? day.problem.lessons.find((l) => l.id === lessonId) : undefined;
  if (!lesson) return { ok: true };
  const absentTeacher = day.kind === "ok" ? lesson.teacherIds.find((t) => day.absences.some((a) => a.teacherId === t)) : undefined;
  const check = absentTeacher ? await allowedFor(slug, absentTeacher) : { error: "Only admins and HODs arrange cover." };
  if ("error" in check || !check.access.can("absence.manage")) {
    return { ok: false, error: "error" in check ? check.error : "Only admins and HODs arrange cover." };
  }
  await prisma.cover.deleteMany({ where: { institutionId: access.inst.id, date: toDate(date), lessonId } });
  revalidatePath(`/${slug}`, "layout");
  return { ok: true };
}
