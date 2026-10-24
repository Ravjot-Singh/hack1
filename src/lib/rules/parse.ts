// Built-in, deterministic parser for plain-English timetable rules. Free and instant: the AI
// fallback is only offered when this gives up. It gives up rather than guess: any word it
// can't account for makes it return { ok: false } so a misread rule is never saved silently.

import type { LessonKind } from "@/lib/solver/types";
import { emptyTarget, halves, type RuleContext, type RuleDraft } from "./draft";

export type ParseResult = { ok: true; draft: RuleDraft } | { ok: false; reason: string };

const DAY_WORDS: [RegExp, number][] = [
  [/mon(?:day)?s?/, 0],
  [/tue(?:s(?:day)?)?s?/, 1],
  [/wed(?:nesday)?s?/, 2],
  [/thu(?:r(?:s(?:day)?)?)?s?/, 3],
  [/fri(?:day)?s?/, 4],
  [/sat(?:urday)?s?/, 5],
  [/sun(?:day)?s?/, 6],
];
const DAY = `(?:${DAY_WORDS.map(([r]) => r.source).join("|")})`;
const ORDINALS = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"];
const NUMBER_WORDS = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const TITLES = /^(?:dr|prof|mr|mrs|ms|miss|shri|smt|sir|madam)\.?$/;

/** Words that carry no meaning of their own once the parts above are recognised. */
const STOP = new Set(
  (
    "a an the and or of on in at for to by from with during between this that these those any all every each " +
    "is are be been being am was were has have had do does did can t s cannot could should would must might may will shall " +
    "no not never none nothing don doesn won isn aren mustn shouldn couldn " +
    "class classes lesson lessons lecture session sessions schedule scheduled scheduling timetable timetabled put place placed keep kept leave left " +
    "teach teaches teaching taught take takes run runs held hold happen happens " +
    "student students teacher teachers faculty staff group groups section sections batch batches " +
    "free available unavailable busy off blocked block allowed allow" +
    " avoid avoiding rather prefer prefers preferred preferably preference ideally possible if try please want wants like would wish " +
    "only just also too there their they them he she his her him its it we our us i my me who which " +
    "time times slot slots period periods day days week weekly hours hour hrs " +
    "max maximum most more than up upto at least row consecutive consecutively continuous continuously straight back " +
    "after before until till onwards onward later earlier morning mornings afternoon afternoons evening evenings forenoon lunch half " +
    "first last weekday weekdays weekend weekends daily anytime"
  ).split(/\s+/),
);

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Name -> regex source that tolerates spaces, dashes and dots between its parts. */
const flexible = (name: string) =>
  name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map(esc)
    .join("[\\s.\\-]*");

function toMinutes(h: number, m: number, ampm: string | undefined): number {
  let hour = h;
  if (ampm?.startsWith("p") && hour < 12) hour += 12;
  else if (ampm?.startsWith("a") && hour === 12) hour = 0;
  else if (!ampm && hour <= 7) hour += 12; // "after 3" in a college day means 3 pm
  return hour * 60 + m;
}
const hm = (s: string) => {
  const [h, m] = s.split(":").map(Number);
  return h * 60 + m;
};

