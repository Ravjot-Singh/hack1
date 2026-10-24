"use client";

import { useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CalendarOff, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { addDays, resolveDay, todayIso, type CalendarInfo } from "@/lib/calendar";
import { buildProblem } from "@/lib/solver";
import type { Assignment, InstituteInput } from "@/lib/solver";
import { DayList } from "./day-list";
import type { ViewKind } from "./timetable-grid";

interface Props {
  snapshot: InstituteInput;
  assignment: Assignment;
  calendar: CalendarInfo;
  /** The viewer's own timetable (teacher or section); otherwise they pick. */
  fixed: { view: ViewKind; entityId: string } | null;
  versionName: string;
}

/** One date's classes: the published weekly timetable resolved through the academic calendar. */
export function TodayView({ snapshot, assignment, calendar, fixed, versionName }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const problem = useMemo(() => buildProblem(snapshot), [snapshot]);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(params.get("date") ?? "") ? params.get("date")! : todayIso();
  const go = (d: string) => router.replace(`${pathname}?date=${d}`, { scroll: false });

  const [view, setView] = useState<ViewKind>(fixed?.view ?? "section");
  const [picked, setPicked] = useState<Record<ViewKind, string>>({
    section: snapshot.sections[0]?.id ?? "",
    teacher: snapshot.teachers[0]?.id ?? "",
    room: snapshot.rooms.find((r) => !r.isEventVenue)?.id ?? "",
  });
  const entityId = fixed?.entityId ?? picked[view];
  const options =
    view === "section"
      ? snapshot.sections.map((s) => ({ id: s.id, name: s.name }))
      : view === "teacher"
        ? snapshot.teachers.map((t) => ({ id: t.id, name: t.name }))
        : snapshot.rooms.filter((r) => !r.isEventVenue).map((r) => ({ id: r.id, name: r.name }));

  const plan = resolveDay(date, calendar);
  const pretty = new Date(`${date}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="icon-sm" variant="outline" aria-label="Previous day" onClick={() => go(addDays(date, -1))}>
          <ChevronLeft />
        </Button>
        <input
          type="date"
          aria-label="Date"
          className="h-8 rounded-md border bg-background px-2 text-sm"
          value={date}
          onChange={(e) => e.target.value && go(e.target.value)}
        />
        <Button size="icon-sm" variant="outline" aria-label="Next day" onClick={() => go(addDays(date, 1))}>
          <ChevronRight />
        </Button>
        {date !== todayIso() && (
          <Button size="sm" variant="ghost" onClick={() => go(todayIso())}>
            Today
          </Button>
        )}
        {!fixed && (
          <div className="ml-auto flex flex-wrap gap-2">
            <select aria-label="Show" className="h-8 rounded-md border bg-background px-2 text-sm" value={view} onChange={(e) => setView(e.target.value as ViewKind)}>
              <option value="section">Section</option>
              <option value="teacher">Teacher</option>
              <option value="room">Room</option>
            </select>
            <select
              aria-label={`Choose ${view}`}
              className="h-8 min-w-40 rounded-md border bg-background px-2 text-sm"
              value={entityId}
              onChange={(e) => setPicked((p) => ({ ...p, [view]: e.target.value }))}
            >
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div>
        <h2 className="text-lg font-semibold">{pretty}</h2>
        <p className="text-sm text-muted-foreground">
          {plan.kind === "classes" ? (plan.note ?? `${calendar.days[plan.dayIndex]} timetable`) : plan.reason} · {versionName}
        </p>
      </div>

      {plan.kind === "off" ? (
        <div className="flex items-center gap-3 rounded-lg border border-dashed p-6 text-muted-foreground">
          <CalendarOff className="size-5" /> No classes. {plan.reason}.
        </div>
      ) : (
        <DayList problem={problem} assignment={assignment} view={view} entityId={entityId} onlyDay={plan.dayIndex} />
      )}
    </div>
  );
}
