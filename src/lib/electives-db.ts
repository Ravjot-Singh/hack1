import { prisma } from "@/lib/db";

/** A basket with its sections, electives, registration window and choices. */
export async function loadBasket(institutionId: string, basketId: string) {
  return prisma.electiveBasket.findFirst({
    where: { id: basketId, institutionId },
    include: {
      sections: { select: { id: true, name: true, size: true, departmentId: true } },
      offerings: { include: { subject: { select: { code: true, name: true, theoryRoomType: true } } } },
      window: true,
      choices: { select: { offeringId: true, studentId: true } },
    },
  });
}
