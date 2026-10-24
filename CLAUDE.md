# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Safety Rules

- Do not perform any git commands without asking first.
- Never read the `.env` file. Instead, use `.env.example` as the reference for any environment-related activities.

> Exception granted by the user for this project: `git init` and a local commit after each working
> step are pre-approved. `git push`, adding remotes and destructive git operations still need asking.

@AGENTS.md

## What this is

**Scheduling Optimizer**: a multi-college web app that generates clash-free college timetables
(J-PAL South Asia hackathon). Full spec and phased roadmap: `docs/PLAN.md`.

## Commands

- `npm run dev` starts the dev server (Next.js 16, Turbopack)
- `npm test` runs Vitest (solver unit and property tests)
- `npm run lint` runs ESLint
- `npx prisma migrate dev` applies schema changes to the local DB
- `npm run db:seed` loads the demo college

## Architecture

- `src/lib/solver/` holds the pure TypeScript solver. It has **no DB/Next imports**, so it runs in a Web Worker
  (`src/workers/solver.worker.ts`), on the server (validation) and in tests.
  - `types.ts` defines the problem model (slots, lessons, rooms, student "atoms").
  - `lessons.ts` expands offerings (L-T-P or hours/week, batches) into schedulable lessons.
  - `construct.ts` places lessons most-constrained-first, with backtracking and restarts.
  - `validate.ts` is the independent hard-constraint checker. Nothing is saved unless it reports 0 violations.
  - `explain.ts` contains the feasibility pre-checks and the reasons an unplaced lesson was blocked.
- Student clashes use **atoms**: each batch (or a section with no batches) is an atom. A section lesson
  occupies all its atoms, and a batch lesson occupies one.
- `src/lib/setup/` is the setup wizard's pure logic: zod row schemas (`schemas.ts`), CSV/Excel import mapping,
  export and templates (`import.ts`), and conversions between wizard rows and the solver input (`convert.ts`).
  Server actions live in `src/app/[inst]/setup/actions.ts`; each save is a diff in one transaction, checks
  ids belong to the institute, refuses the read-only `/demo`, and blocks deletes that would cascade.
- `npm run samples` regenerates `public/samples/*.csv` from the demo college.
- Every DB row carries `institutionId` (multi-college tenancy).

## Conventions

- Hard rules must never be violated in a saved timetable. Soft rules only affect the score.
- Each constraint has both a `check` and a human-readable explanation. Keep the messages
  admin-friendly (names, not ids).
