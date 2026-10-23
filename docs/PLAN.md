# Plan: Scheduling Optimizer (college timetable web app)

## Context
J-PAL South Asia hackathon brief (`brief.pdf`): build a web app that produces clash-free college
timetables for **any** college. Judged on: core correctness (no clashes) > usability (admin can use
unaided) > design/readability > advanced cases > real-college relevance. Submission = GitHub repo
(README, CLAUDE.md, small commits) + live deployed link. 120 min in class, but the user is building
over **multiple days** toward a full multi-role platform. Working dir `D:\jpal\hack1` is empty
(greenfield, not yet a git repo).

## Decisions (from Q&A)
| Area | Decision |
|---|---|
| Stack | Next.js (App Router) + TypeScript, Tailwind + shadcn/ui, dnd-kit, Prisma, Postgres (Neon on Vercel; local Postgres 18 for dev) |
| Solver | Constraint solver in TS (construct with backtracking, then improve with simulated annealing) running in a **browser Web Worker** with live progress; server re-validates before saving |
| Tenancy | Multi-college: every row has `institutionId`; signup creates an institute |
| Hierarchy | Institute → Department → Program → Year/Semester → Section → Batch; Elective **cohorts** span sections |
| Time grid | Institute default + per-program/year override (staggered breaks, Sat full/half/alternate) |
| Rooms | Dept-owned (priority) + common pool; seminar halls/auditoriums = event venues (never used by the solver) |
| Workload | L-T-P (default) or simple hours/week, chosen per program |
| Workflow | HODs enter dept data → Institute Admin runs ONE institute-wide solve → HOD review → HOI publishes; versioned |
| Allocation | HOD assigns teacher↔subject-section; "Suggest" proposes a balanced allocation |
| Auth | Auth.js: email+password, optional Google; invite links + bulk CSV invites |
| Data input | Setup wizard + CSV/Excel import (row validation, preview) + one-click demo college seed |
| Output | Print/PDF (A4 landscape per section/teacher/room) + public read-only share link + QR |
| Live ops | Teacher absence → substitute suggestions; academic calendar (holidays, exam weeks, day-order swaps) |
| Standout | **Explain-why-it-fails**, **Drag-edit with live validity**, **Plain-English rules via Claude**, **Room utilization heatmap** |
| Modules | Venue booking (request + priority + approval), teacher appointments (auto from free periods), placement drives (drive + class impact), elective registration |

Not chosen (out of scope unless revisited): fairness report, version diff, iCal, Excel export,
copy-last-semester, email notifications. A minimal **in-app** notification inbox is still needed
for bookings and substitutions.

## Roles & permissions (predefined, scoped to the institute)
| Capability | Inst Admin | HOI | HOD | Teacher | Student | Placement | Venue Mgr | Lab Asst |
|---|---|---|---|---|---|---|---|---|
| Institute setup, grid, rooms, users | ✔ | view | – | – | – | – | rooms | – |
| Dept data: subjects, sections, allocation | ✔ | view | own dept | – | – | – | – | – |
| Teacher prefs / unavailability | ✔ | – | own dept | self | – | – | – | – |
| Run solve, drag-edit drafts | ✔ | – | – | – | – | – | – | – |
| Review / sign off dept | – | – | own dept | – | – | – | – | – |
| Publish version | – | ✔ | – | – | – | – | – | – |
| Absence + substitution | ✔ | – | own dept | mark self absent | – | – | – | – |
| Request venue | ✔ | ✔ | ✔ | ✔ | – | ✔ | ✔ | – |
| Approve venue | – | override | owned rooms | – | – | – | common/venues | – |
| Placement drives | – | view | view | view impact | view own | ✔ | – | – |
| Office hours / appointments | – | – | – | manage own | book | – | – | – |
| Elective registration | configure | – | configure dept | – | register | – | – | – |
| Lab downtime | ✔ | – | – | – | – | – | ✔ | own lab |

Enforce the matrix in one place (`lib/auth/permissions.ts`, `can(user, action, resource)`) and use it in both server actions and the UI.