export function parseRule(text: string, ctx: RuleContext): ParseResult {
  const P = ctx.periods.length;
  const orig = ` ${text.replace(/[’‘]/g, "'").replace(/[–—]/g, "-")} `;
  let rest = orig.toLowerCase();
  const lower = rest;

  /** Find all matches in what is left, blank them out, return them. */
  const take = (source: string, flags = "g", haystack?: string, keep?: (m: RegExpExecArray) => boolean): RegExpExecArray[] => {
    const re = new RegExp(source, flags.includes("g") ? flags : flags + "g");
    const out: RegExpExecArray[] = [];
    const hay = haystack ?? rest;
    let m: RegExpExecArray | null;
    while ((m = re.exec(hay))) {
      if (!m[0].length) {
        re.lastIndex++;
        continue;
      }
      if (rest.slice(m.index, m.index + m[0].length).trim() === "") continue; // already used
      if (!keep || keep(m)) out.push(m);
    }
    for (const x of out) rest = rest.slice(0, x.index) + " ".repeat(x[0].length) + rest.slice(x.index + x[0].length);
    return out;
  };
  const W = (s: string) => `(?<![a-z0-9])(?:${s})(?![a-z0-9])`;

  const target = emptyTarget();
  const teacherIds = new Set<string>();
  const add = <T,>(arr: T[], x: T) => {
    if (!arr.includes(x)) arr.push(x);
  };

  // --- Who / what ------------------------------------------------------------
  const title = "(?:(?:dr|prof|mr|mrs|ms|miss|shri|smt)\\.?\\s*)?";
  const bareName = (n: string) => n.split(/\s+/).filter((w) => !TITLES.test(w.toLowerCase())).join(" ");
  for (const t of [...ctx.teachers].sort((a, b) => b.name.length - a.name.length)) {
    if (take(W(title + flexible(bareName(t.name)))).length) teacherIds.add(t.id);
  }
  for (const s of [...ctx.subjects].sort((a, b) => b.name.length - a.name.length)) {
    const hit = (s.name.length >= 4 && take(W(flexible(s.name))).length) || take(W(flexible(s.code).replace(/([a-z])(\d)/, "$1[\\s\\-]*$2"))).length;
    if (hit) add(target.subjectIds, s.id);
  }
  for (const s of [...ctx.sections].sort((a, b) => b.name.length - a.name.length)) {
    // One- or two-letter names ("A") are only matched as "section A".
    const name = s.name.replace(/[^a-z0-9]/gi, "").length <= 2 ? `section\\s+${flexible(s.name)}` : flexible(s.name);
    if (take(W(name)).length) add(target.sectionIds, s.id);
  }
  for (const d of ctx.departments) {
    // Codes like "AS" are also English words: only match them as written (upper case).
    const hit = take(W(flexible(d.name))).length || take(`(?<![A-Za-z0-9])${esc(d.code)}(?![A-Za-z0-9])`, "g", orig).length;
    if (hit) for (const s of ctx.sections) if (s.deptId === d.id) add(target.sectionIds, s.id);
  }
  // Single words of a teacher's name ("Kumar", "Prof. Iyer"), if they point to one person.
  const byWord = new Map<string, Set<string>>();
  for (const t of ctx.teachers) {
    for (const w of bareName(t.name).toLowerCase().split(/[^a-z]+/)) {
      if (w.length >= 3 && !STOP.has(w)) byWord.set(w, (byWord.get(w) ?? new Set()).add(t.id));
    }
  }
  for (const [w, ids] of byWord) {
    if (!new RegExp(W(title + esc(w))).test(rest)) continue;
    const already = [...ids].filter((id) => teacherIds.has(id));
    if (ids.size > 1 && already.length !== 1) {
      const names = [...ids].map((id) => ctx.teachers.find((t) => t.id === id)!.name);
      return { ok: false, reason: `"${w}" could be ${names.join(" or ")}. Use the full name.` };
    }
    take(W(title + esc(w)));
    teacherIds.add(already[0] ?? [...ids][0]);
  }
  target.teacherIds = [...teacherIds];

  // --- Back-to-back limits ------------------------------------------------------
  const rowWords = "in\\s+a\\s+row|back[\\s-]*to[\\s-]*back|consecutive(?:ly)?|continuous(?:ly)?|straight|at\\s+a\\s+stretch";
  const unit = "(?:periods?|classes|lectures?|hours?|hrs?)";
  const limit =
    new RegExp(`(\\d+)\\s*(?:${rowWords})?\\s*${unit}?\\s*(?:${rowWords})`).exec(rest) ??
    new RegExp(`(?:max(?:imum)?|at\\s+most|no\\s+more\\s+than|not\\s+more\\s+than|up\\s*to)\\s*(?:of\\s+)?(\\d+)\\s*(?:${rowWords})?\\s*${unit}`).exec(rest);
  if (limit && /in\s+a\s+row|back|consecutive|continuous|straight|stretch/.test(lower)) {
    const isTeacher = /teach|faculty|staff|professor|lecturer/.test(lower);
    const isStudent = /student|section|batch|group|class(es)?\s+(?:can|should|may|must)|learner/.test(lower);
    if (isTeacher === isStudent) return { ok: false, reason: "Say whether the back-to-back limit is for teachers or for students." };
    const max = Number(limit[1]);
    if (!(max >= 1 && max <= 12)) return { ok: false, reason: "The limit must be between 1 and 12 periods." };
    take(esc(limit[0]));
    const left = leftover(rest);
    if (left.length) return unknown(left);
    return { ok: true, draft: { kind: "limit", who: isTeacher ? "teachers" : "students", max } };
  }

  // --- When: clock times ---------------------------------------------------------
  const periods = new Set<number>();
  const mid = (p: number) => (hm(ctx.periods[p].start) + hm(ctx.periods[p].end)) / 2;
  const T = "(\\d{1,2})(?:[:.](\\d{2}))?\\s*(a\\.?m\\.?|p\\.?m\\.?|o'?clock)?";
  const clock = (h: string, m: string | undefined, ap: string | undefined, fallbackAp?: string) =>
    toMinutes(Number(h), Number(m ?? 0), (ap && !ap.startsWith("o") ? ap : undefined) ?? fallbackAp);
  // A bare "after 3" may mean P3, so clock times need minutes or am/pm.
  const range = W(`(?:between|from)\\s+${T}\\s*(?:and|to|-|till|until)\\s*${T}`);
  for (const m of take(range, "g", undefined, (m) => !!(m[2] || m[3] || m[5] || m[6]))) {
    const a = clock(m[1], m[2], m[3], m[6]);
    const b = clock(m[4], m[5], m[6]);
    ctx.periods.forEach((_, p) => mid(p) >= a && mid(p) <= b && periods.add(p));
  }
  for (const m of take(W(`(after|past|post|from|before|until|till|by)\\s+${T}`), "g", undefined, (m) => !!(m[3] || m[4]))) {
    const t = clock(m[2], m[3], m[4]);
    const after = ["after", "past", "post", "from"].includes(m[1]);
    ctx.periods.forEach((_, p) => (after ? mid(p) >= t : mid(p) <= t) && periods.add(p));
  }

  // --- When: periods -------------------------------------------------------------
  const ordinal = `(\\d{1,2})(?:st|nd|rd|th)?|${ORDINALS.join("|")}`;
  const num = (s: string) => (ORDINALS.includes(s) ? ORDINALS.indexOf(s) + 1 : NUMBER_WORDS.includes(s) ? NUMBER_WORDS.indexOf(s) + 1 : parseInt(s, 10));
  const addRange = (a: number, b: number) => {
    for (let p = Math.max(1, Math.min(a, b)); p <= Math.min(P, Math.max(a, b)); p++) periods.add(p - 1);
  };
  const badPeriod = (n: number) => n < 1 || n > P;
  for (const m of take(W(`(first|last)\\s+(\\d|${NUMBER_WORDS.join("|")})\\s+(?:periods|classes|lectures|hours)`))) {
    const n = num(m[2]);
    if (m[1] === "first") addRange(1, n);
    else addRange(P - n + 1, P);
  }
  for (const m of take(W(`(after|before|from|until|till|upto|up\\s+to)\\s+(?:the\\s+)?(?:p|period\\s*|(?=\\d{1,2}(?:st|nd|rd|th)\\s+period))(\\d{1,2})(?:st|nd|rd|th)?(?:\\s+period)?(\\s+onwards?)?`))) {
    const n = num(m[2]);
    if (badPeriod(n)) return { ok: false, reason: `There is no period ${n}; the day has ${P}.` };
    if (m[1] === "after") addRange(n + 1, P);
    else if (m[1] === "before") addRange(1, n - 1);
    else if (m[1] === "from") addRange(n, P);
    else addRange(1, n);
  }
  for (const m of take(W(`(?:p|periods?\\s*)(\\d{1,2})(?:\\s*(?:-|to|till|until|and|,|&)\\s*(?:p|period\\s*)?(\\d{1,2}))?`))) {
    const a = num(m[1]);
    const b = m[2] ? num(m[2]) : a;
    if (badPeriod(a) || badPeriod(b)) return { ok: false, reason: `There is no period ${badPeriod(a) ? a : b}; the day has ${P}.` };
    if (m[0].includes("and") || m[0].includes(",") || m[0].includes("&")) {
      addRange(a, a);
      addRange(b, b);
    } else addRange(a, b);
  }
  for (const m of take(W(`(?:the\\s+)?(${ordinal}|last)\\s+(?:period|class|lecture|hour)s?`))) {
    if (m[1] === "last") addRange(P, P);
    else {
      const n = num(m[2] ?? m[1]);
      if (badPeriod(n)) return { ok: false, reason: `There is no period ${n}; the day has ${P}.` };
      addRange(n, n);
    }
  }
  const { morning, afternoon } = halves(ctx);
  if (take(W("after\\s*-?\\s*lunch|post[\\s-]*lunch|afternoons?|evenings?|second\\s+half")).length) afternoon.forEach((p) => periods.add(p));
  if (take(W("before\\s+lunch|pre[\\s-]*lunch|mornings?|forenoons?|first\\s+half")).length) morning.forEach((p) => periods.add(p));

  // --- When: days ------------------------------------------------------------------
  const canon = ctx.days.map((d) => DAY_WORDS.findIndex(([r]) => new RegExp(`^${r.source}$`).test(d.toLowerCase())));
  const days = new Set<number>();
  const dayIndex = (word: string) => DAY_WORDS.findIndex(([r]) => new RegExp(`^${r.source}$`).test(word));
  const addDay = (c: number): string | null => {
    const i = canon.indexOf(c);
    if (i < 0) return `${["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"][c]} isn't a working day here.`;
    days.add(i);
    return null;
  };
  for (const m of take(W(`(${DAY})\\s*(?:-|to|through|thru|till|until)\\s*(${DAY})`))) {
    const a = dayIndex(m[1]);
    const b = dayIndex(m[2]);
    for (let c = a; c <= b; c++) if (canon.includes(c)) days.add(canon.indexOf(c));
  }
  for (const m of take(W(DAY))) {
    const err = addDay(dayIndex(m[0]));
    if (err) return { ok: false, reason: err };
  }
  if (take(W("weekdays?")).length) canon.forEach((c, i) => c >= 0 && c <= 4 && days.add(i));
  if (take(W("weekends?")).length) canon.forEach((c, i) => c >= 5 && days.add(i));
  take(W("every\\s*day|daily|all\\s+days|any\\s+day|all\\s+week"));

  // --- Years, kinds ------------------------------------------------------------------
  const maxYear = Math.max(1, ...ctx.sections.map((s) => s.year));
  for (const m of take(W(`(?:(\\d)(?:st|nd|rd|th)?|(${ORDINALS.slice(0, 6).join("|")}|final|last))[\\s-]*years?|years?\\s*(\\d)|freshers|freshmen`))) {
    const y = m[1] ? Number(m[1]) : m[3] ? Number(m[3]) : m[2] === "final" || m[2] === "last" ? maxYear : m[2] ? num(m[2]) : 1;
    if (!ctx.sections.some((s) => s.year === y)) return { ok: false, reason: `No section is in year ${y}.` };
    add(target.years, y);
  }
  const kinds: [string, LessonKind[]][] = [
    ["labs?|practicals?|lab\\s+sessions?|practical\\s+sessions?", ["P"]],
    ["tutorials?|tuts?", ["T"]],
    ["lectures?", ["L", "H"]],
    ["theory", ["L", "T", "H"]],
  ];
  for (const [re, ks] of kinds) if (take(W(re)).length) ks.forEach((k) => add(target.kinds, k));

  // --- Hard / soft, never / only -------------------------------------------------------
  const soft = /\b(avoid|rather|prefer|preferabl|ideally|if possible|try|should|would like|wish|better)/.test(lower);
  const preferOnly = /\bprefers?\b|\bpreferred\b|\bpreferably\b(?!\s+not)/.test(lower) && !/prefer(?:s|ably)?\s+not/.test(lower);
  const negative =
    /\b(no|not|never|avoid|unavailable|can't|cannot|can not|don't|doesn't|won't|mustn't|shouldn't|busy|blocked|off|free|nothing|none|isn't|aren't)\b/.test(lower);
  const only =
    /\bonly\b/.test(lower) ||
    preferOnly ||
    (!negative && /\b(must|should|has to|have to|needs? to)\s+(be|happen|run|take place)\b|\bavailable\b/.test(lower));
  if (!only && !negative) return { ok: false, reason: "I couldn't tell whether those times are not allowed or the only times allowed." };

  const left = leftover(rest);
  if (left.length) return unknown(left);
  if (!days.size && !periods.size) return { ok: false, reason: "I couldn't find which days or periods the rule is about." };

  return {
    ok: true,
    draft: {
      kind: "slots",
      strength: soft ? "soft" : "hard",
      only,
      target,
      days: [...days].sort((a, b) => a - b),
      periods: [...periods].sort((a, b) => a - b),
    },
  };
}

function leftover(rest: string): string[] {
  return [...new Set(rest.split(/[^a-z0-9]+/).filter((w) => w && !STOP.has(w)))];
}

function unknown(words: string[]): ParseResult {
  return { ok: false, reason: `I didn't understand ${words.map((w) => `"${w}"`).join(", ")}.` };
}
