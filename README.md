# Scheduling Optimizer

Clash-free college timetables for **any** institute, generated in seconds. Built for the
J-PAL South Asia × Punjab Jobs AI Bootcamp hackathon.

Most colleges still build timetables by hand. It takes weeks, departments fight over shared
labs, and the result still has clashes. Scheduling Optimizer takes the college's real
structure and rules and produces one timetable for the whole institute. Every hard rule is
re-verified by an independent checker, and when something cannot fit, the app says **why**
in plain English.

## What it handles

| Real-college need | How |
|---|---|
| No clashes | Teachers, rooms, sections and lab batches are never double-booked. An independent validator re-checks on the server before saving. |
| L-T-P workloads | `3-1-2` expands into 3 lectures, 1 tutorial and a 2-period lab block per batch. Hours/week mode is available too. |
| Lab batches | Sections split into G1/G2. Batches can be in different labs at the same time. |
| Long lab blocks | 2- or 3-period practicals stay consecutive and never cross a break. |
| Open electives | A basket of electives runs in parallel for several sections. |
| Staggered lunch / half Saturday | Each program/year gets its own time grid on a shared bell schedule. |
| Shared vs department rooms | Department-owned rooms go to that department first, then common rooms. Seminar halls are never used for classes. |
| Room type and size | Computer Lab subjects get a Computer Lab big enough for the batch. |
| Teacher limits | Max periods per day and per week (by designation), unavailable slots, max back-to-back. |
| Walking time | Consecutive classes in far-apart buildings are not allowed when the gap is too short. |
| Quality | Soft goals: teacher preferences, balanced days, fewer idle gaps, the same subject not twice a day, room use. |
| **Explains failure** | Pre-checks find impossible setups (e.g. "CSE-2A needs 34 periods but has 30"), and unplaced classes come with reasons such as "22 of 35 slots: Dr. X already teaching". |
| Printing | A4 landscape section, faculty and room timetables with a subject and faculty key. |

## Try it

- **Try it with a sample college** (free account) creates your own copy of the demo college
  (4 departments, 22 teachers, 10 sections, 3 buildings) with you as its admin. Then click
  **Generate**, **Save as draft**, and switch between section, teacher and room views.
- **Set up your college** starts from scratch: name, working days and bell schedule, then a
  10-step setup wizard (time grids, departments, rooms, teachers, sections, subjects,
  allocation, rules, review). Every list can be typed into a spreadsheet-style table or
  imported from **CSV or Excel (.xlsx)**. Each import dialog offers an empty template and a
  filled-in sample from [`public/samples/`](public/samples/). Re-importing updates matching
  rows instead of duplicating them.
- The shared `/demo` can be viewed without an account but not changed; **Make my own copy** gives
  you an editable one.

Once a timetable is generated:

- **Edit by hand**: pick or drag a class; every slot shows move (green), swap (blue), allowed
  but lowers quality (amber) or not allowed (red, with the reason). Moved classes are pinned;
  **Re-solve around pins** rearranges the rest. Saves are re-validated on the server.
- **Review and publish**: the admin sends a draft for review, each department's HOD approves or
  requests changes (with a comment), and the Head of Institute publishes. Publishing archives
  the previous timetable. Teachers, students and staff only ever see published timetables.
- **Share**: a public read-only link and QR code (with a printable poster) for one section,
  teacher or room, or the whole college. Links can follow the latest published timetable.
  On phones the timetable becomes a day-by-day list.

Day to day:

- **Calendar**: term dates, holidays, exam days and swaps ("Saturday follows Monday").
- **Today**: any date's classes from the published timetable after the calendar, with
  substitutions and cancellations shown.
- **Absences**: mark a teacher absent (or report yourself); each missed class gets ranked
  substitutes who are free, present and under their daily limit (same subject first, then
  department, then whoever has covered least this month), or can be cancelled. The substitute,
  the absent teacher and the affected students get an in-app notification (bell icon).

- **Room use**: a heatmap of every room across the week (busy, free, closed), with average
  use, rooms under 30%, never-used rooms and the busiest slot; filter by building, type or
  owner, or switch to a table.
- **Venues**: book a seminar hall any time, or any room while it has no class, from a rooms ×
  periods grid of the chosen date (published timetable after the calendar and cancellations).
  Requests go to the HOD for department rooms and to the Venue Manager for common rooms and
  halls (the admin stands in if there is none); approvers booking their own rooms are approved
  at once. Overlaps resolve by priority (Institute > Placement > Department > Club): the losing
  request is declined or bumped and its requester is notified with free rooms that fit. Only
  the Head of Institute can book over classes. Approved events show on Today.
