import { Suspense } from "react";
import { ConflictList, DowntimeForm, DowntimeList, ScheduleDate, type ConflictView } from "@/components/labs/labs";
import { NoAccess } from "@/components/no-access";
import { PageSkeleton } from "@/components/page-skeleton";
import { checkPage } from "@/lib/access";
import { resolveDay, todayIso } from "@/lib/calendar";
import { prisma } from "@/lib/db";
import { canManageRoom, downMap, labTypes } from "@/lib/downtime";
import { loadConflicts, loadDowntimes, loadMoves } from "@/lib/downtime-db";
import { loadImpactContext } from "@/lib/placements-db";
import { classUse, periodRange } from "@/lib/venues";
import { cn } from "@/lib/utils";

export default function LabsPage({ params, searchParams }: PageProps<"/[inst]/labs">) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Labs</h1>
        <p className="text-muted-foreground">
          Mark a lab (or any room you look after) out of service. Classes that were due there are listed with free rooms of the same
          type to move them to; teachers and students are told, and the room can&apos;t be booked meanwhile.
        </p>
      </div>
      <Suspense fallback={<PageSkeleton rows={3} />}>
        <Content params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

const pretty = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });

async function Content({ params, searchParams }: Pick<PageProps<"/[inst]/labs">, "params" | "searchParams">) {
  const { inst: slug } = await params;
  const sp = await searchParams;
  const access = await checkPage(slug, "labs.manage");
  if ("denied" in access) return <NoAccess reason={access.denied} next={`/${slug}/labs`} />;
  // Read the clock only after the request-specific access check (keeps prerendering happy).
  const date = typeof sp.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : todayIso();
  const institutionId = access.inst.id;
  const m = access.member!;

  const [rooms, subjects, inst, ctx] = await Promise.all([
    prisma.room.findMany({ where: { institutionId }, orderBy: [{ type: "asc" }, { name: "asc" }] }),
    prisma.subject.findMany({ where: { institutionId }, select: { P: true, labRoomType: true } }),
    prisma.institution.findUniqueOrThrow({ where: { id: institutionId }, select: { periods: true } }),
    loadImpactContext(institutionId),
  ]);
  const labs = labTypes(subjects);
  const mine = rooms.filter((r) => canManageRoom(m, r, labs));
  if (!mine.length) {
    return <p className="text-muted-foreground">No labs are linked to you yet. Ask the Institute Admin to set your department in People.</p>;
  }
  const mineIds = new Set(mine.map((r) => r.id));
  const roomName = (id: string) => rooms.find((r) => r.id === id)?.name ?? "a room";
  const periods = inst.periods as { start: string; end: string }[];
  const today = todayIso();

  const downtimes = (await loadDowntimes(institutionId, today, "9999-12-31")).filter((d) => mineIds.has(d.roomId));
  const conflicts: ConflictView[] = ctx
    ? (await loadConflicts(institutionId, ctx))
        .map((d) => {
          const lesson = (id: string) => ctx.problem.lessons.find((l) => l.id === id)!;
          const time = (id: string) => {
            const a = ctx.assignment[id];
            return periodRange(a.period, a.period + lesson(id).duration - 1, periods);
          };
          return {
            date: d.date,
            open: d.open.filter((c) => mineIds.has(c.roomId)).map((c) => ({ lessonId: c.lessonId, label: c.label, time: time(c.lessonId), room: roomName(c.roomId), reason: c.reason, options: c.options })),
            moved: d.moved
              .filter((x) => mineIds.has(ctx.assignment[x.lessonId].roomId))
              .map((x) => ({ lessonId: x.lessonId, label: lesson(x.lessonId).label, time: time(x.lessonId), from: roomName(ctx.assignment[x.lessonId].roomId), to: roomName(x.roomId) })),
          };
        })
        .filter((d) => d.open.length || d.moved.length)
    : [];

  // The chosen date's schedule for these rooms (lab assistants: their labs; others: all labs).
  const shown = m.role === "LAB_ASSISTANT" ? mine : mine.filter((r) => labs.has(r.type));
  const plan = ctx ? resolveDay(date, ctx.calendar) : null;
  const dayDown = downMap(await loadDowntimes(institutionId, date), date, periods.length);
  const use =
    ctx && plan?.kind === "classes"
      ? classUse(
          ctx.problem,
          ctx.assignment,
          plan.dayIndex,
          new Set((await prisma.cover.findMany({ where: { institutionId, versionId: ctx.versionId, date: new Date(`${date}T00:00:00Z`), action: "CANCEL" } })).map((c) => c.lessonId)),
          await loadMoves(institutionId, ctx.versionId, date),
        )
      : new Map<string, Map<number, string>>();
  const cols = `minmax(8rem, 11rem) repeat(${periods.length}, minmax(3.5rem, 1fr))`;

  return (
    <div className="space-y-8">
      <DowntimeForm slug={slug} rooms={mine.map((r) => ({ id: r.id, name: r.name, type: r.type }))} periods={periods} />

      <section className="space-y-2">
        <h2 className="font-semibold">Classes that need another room</h2>
        {ctx ? <ConflictList slug={slug} days={conflicts} /> : <p className="text-sm text-muted-foreground">No timetable is published.</p>}
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold">Out of service</h2>
        <DowntimeList
          slug={slug}
          items={downtimes.map((d) => ({
            id: d.id,
            room: roomName(d.roomId),
            when: `${d.from === d.to ? pretty(d.from) : `${pretty(d.from)} – ${pretty(d.to)}`}${d.periods.length ? `, ${d.periods.map((p) => `P${p + 1}`).join(" ")}` : ", all day"}`,
            reason: d.reason,
          }))}
        />
      </section>

      <section className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="font-semibold">Lab schedule</h2>
          <ScheduleDate date={date} />
          <span className="text-sm text-muted-foreground">{plan ? (plan.kind === "classes" ? (plan.note ?? "") : plan.reason) : ""}</span>
        </div>
        <div className="overflow-x-auto rounded-lg border p-2">
          <div className="grid min-w-[40rem] gap-[2px] text-xs" style={{ gridTemplateColumns: cols }}>
            <div />
            {periods.map((p, i) => (
              <div key={i} className="text-center text-muted-foreground">
                <div className="font-medium">P{i + 1}</div>
                <div className="text-[10px]">{p.start}</div>
              </div>
            ))}
            {shown.map((r) => (
              <div key={r.id} className="contents">
                <div className="truncate pr-2 leading-8 font-medium">{r.name}</div>
                {periods.map((_, p) => {
                  const off = dayDown.get(r.id)?.get(p);
                  const cls = use.get(r.id)?.get(p);
                  return (
                    <div
                      key={p}
                      title={off ? `Out of service: ${off}` : (cls ?? "Free")}
                      className={cn("h-8 truncate rounded-[3px] px-1 leading-8", off ? "tt-closed text-muted-foreground" : cls ? "bg-muted" : "bg-muted/30")}
                    >
                      {off ? "out" : (cls?.split(" · ")[0] ?? "")}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
