import { Suspense } from "react";
import Link from "next/link";
import { Bell, CalendarRange } from "lucide-react";
import { InstNav, type NavItem } from "@/components/inst-nav";
import { UserMenu } from "@/components/user-menu";
import { getAccess } from "@/lib/access";
import { prisma } from "@/lib/db";
import { ROLE_LABEL } from "@/lib/permissions";

// The header shell prerenders; the institute name, role-aware nav and user menu stream in.
export default function InstituteLayout({ children, params }: LayoutProps<"/[inst]">) {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="border-b bg-background/80 backdrop-blur print:hidden">
        <div className="mx-auto flex min-h-14 max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link href="/" className="flex items-center gap-2 font-semibold">
            <CalendarRange className="size-5" />
            <span className="hidden sm:inline">Scheduling Optimizer</span>
          </Link>
          <span className="text-muted-foreground">/</span>
          <Suspense fallback={<span className="h-4 w-48 animate-pulse rounded bg-muted" />}>
            <Header params={params} />
          </Suspense>
        </div>
      </header>
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 print:max-w-none print:p-0">{children}</main>
    </div>
  );
}

async function Header({ params }: Pick<LayoutProps<"/[inst]">, "params">) {
  const { inst: slug } = await params;
  const access = await getAccess(slug);
  const items: NavItem[] = [{ href: `/${slug}`, label: "Overview", exact: true }];
  if (access.member) items.push({ href: `/${slug}/today`, label: "Today" });
  if (access.member?.teacherId || access.member?.sectionId) items.push({ href: `/${slug}/me`, label: "My timetable" });
  if (access.can("setup.view")) items.push({ href: `/${slug}/setup`, label: "Setup" });
  if (access.can("timetable.generate")) items.push({ href: `/${slug}/solve`, label: "Generate" });
  items.push({ href: `/${slug}/timetables`, label: "Timetables" });
  if (access.can("setup.view")) items.push({ href: `/${slug}/insights`, label: "Room use" });
  if (access.can("absence.manage") || access.can("absence.self")) items.push({ href: `/${slug}/absences`, label: "Absences" });
  if ((access.can("appointments.host") && access.member?.teacherId) || access.can("appointments.book")) items.push({ href: `/${slug}/appointments`, label: "Office hours" });
  if (access.can("placement.view")) items.push({ href: `/${slug}/placements`, label: "Placements" });
  if (access.can("venue.request")) items.push({ href: `/${slug}/venues`, label: "Venues" });
  if (access.can("calendar.manage")) items.push({ href: `/${slug}/calendar`, label: "Calendar" });
  if (access.can("people.manage")) items.push({ href: `/${slug}/people`, label: "People" });
  return (
    <>
      <span className="truncate font-medium">{access.inst.name}</span>
      {access.member && <span className="hidden rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground md:inline">{ROLE_LABEL[access.member.role]}</span>}
      <Suspense>
        <InstNav items={access.user || access.publicDemo ? items : []} />
      </Suspense>
      {access.member && access.user && <NotificationBell slug={slug} userId={access.user.id} institutionId={access.inst.id} />}
      <UserMenu next={`/${slug}`} />
    </>
  );
}

async function NotificationBell({ slug, userId, institutionId }: { slug: string; userId: string; institutionId: string }) {
  const unread = await prisma.notification.count({ where: { userId, institutionId, readAt: null } });
  return (
    <Link
      href={`/${slug}/notifications`}
      className="relative rounded-md p-1.5 text-muted-foreground hover:bg-muted"
      aria-label={unread ? `${unread} unread notifications` : "Notifications"}
    >
      <Bell className="size-4" />
      {unread > 0 && (
        <span className="absolute -top-0.5 -right-0.5 min-w-4 rounded-full bg-destructive px-1 text-center text-[10px] leading-4 font-medium text-white">
          {unread > 9 ? "9+" : unread}
        </span>
      )}
    </Link>
  );
}
