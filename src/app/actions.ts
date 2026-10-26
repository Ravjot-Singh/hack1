"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getUser } from "@/lib/access";
import { prisma } from "@/lib/db";
import { demoCollege } from "@/lib/demo/demo-college";
import { createInstitute } from "@/lib/institute";
import { buildPeriods, DEFAULT_RULES, defaultGrid, slugify } from "@/lib/setup/bell";

const suffix = () => Math.random().toString(36).slice(2, 6);

/** Each new college is a few thousand rows; one account may run this many (demo copies included). */
const MAX_COLLEGES_PER_USER = 5;
const WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/** The colleges this user administers, newest first. */
const adminOf = (userId: string) =>
  prisma.membership.findMany({ where: { userId, role: "INSTITUTE_ADMIN" }, select: { institution: { select: { slug: true } } }, orderBy: { createdAt: "desc" } });

/** Give the signed-in user their own copy of the demo college, with them as its admin. */
export async function createDemoCopy() {
  const user = await getUser();
  if (!user) redirect("/sign-up?next=/");
  const owned = await adminOf(user.id);
  // At the limit, open their newest college instead of creating another.
  if (owned.length >= MAX_COLLEGES_PER_USER) redirect(`/${owned[0].institution.slug}`);
  const slug = `demo-${Math.random().toString(36).slice(2, 8)}`;
  const institutionId = await createInstitute(
    { ...demoCollege(`${slug}-`), name: "Demo Institute of Technology (your copy)" },
    slug,
    true,
  );
  await prisma.membership.create({ data: { userId: user.id, institutionId, role: "INSTITUTE_ADMIN" } });
  redirect(`/${slug}`);
}

const newCollege = z
  .object({
    name: z.string().trim().min(2, "Enter the college name").max(120),
    days: z
      .array(z.enum(WEEK))
      .min(1, "Pick at least one working day")
      .max(7)
      .refine((d) => new Set(d).size === d.length, "Each working day only once"),
    start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Start time like 09:00"),
    periodMinutes: z.coerce.number().int().min(20).max(180),
    periods: z.coerce.number().int().min(1).max(14),
    breakAfter: z.coerce.number().int().min(0),
    breakMinutes: z.coerce.number().int().min(0).max(60),
    lunchPeriod: z.coerce.number().int().min(0),
    halfSaturday: z.boolean(),
  })
  .refine((v) => v.lunchPeriod <= v.periods && v.breakAfter < v.periods, { message: "Break and lunch must be within the day" });

export type NewCollegeInput = z.input<typeof newCollege>;

/** Create an empty institute (the creator becomes its admin), then open the setup wizard. */
export async function createBlankInstitute(input: NewCollegeInput): Promise<{ error: string }> {
  const user = await getUser();
  if (!user) return { error: "Please sign in first." };
  const parsed = newCollege.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  if ((await adminOf(user.id)).length >= MAX_COLLEGES_PER_USER) {
    return { error: `You already run ${MAX_COLLEGES_PER_USER} colleges, the most one account can create. Ask a colleague to create this one and invite you.` };
  }
  const v = parsed.data;
  const slug = `${slugify(v.name)}-${suffix()}`;
  await prisma.institution.create({
    data: {
      name: v.name,
      slug,
      days: v.days,
      periods: buildPeriods(v),
      passingMinutes: 5,
      rules: DEFAULT_RULES as object,
      grids: { create: { name: "Standard", open: defaultGrid(v.days, v.periods, v.lunchPeriod, v.halfSaturday) } },
      members: { create: { userId: user.id, role: "INSTITUTE_ADMIN" } },
    },
  });
  redirect(`/${slug}/setup`);
}
