"use server";

import { redirect } from "next/navigation";
import { getUser } from "@/lib/access";
import { prisma } from "@/lib/db";

/** Join the invite's college with its role. One account can belong to many colleges, one role each. */
export async function acceptInvite(token: string): Promise<{ error: string }> {
  const user = await getUser();
  if (!user) return { error: "Please sign in first." };
  const invite = await prisma.invite.findUnique({ where: { token }, include: { institution: { select: { slug: true } } } });
  if (!invite || invite.acceptedAt) return { error: "This invite has already been used or was withdrawn." };
  if (invite.expiresAt < new Date()) return { error: "This invite has expired. Ask the admin for a new link." };
  const existing = await prisma.membership.findUnique({
    where: { userId_institutionId: { userId: user.id, institutionId: invite.institutionId } },
  });
  if (existing) return { error: "You're already a member of this college. Ask the admin to change your role instead." };
  // Claim the invite first: the row lock makes a second person accepting at the same moment
  // see it already taken, so a single-use link can never create two memberships.
  const joined = await prisma.$transaction(async (tx) => {
    const claimed = await tx.invite.updateMany({
      where: { id: invite.id, acceptedAt: null, expiresAt: { gt: new Date() } },
      data: { acceptedAt: new Date(), acceptedBy: user.id },
    });
    if (claimed.count === 0) return false;
    await tx.membership.create({
      data: {
        userId: user.id,
        institutionId: invite.institutionId,
        role: invite.role,
        departmentId: invite.departmentId,
        teacherId: invite.teacherId,
        sectionId: invite.sectionId,
      },
    });
    return true;
  });
  if (!joined) return { error: "This invite has already been used or was withdrawn." };
  redirect(`/${invite.institution.slug}`);
}
