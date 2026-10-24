"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AccessError, requireAction } from "@/lib/access";
import { prisma } from "@/lib/db";

export type CalendarResult = { ok: true } | { ok: false; error: string };

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date");
const toDate = (s: string) => new Date(`${s}T00:00:00Z`);

async function manage(slug: string) {
  try {
    return { access: await requireAction(slug, "calendar.manage") };
  } catch (e) {
    if (e instanceof AccessError) return { error: e.message };
    throw e;
  }
}

export async function saveTerm(slug: string, start: string, end: string): Promise<CalendarResult> {
  const m = await manage(slug);
  if (!m.access) return { ok: false, error: m.error! };
  const s = isoDate.or(z.literal("")).safeParse(start);
  const e = isoDate.or(z.literal("")).safeParse(end);
  if (!s.success || !e.success) return { ok: false, error: "Dates must look like 2026-07-20." };
  if (start && end && end < start) return { ok: false, error: "The term can't end before it starts." };
  await prisma.institution.update({
    where: { id: m.access.inst.id },
    data: { termStart: start ? toDate(start) : null, termEnd: end ? toDate(end) : null },
  });
  revalidatePath(`/${slug}`, "layout");
  return { ok: true };
}

const special = z
  .object({
    date: isoDate,
    kind: z.enum(["HOLIDAY", "EXAM", "FOLLOWS"]),
    label: z.string().trim().min(1, "Add a short label, e.g. Diwali").max(80),
    followsDay: z.number().int().min(0).nullable(),
    /** Optional last date to repeat the same entry over a range (e.g. a week of exams). */
    until: isoDate.or(z.literal("")).default(""),
  })
  .refine((v) => v.kind !== "FOLLOWS" || v.followsDay !== null, { message: "Pick which day's timetable to follow" });

export async function addSpecialDays(slug: string, input: unknown): Promise<CalendarResult> {
  const m = await manage(slug);
  if (!m.access) return { ok: false, error: m.error! };
  const parsed = special.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const v = parsed.data;
  const last = v.until && v.until > v.date ? v.until : v.date;
  const dates: string[] = [];
  for (let d = toDate(v.date); d <= toDate(last); d.setUTCDate(d.getUTCDate() + 1)) dates.push(d.toISOString().slice(0, 10));
  if (dates.length > 120) return { ok: false, error: "That range is too long (max 120 days)." };
  const institutionId = m.access.inst.id;
  const data = { kind: v.kind, label: v.label, followsDay: v.kind === "FOLLOWS" ? v.followsDay : null };
  await prisma.$transaction(
    dates.map((date) =>
      prisma.calendarDay.upsert({
        where: { institutionId_date: { institutionId, date: toDate(date) } },
        create: { institutionId, date: toDate(date), ...data },
        update: data,
      }),
    ),
  );
  revalidatePath(`/${slug}`, "layout");
  return { ok: true };
}

export async function removeSpecialDay(slug: string, id: string): Promise<CalendarResult> {
  const m = await manage(slug);
  if (!m.access) return { ok: false, error: m.error! };
  await prisma.calendarDay.deleteMany({ where: { id, institutionId: m.access.inst.id } });
  revalidatePath(`/${slug}`, "layout");
  return { ok: true };
}