## Data model (Prisma, all rows carry `institutionId`)
- **Org:** Institution, Department, Program(workloadMode: LTP|HOURS), AcademicTerm, Building(travel matrix minutes), Room(type, capacity, buildingId, ownerDeptId?, isEventVenue)
- **Time:** TimeGrid(days, periods[{index,start,end,kind: CLASS|BREAK}]), GridAssignment(programId/year → gridId)
- **People:** User(role, deptId?), Teacher(designation, maxPerDay, maxPerWeek, deptId), Student(roll, sectionId, batchId)
- **Academic:** Section(programId, year, size), Batch(sectionId, size), Subject(code, L, T, P, hoursPerWeek, roomTypeReq, labBlockLen), Offering(subject + section|cohort, teacherIds[], batchwise P), ElectiveBasket(sections[], offerings[] run in parallel), ElectiveChoice(student → offering, seat limits)
- **Rules:** Constraint(kind, scope{level,id}, params JSON, hard|soft, weight, source: UI|NL). This single JSON representation is used by the wizard, the NL parser and the solver.
- **Availability:** TeacherSlotPref(teacherId, day, period, value: UNAVAILABLE|AVOID|PREFER), RoomDowntime(roomId, dateRange, reason)
- **Timetable:** TimetableVersion(status: DRAFT|REVIEW|APPROVED|PUBLISHED|ARCHIVED, score, stats), Placement(versionId, lessonId, day, period, roomId, pinned), DeptSignoff(versionId, deptId, status, comment)
- **Live layer:** CalendarDay(date, type: HOLIDAY|EXAM|DAY_ORDER, followsDay?), Absence(teacherId, date, periods), Override(date, placementId, action: SUBSTITUTE|CANCEL|MOVE|ROOM_CHANGE, data)
- **Modules:** VenueBooking(roomId, start, end, requesterId, priorityClass, status), OfficeHours(teacherId, day, period, slotMinutes), Appointment, PlacementDrive(rounds[], eligible students, venue bookings), Notification
- **Sharing:** ShareLink(token, target: section|teacher|room, versionId|live)

## Solver design (`src/lib/solver/`, pure TS, no DB imports, so it runs in a worker and on the server)
1. **`lessons.ts`: expand offerings into lessons.** L-T-P 3-1-2 with 2 batches becomes 3×L (section, 1 period) + 1×T + 2×P (one per batch, `labBlockLen` consecutive periods, lab room type). An elective basket becomes a *group* of lessons that must share the same slots.
2. **Student-conflict "atoms".** Each batch is an atom; a section lesson takes all of its atoms; a batch lesson takes one; an elective basket takes the atoms of all member sections. Clash checks are bitset ops on teacher/room/atom × slot.
3. **Hard constraints** (each in `constraints/*.ts` with `check()` + `explain()`): no teacher/room/atom double-booking; room type + capacity; teacher unavailability; teacher max load/day (max/week checked before solving); max back-to-back (section & teacher); practical blocks are consecutive and never span a break; building travel time between consecutive periods; grid validity (no lessons in breaks); pinned placements; room downtime.
4. **Soft goals** (weighted, with admin sliders Off/Low/Med/High): teacher preferences, balanced days (variance of daily load), max idle gaps for students, room utilization (compact vs spread mode), travel minimization.
5. **`construct.ts`:** most-constrained-first ordering (baskets, lab blocks, then fewest feasible slots) with forward checking, limited-discrepancy backtracking and randomized restarts.
6. **`improve.ts`:** simulated annealing over feasible-only moves (move, swap, room change, Kempe-chain swap), time-boxed, posting `{iteration, hardViolations, score}` to the UI.
7. **`validate.ts`:** an independent full checker shared by worker, server save route and tests. The server never saves a version with hard violations.

## Standout features
- **Explain why it fails** (`feasibility.ts`, `explain.ts`)
  - Live pre-checks while data is entered: section demand vs available slots; teacher assigned hrs vs max/availability; lab slot-hours demand vs supply per room type; lessons with no room of the right type/capacity; basket size vs room capacity. Each check shows a plain sentence and a "Fix →" deep link.
  - After a solve: for every unplaced lesson, summarize why each candidate slot was blocked (e.g. "22/30 slots: Dr. Sharma busy; 8/30: no free CS lab").
  - Relaxation probe: re-solve with one hard rule relaxed at a time and report "Allowing 4 back-to-back instead of 3 makes it solvable".
- **Drag-edit:** section/teacher/room grids; while dragging, every cell is colored green (ok), amber (soft penalty, shows Δscore) or red (hard rule, tooltip says which) using the same constraint module. Dropping a lesson pins it; dropping onto a filled cell swaps the two if both moves are valid. Undo/redo; "Re-solve around pins".
- **Plain-English rules:** `POST /api/rules/parse` calls Claude (`claude-sonnet-5-5`, structured tool output matching the zod `Constraint` schema). The prompt includes the institute's entity names for resolution. The UI shows "I understood: …" for the admin to confirm before saving. `ANTHROPIC_API_KEY` is server-only. Load the `claude-api` skill when implementing.
- **Utilization heatmap:** room × slot grid colored by occupancy %, filterable by building/type/dept, with summary stats (avg utilization, rooms < 30% used, peak hour).

