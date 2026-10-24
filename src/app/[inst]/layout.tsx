import { Suspense } from "react";
import Link from "next/link";
import { CalendarRange } from "lucide-react";
import { InstNav, type NavItem } from "@/components/inst-nav";
import { UserMenu } from "@/components/user-menu";
import { getAccess } from "@/lib/access";
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
  if (access.can("calendar.manage")) items.push({ href: `/${slug}/calendar`, label: "Calendar" });
  if (access.can("people.manage")) items.push({ href: `/${slug}/people`, label: "People" });
  return (
    <>
      <span className="truncate font-medium">{access.inst.name}</span>
      {access.member && <span className="hidden rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground md:inline">{ROLE_LABEL[access.member.role]}</span>}
      <Suspense>
        <InstNav items={access.user || access.publicDemo ? items : []} />
      </Suspense>
      <UserMenu next={`/${slug}`} />
    </>
  );
}
