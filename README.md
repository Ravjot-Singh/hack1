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

- **Try it with a sample college** creates your own copy of the demo college (4 departments,
  22 teachers, 10 sections, 3 buildings). Then click **Generate**, **Save as draft**, and switch
  between section, teacher and room views.
- **Set up your college** starts from scratch: name, working days and bell schedule, then a
  10-step setup wizard (time grids, departments, rooms, teachers, sections, subjects,
  allocation, rules, review). Every list can be typed into a spreadsheet-style table or
  imported from **CSV or Excel (.xlsx)**. Each import dialog offers an empty template and a
  filled-in sample from [`public/samples/`](public/samples/). Re-importing updates matching
  rows instead of duplicating them.
- The shared `/demo` is read-only; **Make my own copy** gives you an editable one.

Setup tips that matter for real colleges:

- Teacher load limits fill in from the designation (Professor 14, Associate 16, Assistant 18
  periods/week) and can be overridden. **Availability** marks never/prefer/rather-not slots.
- Staggered lunch = two time grids with a different closed period; each section picks one.
- Elective baskets make electives of several sections run at the same time.
- The allocation step shows every teacher's load live, and the review step links each
  readiness problem to the step that fixes it.

## Setup

Requirements: Node 20+ and PostgreSQL (local, or [Neon](https://neon.tech) for deployment).

```bash
npm install                 # also generates the Prisma client
cp .env.example .env        # then set DATABASE_URL
npx prisma migrate dev      # create tables
npm run db:seed             # load the demo college at /demo
npm run dev                 # http://localhost:3000
```

Tests and checks:

```bash
npm test          # solver unit + property tests (Vitest)
npm run typecheck
npm run lint
```

## Deploying (Vercel + Neon)

1. Create a Neon project and copy its pooled connection string.
2. Import the repo in Vercel and set `DATABASE_URL` in the project's environment variables.
3. Run `npx prisma migrate deploy` and `npm run db:seed` once against the Neon database.
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
src/lib/setup/       Setup wizard logic: row schemas (zod), CSV/Excel import + export, conversions
src/components/setup/ Editable table, import dialog, slot matrix, wizard steps
src/workers/         Web Worker wrapper with progress messages
src/lib/institute.ts DB <-> solver mapping (Prisma 7 + Postgres)
src/app/             Next.js 16 App Router pages, server actions
```

Every database row carries `institutionId`, so one deployment serves many colleges.

## Roadmap

The full spec is in [`docs/PLAN.md`](docs/PLAN.md). Next phases: drag-and-drop editing with live rule checks, roles (Institute Admin, HOD, Teacher,
Student, Placement Officer, Venue Manager, Lab Assistant) with approval workflow,
plain-English rules via Claude, utilization heatmap, substitutions, academic calendar,
venue booking, teacher appointments and placement drives.