## Live operations & modules
- **Date view** = base published version + calendar (holiday/exam/day-order) + overrides + approved events. Every role's "Today" screen uses it.
- **Absence:** affected lessons are listed with ranked substitute suggestions: free in that period, same dept/subject competence, under daily max, fewest subs this month. Other options are swapping with another lesson of the same section that day, or cancelling. Affected users get in-app notifications.
- **Venue booking:** event venues, plus any room during its free periods. Requests go to the owner (HOD for owned rooms, Venue Mgr for common rooms/venues). Overlapping requests resolve by priority Institute > Placement > Department > Club, and the loser is shown alternatives. Class slots are blocked unless the HOI overrides.
- **Appointments:** teacher toggles office hours on free periods of the published timetable, with 10/15/20-min sub-slots and N bookings/student/week. If the timetable changes, invalidated bookings are flagged and notified.
- **Placement drives:** company, dates, rounds with times and venue (auto-requested at Placement priority), eligible students by filter or CSV of roll numbers. The impact report shows classes overlapped per section and student counts, and teachers see "12/60 away for drive".
- **Elective registration:** windows with seat limits. Final counts set cohort sizes for the solver (room capacity check).
- **Lab Assistant:** view lab schedules; mark downtime, which feeds into RoomDowntime and conflict alerts.

## Pages (App Router)
`/` landing + "Try demo college" · `/signup`, `/login`, `/invite/[token]` · `/[inst]/setup/*` wizard (Institute → Time grids → Departments → Buildings & rooms → Teachers → Programs/sections/batches → Subjects → Electives → Allocation → Rules → Readiness checklist) · `/[inst]/import` · `/[inst]/solve` (live progress, explanations) · `/[inst]/timetable/[version]` (section|teacher|room views, drag-edit, review/sign-off/publish) · `/[inst]/today` · `/[inst]/absences` · `/[inst]/calendar` · `/[inst]/venues` · `/[inst]/appointments` · `/[inst]/placements` · `/[inst]/electives` · `/[inst]/insights` (heatmap) · `/s/[token]` public share · print routes with `@media print`.

## Build phases (each ends deployed + committed)
- **Phase 0, in-class 120 min (submission-safe):** scaffold; run the `project-safety-rules` skill; CLAUDE.md + README; Prisma core models (Institution…Offering, TimeGrid, Version, Placement) with `institutionId`; demo-college seed; solver v1 (lessons, atoms, core hard constraints, construct) in a Web Worker; validator; section/teacher/room grid views; print CSS; deploy Vercel + Neon.
- **Phase 1, correctness depth:** wizard + CSV import; L-T-P/batches/electives baskets; per-program grids; all hard rules; soft scoring + annealing; feasibility pre-checks + explain-failure + relaxation probe; heatmap.
- **Phase 2, roles & workflow:** Auth.js, invites, permission matrix, multi-tenant routing, version lifecycle + HOD sign-off + publish; drag-edit; share links + QR; allocation "Suggest".
- **Phase 3, live operations:** academic calendar, date view, absences/substitutes, NL rules via Claude, in-app notifications.
- **Phase 4, modules:** venue booking, appointments, placement drives, elective registration, lab assistant.

## Verification
- **Vitest unit tests** per constraint (check + explain), lesson expansion (L-T-P, batches, baskets) and feasibility messages.
- **Property test:** generate random colleges (seeded), solve, and assert `validate()` reports 0 hard violations. Infeasible generated cases must produce at least one explanation.
- **Benchmarks:** demo college (4 depts, ~30 teachers, ~20 rooms) solves in under 10 s. A large synthetic college (10 depts, ~120 sections) completes within the time box with a clear progress UI.
- **Playwright e2e:** load demo → solve → drag a lesson (red cell rejected, green accepted) → publish → open the public share link → print view.
- **Manual:** `npm run dev` with the in-app browser preview; check light/dark and mobile widths; confirm the deployed Vercel URL works with a Neon DB.
- **Git:** the brief wants small commits, and the user's safety rule says to ask before git commands. Confirm at implementation start whether commits after each working step are pre-approved.
