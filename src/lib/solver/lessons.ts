import type { InstituteInput, Lesson, LessonKind, Problem, SectionInput, Unit } from "./types";

const KIND_NAME: Record<LessonKind, string> = { L: "Lecture", T: "Tutorial", P: "Lab", H: "Class" };

/** Atoms of a section: one per batch, or the section itself when it has no batches. */
export function sectionAtoms(section: SectionInput): string[] {
  return section.batches.length ? section.batches.map((b) => b.id) : [section.id];
}

/** Split `hours` into blocks of at most `len` periods (3 with len 2 -> [2, 1]). */
function blocks(hours: number, len: number): number[] {
  const out: number[] = [];
  const size = Math.max(1, len);
  for (let left = hours; left > 0; left -= size) out.push(Math.min(size, left));
  return out;
}

/**
 * Expand offerings (subject x section x teacher) into schedulable lessons and group
 * elective-basket lessons into units that must be placed at the same time.
 */
export function buildProblem(input: InstituteInput): Problem {
  const sections = new Map(input.sections.map((s) => [s.id, s]));
  const subjects = new Map(input.subjects.map((s) => [s.id, s]));
  const basketSize = new Map<string, number>();
  for (const o of input.offerings) {
    if (o.basketId) basketSize.set(o.basketId, (basketSize.get(o.basketId) ?? 0) + 1);
  }

  const atomNames: Record<string, string> = {};
  const atomSection: Record<string, string> = {};
  for (const s of input.sections) {
    if (s.batches.length) {
      for (const b of s.batches) {
        atomNames[b.id] = `${s.name} ${b.name}`;
        atomSection[b.id] = s.id;
      }
    } else {
      atomNames[s.id] = s.name;
      atomSection[s.id] = s.id;
    }
  }

  const lessons: Lesson[] = [];
  const unitMap = new Map<string, Unit>();
  const addLesson = (lesson: Omit<Lesson, "unitId">, unitKey: string | null) => {
    const unitId = unitKey ?? lesson.id;
    const full: Lesson = { ...lesson, unitId };
    lessons.push(full);
    const unit = unitMap.get(unitId);
    if (unit) unit.lessonIds.push(full.id);
    else unitMap.set(unitId, { id: unitId, lessonIds: [full.id], duration: full.duration });
  };

  for (const o of input.offerings) {
    const subject = subjects.get(o.subjectId);
    if (!subject) continue;
    const secs = o.sectionIds.map((id) => sections.get(id)).filter((s): s is SectionInput => !!s);
    if (!secs.length) continue;

    const allAtoms = secs.flatMap(sectionAtoms);
    const secLabel = secs.map((s) => s.name).join(" + ");
    const totalSize = secs.reduce((n, s) => n + s.size, 0);
    const theorySize = o.basketId
      ? (o.expectedSize ?? Math.ceil(totalSize / (basketSize.get(o.basketId) ?? 1)))
      : totalSize;
    const labTeachers = o.labTeacherIds.length ? o.labTeacherIds : o.teacherIds;
    const base = {
      offeringId: o.id,
      subjectId: subject.id,
      subjectCode: subject.code,
      subjectName: subject.name,
      sectionIds: secs.map((s) => s.id),
      deptId: subject.deptId,
    };
    // Basket lessons with the same kind, index and length share a unit (run in parallel).
    const unitKey = (kind: string, k: number, dur: number) =>
      o.basketId ? `${o.basketId}:${kind}${dur}:${k}` : null;

    const theory = (kind: LessonKind, count: number) => {
      for (let k = 0; k < count; k++) {
        addLesson(
          {
            ...base,
            id: `${o.id}:${kind}${k}`,
            kind,
            teacherIds: o.teacherIds,
            batchId: null,
            atoms: allAtoms,
            size: theorySize,
            duration: 1,
            roomType: subject.theoryRoomType,
            label: `${subject.code} ${KIND_NAME[kind]} · ${secLabel}`,
          },
          unitKey(kind, k, 1),
        );
      }
    };

    if (subject.mode === "HOURS") {
      theory("H", subject.hoursPerWeek);
      continue;
    }
    theory("L", subject.L);
    theory("T", subject.T);

    blocks(subject.P, subject.labBlockLen).forEach((dur, k) => {
      const perBatch = o.batchwiseLab && !o.basketId && secs.some((s) => s.batches.length);
      if (!perBatch) {
        addLesson(
          {
            ...base,
            id: `${o.id}:P${k}`,
            kind: "P",
            teacherIds: labTeachers,
            batchId: null,
            atoms: allAtoms,
            size: theorySize,
            duration: dur,
            roomType: subject.labRoomType,
            label: `${subject.code} Lab · ${secLabel}`,
          },
          unitKey("P", k, dur),
        );
        return;
      }
      for (const s of secs) {
        const groups = s.batches.length ? s.batches : [{ id: s.id, name: "", size: s.size }];
        for (const b of groups) {
          addLesson(
            {
              ...base,
              id: `${o.id}:P${k}:${b.id}`,
              kind: "P",
              teacherIds: labTeachers,
              batchId: s.batches.length ? b.id : null,
              atoms: [b.id],
              size: b.size,
              duration: dur,
              roomType: subject.labRoomType,
              label: `${subject.code} Lab · ${s.name}${b.name ? " " + b.name : ""}`,
            },
            null,
          );
        }
      }
    });
  }

  return { input, lessons, units: [...unitMap.values()], atomNames, atomSection };
}
