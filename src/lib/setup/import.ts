import Papa from "papaparse";
import {
  designationLimits,
  newId,
  type BasketRow,
  type BuildingRow,
  type DepartmentRow,
  type OfferingRow,
  type ProgramRow,
  type RoomRow,
  type SectionRow,
  type SubjectRow,
  type TeacherRow,
} from "./schemas";
import { formatSlots, parseSlots } from "./slots";

// CSV / Excel import and export for the setup wizard. Pure functions: no DB, no DOM.

export type Entity = "departments" | "buildings" | "rooms" | "teachers" | "programs" | "sections" | "subjects" | "allocation";

export interface Lookups {
  days: string[];
  periods: number;
  departments: { id: string; name: string; code: string }[];
  buildings: { id: string; name: string }[];
  grids: { id: string; name: string }[];
  programs: { id: string; name: string }[];
  sections: { id: string; name: string }[];
  subjects: { id: string; code: string; name: string }[];
  teachers: { id: string; name: string }[];
  baskets: { id: string; name: string }[];
}

type Kind = "text" | "int" | "bool" | "slots" | "dept" | "building" | "grid" | "program" | "sections" | "subject" | "teachers";

interface Field {
  key: string;
  header: string;
  aliases?: string[];
  kind: Kind;
  required?: boolean;
  /** One-line help shown in the import dialog. */
  help?: string;
}

