import { Suspense } from "react";
import { NoAccess } from "@/components/no-access";
import { PageSkeleton } from "@/components/page-skeleton";
import { PeopleManager } from "@/components/people/people-manager";
import { checkPage } from "@/lib/access";
import { prisma } from "@/lib/db";

export default function PeoplePage({ params }: PageProps<"/[inst]/people">) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">People</h1>
        <p className="text-muted-foreground">
          Invite HODs, teachers, students and staff. Invite one person or many at once (typed, imported from a sheet, or a whole group); each gets a
          link to join that you share by WhatsApp, email or a mail merge.
        </p>
      </div>
      <Suspense fallback={<PageSkeleton rows={2} />}>
        <People params={params} />
      </Suspense>
    </div>
  );
}

async function People({ params }: Pick<PageProps<"/[inst]/people">, "params">) {
  const { inst: slug } = await params;
  const access = await checkPage(slug, "people.manage");
  if ("denied" in access) return <NoAccess reason={access.denied} next={`/${slug}/people`} />;
  const institutionId = access.inst.id;
  const [members, invites, departments, teachers, sections] = await Promise.all([
    prisma.membership.findMany({
      where: { institutionId },
      include: { user: { select: { name: true, email: true } } },
      orderBy: [{ role: "asc" }, { createdAt: "asc" }],
    }),
    prisma.invite.findMany({ where: { institutionId, acceptedAt: null }, orderBy: { createdAt: "desc" } }),
    prisma.department.findMany({ where: { institutionId }, select: { id: true, name: true, code: true }, orderBy: { code: "asc" } }),
    prisma.teacher.findMany({ where: { institutionId }, select: { id: true, name: true, departmentId: true }, orderBy: { name: "asc" } }),
    prisma.section.findMany({ where: { institutionId }, select: { id: true, name: true }, orderBy: [{ year: "asc" }, { name: "asc" }] }),
  ]);
  return (
    <PeopleManager
      slug={slug}
      me={access.user!.id}
      members={members.map((m) => ({
        id: m.id,
        userId: m.userId,
        name: m.user.name,
        email: m.user.email,
        role: m.role,
        departmentId: m.departmentId,
        teacherId: m.teacherId,
        sectionId: m.sectionId,
      }))}
      invites={invites.map((i) => ({
        id: i.id,
        token: i.token,
        name: i.name,
        email: i.email,
        role: i.role,
        departmentId: i.departmentId,
        teacherId: i.teacherId,
        sectionId: i.sectionId,
        expired: i.expiresAt < new Date(),
        sentAt: i.sentAt?.toISOString() ?? null,
      }))}
      departments={departments}
      teachers={teachers}
      sections={sections}
    />
  );
}
