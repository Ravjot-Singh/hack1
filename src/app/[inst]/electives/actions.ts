"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getAccess, type Access } from "@/lib/access";
import { todayIso } from "@/lib/calendar";
import { toDate } from "@/lib/cover-db";
import { prisma } from "@/lib/db";
import { isoDate as isoDateSchema } from "@/lib/dates";
import { loadBasket } from "@/lib/electives-db";
import { choiceProblem, countChoices, roomWarnings, sizesFromChoices, type ElectiveWindowInfo } from "@/lib/electives";

/** A booking refused by our own checks; its message is shown as is. */
class Refusal extends Error {}

export type ElectiveResult = { ok: true; message?: string; warnings?: string[] } | { ok: false; error: string };

const iso = (d: Date) => d.toISOString().slice(0, 10);
const isoDate = isoDateSchema();

async function member(slug: string): Promise<Access | string> {
  const access = await getAccess(slug);
  if (access.publicDemo) return "The shared demo is read-only.";
  if (!access.member || !access.user) return "Please sign in as a member of this college.";
  return access;
}

type Basket = NonNullable<Awaited<ReturnType<typeof loadBasket>>>;

/** Admins configure any basket; an HOD only baskets whose sections are all in their department. */
function mayConfigure(access: Access, basket: Basket): boolean {
  if (!access.can("electives.configure")) return false;
  const m = access.member!;
  // A basket with no sections belongs to no department, so only the admin may configure it.
  return m.role === "INSTITUTE_ADMIN" || (!!m.departmentId && basket.sections.length > 0 && basket.sections.every((s) => s.departmentId === m.departmentId));
}

const windowInfo = (w: NonNullable<Basket["window"]>): ElectiveWindowInfo => ({ opensOn: iso(w.opensOn), closesOn: iso(w.closesOn), seats: w.seats as Record<string, number> });

const windowInput = z.object({
  basketId: z.string(),
  opensOn: isoDate,
  closesOn: isoDate,
  seats: z.record(z.string(), z.number().int().min(1).max(5000).nullable()),
});

export async function saveWindow(slug: string, input: unknown): Promise<ElectiveResult> {
  const access = await member(slug);
  if (typeof access === "string") return { ok: false, error: access };
  const parsed = windowInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const v = parsed.data;
  const institutionId = access.inst.id;
  const basket = await loadBasket(institutionId, v.basketId);
  if (!basket) return { ok: false, error: "That basket no longer exists." };
  if (!mayConfigure(access, basket)) return { ok: false, error: "Only the Institute Admin (or the HOD, for a basket within one department) can set this up." };
  if (v.closesOn < v.opensOn) return { ok: false, error: "Registration must close on or after the day it opens." };
  const seats = Object.fromEntries(Object.entries(v.seats).filter(([id, n]) => n != null && basket.offerings.some((o) => o.id === id)));
  const data = { opensOn: toDate(v.opensOn), closesOn: toDate(v.closesOn), seats };
  await prisma.electiveWindow.upsert({ where: { basketId: basket.id }, create: { ...data, institutionId, basketId: basket.id, createdBy: access.user!.id }, update: data });
  if (!basket.window) {
    const students = await prisma.membership.findMany({ where: { institutionId, role: "STUDENT", sectionId: { in: basket.sections.map((s) => s.id) } }, select: { userId: true } });
    if (students.length) {
      await prisma.notification.createMany({
        data: students.map((s) => ({ institutionId, userId: s.userId, link: `/${slug}/electives`, text: `Choose your ${basket.name}: registration is open ${v.opensOn} to ${v.closesOn}.` })),
      });
    }
  }
  revalidatePath(`/${slug}`, "layout");
  return { ok: true, message: "Saved." };
}

