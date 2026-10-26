"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, Loader2, Save } from "lucide-react";
import {
  saveBuildings,
  saveDepartments,
  savePrograms,
  saveRooms,
  saveSections,
  saveSubjects,
  saveTeachers,
} from "@/app/[inst]/setup/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { lookupsOf } from "@/lib/setup/convert";
import { exportTable } from "@/lib/setup/import";
import {
  DESIGNATIONS,
  designationLimits,
  idsOf,
  type BuildingRow,
  type DepartmentRow,
  type ProgramRow,
  type RoomRow,
  type SectionRow,
  type SubjectRow,
  type TeacherRow,
} from "@/lib/setup/schemas";
import { ROOM_TYPES } from "@/lib/setup/steps";
import { EditableTable, type Column } from "../editable-table";
import { SlotMatrix } from "../slot-matrix";
import type { StepProps } from "../step-view";

function useOptions(data: StepProps["data"], scope: string | null = null) {
  return useMemo(
    () => ({
      depts: data.departments.map((d) => ({ value: d.id!, label: `${d.code} · ${d.name}` })),
      deptCodes: data.departments.filter((d) => !scope || d.id === scope).map((d) => ({ value: d.id!, label: d.code })),
      buildings: data.buildings.map((b) => ({ value: b.id!, label: b.name })),
      grids: data.grids.map((g) => ({ value: g.id!, label: g.name })),
      programs: data.programs.filter((p) => !scope || p.deptId === scope).map((p) => ({ value: p.id!, label: p.name })),
      roomTypes: [...new Set([...data.rooms.map((r) => r.type), ...ROOM_TYPES])],
    }),
    [data, scope],
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">{children}</p>;
}

// ------------------------------------------------------------------ Departments

export function DepartmentsStep({ slug, data, readOnly }: StepProps) {
  const lookups = lookupsOf(data);
  const columns: Column<DepartmentRow>[] = [
    { key: "name", label: "Name", type: "text", placeholder: "Computer Science & Engineering", className: "min-w-72" },
    { key: "code", label: "Code", type: "text", placeholder: "CSE", className: "w-28" },
  ];
  return (
    <EditableTable<DepartmentRow>
      title="Departments"
      description="Use a short code (CSE, ECE, AS…). Codes are how imports refer to departments."
      rows={data.departments}
      columns={columns}
      newRow={() => ({ name: "", code: "" })}
      onSave={(rows) => saveDepartments(slug, rows, idsOf(data.departments))}
      readOnly={readOnly}
      importer={{ entity: "departments", noun: "departments", lookups, exportTable: () => exportTable("departments", data, lookups) }}
    />
  );
}

// ------------------------------------------------------------------ Buildings & rooms

export function RoomsStep({ slug, data, readOnly }: StepProps) {
  const lookups = lookupsOf(data);
  const o = useOptions(data);
  const buildingCols: Column<BuildingRow>[] = [{ key: "name", label: "Building", type: "text", placeholder: "Main Block", className: "min-w-64" }];
  const roomCols: Column<RoomRow>[] = [
    { key: "name", label: "Room", type: "text", placeholder: "E-201", className: "min-w-32" },
    { key: "type", label: "Type", type: "text", list: "room-types", placeholder: "Classroom", className: "min-w-40" },
    { key: "capacity", label: "Seats", type: "number" },
    { key: "buildingId", label: "Building", type: "select", options: o.buildings, emptyLabel: "—" },
    { key: "ownerDeptId", label: "Owned by", type: "select", options: o.deptCodes, emptyLabel: "Shared" },
    { key: "isEventVenue", label: "Event venue", type: "checkbox" },
  ];
  return (
    <div className="space-y-8">
      <datalist id="room-types">
        {o.roomTypes.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>
      <EditableTable
        title="Buildings"
        description="Optional, but needed if walking time between blocks matters."
        rows={data.buildings}
        columns={buildingCols}
        newRow={() => ({ name: "", travelMinutes: {} })}
        onSave={(rows) => saveBuildings(slug, rows, idsOf(data.buildings))}
        readOnly={readOnly}
        importer={{ entity: "buildings", noun: "buildings", lookups, exportTable: () => exportTable("buildings", data, lookups) }}
      />
      {data.buildings.length > 1 && <TravelMatrix slug={slug} buildings={data.buildings} readOnly={readOnly} />}
      <EditableTable
        title="Rooms"
        description={
          <>
            The <b>type</b> must match what subjects ask for (e.g. &quot;Computer Lab&quot;). Rooms owned by a department go
            to its classes first. Tick <b>event venue</b> for seminar halls, which are never used for classes.
          </>
        }
        rows={data.rooms}
        columns={roomCols}
        newRow={() => ({ name: "", type: "Classroom", capacity: 60, buildingId: null, ownerDeptId: null, isEventVenue: false })}
        onSave={(rows) => saveRooms(slug, rows, idsOf(data.rooms))}
        readOnly={readOnly}
        importer={{ entity: "rooms", noun: "rooms", lookups, exportTable: () => exportTable("rooms", data, lookups) }}
      />
    </div>
  );
}

function TravelMatrix({ slug, buildings, readOnly }: { slug: string; buildings: BuildingRow[]; readOnly: boolean }) {
  const router = useRouter();
  const [rows, setRows] = useState(buildings);
  const [prev, setPrev] = useState(buildings);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (prev !== buildings) {
    setPrev(buildings);
    setRows(buildings);
  }
  const get = (a: BuildingRow, b: BuildingRow) => (a.travelMinutes?.[b.id!] ?? b.travelMinutes?.[a.id!] ?? 0) as number;
  const set = (a: BuildingRow, b: BuildingRow, v: number) =>
    setRows((rs) =>
      rs.map((r) =>
        r.id === a.id ? { ...r, travelMinutes: { ...r.travelMinutes, [b.id!]: v } } : r.id === b.id ? { ...r, travelMinutes: { ...r.travelMinutes, [a.id!]: v } } : r,
      ),
    );
  return (
    <section className="space-y-2">
      <h3 className="font-medium">Walking time between buildings (minutes)</h3>
      <p className="text-sm text-muted-foreground">
        If the walk is longer than the gap between two periods (plus grace time), the solver won&apos;t put back-to-back
        classes in those buildings for the same teacher or students.
      </p>
      <div className="overflow-x-auto">
        <table className="text-sm">
          <thead>
            <tr>
              <th />
              {rows.map((b) => (
                <th key={b.id} className="px-2 py-1 text-left text-xs font-medium text-muted-foreground">
                  {b.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((a, i) => (
              <tr key={a.id}>
                <th className="pr-3 text-left text-xs font-medium text-muted-foreground">{a.name}</th>
                {rows.map((b, j) => (
                  <td key={b.id} className="px-1 py-0.5">
                    {j <= i ? (
                      <span className="block w-16 text-center text-muted-foreground">{i === j ? "–" : get(a, b)}</span>
                    ) : (
                      <input
                        type="number"
                        min={0}
                        aria-label={`${a.name} to ${b.name}`}
                        disabled={readOnly}
                        className="h-8 w-16 rounded-md border px-2 tabular-nums"
                        value={get(a, b)}
                        onChange={(e) => set(a, b, Number(e.target.value))}
                      />
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!readOnly && (
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await saveBuildings(slug, rows, idsOf(buildings));
                setMsg(res.ok ? "Saved." : res.error);
                if (res.ok) router.refresh();
              })
            }
          >
            {pending ? <Loader2 className="animate-spin" /> : <Save />} Save walking times
          </Button>
          {msg && <span className="text-xs text-muted-foreground">{msg}</span>}
        </div>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ Teachers

export function TeachersStep({ slug, data, readOnly, scope }: StepProps) {
  const lookups = lookupsOf(data);
  const o = useOptions(data, scope);
  const [editing, setEditing] = useState<{ row: TeacherRow; update: (p: Partial<TeacherRow>) => void } | null>(null);
  if (!data.departments.length) return <Hint>Add departments first; every teacher belongs to one.</Hint>;
  const columns: Column<TeacherRow>[] = [
    { key: "name", label: "Name", type: "text", placeholder: "Dr. Anita Desai", className: "min-w-52" },
    { key: "deptId", label: "Department", type: "select", options: o.deptCodes },
    {
      key: "designation",
      label: "Designation",
      type: "text",
      list: "designations",
      className: "min-w-44",
      // Picking a designation fills in the usual load limits.
      derive: (v) => {
        const [maxPerDay, maxPerWeek] = designationLimits(String(v));
        return { maxPerDay, maxPerWeek };
      },
    },
    { key: "maxPerDay", label: "Max/day", type: "number" },
    { key: "maxPerWeek", label: "Max/week", type: "number" },
    { key: "email", label: "Email", type: "text", placeholder: "optional", className: "min-w-48" },
  ];
  return (
    <>
      <datalist id="designations">
        {DESIGNATIONS.map((d) => (
          <option key={d.name} value={d.name} />
        ))}
      </datalist>
      <EditableTable
        title="Teachers"
        description="Max/day and max/week fill in from the designation (UGC norms) and can be changed. Use Availability for blocked slots and preferences."
        rows={scope ? data.teachers.filter((t) => t.deptId === scope) : data.teachers}
        columns={columns}
        newRow={() => ({
          name: "",
          deptId: scope ?? data.departments[0]?.id ?? "",
          designation: "Assistant Professor",
          maxPerDay: 5,
          maxPerWeek: 18,
          email: "",
          unavailable: [],
          prefs: [],
        })}
        onSave={(rows) => saveTeachers(slug, rows, idsOf(scope ? data.teachers.filter((t) => t.deptId === scope) : data.teachers))}
        readOnly={readOnly}
        importer={{ entity: "teachers", noun: "teachers", lookups, exportTable: () => exportTable("teachers", data, lookups) }}
        rowActions={(row, update) => {
          const blocked = row.unavailable?.length ?? 0;
          const prefs = row.prefs?.length ?? 0;
          return (
            <Button variant="ghost" size="xs" onClick={() => setEditing({ row, update })}>
              <CalendarClock /> Availability
              {(blocked > 0 || prefs > 0) && (
                <span className="text-muted-foreground">
                  {blocked ? ` · ${blocked} blocked` : ""}
                  {prefs ? ` · ${prefs} pref` : ""}
                </span>
              )}
            </Button>
          );
        }}
      />
      {editing && (
        <AvailabilityDialog
          key={editing.row.id}
          row={editing.row}
          days={data.settings.days}
          periods={data.settings.periods}
          readOnly={readOnly}
          onClose={() => setEditing(null)}
          onApply={(patch) => {
            editing.update(patch);
            setEditing(null);
          }}
        />
      )}
    </>
  );
}

const AVAILABILITY_STATES = [
  { value: "ok", label: "Available", short: "", className: "bg-background hover:bg-muted" },
  { value: "un", label: "Unavailable (never schedule)", short: "✕", className: "border-destructive/40 bg-destructive/15 text-destructive" },
  { value: "pref", label: "Prefers", short: "★", className: "border-emerald-500/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" },
  { value: "avoid", label: "Rather not", short: "–", className: "border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-300" },
];

function AvailabilityDialog({
  row,
  days,
  periods,
  readOnly,
  onClose,
  onApply,
}: {
  row: TeacherRow;
  days: string[];
  periods: { start: string; end: string }[];
  readOnly: boolean;
  onClose: () => void;
  onApply: (patch: Partial<TeacherRow>) => void;
}) {
  const [state, setState] = useState(() => {
    const m = new Map<string, string>();
    for (const [d, p] of (row.unavailable ?? []) as [number, number][]) m.set(`${d}:${p}`, "un");
    for (const x of row.prefs ?? []) m.set(`${x.day}:${x.period}`, x.value === "PREFER" ? "pref" : "avoid");
    return m;
  });
  const apply = () => {
    const unavailable: [number, number][] = [];
    const prefs: { day: number; period: number; value: "PREFER" | "AVOID" }[] = [];
    for (const [k, v] of state) {
      const [d, p] = k.split(":").map(Number);
      if (v === "un") unavailable.push([d, p]);
      if (v === "pref") prefs.push({ day: d, period: p, value: "PREFER" });
      if (v === "avoid") prefs.push({ day: d, period: p, value: "AVOID" });
    }
    onApply({ unavailable, prefs });
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Availability · {row.name || "New teacher"}</DialogTitle>
          <DialogDescription>
            Unavailable slots are never used. Preferences are honoured when possible. Changes apply to the table; remember
            to Save teachers.
          </DialogDescription>
        </DialogHeader>
        <SlotMatrix
          days={days}
          periods={periods}
          states={AVAILABILITY_STATES}
          readOnly={readOnly}
          get={(d, p) => state.get(`${d}:${p}`) ?? "ok"}
          onSet={(cells, value) =>
            setState((m) => {
              const next = new Map(m);
              for (const [d, p] of cells) {
                if (value === "ok") next.delete(`${d}:${p}`);
                else next.set(`${d}:${p}`, value);
              }
              return next;
            })
          }
        />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          {!readOnly && <Button onClick={apply}>Apply</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------------ Programs & sections

export function SectionsStep({ slug, data, readOnly, scope }: StepProps) {
  const lookups = lookupsOf(data);
  const o = useOptions(data, scope);
  const ownPrograms = scope ? data.programs.filter((p) => p.deptId === scope) : data.programs;
  const ownProgramIds = new Set(ownPrograms.map((p) => p.id));
  if (!data.departments.length) return <Hint>Add departments first; every program belongs to one.</Hint>;
  const programCols: Column<ProgramRow>[] = [
    { key: "name", label: "Program", type: "text", placeholder: "B.Tech CSE", className: "min-w-64" },
    { key: "deptId", label: "Department", type: "select", options: o.deptCodes },
  ];
  const sectionCols: Column<SectionRow>[] = [
    { key: "name", label: "Section", type: "text", placeholder: "CSE-2A", className: "min-w-32" },
    { key: "programId", label: "Program", type: "select", options: o.programs },
    { key: "year", label: "Year", type: "number" },
    { key: "size", label: "Students", type: "number" },
    { key: "gridId", label: "Time grid", type: "select", options: o.grids },
    { key: "batchCount", label: "Lab batches", type: "number" },
  ];
  return (
    <div className="space-y-8">
      <EditableTable<ProgramRow>
        title="Programs"
        description="Degree programs such as B.Tech CSE or MBA. A common first year can be its own program."
        rows={ownPrograms}
        columns={programCols}
        newRow={() => ({ name: "", deptId: scope ?? data.departments[0]?.id ?? "" })}
        onSave={(rows) => savePrograms(slug, rows, idsOf(ownPrograms))}
        readOnly={readOnly}
        importer={{ entity: "programs", noun: "programs", lookups, exportTable: () => exportTable("programs", data, lookups) }}
      />
      {ownPrograms.length ? (
        <EditableTable
          title="Sections"
          description="Lab batches split a section for practicals (2 = G1 and G2, sizes split evenly). Use 0 if labs run for the whole section."
          rows={scope ? data.sections.filter((s) => ownProgramIds.has(s.programId)) : data.sections}
          columns={sectionCols}
          newRow={() => ({
            name: "",
            programId: ownPrograms[0]?.id ?? "",
            year: 1,
            size: 60,
            gridId: data.grids[0]?.id ?? "",
            batchCount: 2,
          })}
          onSave={(rows) => saveSections(slug, rows, idsOf(scope ? data.sections.filter((s) => ownProgramIds.has(s.programId)) : data.sections))}
          readOnly={readOnly}
          importer={{ entity: "sections", noun: "sections", lookups, exportTable: () => exportTable("sections", data, lookups) }}
        />
      ) : (
        <Hint>Save at least one program, then add its sections.</Hint>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Subjects

export function SubjectsStep({ slug, data, readOnly, scope }: StepProps) {
  const lookups = lookupsOf(data);
  const o = useOptions(data, scope);
  if (!data.departments.length) return <Hint>Add departments first; every subject belongs to one.</Hint>;
  const columns: Column<SubjectRow>[] = [
    { key: "code", label: "Code", type: "text", placeholder: "CS201", className: "w-28" },
    { key: "name", label: "Subject", type: "text", placeholder: "Data Structures", className: "min-w-56" },
    { key: "deptId", label: "Dept", type: "select", options: o.deptCodes },
    {
      key: "mode",
      label: "Hours as",
      type: "select",
      options: [
        { value: "LTP", label: "L-T-P" },
        { value: "HOURS", label: "Hours/week" },
      ],
    },
    { key: "L", label: "L", type: "number" },
    { key: "T", label: "T", type: "number" },
    { key: "P", label: "P", type: "number" },
    { key: "hoursPerWeek", label: "Hrs/wk", type: "number" },
    { key: "theoryRoomType", label: "Theory room", type: "text", list: "room-types-subjects", className: "min-w-32" },
    { key: "labRoomType", label: "Lab room", type: "text", list: "room-types-subjects", className: "min-w-32" },
    { key: "labBlockLen", label: "Lab block", type: "number" },
  ];
  return (
    <>
      <datalist id="room-types-subjects">
        {o.roomTypes.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>
      <EditableTable<SubjectRow>
        title="Subjects"
        description="L-T-P = weekly lectures, tutorials and practical periods (3-1-2 is typical). Lab block = periods per practical session, kept back-to-back. Room types must match your rooms."
        rows={scope ? data.subjects.filter((x) => x.deptId === scope) : data.subjects}
        columns={columns}
        newRow={() => ({
          code: "",
          name: "",
          deptId: scope ?? data.departments[0]?.id ?? "",
          mode: "LTP",
          L: 3,
          T: 0,
          P: 0,
          hoursPerWeek: 3,
          theoryRoomType: "Classroom",
          labRoomType: "Classroom",
          labBlockLen: 2,
        })}
        onSave={(rows) => saveSubjects(slug, rows, idsOf(scope ? data.subjects.filter((x) => x.deptId === scope) : data.subjects))}
        readOnly={readOnly}
        importer={{ entity: "subjects", noun: "subjects", lookups, exportTable: () => exportTable("subjects", data, lookups) }}
      />
    </>
  );
}
