"use server";

import { revalidatePath } from "next/cache";
import { getAccess } from "@/lib/access";
import { prisma } from "@/lib/db";

/** Mark all of the signed-in user's notifications in this college as read. */
export async function markAllRead(slug: string): Promise<void> {
  const access = await getAccess(slug);
  if (!access.user) return;
  await prisma.notification.updateMany({
    where: { userId: access.user.id, institutionId: access.inst.id, readAt: null },
    data: { readAt: new Date() },
  });
  revalidatePath(`/${slug}`, "layout");
}