/** Columns per entity. `header` is what templates use; aliases are also accepted. */
export const FIELDS: Record<Entity, Field[]> = {
  departments: [
    { key: "name", header: "name", aliases: ["department", "department name"], kind: "text", required: true },
    { key: "code", header: "code", aliases: ["short name", "abbreviation"], kind: "text", required: true },
  ],
  buildings: [
    { key: "name", header: "name", aliases: ["building", "block"], kind: "text", required: true },
    {
      key: "walking",
      header: "walking_minutes",
      aliases: ["walking time", "walking minutes", "travel", "travel minutes"],
      kind: "text",
      help: 'Minutes to walk to other buildings, e.g. "IT Block 5; Workshop Building 4"',
    },
  ],
  rooms: [
    { key: "name", header: "name", aliases: ["room", "room no", "room number"], kind: "text", required: true },
    { key: "type", header: "type", aliases: ["room type"], kind: "text", required: true, help: "e.g. Classroom, Computer Lab" },
    { key: "capacity", header: "capacity", aliases: ["seats", "size"], kind: "int", required: true },
    { key: "buildingId", header: "building", aliases: ["block"], kind: "building" },
    { key: "ownerDeptId", header: "owner_department", aliases: ["department", "owner", "dept"], kind: "dept", help: "blank = shared by all" },
    { key: "isEventVenue", header: "event_venue", aliases: ["venue", "seminar hall"], kind: "bool", help: "yes for seminar halls / auditoriums" },
  ],
  teachers: [
    { key: "name", header: "name", aliases: ["teacher", "faculty", "faculty name"], kind: "text", required: true },
    { key: "deptId", header: "department", aliases: ["dept"], kind: "dept", required: true },
    { key: "designation", header: "designation", aliases: ["title", "post"], kind: "text", required: true },
    { key: "maxPerDay", header: "max_per_day", aliases: ["max day", "periods per day"], kind: "int", help: "blank = by designation" },
    { key: "maxPerWeek", header: "max_per_week", aliases: ["max week", "periods per week", "load"], kind: "int", help: "blank = by designation" },
    { key: "email", header: "email", aliases: ["mail"], kind: "text" },
    { key: "unavailable", header: "unavailable", aliases: ["not available", "blocked"], kind: "slots", help: 'e.g. "Fri P5-P8; Sat"' },
    { key: "prefer", header: "prefer", aliases: ["preferred"], kind: "slots" },
    { key: "avoid", header: "avoid", kind: "slots" },
  ],
  programs: [
    { key: "name", header: "name", aliases: ["program", "programme", "course"], kind: "text", required: true },
    { key: "deptId", header: "department", aliases: ["dept"], kind: "dept", required: true },
  ],
  sections: [
    { key: "name", header: "name", aliases: ["section", "class"], kind: "text", required: true },
    { key: "programId", header: "program", aliases: ["programme", "course"], kind: "program", required: true },
    { key: "year", header: "year", aliases: ["semester year"], kind: "int", required: true },
    { key: "size", header: "size", aliases: ["students", "strength"], kind: "int", required: true },
    { key: "gridId", header: "time_grid", aliases: ["grid", "timings"], kind: "grid", help: "blank = first grid" },
    { key: "batchCount", header: "batches", aliases: ["lab batches", "groups"], kind: "int", help: "lab groups, e.g. 2 for G1/G2" },
  ],
  subjects: [
    { key: "code", header: "code", aliases: ["subject code", "course code"], kind: "text", required: true },
    { key: "name", header: "name", aliases: ["subject", "subject name", "title"], kind: "text", required: true },
    { key: "deptId", header: "department", aliases: ["dept"], kind: "dept", required: true },
    { key: "L", header: "L", aliases: ["lecture", "lectures"], kind: "int" },
    { key: "T", header: "T", aliases: ["tutorial", "tutorials"], kind: "int" },
    { key: "P", header: "P", aliases: ["practical", "practicals", "lab hours"], kind: "int" },
    { key: "hoursPerWeek", header: "hours_per_week", aliases: ["hours"], kind: "int", help: "only when not using L-T-P" },
    { key: "theoryRoomType", header: "theory_room_type", aliases: ["room type"], kind: "text", help: "blank = Classroom" },
    { key: "labRoomType", header: "lab_room_type", aliases: ["lab type", "lab"], kind: "text" },
    { key: "labBlockLen", header: "lab_block", aliases: ["lab block length", "block"], kind: "int", help: "periods per lab session, blank = 2" },
  ],
  allocation: [
    { key: "sectionIds", header: "section", aliases: ["sections", "class"], kind: "sections", required: true, help: 'several with ";" for a combined class or basket' },
    { key: "subjectId", header: "subject_code", aliases: ["subject", "code"], kind: "subject", required: true },
    { key: "teacherIds", header: "teachers", aliases: ["teacher", "faculty"], kind: "teachers", help: 'several with ";"' },
    { key: "labTeacherIds", header: "lab_teachers", aliases: ["lab teacher", "lab faculty"], kind: "teachers", help: "blank = same as teachers" },
    { key: "batchwiseLab", header: "batchwise_lab", aliases: ["batchwise"], kind: "bool", help: "blank = yes" },
    { key: "splitLabBatches", header: "split_batches", aliases: ["split lab batches", "split"], kind: "bool", help: "yes = lab teachers share the batches; blank = no" },
    { key: "basket", header: "basket", aliases: ["elective basket", "elective group"], kind: "text", help: "electives that run at the same time" },
    { key: "expectedSize", header: "expected_size", aliases: ["enrolment", "enrollment"], kind: "int" },
  ],
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const stripTitle = (s: string) => s.replace(/^(dr|mr|ms|mrs|prof|er)\.?\s+/i, "").trim().toLowerCase();
const listSplit = (s: string) => s.split(/[;\n]/).map((x) => x.trim()).filter(Boolean);

export function parseBool(s: string): boolean | null {
  const v = s.trim().toLowerCase();
  if (["yes", "y", "true", "1", "x", "✓"].includes(v)) return true;
  if (["no", "n", "false", "0", ""].includes(v)) return false;
  return null;
}

/** Parse CSV text into a table of strings. */
export function parseCsv(text: string): string[][] {
  const res = Papa.parse<string[]>(text.replace(/^﻿/, ""), { skipEmptyLines: "greedy" });
  return res.data.map((r) => r.map((c) => String(c ?? "").trim()));
}

export function toCsv(table: string[][]): string {
  return Papa.unparse(table);
}

export interface ImportResult<T> {
  rows: T[];
  errors: string[];
  /** Allocation only: baskets referenced by name (existing ids kept, new ones get "new:" ids). */
  baskets?: BasketRow[];
}

/**
 * Map a parsed table (first row = headers) to editable rows, resolving names to ids.
 * Row numbers in errors match the spreadsheet (header = row 1).
 */
export function mapRows(entity: Entity, table: string[][], lk: Lookups): ImportResult<Record<string, unknown>> {
  const errors: string[] = [];
  const fields = FIELDS[entity];
  const headerIdx = table.findIndex((r) => r.some((c) => c.trim()));
  if (headerIdx < 0) return { rows: [], errors: ["The file is empty."] };
  const header = table[headerIdx].map(norm);
  const col = new Map<string, number>();
  for (const f of fields) {
    const i = header.findIndex((h) => h === norm(f.header) || (f.aliases ?? []).some((a) => norm(a) === h));
    if (i >= 0) col.set(f.key, i);
  }
  const missing = fields.filter((f) => f.required && !col.has(f.key)).map((f) => f.header);
  if (missing.length) {
    return {
      rows: [],
      errors: [`Missing column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}. Expected: ${fields.map((f) => f.header).join(", ")}.`],
    };
  }

  const known = (list: { name: string }[]) =>
    list.length ? ` (known: ${list.slice(0, 8).map((x) => x.name).join(", ")}${list.length > 8 ? ", …" : ""})` : " (none added yet)";
  const findDept = (v: string) => lk.departments.find((d) => norm(d.code) === norm(v) || norm(d.name) === norm(v));
  const byName = <T extends { name: string }>(list: T[], v: string) => list.find((x) => norm(x.name) === norm(v));
  const findTeacher = (v: string) =>
    lk.teachers.find((t) => norm(t.name) === norm(v)) ?? lk.teachers.find((t) => stripTitle(t.name) === stripTitle(v));
  const findSubject = (v: string) => lk.subjects.find((s) => norm(s.code) === norm(v)) ?? byName(lk.subjects, v);

  const rows: Record<string, unknown>[] = [];
  const basketSections = new Map<string, Set<string>>();

  for (let r = headerIdx + 1; r < table.length; r++) {
    const line = table[r];
    if (!line.some((c) => c.trim())) continue;
    const rowNo = r + 1;
    const out: Record<string, unknown> = {};
    let bad = false;
    const fail = (msg: string) => {
      errors.push(`Row ${rowNo}: ${msg}`);
      bad = true;
    };

    for (const f of fields) {
      const i = col.get(f.key);
      const raw = i === undefined ? "" : (line[i] ?? "").trim();
      if (!raw) {
        if (f.required) fail(`${f.header} is empty`);
        continue;
      }
      switch (f.kind) {
        case "text":
          out[f.key] = raw;
          break;
        case "int": {
          const n = Number(raw);
          if (!Number.isInteger(n) || n < 0) fail(`${f.header} "${raw}" is not a whole number`);
          else out[f.key] = n;
          break;
        }
        case "bool": {
          const b = parseBool(raw);
          if (b === null) fail(`${f.header} "${raw}" should be yes or no`);
          else out[f.key] = b;
          break;
        }
        case "slots": {
          const { slots, error } = parseSlots(raw, lk.days, lk.periods);
          if (error) fail(`${f.header}: ${error}`);
          else out[f.key] = slots;
          break;
        }
        case "dept": {
          const d = findDept(raw);
          if (!d) fail(`department "${raw}" not found${known(lk.departments.map((x) => ({ name: x.code })))}`);
          else out[f.key] = d.id;
          break;
        }
        case "building": {
          const b = byName(lk.buildings, raw);
          if (!b) fail(`building "${raw}" not found${lk.buildings.length ? known(lk.buildings) : ": add or import the buildings (table above) and save them first"}`);
          else out[f.key] = b.id;
          break;
        }
        case "grid": {
          const g = byName(lk.grids, raw);
          if (!g) fail(`time grid "${raw}" not found${known(lk.grids)}`);
          else out[f.key] = g.id;
          break;
        }
        case "program": {
          const p = byName(lk.programs, raw);
          if (!p) fail(`program "${raw}" not found${known(lk.programs)}`);
          else out[f.key] = p.id;
          break;
        }
        case "subject": {
          const s = findSubject(raw);
          if (!s) fail(`subject "${raw}" not found${known(lk.subjects.map((x) => ({ name: x.code })))}`);
          else out[f.key] = s.id;
          break;
        }
        case "sections": {
          const ids: string[] = [];
          for (const v of listSplit(raw)) {
            const s = byName(lk.sections, v);
            if (!s) fail(`section "${v}" not found${known(lk.sections)}`);
            else ids.push(s.id);
          }
          out[f.key] = ids;
          break;
        }
        case "teachers": {
          const ids: string[] = [];
          for (const v of listSplit(raw)) {
            const t = findTeacher(v);
            if (!t) fail(`teacher "${v}" not found${known(lk.teachers)}`);
            else ids.push(t.id);
          }
          out[f.key] = ids;
          break;
        }
      }
    }
    if (bad) continue;

    // Entity-specific defaults.
    if (entity === "rooms") {
      out.buildingId ??= null;
      out.ownerDeptId ??= null;
      out.isEventVenue ??= false;
    } else if (entity === "teachers") {
      const [day, week] = designationLimits(String(out.designation));
      out.maxPerDay ??= day;
      out.maxPerWeek ??= week;
      out.email ??= "";
      out.unavailable ??= [];
      out.prefs = [
        ...((out.prefer as [number, number][]) ?? []).map(([d, p]) => ({ day: d, period: p, value: "PREFER" })),
        ...((out.avoid as [number, number][]) ?? []).map(([d, p]) => ({ day: d, period: p, value: "AVOID" })),
      ];
      delete out.prefer;
      delete out.avoid;
    } else if (entity === "sections") {
      if (!out.gridId) {
        if (!lk.grids[0]) {
          fail("no time grid exists yet");
          continue;
        }
        out.gridId = lk.grids[0].id;
      }
      out.batchCount ??= 0;
    } else if (entity === "subjects") {
      const L = (out.L as number) ?? 0;
      const T = (out.T as number) ?? 0;
      const P = (out.P as number) ?? 0;
      const hours = out.hoursPerWeek as number | undefined;
      out.L = L;
      out.T = T;
      out.P = P;
      out.mode = L + T + P === 0 && hours ? "HOURS" : "LTP";
      out.hoursPerWeek = hours ?? L + T + P;
      out.theoryRoomType ??= "Classroom";
      if (P > 0 && !out.labRoomType) {
        fail("lab_room_type is needed when P > 0 (e.g. Computer Lab)");
        continue;
      }
      out.labRoomType ??= out.theoryRoomType;
      out.labBlockLen ??= 2;
    } else if (entity === "allocation") {
      out.labTeacherIds ??= [];
      out.teacherIds ??= [];
      out.batchwiseLab ??= true;
      out.splitLabBatches ??= false;
      out.expectedSize ??= null;
      const basket = out.basket as string | undefined;
      delete out.basket;
      out.basketId = null;
      if (basket) {
        const set = basketSections.get(basket) ?? new Set<string>();
        for (const s of out.sectionIds as string[]) set.add(s);
        basketSections.set(basket, set);
        out.basketName = basket;
      }
    }
    rows.push(out);
  }

  if (entity === "buildings") {
    // "IT Block 5; Workshop 4": names may be other rows of this file or buildings already added.
    const names = new Set([...rows.map((r) => norm(String(r.name))), ...lk.buildings.map((b) => norm(b.name))]);
    rows.forEach((row) => {
      const raw = row.walking as string | undefined;
      delete row.walking;
      if (!raw) return;
      const byName: Record<string, number> = {};
      for (const part of raw.split(/[;\n]/).map((x) => x.trim()).filter(Boolean)) {
        const m = /^(.+?)\s*[:=-]?\s*(\d{1,3})\s*(?:min(?:ute)?s?)?$/i.exec(part);
        if (!m) errors.push(`${row.name}: walking time "${part}" should look like "IT Block 5"`);
        else if (!names.has(norm(m[1]))) errors.push(`${row.name}: building "${m[1]}" not found in this file or the college`);
        else byName[m[1]] = Math.min(120, Number(m[2]));
      }
      row.walkingByName = byName;
    });
  }

  if (entity !== "allocation") return { rows, errors };

  // Resolve baskets: reuse existing ones by name, create the rest.
  const baskets: BasketRow[] = [...basketSections.entries()].map(([name, set]) => ({
    id: byName(lk.baskets, name)?.id ?? newId(),
    name,
    sectionIds: [...set],
  }));
  for (const row of rows) {
    if (!row.basketName) continue;
    const b = baskets.find((x) => x.name === row.basketName)!;
    row.basketId = b.id;
    row.sectionIds = b.sectionIds;
    delete row.basketName;
  }
  for (const b of baskets) {
    if (b.sectionIds.length < 2) errors.push(`Basket "${b.name}" covers only one section; a basket needs at least two.`);
  }
  return { rows, errors, baskets };
}

/**
 * Natural key used to match imported rows to existing ones (so re-importing updates, not
 * duplicates). Loose keys ignore punctuation ("DBMS LAB" = "DBMS_Lab"); exact keys only case
 * and spacing.
 */
export function naturalKey(entity: Entity, row: Record<string, unknown>, loose = true): string {
  const k = (s: unknown) => (loose ? norm(String(s ?? "")) : String(s ?? "").trim().toLowerCase().replace(/\s+/g, " "));
  switch (entity) {
    case "departments":
    case "subjects":
      return k(row.code);
    case "allocation":
      return `${row.subjectId}|${[...((row.sectionIds as string[]) ?? [])].sort().join(",")}`;
    default:
      return k(row.name);
  }
}

/**
 * Merge imported rows into the current table. "merge" updates matching rows (keeping their ids)
 * and appends the rest; "replace" keeps ids of matches but drops rows not in the file.
 * Each existing row is matched at most once: exact names first, then a loose match only when
 * it is the one unclaimed candidate. Otherwise two look-alike rows ("DBMS LAB", "DBMS_Lab")
 * would both take one room's id, and saving would overwrite one with the other.
 */
export function mergeRows<T extends { id?: string }>(entity: Entity, current: T[], imported: T[], mode: "merge" | "replace"): T[] {
  const key = (r: T, loose: boolean) => naturalKey(entity, r as Record<string, unknown>, loose);
  const claimed = new Set<T>();
  const matchOf = new Map<number, T>();
  for (const loose of [false, true]) {
    imported.forEach((row, i) => {
      if (matchOf.has(i)) return;
      const candidates = current.filter((r) => !claimed.has(r) && key(r, loose) === key(row, loose));
      if (candidates.length !== 1) return;
      claimed.add(candidates[0]);
      matchOf.set(i, candidates[0]);
    });
  }
  const merged = imported.map((row, i) => {
    const match = matchOf.get(i);
    return { ...match, ...row, id: match?.id ?? newId() } as T;
  });
  const all = mode === "replace" ? merged : [...current.filter((r) => !claimed.has(r)), ...merged];
  if (entity === "buildings") resolveWalking(all as unknown as (BuildingRow & { walkingByName?: Record<string, number> })[]);
  return all;
}

/** Turn imported "building name -> minutes" into travelMinutes by id, both ways. */
function resolveWalking(rows: (BuildingRow & { walkingByName?: Record<string, number> })[]) {
  const idOf = new Map(rows.map((r) => [norm(r.name), r.id!]));
  for (const r of rows) r.travelMinutes = { ...(r.travelMinutes ?? {}) };
  for (const r of rows) {
    for (const [name, minutes] of Object.entries(r.walkingByName ?? {})) {
      const other = rows.find((x) => x.id === idOf.get(norm(name)));
      if (!other || other.id === r.id) continue;
      r.travelMinutes![other.id!] = minutes;
      other.travelMinutes![r.id!] = minutes;
    }
    delete r.walkingByName;
  }
}

// ---- Export (current data -> spreadsheet table) ----

export interface SetupRows {
  departments: DepartmentRow[];
  buildings: BuildingRow[];
  rooms: RoomRow[];
  teachers: TeacherRow[];
  programs: ProgramRow[];
  sections: SectionRow[];
  subjects: SubjectRow[];
  baskets: BasketRow[];
  offerings: OfferingRow[];
}

export function exportTable(entity: Entity, data: SetupRows, lk: Lookups): string[][] {
  const header = FIELDS[entity].map((f) => f.header);
  const dept = (id: string | null | undefined) => lk.departments.find((d) => d.id === id)?.code ?? "";
  const nameOf = (list: { id: string; name: string }[], id: string | null | undefined) => list.find((x) => x.id === id)?.name ?? "";
  const yes = (b: boolean | undefined) => (b ? "yes" : "no");
  const slots = (s: [number, number][]) => formatSlots(s, lk.days, lk.periods);
  let body: unknown[][] = [];
  switch (entity) {
    case "departments":
      body = data.departments.map((d) => [d.name, d.code]);
      break;
    case "buildings":
      body = data.buildings.map((b) => [
        b.name,
        Object.entries(b.travelMinutes ?? {})
          .map(([id, m]) => `${nameOf(lk.buildings, id)} ${m}`)
          .filter((x) => !x.startsWith(" "))
          .join("; "),
      ]);
      break;
    case "rooms":
      body = data.rooms.map((r) => [r.name, r.type, r.capacity, nameOf(lk.buildings, r.buildingId), dept(r.ownerDeptId), yes(r.isEventVenue)]);
      break;
    case "teachers":
      body = data.teachers.map((t) => [
        t.name,
        dept(t.deptId),
        t.designation,
        Number(t.maxPerDay),
        Number(t.maxPerWeek),
        t.email ?? "",
        slots((t.unavailable ?? []) as [number, number][]),
        slots((t.prefs ?? []).filter((p) => p.value === "PREFER").map((p) => [p.day, p.period])),
        slots((t.prefs ?? []).filter((p) => p.value === "AVOID").map((p) => [p.day, p.period])),
      ]);
      break;
    case "programs":
      body = data.programs.map((p) => [p.name, dept(p.deptId)]);
      break;
    case "sections":
      body = data.sections.map((s) => [s.name, nameOf(lk.programs, s.programId), Number(s.year), Number(s.size), nameOf(lk.grids, s.gridId), Number(s.batchCount)]);
      break;
    case "subjects":
      body = data.subjects.map((s) => [
        s.code,
        s.name,
        dept(s.deptId),
        s.mode === "LTP" ? Number(s.L) : "",
        s.mode === "LTP" ? Number(s.T) : "",
        s.mode === "LTP" ? Number(s.P) : "",
        s.mode === "HOURS" ? Number(s.hoursPerWeek) : "",
        s.theoryRoomType ?? "Classroom",
        Number(s.P) > 0 ? (s.labRoomType ?? "") : "",
        Number(s.P) > 0 ? Number(s.labBlockLen) : "",
      ]);
      break;
    case "allocation":
      body = data.offerings.map((o) => {
        const subj = lk.subjects.find((s) => s.id === o.subjectId);
        const names = (ids: string[] | undefined, list: { id: string; name: string }[]) => (ids ?? []).map((id) => nameOf(list, id)).join("; ");
        return [
          names(o.sectionIds, lk.sections),
          subj?.code ?? "",
          names(o.teacherIds, lk.teachers),
          names(o.labTeacherIds, lk.teachers),
          yes(o.batchwiseLab ?? true),
          yes(o.splitLabBatches ?? false),
          nameOf(lk.baskets, o.basketId),
          o.expectedSize ?? "",
        ];
      });
      break;
  }
  return [header, ...body.map((r) => r.map((c) => (c == null ? "" : String(c))))];
}

/** Header + example rows for an empty template. */
export const TEMPLATE_EXAMPLES: Record<Entity, string[][]> = {
  departments: [
    ["Computer Science & Engineering", "CSE"],
    ["Applied Sciences", "AS"],
  ],
  buildings: [
    ["Main Block", "Engineering Block 4"],
    ["Engineering Block", ""],
  ],
  rooms: [
    ["E-201", "Classroom", "70", "Engineering Block", "CSE", "no"],
    ["CS Lab 1", "Computer Lab", "36", "Engineering Block", "", "no"],
    ["Seminar Hall", "Seminar Hall", "200", "Main Block", "", "yes"],
  ],
  teachers: [
    ["Dr. Anita Desai", "CSE", "Associate Professor", "", "", "anita@college.edu", "Fri P5-P8", "", ""],
    ["Mr. Rohit Bansal", "CSE", "Assistant Professor", "5", "18", "", "", "Mon P1-P3", "Sat"],
  ],
  programs: [["B.Tech CSE", "CSE"]],
  sections: [
    ["CSE-2A", "B.Tech CSE", "2", "64", "", "2"],
    ["CSE-2B", "B.Tech CSE", "2", "62", "", "2"],
  ],
  subjects: [
    ["CS201", "Data Structures", "CSE", "3", "0", "2", "", "Classroom", "Computer Lab", "2"],
    ["HS201", "Universal Human Values", "AS", "2", "0", "0", "", "Classroom", "", ""],
  ],
  allocation: [
    ["CSE-2A", "CS201", "Dr. Anita Desai", "", "yes", "", "", ""],
    ["CSE-2B", "CS203", "Mr. Rohit Bansal", "Mr. Rohit Bansal; Ms. Priya Nair", "yes", "yes", "", ""],
    ["CSE-3A; ECE-3A; ME-3A", "OE301", "Ms. Priya Nair", "", "", "", "Open Elective", "60"],
  ],
};

export function templateTable(entity: Entity): string[][] {
  return [FIELDS[entity].map((f) => f.header), ...TEMPLATE_EXAMPLES[entity]];
}
