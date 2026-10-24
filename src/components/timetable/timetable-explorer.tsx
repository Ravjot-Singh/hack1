"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Assignment, Problem } from "@/lib/solver/types";
import { SubjectLegend, TimetableGrid, type GridEdit, type ViewKind } from "./timetable-grid";

interface Props {
  problem: Problem;
  assignment: Assignment;
  /** Shown in the printed header, e.g. "Draft 3". */
  title: string;
  /** Manual-edit mode (drag / click to move). */
  edit?: GridEdit;
  /** Extra controls shown before the Print button. */
  actions?: ReactNode;
}

/** Switch between section / teacher / room timetables, with print. */
export function TimetableExplorer({ problem, assignment, title, edit, actions }: Props) {
  const { input } = problem;
  const [view, setView] = useState<ViewKind>("section");
  const options = useMemo(() => {
    const depts = input.departments;
    if (view === "section") {
      return depts.map((d) => ({
        group: d.name,
        items: input.sections.filter((s) => s.deptId === d.id).map((s) => ({ id: s.id, name: s.name })),
      }));
    }
    if (view === "teacher") {
      return depts.map((d) => ({
        group: d.name,
        items: input.teachers.filter((t) => t.deptId === d.id).map((t) => ({ id: t.id, name: t.name })),
      }));
    }
    const types = [...new Set(input.rooms.filter((r) => !r.isEventVenue).map((r) => r.type))];
    return types.map((type) => ({
      group: type,
      items: input.rooms.filter((r) => r.type === type && !r.isEventVenue).map((r) => ({ id: r.id, name: r.name })),
    }));
  }, [input, view]);

  const [selected, setSelected] = useState<Record<ViewKind, string>>({
    section: input.sections[0]?.id ?? "",
    teacher: input.teachers[0]?.id ?? "",
    room: input.rooms.find((r) => !r.isEventVenue)?.id ?? "",
  });
  const entityId = selected[view];
  const entityName = options.flatMap((o) => o.items).find((i) => i.id === entityId)?.name ?? "";
  // Weekly periods; for a section, counted for one student group (its first batch).
  const load = useMemo(() => {
    const sec = input.sections.find((s) => s.id === entityId);
    const atom = sec ? (sec.batches[0]?.id ?? sec.id) : "";
    const units = new Set<string>();
    let periods = 0;
    for (const l of problem.lessons) {
      const a = assignment[l.id];
      if (!a || units.has(l.unitId)) continue;
      const mine =
        view === "section" ? l.atoms.includes(atom) : view === "teacher" ? l.teacherIds.includes(entityId) : a.roomId === entityId;
      if (!mine) continue;
      units.add(l.unitId);
      periods += l.duration;
    }
    return periods;
  }, [problem, assignment, input.sections, view, entityId]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 print:hidden">
        <Tabs value={view} onValueChange={(v) => setView(v as ViewKind)}>
          <TabsList>
            <TabsTrigger value="section">Sections</TabsTrigger>
            <TabsTrigger value="teacher">Teachers</TabsTrigger>
            <TabsTrigger value="room">Rooms</TabsTrigger>
          </TabsList>
        </Tabs>
        <select
          aria-label={`Choose ${view}`}
          value={entityId}
          onChange={(e) => setSelected((s) => ({ ...s, [view]: e.target.value }))}
          className="h-8 min-w-48 rounded-lg border bg-background px-2 text-sm"
        >
          {options.map((o) => (
            <optgroup key={o.group} label={o.group}>
              {o.items.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <span className="text-sm text-muted-foreground">
          {load} periods/week{view === "section" ? " (per batch)" : ""}
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div>
        <Button variant="outline" size="sm" onClick={() => window.print()}>
          <Printer /> Print / PDF
        </Button>
      </div>

      <div className="hidden print:block">
        <div className="text-lg font-semibold">
          {input.name} · {entityName}
        </div>
        <div className="text-xs text-muted-foreground">
          {view === "section" ? "Class timetable" : view === "teacher" ? "Faculty timetable" : "Room timetable"} · {title}
        </div>
      </div>

      <TimetableGrid problem={problem} assignment={assignment} view={view} entityId={entityId} edit={edit} />
      {view === "section" && (
        <div className="rounded-lg border p-3 print:border-0 print:p-0">
          <SubjectLegend problem={problem} sectionId={entityId} />
        </div>
      )}
    </div>
  );
}
