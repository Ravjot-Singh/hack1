import { prisma } from "@/lib/db";
import type { CalendarInfo, SpecialDay } from "@/lib/calendar";

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

/** The institute's calendar as plain strings for resolveDay(). */
export async function loadCalendar(institutionId: string): Promise<Omit<CalendarInfo, "specials"> & { specials: (SpecialDay & { id: string })[] }> {
  const inst = await prisma.institution.findUniqueOrThrow({
    where: { id: institutionId },
    select: { days: true, termStart: true, termEnd: true, calendar: { orderBy: { date: "asc" } } },
  });
  return {
    days: inst.days as string[],
    termStart: iso(inst.termStart),
    termEnd: iso(inst.termEnd),
    specials: inst.calendar.map((c) => ({ id: c.id, date: iso(c.date)!, kind: c.kind, label: c.label, followsDay: c.followsDay })),
  };
}
