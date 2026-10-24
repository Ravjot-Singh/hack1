"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { demoCollege } from "@/lib/demo/demo-college";
import { createInstitute } from "@/lib/institute";
import { buildPeriods, DEFAULT_RULES, defaultGrid, slugify } from "@/lib/setup/bell";

const suffix = () => Math.random().toString(36).slice(2, 6);

/** Give a visitor their own copy of the demo college to experiment with. */
export async function createDemoCopy() {
  const slug = `demo-${Math.random().toString(36).slice(2, 8)}`;
  await createInstitute({ ...demoCollege(`${slug}-`), name: "Demo Institute of Technology (your copy)" }, slug, true);
  redirect(`/${slug}`);
}

const newCollege = z
  .object({
    name: z.string().trim().min(2, "Enter the college name").max(120),
    days: z.array(z.string()).min(1, "Pick at least one working day"),
    start: z.string().regex(/^\d{2}:\d{2}$/, "Start time like 09:00"),
    periodMinutes: z.coerce.number().int().min(20).max(180),
    periods: z.coerce.number().int().min(1).max(14),
    breakAfter: z.coerce.number().int().min(0),
    breakMinutes: z.coerce.number().int().min(0).max(60),
    lunchPeriod: z.coerce.number().int().min(0),
    halfSaturday: z.boolean(),
  })
  .refine((v) => v.lunchPeriod <= v.periods && v.breakAfter < v.periods, { message: "Break and lunch must be within the day" });

export type NewCollegeInput = z.input<typeof newCollege>;

/** Create an empty institute with a bell schedule and one default time grid, then open the setup wizard. */
export async function createBlankInstitute(input: NewCollegeInput): Promise<{ error: string }> {
  const parsed = newCollege.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
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
    },
  });
  redirect(`/${slug}/setup`);
}
