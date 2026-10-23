import type { Issue, Problem } from "./types";

/**
 * Feasibility pre-checks run before solving (and live while data is entered). They catch
 * the impossible setups that make a solver silently fail, and say what to change.
 */
export function precheck(problem: Problem): Issue[] {
  const { input, lessons } = problem;
  const issues: Issue[] = [];
  const D = input.days.length;
  const P = input.periods.length;
  const sections = new Map(input.sections.map((s) => [s.id, s]));
  const grids = new Map(input.grids.map((g) => [g.id, g]));
  const openCount = (gridId: string) =>
    grids.get(gridId)?.open.reduce((n, day) => n + day.filter(Boolean).length, 0) ?? 0;
  const maxRun = (gridId: string) => {
    let best = 0;
    for (const day of grids.get(gridId)?.open ?? []) {
      let run = 0;
      for (const o of day) best = Math.max(best, (run = o ? run + 1 : 0));
    }
    return best;
  };

  // Student groups: weekly demand vs teaching periods in their grid.
  const atomDemand = new Map<string, number>();
  const counted = new Set<string>();
  for (const l of lessons) {
    for (const atom of l.atoms) {
      // Parallel basket lessons only count once per atom.
      const key = `${atom}|${l.unitId}`;
      if (counted.has(key)) continue;
      counted.add(key);
      atomDemand.set(atom, (atomDemand.get(atom) ?? 0) + l.duration);
    }
  }
  for (const [atom, need] of atomDemand) {
    const sec = sections.get(problem.atomSection[atom]);
    if (!sec) continue;
    const have = openCount(sec.gridId);
    if (need > have) {
      issues.push({
        severity: "error",
        rule: "section-capacity",
        message: `${problem.atomNames[atom]} needs ${need} periods a week but its timetable only has ${have} teaching periods.`,
        fix: `Reduce subjects/hours for ${sec.name} or open more periods in its time grid.`,
      });
    }
  }

  // Teachers: weekly load vs limits and availability.
  for (const t of input.teachers) {
    const mine = lessons.filter((l) => l.teacherIds.includes(t.id));
    const units = new Set<string>();
    let load = 0;
    for (const l of mine) {
      if (units.has(l.unitId)) continue;
      units.add(l.unitId);
      load += l.duration;
    }
    if (!load) continue;
    const available = D * P - t.unavailable.length;
    if (load > t.maxPerWeek) {
      issues.push({
        severity: "error",
        rule: "teacher-load",
        message: `${t.name} is assigned ${load} periods a week but the limit for a ${t.designation} is ${t.maxPerWeek}.`,
        fix: `Move some of ${t.name}'s classes to another teacher or raise the limit.`,
      });
    } else if (load > t.maxPerDay * D) {
      issues.push({
        severity: "error",
        rule: "teacher-load",
        message: `${t.name} has ${load} periods but can teach at most ${t.maxPerDay} a day × ${D} days.`,
        fix: `Raise ${t.name}'s daily limit or reassign classes.`,
      });
    } else if (load > available) {
      issues.push({
        severity: "error",
        rule: "teacher-availability",
        message: `${t.name} has ${load} periods but is only available for ${available}.`,
        fix: `Reduce ${t.name}'s blocked slots or reassign classes.`,
      });
    }
    const basketTeacher = new Map<string, number>();
    for (const l of mine) {
      if (l.unitId === l.id) continue; // not part of a basket
      basketTeacher.set(l.unitId, (basketTeacher.get(l.unitId) ?? 0) + 1);
    }
    if ([...basketTeacher.values()].some((n) => n > 1)) {
      issues.push({
        severity: "error",
        rule: "basket-teacher",
        message: `${t.name} teaches two electives in the same basket, but basket electives run at the same time.`,
        fix: "Give one of those electives to another teacher.",
      });
    }
  }

  // Rooms: type exists, big enough, and enough room-periods overall.
  const seen = new Set<string>();
  const demandByType = new Map<string, number>();
  for (const l of lessons) {
    demandByType.set(l.roomType, (demandByType.get(l.roomType) ?? 0) + l.duration);
    const ofType = input.rooms.filter((r) => !r.isEventVenue && r.type === l.roomType);
    const key = `${l.offeringId}|${l.kind}|${l.size}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!ofType.length) {
      issues.push({
        severity: "error",
        rule: "room-type",
        message: `${l.label} needs a "${l.roomType}" but the institute has none.`,
        fix: `Add a room of type "${l.roomType}" or change the subject's room type.`,
      });
    } else if (Math.max(...ofType.map((r) => r.capacity)) < l.size) {
      issues.push({
        severity: "error",
        rule: "room-capacity",
        message: `${l.label} has ${l.size} students but the largest ${l.roomType} holds ${Math.max(...ofType.map((r) => r.capacity))}.`,
        fix: l.kind === "P" ? "Split the section into batches for labs." : "Add a bigger room or split the section.",
      });
    }
    for (const sid of l.sectionIds) {
      const sec = sections.get(sid);
      if (sec && l.duration > maxRun(sec.gridId)) {
        issues.push({
          severity: "error",
          rule: "block-length",
          message: `${l.label} needs ${l.duration} periods in a row but ${sec.name}'s grid never has more than ${maxRun(sec.gridId)} without a break.`,
          fix: "Shorten the lab block or move the break.",
        });
      }
    }
    const maxS = input.rules.maxConsecutiveSection;
    if (maxS != null && l.duration > maxS) {
      issues.push({
        severity: "error",
        rule: "block-length",
        message: `${l.label} is ${l.duration} periods long but students may only have ${maxS} in a row.`,
        fix: "Raise the back-to-back limit or shorten the lab block.",
      });
    }
  }
  // Upper bound on teaching periods any room can offer: the most open grid.
  const openAny = Math.max(0, ...input.grids.map((g) => openCount(g.id)));
  for (const [type, need] of demandByType) {
    const supply = input.rooms.filter((r) => !r.isEventVenue && r.type === type).length * openAny;
    if (supply && need > supply) {
      issues.push({
        severity: "error",
        rule: "room-supply",
        message: `Classes need ${need} ${type} periods a week but all ${type}s together offer only ${supply}.`,
        fix: `Add more rooms of type ${type}.`,
      });
    } else if (supply && need > 0.85 * supply) {
      issues.push({
        severity: "warning",
        rule: "room-supply",
        message: `${type}s are ${Math.round((100 * need) / supply)}% booked; solving may be slow or fail.`,
      });
    }
  }

  for (const o of input.offerings) {
    if (!o.teacherIds.length) {
      const subj = input.subjects.find((s) => s.id === o.subjectId);
      issues.push({
        severity: "warning",
        rule: "no-teacher",
        message: `${subj?.code ?? o.subjectId} for ${o.sectionIds.map((id) => sections.get(id)?.name).join(", ")} has no teacher assigned.`,
        fix: "Assign a teacher in Allocation.",
      });
    }
  }

  return issues;
}
