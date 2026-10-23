import { cache } from "react";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";

/** Institution by URL slug (deduplicated per request); 404 when missing. */
export const getInstitution = cache(async (slug: string) => {
  const inst = await prisma.institution.findUnique({ where: { slug } });
  if (!inst) notFound();
  return inst;
});
