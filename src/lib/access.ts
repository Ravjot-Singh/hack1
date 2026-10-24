import { cache } from "react";
import { headers } from "next/headers";
import { prisma } from "@/lib/db";
import { auth } from "@/lib/auth";
import { getInstitution } from "@/lib/inst";
import { isReadOnly } from "@/lib/setup/load";
import { can, canEditDepartment, type Action, type Member, type Role } from "@/lib/permissions";

/** The signed-in user for this request, or null. */
export const getUser = cache(async () => {
  const session = await auth.api.getSession({ headers: await headers() });
  return session?.user ?? null;
});

/** Read-only things anyone may look at on the shared public demo. */
const DEMO_VIEW: Action[] = ["setup.view", "timetable.viewDrafts", "timetable.generate"];

export interface Access {
  inst: Awaited<ReturnType<typeof getInstitution>>;
  user: Awaited<ReturnType<typeof getUser>>;
  member: Member | null;
  /** Shared demo: viewable by anyone, writable by no one. */
  publicDemo: boolean;
  can: (action: Action) => boolean;
  canEditDepartment: (departmentId: string | null | undefined) => boolean;
}

/** Who is looking at this institute and what they may do (cached per request). */
export const getAccess = cache(async (slug: string): Promise<Access> => {
  const inst = await getInstitution(slug);
  const user = await getUser();
  const [membership, hoiCount] = await Promise.all([
    user
      ? prisma.membership.findUnique({ where: { userId_institutionId: { userId: user.id, institutionId: inst.id } } })
      : null,
    prisma.membership.count({ where: { institutionId: inst.id, role: "HEAD_OF_INSTITUTE" } }),
  ]);
  const member: Member | null = membership
    ? {
        role: membership.role as Role,
        departmentId: membership.departmentId,
        teacherId: membership.teacherId,
        sectionId: membership.sectionId,
      }
    : null;
  const publicDemo = isReadOnly(inst);
  return {
    inst,
    user,
    member,
    publicDemo,
    can: (action) => (publicDemo ? DEMO_VIEW.includes(action) : can(member, action, { noHeadOfInstitute: hoiCount === 0 })),
    canEditDepartment: (departmentId) => !publicDemo && canEditDepartment(member, departmentId),
  };
});

export type AccessDenied = { denied: "signin" | "member" | "role" };

/** For pages: what to show when the visitor may not see this. */
export async function checkPage(slug: string, action?: Action): Promise<Access | AccessDenied> {
  const access = await getAccess(slug);
  if (access.publicDemo) return !action || access.can(action) ? access : { denied: "role" };
  if (!access.user) return { denied: "signin" };
  if (!access.member) return { denied: "member" };
  if (action && !access.can(action)) return { denied: "role" };
  return access;
}

/** For server actions: throws a readable error unless the current user may do `action`. */
export async function requireAction(slug: string, action: Action): Promise<Access> {
  const access = await getAccess(slug);
  if (access.publicDemo) throw new AccessError("The shared demo is read-only. Make your own copy to change things.");
  if (!access.user) throw new AccessError("Please sign in again.");
  if (!access.member) throw new AccessError("You are not a member of this college.");
  if (!access.can(action)) throw new AccessError("Your role doesn't allow this.");
  return access;
}

export class AccessError extends Error {}
