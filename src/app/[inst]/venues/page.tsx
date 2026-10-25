import { Suspense } from "react";
import { NoAccess } from "@/components/no-access";
import { PageSkeleton } from "@/components/page-skeleton";
import { VenueBoard, type BookingView } from "@/components/venues/venue-board";
import { checkPage } from "@/lib/access";
import { todayIso } from "@/lib/calendar";
import { toDate } from "@/lib/cover-db";
import { prisma } from "@/lib/db";
import { allowedPriorities, canDecide, periodRange } from "@/lib/venues";
import { loadVenueDay } from "@/lib/venues-db";

export default function VenuesPage({ params, searchParams }: PageProps<"/[inst]/venues">) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Rooms & venues</h1>
        <p className="text-muted-foreground">
          Book a seminar hall any time, or any room while it has no class. Requests go to whoever looks after the room: the HOD for
          department rooms, the Venue Manager for common rooms and halls. When two requests want the same time, higher priority wins
          (Institute, then Placement, Department, Club) and the other is offered free rooms.
        </p>
      </div>
      <Suspense fallback={<PageSkeleton rows={3} />}>
        <Board params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Board({ params, searchParams }: Pick<PageProps<"/[inst]/venues">, "params" | "searchParams">) {
  const { inst: slug } = await params;
  const sp = await searchParams;
  const access = await checkPage(slug, "venue.request");
  if ("denied" in access) return <NoAccess reason={access.denied} next={`/${slug}/venues`} />;
  // Read the clock only after the request-specific access check (keeps prerendering happy).
  const date = typeof sp.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : todayIso();
  const institutionId = access.inst.id;
  const member = access.member!;
  const userId = access.user!.id;

  const [day, departments, noVm, upcoming] = await Promise.all([
    loadVenueDay(institutionId, date),
    prisma.department.findMany({ where: { institutionId }, select: { id: true, code: true } }),
    prisma.membership.count({ where: { institutionId, role: "VENUE_MANAGER" } }).then((n) => n === 0),
    prisma.venueBooking.findMany({
      where: { institutionId, date: { gte: toDate(todayIso()) }, OR: [{ requestedBy: userId }, { status: "PENDING" }] },
      include: { room: true },
      orderBy: [{ date: "asc" }, { startPeriod: "asc" }],
      take: 200,
    }),
  ]);
  const deptCode = (id: string | null) => departments.find((d) => d.id === id)?.code ?? null;
  const userIds = [...new Set([...day.rows, ...upcoming].map((b) => b.requestedBy))];
  const users = await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } });
  const nameOf = (id: string) => users.find((u) => u.id === id)?.name ?? "Someone";
  const decides = (room: Parameters<typeof canDecide>[1]) => canDecide(member, room, { noVenueManager: noVm });

  const view = (b: (typeof upcoming)[number] | (typeof day.rows)[number], roomName: string, room: Parameters<typeof canDecide>[1] | undefined): BookingView => ({
    id: b.id,
    roomId: b.roomId,
    roomName,
    date: b.date.toISOString().slice(0, 10),
    start: b.startPeriod,
    end: b.endPeriod,
    when: periodRange(b.startPeriod, b.endPeriod, day.periods),
    title: b.title,
    attendees: b.attendees,
    priority: b.priority,
    status: b.status,
    requester: nameOf(b.requestedBy),
    note: b.note,
    classOverride: b.classOverride,
    mine: b.requestedBy === userId,
    canDecide: !!room && decides(room),
  });

  const roomById = new Map(day.rooms.map((r) => [r.id, r]));
  return (
    <VenueBoard
      slug={slug}
      date={date}
      dayNote={day.plan.kind === "classes" ? `${day.days[day.plan.dayIndex]} timetable${day.plan.note ? ` · ${day.plan.note}` : ""}` : `${day.plan.reason}: no classes`}
      published={day.published}
      periods={day.periods}
      rooms={day.rooms.map((r) => ({ ...r, ownerCode: deptCode(r.ownerDeptId) }))}
      use={Object.fromEntries([...day.use].map(([roomId, m]) => [roomId, Object.fromEntries(m)]))}
      down={Object.fromEntries([...day.down].map(([roomId, m]) => [roomId, Object.fromEntries(m)]))}
      bookings={day.rows.map((b) => view(b, roomById.get(b.roomId)?.name ?? "", roomById.get(b.roomId)))}
      queue={upcoming.filter((b) => b.status === "PENDING" && decides(b.room)).map((b) => view(b, b.room.name, b.room))}
      mine={upcoming.filter((b) => b.requestedBy === userId).map((b) => view(b, b.room.name, b.room))}
      priorities={allowedPriorities(member.role)}
      isHoi={member.role === "HEAD_OF_INSTITUTE"}
    />
  );
}
