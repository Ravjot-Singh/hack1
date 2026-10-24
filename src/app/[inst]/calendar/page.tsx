import { Suspense } from "react";
import { CalendarManager } from "@/components/calendar/calendar-manager";
import { NoAccess } from "@/components/no-access";
import { PageSkeleton } from "@/components/page-skeleton";
import { checkPage } from "@/lib/access";
import { loadCalendar } from "@/lib/calendar-db";

export default function CalendarPage({ params }: PageProps<"/[inst]/calendar">) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Academic calendar</h1>
        <p className="text-muted-foreground">
          Term dates, holidays, exam days and swapped days (&ldquo;Saturday follows Monday&rdquo;). The Today view and
          substitutions use this to know which timetable runs on a date.
        </p>
      </div>
      <Suspense fallback={<PageSkeleton rows={2} />}>
        <Calendar params={params} />
      </Suspense>
    </div>
  );
}

async function Calendar({ params }: Pick<PageProps<"/[inst]/calendar">, "params">) {
  const { inst: slug } = await params;
  const access = await checkPage(slug, "calendar.manage");
  if ("denied" in access) return <NoAccess reason={access.denied} next={`/${slug}/calendar`} />;
  return <CalendarManager slug={slug} calendar={await loadCalendar(access.inst.id)} />;
}