export async function chooseElective(slug: string, basketId: string, offeringId: string): Promise<ElectiveResult> {
  const access = await member(slug);
  if (typeof access === "string") return { ok: false, error: access };
  if (!access.can("electives.register")) return { ok: false, error: "Only students register for electives." };
  const institutionId = access.inst.id;
  const studentId = access.user!.id;
  const sectionId = access.member!.sectionId;
  try {
    await prisma.$transaction(
      async (tx) => {
        const basket = await tx.electiveBasket.findFirst({
          where: { id: basketId, institutionId },
          include: { sections: { select: { id: true } }, offerings: { include: { subject: { select: { code: true, name: true } } } }, window: true, choices: true },
        });
        if (!basket) throw new Refusal("That basket no longer exists.");
        const current = basket.choices.find((c) => c.studentId === studentId)?.offeringId ?? null;
        const problem = choiceProblem({
          window: basket.window ? windowInfo(basket.window as NonNullable<Basket["window"]>) : null,
          today: todayIso(),
          studentSectionId: sectionId,
          basketSectionIds: basket.sections.map((s) => s.id),
          offeringId,
          offeringIds: basket.offerings.map((o) => o.id),
          counts: countChoices(basket.choices),
          current,
          label: (id) => {
            const s = basket.offerings.find((o) => o.id === id)?.subject;
            return s ? `${s.code} ${s.name}` : "That elective";
          },
        });
        if (problem) throw new Refusal(problem);
        await tx.electiveChoice.upsert({
          where: { basketId_studentId: { basketId, studentId } },
          create: { institutionId, basketId, offeringId, studentId, sectionId: sectionId! },
          update: { offeringId },
        });
      },
      { isolationLevel: "Serializable" },
    );
  } catch (e) {
    // Our own checks explain themselves; anything else is the database refusing a write that
    // raced with another one (only one of them may win). Other failures are logged.
    if (!(e instanceof Refusal) && (e as { code?: string }).code !== "P2034") console.error(e);
    return { ok: false, error: e instanceof Refusal ? e.message : "Seats changed while you chose. Try again." };
  }
  revalidatePath(`/${slug}`, "layout");
  return { ok: true };
}

export async function withdrawChoice(slug: string, basketId: string): Promise<ElectiveResult> {
  const access = await member(slug);
  if (typeof access === "string") return { ok: false, error: access };
  const basket = await loadBasket(access.inst.id, basketId);
  if (!basket?.window) return { ok: false, error: "Registration isn't set up for this basket." };
  const today = todayIso();
  if (today < iso(basket.window.opensOn) || today > iso(basket.window.closesOn)) return { ok: false, error: "Registration is closed." };
  await prisma.electiveChoice.deleteMany({ where: { basketId, studentId: access.user!.id } });
  revalidatePath(`/${slug}`, "layout");
  return { ok: true };
}

/** Copy the counts into the electives' class sizes so the solver books rooms that fit. */
export async function applyCounts(slug: string, basketId: string, mode: "registered" | "scaled"): Promise<ElectiveResult> {
  const access = await member(slug);
  if (typeof access === "string") return { ok: false, error: access };
  if (mode !== "registered" && mode !== "scaled") return { ok: false, error: "Pick registered or scaled counts." };
  const institutionId = access.inst.id;
  const basket = await loadBasket(institutionId, basketId);
  if (!basket?.window) return { ok: false, error: "Set up registration first." };
  if (!mayConfigure(access, basket)) return { ok: false, error: "You can't change this basket." };
  if (!basket.choices.length) return { ok: false, error: "No one has registered yet." };
  const total = basket.sections.reduce((n, s) => n + s.size, 0);
  const seats = basket.window.seats as Record<string, number>;
  const sizes = sizesFromChoices(basket.offerings.map((o) => o.id), countChoices(basket.choices), mode, total, seats);
  const placed = Object.values(sizes).reduce((n, x) => n + x, 0);
  await prisma.$transaction([
    ...basket.offerings.map((o) => prisma.offering.update({ where: { id: o.id }, data: { expectedSize: sizes[o.id] } })),
    prisma.electiveWindow.update({ where: { basketId }, data: { appliedAt: new Date() } }),
  ]);
  const rooms = await prisma.room.findMany({ where: { institutionId }, select: { type: true, capacity: true, isEventVenue: true } });
  const warnings = roomWarnings(sizes, basket.offerings.map((o) => ({ id: o.id, label: `${o.subject.code} ${o.subject.name}`, roomType: o.subject.theoryRoomType })), rooms);
  const unplaced = mode === "scaled" && placed < total ? [`Seat limits leave room for only ${placed} of ${total} students; raise some limits.`] : [];
  const empty = basket.offerings.filter((o) => !basket.choices.some((c) => c.offeringId === o.id)).map((o) => `${o.subject.code}: no one chose it; consider dropping it in Allocation.`);
  revalidatePath(`/${slug}`, "layout");
  return { ok: true, message: "Class sizes updated. Generate a new timetable to use them.", warnings: [...unplaced, ...warnings, ...empty] };
}
