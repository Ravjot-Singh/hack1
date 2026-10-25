"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AccessError, requireAction } from "@/lib/access";
import { prisma } from "@/lib/db";
import { draftProblem, duplicates, linksFor, MAX_BULK_INVITES, type InviteDraft } from "@/lib/invites";
import type { Role } from "@/lib/permissions";

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

export type BulkInviteResult = { ok: true; created: number; skipped: string[] } | { ok: false; error: string; rowErrors?: string[] };

/**
 * Many invites at once (typed rows, an imported sheet or a group). Bad rows refuse the whole
 * batch with one message per row; people who already have an account or an open invite (same
 * email or teacher record) are skipped and named. Teacher rows without an email get the
 * teacher record's email.
 */
export async function createInvites(slug: string, input: unknown): Promise<BulkInviteResult> {
  const a = await admin(slug);
  if (!a.access) return { ok: false, error: a.error! };
  const parsed = z.array(z.unknown()).max(MAX_BULK_INVITES, `At most ${MAX_BULK_INVITES} people at a time.`).safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const institutionId = a.access.inst.id;
  const [departments, teachers, sections, members, invites] = await Promise.all([
    prisma.department.findMany({ where: { institutionId }, select: { id: true } }),
    prisma.teacher.findMany({ where: { institutionId }, select: { id: true, name: true, email: true } }),
    prisma.section.findMany({ where: { institutionId }, select: { id: true } }),
    prisma.membership.findMany({ where: { institutionId }, select: { teacherId: true, user: { select: { email: true } } } }),
    prisma.invite.findMany({ where: { institutionId, acceptedAt: null }, select: { teacherId: true, email: true } }),
  ]);
  const ids = (list: { id: string }[]) => new Set(list.map((x) => x.id));
  const [deptIds, teacherIds, sectionIds] = [ids(departments), ids(teachers), ids(sections)];
  const teacherById = new Map(teachers.map((t) => [t.id, t]));

  const rows: InviteDraft[] = [];
  const rowErrors: string[] = [];
  parsed.data.forEach((raw, i) => {
    const v = inviteInput.safeParse(raw);
    const at = `Row ${i + 1}`;
    if (!v.success) return rowErrors.push(`${at}: ${v.error.issues[0].message}.`);
    const d: InviteDraft = { ...v.data, ...linksFor(v.data) };
    const problem = draftProblem(d);
    if (problem) return rowErrors.push(`${at} (${d.name}): ${problem}`);
    if ((d.departmentId && !deptIds.has(d.departmentId)) || (d.teacherId && !teacherIds.has(d.teacherId)) || (d.sectionId && !sectionIds.has(d.sectionId))) {
      return rowErrors.push(`${at} (${d.name}): that department, teacher or section no longer exists; reload the page.`);
    }
    if (!d.email && d.teacherId) d.email = teacherById.get(d.teacherId)?.email?.toLowerCase() ?? "";
    rows.push(d);
  });
  if (rowErrors.length) return { ok: false, error: `${rowErrors.length} row${rowErrors.length > 1 ? "s need" : " needs"} fixing; nothing was created.`, rowErrors };

  const taken = {
    emails: new Set([...members.map((m) => m.user.email.toLowerCase()), ...invites.flatMap((x) => (x.email ? [x.email.toLowerCase()] : []))]),
    teacherIds: new Set([...members, ...invites].flatMap((x) => (x.teacherId ? [x.teacherId] : []))),
  };
  const dup = duplicates(rows, taken, (id) => teacherById.get(id)?.name ?? "That teacher");
  const todo = rows.filter((_, i) => !dup.has(i));
  const expiresAt = new Date(Date.now() + INVITE_DAYS * 86400_000);
  await prisma.invite.createMany({
    data: todo.map((d) => ({
      token: token(),
      institutionId,
      name: d.name.trim(),
      email: d.email || null,
      role: d.role,
      departmentId: d.departmentId,
      teacherId: d.teacherId,
      sectionId: d.sectionId,
      invitedBy: a.access!.user!.id,
      expiresAt,
    })),
  });
  revalidatePath(`/${slug}/people`);
  return { ok: true, created: todo.length, skipped: [...dup.entries()].map(([i, why]) => `${rows[i].name}: ${why}`) };
}

/** Record that these links were handed out (copied, shared or exported). */
export async function markSent(slug: string, inviteIds: string[]): Promise<PeopleResult> {
  const a = await admin(slug);
  if (!a.access) return { ok: false, error: a.error! };
  const ids = z.array(z.string()).max(MAX_BULK_INVITES).safeParse(inviteIds);
  if (!ids.success) return { ok: false, error: "Too many invites at once." };
  await prisma.invite.updateMany({ where: { id: { in: ids.data }, institutionId: a.access.inst.id, acceptedAt: null }, data: { sentAt: new Date() } });
  revalidatePath(`/${slug}/people`);
  return { ok: true };
}

/**
 * Reminder for everyone who was sent a link but hasn't joined: their links get a fresh
 * 14 days (expired ones work again) and are returned for sharing.
 */
export async function resendInvites(
  slug: string,
): Promise<{ ok: true; invites: { id: string; name: string; email: string | null; role: Role; token: string }[] } | { ok: false; error: string }> {
  const a = await admin(slug);
  if (!a.access) return { ok: false, error: a.error! };
  const where = { institutionId: a.access.inst.id, acceptedAt: null, sentAt: { not: null } };
  const invites = await prisma.invite.findMany({ where, select: { id: true, name: true, email: true, role: true, token: true }, orderBy: { name: "asc" } });
  const now = new Date();
  await prisma.invite.updateMany({ where: { ...where, id: { in: invites.map((i) => i.id) } }, data: { sentAt: now, expiresAt: new Date(now.getTime() + INVITE_DAYS * 86400_000) } });
  revalidatePath(`/${slug}/people`);
  return { ok: true, invites };
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
