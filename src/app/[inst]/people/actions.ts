"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AccessError, requireAction } from "@/lib/access";
import { prisma } from "@/lib/db";

export type PeopleResult = { ok: true } | { ok: false; error: string };
export type InviteResult = { ok: true; token: string } | { ok: false; error: string };

const ROLES = [
  "INSTITUTE_ADMIN",
  "HEAD_OF_INSTITUTE",
  "HOD",
  "TEACHER",
  "STUDENT",
  "PLACEMENT_OFFICER",
  "VENUE_MANAGER",
  "LAB_ASSISTANT",
] as const;

const roleLink = z.object({
  role: z.enum(ROLES),
  departmentId: z.string().nullable().default(null),
  teacherId: z.string().nullable().default(null),
  sectionId: z.string().nullable().default(null),
});

const inviteInput = roleLink.extend({
  name: z.string().trim().min(2, "Enter the person's name").max(80),
  email: z.string().trim().toLowerCase().email("Not a valid email").or(z.literal("")).default(""),
});

const INVITE_DAYS = 14;

function token(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("base64url");
}

async function admin(slug: string) {
  try {
    return { access: await requireAction(slug, "people.manage") };
  } catch (e) {
    if (e instanceof AccessError) return { error: e.message };
    throw e;
  }
}

/** Check that role links point at this institute's records and that HODs have a department. */
async function checkLinks(institutionId: string, v: z.output<typeof roleLink>): Promise<string | null> {
  if (v.role === "HOD" && !v.departmentId) return "Pick the HOD's department.";
  const [dept, teacher, section] = await Promise.all([
    v.departmentId ? prisma.department.findFirst({ where: { id: v.departmentId, institutionId } }) : true,
    v.teacherId ? prisma.teacher.findFirst({ where: { id: v.teacherId, institutionId } }) : true,
    v.sectionId ? prisma.section.findFirst({ where: { id: v.sectionId, institutionId } }) : true,
  ]);
  if (!dept || !teacher || !section) return "That department, teacher or section no longer exists; reload the page.";
  return null;
}

/** Only the parts of a link that make sense for the role are kept. */
function linksFor(v: z.output<typeof roleLink>) {
  return {
    // A lab assistant looks after one department's labs, or the common labs when none is set.
    departmentId: v.role === "HOD" || v.role === "LAB_ASSISTANT" ? v.departmentId : null,
    teacherId: v.role === "TEACHER" || v.role === "HOD" ? v.teacherId : null,
    sectionId: v.role === "STUDENT" ? v.sectionId : null,
  };
}

export async function createInvite(slug: string, input: unknown): Promise<InviteResult> {
  const a = await admin(slug);
  if (!a.access) return { ok: false, error: a.error! };
  const parsed = inviteInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const v = parsed.data;
  const bad = await checkLinks(a.access.inst.id, v);
  if (bad) return { ok: false, error: bad };
  const invite = await prisma.invite.create({
    data: {
      token: token(),
      institutionId: a.access.inst.id,
      name: v.name,
      email: v.email || null,
      role: v.role,
      ...linksFor(v),
      invitedBy: a.access.user!.id,
      expiresAt: new Date(Date.now() + INVITE_DAYS * 86400_000),
    },
  });
  revalidatePath(`/${slug}/people`);
  return { ok: true, token: invite.token };
}

/** One invite per teacher who has no account or open invite yet. */
export async function inviteAllTeachers(slug: string): Promise<{ ok: true; created: number } | { ok: false; error: string }> {
  const a = await admin(slug);
  if (!a.access) return { ok: false, error: a.error! };
  const institutionId = a.access.inst.id;
  const [teachers, members, invites] = await Promise.all([
    prisma.teacher.findMany({ where: { institutionId }, select: { id: true, name: true, email: true } }),
    prisma.membership.findMany({ where: { institutionId, teacherId: { not: null } }, select: { teacherId: true } }),
    prisma.invite.findMany({ where: { institutionId, acceptedAt: null, teacherId: { not: null } }, select: { teacherId: true } }),
  ]);
  const covered = new Set([...members, ...invites].map((x) => x.teacherId));
  const todo = teachers.filter((t) => !covered.has(t.id));
  await prisma.invite.createMany({
    data: todo.map((t) => ({
      token: token(),
      institutionId,
      name: t.name,
      email: t.email,
      role: "TEACHER" as const,
      teacherId: t.id,
      invitedBy: a.access!.user!.id,
      expiresAt: new Date(Date.now() + INVITE_DAYS * 86400_000),
    })),
  });
  revalidatePath(`/${slug}/people`);
  return { ok: true, created: todo.length };
}

export async function revokeInvite(slug: string, inviteId: string): Promise<PeopleResult> {
  const a = await admin(slug);
  if (!a.access) return { ok: false, error: a.error! };
  await prisma.invite.deleteMany({ where: { id: inviteId, institutionId: a.access.inst.id, acceptedAt: null } });
  revalidatePath(`/${slug}/people`);
  return { ok: true };
}

async function adminCountAfter(institutionId: string, membershipId: string, newRole: string | null) {
  const admins = await prisma.membership.findMany({ where: { institutionId, role: "INSTITUTE_ADMIN" }, select: { id: true } });
  return admins.filter((m) => m.id !== membershipId).length + (newRole === "INSTITUTE_ADMIN" ? 1 : 0);
}

export async function changeRole(slug: string, membershipId: string, input: unknown): Promise<PeopleResult> {
  const a = await admin(slug);
  if (!a.access) return { ok: false, error: a.error! };
  const parsed = roleLink.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const institutionId = a.access.inst.id;
  const m = await prisma.membership.findFirst({ where: { id: membershipId, institutionId } });
  if (!m) return { ok: false, error: "That person is no longer a member." };
  const bad = await checkLinks(institutionId, parsed.data);
  if (bad) return { ok: false, error: bad };
  if ((await adminCountAfter(institutionId, membershipId, parsed.data.role)) === 0) {
    return { ok: false, error: "The college needs at least one Institute Admin." };
  }
  await prisma.membership.update({ where: { id: membershipId }, data: { role: parsed.data.role, ...linksFor(parsed.data) } });
  revalidatePath(`/${slug}`, "layout");
  return { ok: true };
}

export async function removeMember(slug: string, membershipId: string): Promise<PeopleResult> {
  const a = await admin(slug);
  if (!a.access) return { ok: false, error: a.error! };
  const institutionId = a.access.inst.id;
  const m = await prisma.membership.findFirst({ where: { id: membershipId, institutionId } });
  if (!m) return { ok: true };
  if ((await adminCountAfter(institutionId, membershipId, null)) === 0) {
    return { ok: false, error: "The college needs at least one Institute Admin." };
  }
  await prisma.membership.delete({ where: { id: membershipId } });
  revalidatePath(`/${slug}`, "layout");
  return { ok: true };
}
