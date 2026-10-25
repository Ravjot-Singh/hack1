import { Suspense } from "react";
import { AppointmentList, BookingPanel, OfficeHoursEditor, type AppointmentView } from "@/components/appointments/appointments";
import { NoAccess } from "@/components/no-access";
import { PageSkeleton } from "@/components/page-skeleton";
import { checkPage } from "@/lib/access";
import { openSlots, subSlots, teachingSlots, weekCount, weekStart } from "@/lib/appointments";
import { BOOKING_WINDOW, dateInfos, loadWorld, toBooked, toConfig } from "@/lib/appointments-db";
import { addDays, todayIso } from "@/lib/calendar";
import { toDate } from "@/lib/cover-db";
import { prisma } from "@/lib/db";

export default function AppointmentsPage({ params, searchParams }: PageProps<"/[inst]/appointments">) {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Office hours</h1>
      <Suspense fallback={<PageSkeleton rows={3} />}>
        <Content params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Content({ params, searchParams }: Pick<PageProps<"/[inst]/appointments">, "params" | "searchParams">) {
  const { inst: slug } = await params;
  const sp = await searchParams;
  const access = await checkPage(slug);
  if ("denied" in access) return <NoAccess reason={access.denied} next={`/${slug}/appointments`} />;
  const m = access.member!;
  const host = access.can("appointments.host") && !!m.teacherId;
  const book = access.can("appointments.book");
  if (!host && !book) return <NoAccess reason="role" next={`/${slug}/appointments`} />;

  const institutionId = access.inst.id;
  const today = todayIso();
  const world = await loadWorld(institutionId, today, BOOKING_WINDOW);
  if (!world) return <p className="text-muted-foreground">Office hours work on the published timetable; none is published yet.</p>;
  const { snapshot } = world;
  const periods = snapshot.periods;
  const teacherName = (id: string) => snapshot.teachers.find((t) => t.id === id)?.name ?? "Former teacher";
  const startOf = (period: number, offset: number, minutes: number) => {
    const p = periods[period];
    return p ? (subSlots(p, minutes).find((s) => s.offset === offset)?.start ?? p.start) : `P${period + 1}`;
  };

  const rows = await prisma.appointment.findMany({
    where: { institutionId, date: { gte: toDate(today) }, ...(host ? { teacherId: m.teacherId! } : { studentId: access.user!.id }) },
    orderBy: [{ date: "asc" }, { period: "asc" }, { offset: "asc" }],
  });
  const students = host ? await prisma.user.findMany({ where: { id: { in: rows.map((r) => r.studentId) } }, select: { id: true, name: true } }) : [];
  const list: AppointmentView[] = rows.map((r) => ({
    id: r.id,
    date: r.date.toISOString().slice(0, 10),
    time: startOf(r.period, r.offset, r.minutes),
    minutes: r.minutes,
    topic: r.topic,
    status: r.status,
    note: r.note,
    with: host ? (students.find((s) => s.id === r.studentId)?.name ?? "A student") : teacherName(r.teacherId),
  }));

  if (host) {
    const teacherId = m.teacherId!;
    const cfg = await prisma.officeHours.findUnique({ where: { teacherId } });
    const teaching = [...teachingSlots(world.problem, world.assignment, teacherId)];
    // A period is closed when no time grid has classes in it (breaks, half days).
    const closed = snapshot.days.flatMap((_, d) => periods.map((_, p) => [d, p] as [number, number])).filter(([d, p]) => !snapshot.grids.some((g) => g.open[d]?.[p])).map(([d, p]) => `${d}:${p}`);
    return (
      <div className="space-y-8">
        <p className="text-muted-foreground">
          Pick free periods of the published timetable when students may book you. They are split into short slots; if your timetable
          changes, or you are on leave or covering a class, affected bookings are called off and the student is told.
        </p>
        <OfficeHoursEditor
          slug={slug}
          days={snapshot.days}
          periods={periods}
          teaching={teaching}
          closed={closed}
          initial={cfg ? toConfig(cfg) : { teacherId, slots: [], slotMinutes: 15, perStudentWeek: 2, location: "" }}
        />
        <section className="space-y-2">
          <h2 className="font-semibold">Upcoming bookings</h2>
          <AppointmentList slug={slug} items={list} empty="No one has booked yet." />
        </section>
      </div>
    );
  }

  // Student: teachers with office hours, those who teach the student's section first.
  const configs = await prisma.officeHours.findMany({ where: { institutionId } });
  const mine = new Set(m.sectionId ? world.problem.lessons.filter((l) => l.sectionIds.includes(m.sectionId!)).flatMap((l) => l.teacherIds) : []);
  const teachers = configs
    .filter((c) => (c.slots as unknown[]).length && snapshot.teachers.some((t) => t.id === c.teacherId))
    .map((c) => ({ id: c.teacherId, name: teacherName(c.teacherId), teachesYou: mine.has(c.teacherId), location: c.location }))
    .sort((a, b) => Number(b.teachesYou) - Number(a.teachesYou) || a.name.localeCompare(b.name));
  const picked = teachers.find((t) => t.id === sp.t) ?? teachers[0] ?? null;

  let slots: { date: string; period: number; offset: number; start: string; end: string }[] = [];
  let limitNote = "";
  if (picked) {
    const config = toConfig(configs.find((c) => c.teacherId === picked.id)!);
    const booked = (
      await prisma.appointment.findMany({
        where: { institutionId, teacherId: picked.id, status: "BOOKED", date: { gte: toDate(weekStart(today)), lte: toDate(addDays(today, BOOKING_WINDOW)) } },
      })
    ).map(toBooked);
    // Weeks where this student has reached the teacher's limit are hidden.
    slots = openSlots(config, dateInfos(world, picked.id), periods, booked).filter((s) => weekCount(booked, picked.id, access.user!.id, s.date) < config.perStudentWeek);
    limitNote = `Up to ${config.perStudentWeek} booking${config.perStudentWeek === 1 ? "" : "s"} a week with ${picked.name}, ${config.slotMinutes} minutes each${config.location ? ` · ${config.location}` : ""}.`;
  }

  return (
    <div className="space-y-8">
      <p className="text-muted-foreground">Book a short slot in a teacher&apos;s office hours, up to {BOOKING_WINDOW} days ahead.</p>
      <BookingPanel slug={slug} teachers={teachers} pickedId={picked?.id ?? null} slots={slots} limitNote={limitNote} />
      <section className="space-y-2">
        <h2 className="font-semibold">Your appointments</h2>
        <AppointmentList slug={slug} items={list} empty="None booked." />
      </section>
    </div>
  );
}