- **Office hours**: teachers open free periods of the published timetable (their classes and
  breaks can't be picked), split into 10/15/20-minute slots with a per-student weekly limit and
  a location. Students book up to two weeks ahead, their own teachers listed first; dates go
  through the academic calendar (holidays, day swaps). Leave, cover duty or a newly published
  timetable calls off clashing bookings and tells the student and the teacher why.
- **Placement drives** (Placement Officer): company, role, rounds with date, periods and venue
  (requested automatically at Placement priority through the venue rules), and who takes part:
  sections filtered by department and year with a headcount each, or a pasted list of
  "roll number, section". The impact report shows each section's students away and classes
  affected, and every class that loses students ("20/64 away"; lab batches get their share).
  Teachers see "10/32 away for the Infosys placement drive" on Today; students see the drives
  their section is in. Teachers and students are notified when rounds are set or moved.
- **Elective registration**: for each elective basket the admin (or the HOD, for a basket
  within one department) opens a window with seat limits; students of the basket's sections
  choose, switch or withdraw while it is open (seats checked in a serializable transaction).
  Live counts per elective and per section; then the counts become the electives' class
  sizes, as registered or scaled to every student within the seat limits, with warnings when
  an elective outgrows its rooms or nobody chose it. The next solve plans rooms for them.
- **Labs**: lab assistants (for one department's labs, or the common labs), the Venue Manager
  and the admin mark rooms out of service for a date range, all day or some periods. Classes
  due there are listed with free rooms of the same type and size to move them to for that day
  (teachers and students are told; Today shows the new room), bookings in that time are called
  off, and the room can't be booked meanwhile. A lab schedule shows each lab's day.
- **Lunch by department** (Setup → Time grids): give each department its own lunch period, or
  spread them automatically over a lunch window so about the same number of students eat at a
  time. A chart shows students at lunch per period, now and with the plan. Sections move to a
  copy of their grid with the new lunch (half days and other breaks kept); the next solve
  plans around it.
- **Rules in your own words** (Setup → Rules): type "Dr. Rao is not available on Friday
  afternoons", "No labs on Saturday", "First years only have classes in the morning" or "Max 3
  classes in a row for teachers". A built-in reader understands teachers, sections, years,
  subjects, departments, labs/lectures, days, periods, clock times and morning/after lunch, for
  free. Only when it can't does the admin get an **Ask Claude** (or **Ask Grok**) button. The
  admin always confirms a summary generated from the structured rule (not written by the AI),
  can switch it between "must" and "try to", and is warned if it would leave a class no time.
  Hard rules are enforced by the solver and the validator; "try to" rules lower the score.

### Roles

| Role | Can |
|---|---|
| Institute Admin | Everything: setup, generate, hand-edit drafts, send for review, people & invites |
| Head of Institute | View drafts and setup, publish approved timetables |
| Head of Department | Edit their own department's teachers, programs, sections, subjects and allocation; sign off timetables |
| Teacher / Student | **My timetable** (their own, from the published version) and published timetables |
| Placement Officer, Venue Manager, Lab Assistant | Published timetables (their own modules are on the roadmap) |

The admin invites people from **People**: one link per person (copy, WhatsApp or CSV export),
or **Invite all teachers** in one click. Links work once and expire after 14 days. If a
college has no Head of Institute, the admin can publish.

Setup tips that matter for real colleges:

- Teacher load limits fill in from the designation (Professor 14, Associate 16, Assistant 18
  periods/week) and can be overridden. **Availability** marks never/prefer/rather-not slots.
- Staggered lunch = two time grids with a different closed period; each section picks one.
- Elective baskets make electives of several sections run at the same time.
- The allocation step shows every teacher's load live, and the review step links each
  readiness problem to the step that fixes it.
- **Suggest teachers** fills subjects that have no teacher: whoever already teaches the subject,
  then its department, spreading load evenly and never over anyone's weekly limit. You review
  and tick suggestions before they're saved.

## Setup

Requirements: Node 20+ and PostgreSQL (local, or [Neon](https://neon.tech) for deployment).

```bash
npm install                 # also generates the Prisma client
cp .env.example .env        # then set DATABASE_URL (and BETTER_AUTH_SECRET for production)
npx prisma migrate dev      # create tables
npm run db:seed             # load the demo college at /demo
npm run dev                 # http://localhost:3000
```

For local testing of roles, `npx tsx scripts/seed-dev-users.ts <college-slug>` creates one
account per role (admin, HOI, CSE HOD, teacher, a 2nd- and a 3rd-year student, placement officer, CSE lab assistant) in that college; the shared dev
password is in the script. Never run it against production.

Optional AI fallback for plain-English rules: set `LLM_PROVIDER` (`anthropic` or `xai`) and
`ANTHROPIC_API_KEY` or `XAI_API_KEY` (see `.env.example`). Without a key the built-in reader
still works. Each AI call is logged in the `AiCall` table, which is also the cache: the same
sentence is never sent twice, and calls are capped at 30 per college per day. Claude runs at
low effort with Anthropic's server-side refusal fallback enabled; `ANTHROPIC_MODEL` can be set
to a cheaper model such as `claude-haiku-5-5`.

Real college data: `data/gndec/` holds importable CSVs for GNDEC Ludhiana built from its public
website (faculty directory, sanctioned intake and the CSE/IT timetables); `data/gndec/REPORT.md`
says what is real, what is estimated and what was left out. `npm run gndec:build` refreshes them
from the site and `npm run gndec:verify` imports them and solves.

Tests and checks (see [`docs/TESTING.md`](docs/TESTING.md) for the plan and latest results):

```bash
npm test                  # unit + property tests (Vitest)
npm run test:integration  # server actions on a separate <db>_test database
npm run test:e2e          # browser tests in Edge against the dev server (needs the dev accounts)
npm run typecheck
npm run lint
```

## Deploying (Vercel + Neon)

1. Create a Neon project and copy its pooled connection string.
2. Import the repo in Vercel and set the environment variables: `DATABASE_URL` (Neon),
   `BETTER_AUTH_SECRET` (`openssl rand -base64 32`; login won't work without it) and
   `BETTER_AUTH_URL` (the Vercel URL).
3. Run `npx prisma migrate deploy` and `npm run db:seed` once against the Neon database
   (`npm run db:prod -- npx prisma migrate deploy` uses `PROD_DB_URL` from `.env`).
4. Deploy. The solver runs in the browser (Web Worker), so there are no serverless timeouts.

## Architecture

```
src/lib/solver/      Pure TypeScript solver (no DB or framework imports)
  types.ts           Problem model
  lessons.ts         Offerings -> lessons (L-T-P, batches, elective baskets)
  engine.ts          Index-based state, feasibility checks, soft cost, failure reasons
  construct.ts       Iterative forward search (place hardest first, eject conflicts) + local improvement
  validate.ts        Independent hard-rule checker (used by tests, server save, version view)
  explain.ts         Feasibility pre-checks with fixes
  score.ts           Soft-goal penalties -> 0-100 quality
  custom-rules.ts    Plain-English rules resolved to forbidden / avoided slots per lesson
src/lib/rules/       Plain-English rules: built-in parser, summaries, AI prompt + name resolution, Claude/Grok calls
src/lib/setup/       Setup wizard logic: row schemas (zod), CSV/Excel import + export, conversions
src/components/setup/ Editable table, import dialog, slot matrix, wizard steps
src/workers/         Web Worker wrapper with progress messages
src/lib/appointments.ts Office hours: sub-slots, busy periods per date, open slots, weekly limits
src/lib/placements.ts Placement drives: roll-list parsing, classes hit per round, section impact
src/lib/electives.ts Elective registration: windows, seat checks, counts -> class sizes
src/lib/downtime.ts  Rooms out of service: who may mark them, classes hit, replacement rooms
src/lib/venues.ts    Venue booking rules: class use per date, conflicts, priorities, approvers, alternatives
src/lib/permissions.ts Role -> action matrix (pure, unit-tested); src/lib/access.ts applies it per request
src/lib/auth.ts      Better Auth (email + password, optional Google), sessions in Postgres
src/lib/institute.ts DB <-> solver mapping (Prisma 7 + Postgres)
src/app/             Next.js 16 App Router pages, server actions
```

Every database row carries `institutionId`, so one deployment serves many colleges.

## Roadmap

The full spec is in [`docs/PLAN.md`](docs/PLAN.md). Phases 1–4 are complete; deployment to Vercel + Neon is next.
