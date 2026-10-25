import { Suspense } from "react";
import { Briefcase } from "lucide-react";
import { NoAccess } from "@/components/no-access";
import { PageSkeleton } from "@/components/page-skeleton";
import { DriveEditorToggle } from "@/components/placements/drive-editor";
import { Badge } from "@/components/ui/badge";
import { checkPage } from "@/lib/access";
import { todayIso } from "@/lib/calendar";
import { prisma } from "@/lib/db";
import { sectionImpact, type Attendance } from "@/lib/placements";
import { loadImpactContext, roundHits } from "@/lib/placements-db";
import { periodRange } from "@/lib/venues";
import { cn } from "@/lib/utils";

export default function PlacementsPage({ params }: PageProps<"/[inst]/placements">) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Placement drives</h1>
        <p className="text-muted-foreground">
          Each drive lists its rounds and venues, who takes part, and which classes lose students, so teachers know who will be away.
        </p>
      </div>
      <Suspense fallback={<PageSkeleton rows={3} />}>
        <Drives params={params} />
      </Suspense>
    </div>
  );
}

const STATUS: Record<string, string> = { PENDING: "venue requested", APPROVED: "venue booked", REJECTED: "venue declined", CANCELLED: "venue cancelled" };

async function Drives({ params }: Pick<PageProps<"/[inst]/placements">, "params">) {
  const { inst: slug } = await params;
  const access = await checkPage(slug, "placement.view");
  if ("denied" in access) return <NoAccess reason={access.denied} next={`/${slug}/placements`} />;
  const institutionId = access.inst.id;
  const m = access.member!;
  const manage = access.can("placement.manage");
  const isStudent = m.role === "STUDENT";

  const [all, sections, departments, rooms, inst, ctx] = await Promise.all([
    prisma.placementDrive.findMany({ where: { institutionId }, include: { rounds: { orderBy: [{ date: "asc" }, { startPeriod: "asc" }] } }, orderBy: { createdAt: "desc" } }),
    prisma.section.findMany({ where: { institutionId }, orderBy: [{ year: "asc" }, { name: "asc" }], select: { id: true, name: true, year: true, departmentId: true, size: true } }),
    prisma.department.findMany({ where: { institutionId }, orderBy: { code: "asc" }, select: { id: true, code: true } }),
    prisma.room.findMany({ where: { institutionId }, orderBy: [{ isEventVenue: "desc" }, { capacity: "desc" }], select: { id: true, name: true, capacity: true, isEventVenue: true } }),
    prisma.institution.findUniqueOrThrow({ where: { id: institutionId }, select: { periods: true } }),
    loadImpactContext(institutionId),
  ]);
  const periods = inst.periods as { start: string; end: string }[];
  const attendingOf = (d: (typeof all)[number]) => d.attending as unknown as Attendance[];
  // Students only see drives their section takes part in.
  const drives = isStudent ? all.filter((d) => attendingOf(d).some((a) => a.sectionId === m.sectionId)) : all;
  const bookings = await prisma.venueBooking.findMany({ where: { id: { in: drives.flatMap((d) => d.rounds.map((r) => r.bookingId).filter((x): x is string => !!x)) } }, select: { id: true, status: true } });
  const hits = ctx ? await roundHits(institutionId, ctx, drives.flatMap((d) => d.rounds.map((r) => ({ ...r, attending: attendingOf(d) })))) : new Map();
  const editorSections = sections.map((s) => ({ id: s.id, name: s.name, year: s.year, deptId: s.departmentId, size: s.size }));
  const roomName = (id: string | null) => rooms.find((r) => r.id === id)?.name ?? null;
  const teacherName = (id: string) => ctx?.snapshot.teachers.find((t) => t.id === id)?.name ?? "";
  const today = todayIso();
  const upcoming = (d: (typeof all)[number]) => d.rounds.some((r) => r.date.toISOString().slice(0, 10) >= today);
  const sorted = [...drives].sort((a, b) => Number(upcoming(b)) - Number(upcoming(a)));
  const pretty = (d: Date) => d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  const editorProps = { slug, sections: editorSections, departments, rooms, periods };

  return (
    <div className="space-y-6">
      {manage && <DriveEditorToggle label="New drive" drive={null} {...editorProps} />}
      {!ctx && <p className="text-sm text-muted-foreground">No timetable is published, so the impact on classes can&apos;t be shown yet.</p>}
      {sorted.length === 0 && <p className="text-muted-foreground">{isStudent ? "No drive for your section yet." : "No placement drives yet."}</p>}
      {sorted.map((d) => {
        const attending = attendingOf(d);
        const total = attending.reduce((n, a) => n + a.count, 0);
        const driveHits = d.rounds.flatMap((r) => hits.get(r.id) ?? []);
        const impact = ctx ? sectionImpact(ctx.problem, attending, driveHits) : [];
        const past = !upcoming(d);
        return (
          <article key={d.id} id={d.id} className={cn("space-y-4 rounded-lg border p-4", past && "opacity-70")}>
            <header className="flex flex-wrap items-start gap-3">
              <Briefcase className="mt-1 size-5 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <h2 className="text-lg font-semibold">
                  {d.company}
                  {d.role && <span className="font-normal text-muted-foreground"> · {d.role}</span>}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {total} students from {attending.length} section{attending.length === 1 ? "" : "s"}
                  {past ? " · finished" : ""}
                </p>
                {d.notes && <p className="mt-1 text-sm">{d.notes}</p>}
              </div>
            </header>

            <ul className="space-y-1 text-sm">
              {d.rounds.map((r) => {
                const status = bookings.find((b) => b.id === r.bookingId)?.status;
                return (
                  <li key={r.id} className="flex flex-wrap gap-x-3">
                    <span className="w-40 font-medium">{r.name}</span>
                    <span>
                      {pretty(r.date)} · {periodRange(r.startPeriod, r.endPeriod, periods)}
                    </span>
                    <span className="text-muted-foreground">
                      {roomName(r.roomId) ?? "Venue to be announced"}
                      {r.roomId && !isStudent ? ` (${status ? STATUS[status] : "venue not requested"})` : ""}
                    </span>
                  </li>
                );
              })}
            </ul>

            {!isStudent && ctx && (
              <div className="grid gap-4 lg:grid-cols-2">
                <section className="space-y-1.5">
                  <h3 className="text-sm font-semibold">Sections</h3>
                  <table className="w-full text-sm">
                    <thead className="text-left text-xs text-muted-foreground">
                      <tr>
                        <th className="py-1 font-medium">Section</th>
                        <th className="py-1 text-right font-medium">Away</th>
                        <th className="py-1 text-right font-medium">Classes affected</th>
                      </tr>
                    </thead>
                    <tbody>
                      {impact.map((s) => (
                        <tr key={s.sectionId} className="border-t">
                          <td className="py-1">{s.name}</td>
                          <td className="py-1 text-right tabular-nums">
                            {s.away}/{s.size}
                          </td>
                          <td className="py-1 text-right tabular-nums">{s.classes}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
                <section className="space-y-1.5">
                  <h3 className="text-sm font-semibold">Classes that lose students</h3>
                  {driveHits.length === 0 ? (
                    <p className="text-sm text-muted-foreground">None: the rounds fall outside class time.</p>
                  ) : (
                    <ul className="space-y-1 text-sm">
                      {d.rounds.map((r) =>
                        (hits.get(r.id) ?? []).map((h: { lessonId: string; label: string; period: number; teacherIds: string[]; away: number; size: number }) => {
                          const yours = !!m.teacherId && h.teacherIds.includes(m.teacherId);
                          return (
                            <li key={`${r.id}-${h.lessonId}`} className={cn("flex flex-wrap gap-x-2", yours && "font-medium")}>
                              <span className="tabular-nums text-muted-foreground">
                                {pretty(r.date)} P{h.period + 1}
                              </span>
                              <span>{h.label}</span>
                              <span className="text-muted-foreground">{h.teacherIds.map(teacherName).join(", ")}</span>
                              <Badge variant={yours ? "default" : "outline"} className="ml-auto tabular-nums">
                                {h.away}/{h.size} away
                              </Badge>
                            </li>
                          );
                        }),
                      )}
                    </ul>
                  )}
                </section>
              </div>
            )}

            {manage && (
              <DriveEditorToggle
                label="Edit drive"
                drive={{
                  id: d.id,
                  company: d.company,
                  role: d.role,
                  notes: d.notes,
                  attending,
                  rounds: d.rounds.map((r) => ({ id: r.id, name: r.name, date: r.date.toISOString().slice(0, 10), start: r.startPeriod, end: r.endPeriod, roomId: r.roomId })),
                }}
                {...editorProps}
              />
            )}
          </article>
        );
      })}
    </div>
  );
}
