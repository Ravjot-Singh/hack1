import type {
  InstituteInput,
  OfferingInput,
  RoomInput,
  SectionInput,
  SubjectInput,
  TeacherInput,
} from "@/lib/solver/types";

/**
 * A realistic sample engineering college: 4 departments, 22 teachers, 10 sections with
 * lab batches, 3 buildings, staggered lunch (1st years vs seniors), half-day Saturday,
 * an open-elective basket and a 3-period CAD lab block.
 * `prefix` keeps ids unique when several demo institutes live in one database.
 */
export function demoCollege(prefix = ""): InstituteInput {
  const id = (s: string) => `${prefix}${s}`;
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const periods = [
    { start: "09:00", end: "09:50" },
    { start: "09:50", end: "10:40" },
    { start: "10:50", end: "11:40" },
    { start: "11:40", end: "12:30" },
    { start: "12:30", end: "13:20" },
    { start: "13:20", end: "14:10" },
    { start: "14:10", end: "15:00" },
    { start: "15:00", end: "15:50" },
  ];
  const grid = (lunch: number) =>
    days.map((_, d) => periods.map((_, p) => (d === 5 ? p < 4 : p !== lunch)));

  const departments = [
    { id: id("d-as"), name: "Applied Sciences", code: "AS" },
    { id: id("d-cse"), name: "Computer Science & Engineering", code: "CSE" },
    { id: id("d-ece"), name: "Electronics & Communication", code: "ECE" },
    { id: id("d-me"), name: "Mechanical Engineering", code: "ME" },
  ];
  const [AS, CSE, ECE, ME] = departments.map((d) => d.id);

  const buildings = [
    { id: id("b-main"), name: "Main Block", travelMinutes: { [id("b-eng")]: 3, [id("b-ws")]: 10 } },
    { id: id("b-eng"), name: "Engineering Block", travelMinutes: { [id("b-main")]: 3, [id("b-ws")]: 8 } },
    { id: id("b-ws"), name: "Workshop Block", travelMinutes: { [id("b-main")]: 10, [id("b-eng")]: 8 } },
  ];
  const [MAIN, ENG, WS] = buildings.map((b) => b.id);

  const room = (code: string, name: string, type: string, capacity: number, buildingId: string, ownerDeptId: string | null, isEventVenue = false): RoomInput => ({
    id: id(`r-${code}`), name, type, capacity, buildingId, ownerDeptId, isEventVenue,
  });
  const rooms: RoomInput[] = [
    ...[1, 2, 3, 4, 5, 6].map((n) => room(`m10${n}`, `M-10${n}`, "Classroom", 70, MAIN, null)),
    room("phy", "Physics Lab", "Physics Lab", 36, MAIN, AS),
    room("chem", "Chemistry Lab", "Chemistry Lab", 36, MAIN, AS),
    room("sem", "Seminar Hall", "Seminar Hall", 200, MAIN, null, true),
    room("e201", "E-201", "Classroom", 70, ENG, CSE),
    room("e202", "E-202", "Classroom", 70, ENG, CSE),
    room("e203", "E-203", "Classroom", 70, ENG, ECE),
    room("e204", "E-204", "Classroom", 70, ENG, null),
    room("cs1", "CS Lab 1", "Computer Lab", 36, ENG, CSE),
    room("cs2", "CS Lab 2", "Computer Lab", 36, ENG, null),
    room("elab", "Electronics Lab", "Electronics Lab", 36, ENG, ECE),
    room("ws", "Central Workshop", "Workshop", 36, WS, ME),
    room("cad", "CAD Lab", "Computer Lab", 36, WS, ME),
    room("mlab", "Materials Lab", "Mechanical Lab", 36, WS, ME),
    room("w301", "W-301", "Classroom", 70, WS, ME),
  ];

  const LIMITS: Record<string, [number, number]> = { Professor: [4, 14], "Associate Professor": [4, 16], "Assistant Professor": [5, 18] };
  const teacher = (key: string, name: string, deptId: string, designation: string, extra: Partial<TeacherInput> = {}): TeacherInput => ({
    id: id(`t-${key}`), name, deptId, designation,
    maxPerDay: LIMITS[designation][0], maxPerWeek: LIMITS[designation][1],
    unavailable: [], prefs: [], ...extra,
  });
  const range = (d: number, from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i): [number, number] => [d, from + i]);
  const teachers: TeacherInput[] = [
    teacher("meera", "Dr. Meera Iyer", AS, "Professor", { unavailable: range(5, 0, 3) }),
    teacher("arjun", "Mr. Arjun Bedi", AS, "Assistant Professor"),
    teacher("kavita", "Dr. Kavita Rao", AS, "Associate Professor", {
      prefs: [0, 1, 2, 3, 4].flatMap((d) => [
        ...[0, 1, 2].map((p) => ({ day: d, period: p, value: "PREFER" as const })),
        { day: d, period: 7, value: "AVOID" as const },
      ]),
    }),
    teacher("neha", "Ms. Neha Gill", AS, "Assistant Professor"),
    teacher("sanjay", "Dr. Sanjay Verma", AS, "Associate Professor"),
    teacher("pooja", "Ms. Pooja Arora", AS, "Assistant Professor"),
    teacher("ritu", "Ms. Ritu Sharma", AS, "Assistant Professor"),
    teacher("harpreet", "Mr. Harpreet Singh", AS, "Assistant Professor"),
    teacher("rajesh", "Dr. Rajesh Kumar", CSE, "Professor", { unavailable: range(4, 4, 7) }),
    teacher("anita", "Dr. Anita Desai", CSE, "Associate Professor"),
    teacher("vikram", "Mr. Vikram Malhotra", CSE, "Assistant Professor"),
    teacher("simran", "Ms. Simran Kaur", CSE, "Assistant Professor"),
    teacher("rohit", "Mr. Rohit Bansal", CSE, "Assistant Professor"),
    teacher("priya", "Ms. Priya Nair", CSE, "Assistant Professor"),
    teacher("suresh", "Dr. Suresh Menon", ECE, "Professor"),
    teacher("farah", "Dr. Farah Khan", ECE, "Associate Professor"),
    teacher("gurpreet", "Mr. Gurpreet Dhillon", ECE, "Assistant Professor"),
    teacher("ananya", "Ms. Ananya Ghosh", ECE, "Assistant Professor"),
    teacher("balwinder", "Dr. Balwinder Sandhu", ME, "Professor", {
      prefs: range(5, 0, 3).map(([day, period]) => ({ day, period, value: "AVOID" as const })),
    }),
    teacher("karan", "Mr. Karan Mehta", ME, "Assistant Professor"),
    teacher("deepak", "Mr. Deepak Yadav", ME, "Assistant Professor"),
    teacher("jaspreet", "Ms. Jaspreet Kaur", ME, "Assistant Professor"),
  ];
  const T = (key: string) => id(`t-${key}`);

  const grids = [
    { id: id("g-junior"), name: "1st year (lunch 12:30)", open: grid(4) },
    { id: id("g-senior"), name: "Senior years (lunch 13:20)", open: grid(5) },
  ];
  const section = (key: string, name: string, deptId: string, programName: string, year: number, size: number): SectionInput => ({
    id: id(`s-${key}`), name, deptId, programName, year, size,
    gridId: year === 1 ? grids[0].id : grids[1].id,
    batches: [
      { id: id(`s-${key}-g1`), name: "G1", size: Math.ceil(size / 2) },
      { id: id(`s-${key}-g2`), name: "G2", size: Math.floor(size / 2) },
    ],
  });
  const sections: SectionInput[] = [
    section("fya", "FY-A", AS, "B.Tech (Common 1st year)", 1, 66),
    section("fyb", "FY-B", AS, "B.Tech (Common 1st year)", 1, 66),
    section("fyc", "FY-C", AS, "B.Tech (Common 1st year)", 1, 66),
    section("cse2a", "CSE-2A", CSE, "B.Tech CSE", 2, 64),
    section("cse2b", "CSE-2B", CSE, "B.Tech CSE", 2, 62),
    section("ece2a", "ECE-2A", ECE, "B.Tech ECE", 2, 60),
    section("me2a", "ME-2A", ME, "B.Tech ME", 2, 58),
    section("cse3a", "CSE-3A", CSE, "B.Tech CSE", 3, 64),
    section("ece3a", "ECE-3A", ECE, "B.Tech ECE", 3, 56),
    section("me3a", "ME-3A", ME, "B.Tech ME", 3, 52),
  ];
  const S = (key: string) => id(`s-${key}`);

  const subject = (code: string, name: string, deptId: string, ltp: [number, number, number], labRoomType = "Classroom", labBlockLen = 2): SubjectInput => ({
    id: id(`sub-${code.toLowerCase()}`), code, name, deptId, mode: "LTP",
    L: ltp[0], T: ltp[1], P: ltp[2], hoursPerWeek: ltp[0] + ltp[1] + ltp[2],
    theoryRoomType: "Classroom", labRoomType, labBlockLen,
  });
  const subjects: SubjectInput[] = [
    subject("MA101", "Engineering Mathematics-I", AS, [3, 1, 0]),
    subject("PH101", "Engineering Physics", AS, [3, 0, 2], "Physics Lab"),
    subject("CY101", "Engineering Chemistry", AS, [3, 0, 2], "Chemistry Lab"),
    subject("CS101", "Programming for Problem Solving", CSE, [3, 0, 2], "Computer Lab"),
    subject("ME101", "Workshop Practice", ME, [0, 0, 2], "Workshop"),
    subject("HS101", "Communicative English", AS, [2, 0, 0]),
    subject("MA201", "Mathematics-III", AS, [3, 1, 0]),
    subject("HS201", "Universal Human Values", AS, [2, 0, 0]),
    subject("CS201", "Data Structures", CSE, [3, 0, 2], "Computer Lab"),
    subject("CS203", "Object Oriented Programming", CSE, [3, 0, 2], "Computer Lab"),
    subject("CS204", "Discrete Mathematics", CSE, [3, 1, 0]),
    subject("EC201", "Analog Circuits", ECE, [3, 0, 2], "Electronics Lab"),
    subject("EC202", "Signals & Systems", ECE, [3, 1, 0]),
    subject("EC203", "Digital Electronics", ECE, [3, 0, 2], "Electronics Lab"),
    subject("ME201", "Thermodynamics", ME, [3, 1, 0]),
    subject("ME202", "Strength of Materials", ME, [3, 0, 2], "Mechanical Lab"),
    subject("ME203", "Computer Aided Drawing", ME, [1, 0, 3], "Computer Lab", 3),
    subject("CS301", "Operating Systems", CSE, [3, 0, 2], "Computer Lab"),
    subject("CS302", "Database Systems", CSE, [3, 0, 2], "Computer Lab"),
    subject("CS303", "Theory of Computation", CSE, [3, 1, 0]),
    subject("EC301", "Communication Systems", ECE, [3, 0, 2], "Electronics Lab"),
    subject("EC302", "Microprocessors", ECE, [3, 0, 2], "Electronics Lab"),
    subject("EC303", "Control Systems", ECE, [3, 1, 0]),
    subject("ME301", "Fluid Mechanics", ME, [3, 0, 2], "Mechanical Lab"),
    subject("ME302", "Manufacturing Processes", ME, [3, 0, 2], "Workshop"),
    subject("ME303", "Machine Design", ME, [3, 1, 0]),
    subject("OE301", "Introduction to AI", CSE, [3, 0, 0]),
    subject("OE302", "Internet of Things", ECE, [3, 0, 0]),
    subject("OE303", "Renewable Energy Systems", ME, [3, 0, 0]),
  ];

  let n = 0;
  const offer = (code: string, sec: string, teachersKeys: string[], labKeys: string[] = [], basketId: string | null = null, sectionIds?: string[]): OfferingInput => ({
    id: id(`o-${++n}`),
    subjectId: id(`sub-${code.toLowerCase()}`),
    sectionIds: sectionIds ?? [S(sec)],
    teacherIds: teachersKeys.map(T),
    labTeacherIds: labKeys.map(T),
    batchwiseLab: true,
    basketId,
    expectedSize: null,
  });
  const basket = { id: id("bk-oe3"), name: "Open Elective (3rd year)", sectionIds: [S("cse3a"), S("ece3a"), S("me3a")] };
  const offerings: OfferingInput[] = [
    // 1st year (Applied Sciences runs the common year)
    offer("MA101", "fya", ["meera"]), offer("MA101", "fyb", ["meera"]), offer("MA101", "fyc", ["arjun"]),
    offer("PH101", "fya", ["kavita"], ["neha"]), offer("PH101", "fyb", ["kavita"], ["neha"]), offer("PH101", "fyc", ["neha"]),
    offer("CY101", "fya", ["sanjay"], ["pooja"]), offer("CY101", "fyb", ["sanjay"], ["pooja"]), offer("CY101", "fyc", ["pooja"]),
    offer("CS101", "fya", ["vikram"]), offer("CS101", "fyb", ["priya"]), offer("CS101", "fyc", ["priya"], ["simran"]),
    offer("ME101", "fya", ["jaspreet"]), offer("ME101", "fyb", ["jaspreet"]), offer("ME101", "fyc", ["jaspreet"]),
    offer("HS101", "fya", ["ritu"]), offer("HS101", "fyb", ["ritu"]), offer("HS101", "fyc", ["ritu"]),
    // 2nd year
    offer("MA201", "cse2a", ["harpreet"]), offer("MA201", "cse2b", ["harpreet"]),
    offer("MA201", "ece2a", ["arjun"]), offer("MA201", "me2a", ["arjun"]),
    offer("HS201", "cse2a", ["ritu"]), offer("HS201", "cse2b", ["ritu"]), offer("HS201", "ece2a", ["ritu"]), offer("HS201", "me2a", ["ritu"]),
    offer("CS201", "cse2a", ["anita"]), offer("CS201", "cse2b", ["rohit"]),
    offer("CS203", "cse2a", ["vikram"]), offer("CS203", "cse2b", ["simran"]),
    offer("CS204", "cse2a", ["rajesh"]), offer("CS204", "cse2b", ["rajesh"]),
    offer("EC201", "ece2a", ["farah"], ["ananya"]), offer("EC202", "ece2a", ["suresh"]), offer("EC203", "ece2a", ["gurpreet"]),
    offer("ME201", "me2a", ["balwinder"]), offer("ME202", "me2a", ["karan"]), offer("ME203", "me2a", ["deepak"]),
    // 3rd year
    offer("CS301", "cse3a", ["anita"]), offer("CS302", "cse3a", ["rohit"]), offer("CS303", "cse3a", ["rajesh"]),
    offer("EC301", "ece3a", ["farah"]), offer("EC302", "ece3a", ["gurpreet"]), offer("EC303", "ece3a", ["suresh"]),
    offer("ME301", "me3a", ["karan"]), offer("ME302", "me3a", ["jaspreet"], ["deepak"]), offer("ME303", "me3a", ["balwinder"]),
    // Open elective basket: all three run at the same time for CSE-3A + ECE-3A + ME-3A
    offer("OE301", "", ["priya"], [], basket.id, basket.sectionIds),
    offer("OE302", "", ["ananya"], [], basket.id, basket.sectionIds),
    offer("OE303", "", ["balwinder"], [], basket.id, basket.sectionIds),
  ];

  return {
    name: "Demo Institute of Technology",
    days,
    periods,
    passingMinutes: 5,
    rules: {
      maxConsecutiveSection: 4,
      maxConsecutiveTeacher: 3,
      travelTimeHard: true,
      roomUtilizationMode: "compact",
      weights: { teacherPrefs: 2, balancedDays: 2, idleGaps: 2, subjectSpread: 3, roomUtilization: 1 },
    },
    departments,
    buildings,
    rooms,
    grids,
    teachers,
    sections,
    subjects,
    offerings,
    baskets: [basket],
  };
}
