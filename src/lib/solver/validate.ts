import { travelMinutes, walkAllowance } from "./time";
import type { Assignment, Lesson, Problem, Violation } from "./types";

/**
 * Independent hard-constraint checker. Deliberately does not share state or code paths
 * with the constructor, so it can be trusted to catch solver bugs. The server refuses to
 * save any timetable for which this returns violations.
 */
export function validate(problem: Problem, assignment: Assignment): { violations: Violation[]; unscheduled: string[] } {
  const { input, lessons } = problem;
  const violations: Violation[] = [];
  const add = (rule: string, message: string, ...ids: string[]) => violations.push({ rule, message, lessonIds: ids });

  const rooms = new Map(input.rooms.map((r) => [r.id, r]));
  const teachers = new Map(input.teachers.map((t) => [t.id, t]));
  const sections = new Map(input.sections.map((s) => [s.id, s]));
  const grids = new Map(input.grids.map((g) => [g.id, g]));
  const byId = new Map(lessons.map((l) => [l.id, l]));
  const unitSize = new Map<string, number>();
  for (const l of lessons) unitSize.set(l.unitId, (unitSize.get(l.unitId) ?? 0) + 1);

  const unscheduled = lessons.filter((l) => !assignment[l.id]).map((l) => l.id);
  const P = input.periods.length;
  const D = input.days.length;

  // occupancy: "kind|id|day|period" -> lessons
  const occ = new Map<string, Lesson[]>();
  const mark = (key: string, l: Lesson) => {
    const list = occ.get(key);
    if (list) list.push(l);
    else occ.set(key, [l]);
  };

  for (const l of lessons) {
    const a = assignment[l.id];
    if (!a) continue;
    const where = `${l.label} (${input.days[a.day] ?? "?"} P${a.period + 1})`;
    if (a.day < 0 || a.day >= D || a.period < 0 || a.period + l.duration > P) {
      add("grid", `${where} falls outside the week grid.`, l.id);
      continue;
    }
    for (const sid of l.sectionIds) {
      const sec = sections.get(sid);
      const grid = sec && grids.get(sec.gridId);
      for (let p = a.period; p < a.period + l.duration; p++) {
        if (!grid?.open[a.day]?.[p]) {
          add("grid", `${where} is scheduled during a break or closed period for ${sec?.name ?? sid}.`, l.id);
          break;
        }
      }
    }
    const room = rooms.get(a.roomId);
    if (!room) add("room", `${where} has no valid room.`, l.id);
    else {
      if (room.isEventVenue) add("room", `${where} uses event venue ${room.name}.`, l.id);
      if (room.type !== l.roomType) add("room", `${where} needs a ${l.roomType} but got ${room.name} (${room.type}).`, l.id);
      if (room.capacity < l.size) add("room", `${where}: ${l.size} students don't fit in ${room.name} (${room.capacity}).`, l.id);
    }
    for (const tid of l.teacherIds) {
      const t = teachers.get(tid);
      for (let p = a.period; p < a.period + l.duration; p++) {
        if (t?.unavailable.some(([d, pp]) => d === a.day && pp === p)) {
          add("teacher-unavailable", `${where}: ${t.name} is unavailable then.`, l.id);
        }
      }
    }
    for (let p = a.period; p < a.period + l.duration; p++) {
      for (const tid of l.teacherIds) mark(`t|${tid}|${a.day}|${p}`, l);
      for (const atom of l.atoms) mark(`a|${atom}|${a.day}|${p}`, l);
      mark(`r|${a.roomId}|${a.day}|${p}`, l);
    }
  }

  // Unit coherence (elective baskets run together)
  const unitStart = new Map<string, string>();
  for (const l of lessons) {
    const a = assignment[l.id];
    if (!a) continue;
    const key = `${a.day}|${a.period}`;
    const seen = unitStart.get(l.unitId);
    if (seen && seen !== key) add("basket", `${l.label} must run at the same time as the rest of its elective basket.`, l.id);
    unitStart.set(l.unitId, key);
  }

  // Pins
  for (const pin of input.pins ?? []) {
    const a = assignment[pin.lessonId];
    if (a && (a.day !== pin.day || a.period !== pin.period || a.roomId !== pin.roomId)) {
      add("pinned", `${byId.get(pin.lessonId)?.label ?? pin.lessonId} was pinned but moved.`, pin.lessonId);
    }
  }

  // Clashes
  const reported = new Set<string>();
  for (const [key, list] of occ) {
    if (list.length < 2) continue;
    const [kind, id, day, period] = key.split("|");
    const at = `${input.days[+day]} P${+period + 1}`;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const x = list[i];
        const y = list[j];
        // Parallel electives in one basket legitimately share student atoms.
        if (kind === "a" && x.unitId === y.unitId) continue;
        const sig = `${kind}|${id}|${[x.id, y.id].sort().join("|")}`;
        if (reported.has(sig)) continue;
        reported.add(sig);
        const name =
          kind === "t" ? teachers.get(id)?.name : kind === "r" ? rooms.get(id)?.name : problem.atomNames[id];
        const what = kind === "t" ? "Teacher" : kind === "r" ? "Room" : "Students of";
        add(`${kind === "t" ? "teacher" : kind === "r" ? "room" : "student"}-clash`, `${what} ${name} double-booked on ${at}: ${x.label} and ${y.label}.`, x.id, y.id);
      }
    }
  }

  // Per-entity timelines: daily/weekly load, consecutive runs, travel
  const timeline = (prefix: string, id: string, day: number) =>
    Array.from({ length: P }, (_, p) => occ.get(`${prefix}|${id}|${day}|${p}`) ?? []);

  for (const t of input.teachers) {
    let week = 0;
    for (let d = 0; d < D; d++) {
      const line = timeline("t", t.id, d);
      const load = line.filter((x) => x.length).length;
      week += load;
      if (load > t.maxPerDay) add("teacher-load", `${t.name} teaches ${load} periods on ${input.days[d]} (max ${t.maxPerDay}).`, ...line.flat().map((l) => l.id));
      checkRuns(line, input.rules.maxConsecutiveTeacher, (len) => `${t.name} teaches ${len} periods in a row on ${input.days[d]} (max ${input.rules.maxConsecutiveTeacher}).`);
      if (input.rules.travelTimeHard) checkTravel(line, t.name, d, true);
    }
    if (week > t.maxPerWeek) add("teacher-load", `${t.name} teaches ${week} periods this week (max ${t.maxPerWeek}).`);
  }
  for (const atom of Object.keys(problem.atomNames)) {
    for (let d = 0; d < D; d++) {
      const line = timeline("a", atom, d);
      checkRuns(line, input.rules.maxConsecutiveSection, (len) => `${problem.atomNames[atom]} has ${len} periods in a row on ${input.days[d]} (max ${input.rules.maxConsecutiveSection}).`);
      if (input.rules.travelTimeHard) checkTravel(line, problem.atomNames[atom], d, false);
    }
  }

  function checkRuns(line: Lesson[][], max: number | null, msg: (len: number) => string) {
    if (max == null) return;
    let run = 0;
    for (let p = 0; p <= line.length; p++) {
      if (p < line.length && line[p].length) run++;
      else {
        if (run > max) add("consecutive", msg(run), ...line.slice(p - run, p).flat().map((l) => l.id));
        run = 0;
      }
    }
  }

  function checkTravel(line: Lesson[][], who: string, day: number, isTeacher: boolean) {
    for (let p = 0; p + 1 < line.length; p++) {
      const x = line[p][0];
      const y = line[p + 1][0];
      if (!x || !y || x.id === y.id) continue;
      if (!isTeacher && ((unitSize.get(x.unitId) ?? 1) > 1 || (unitSize.get(y.unitId) ?? 1) > 1)) continue;
      const rx = rooms.get(assignment[x.id].roomId);
      const ry = rooms.get(assignment[y.id].roomId);
      const need = travelMinutes(input, rx?.buildingId ?? null, ry?.buildingId ?? null);
      if (need > walkAllowance(input, p)) {
        add("travel", `${who} must walk ${need} min from ${rx?.name} to ${ry?.name} between P${p + 1} and P${p + 2} on ${input.days[day]}.`, x.id, y.id);
      }
    }
  }

  return { violations, unscheduled };
}
