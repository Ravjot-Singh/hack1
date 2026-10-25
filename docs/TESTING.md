# Testing

How the Scheduling Optimizer is tested, layer by layer, and how to run each layer.

| Layer | What it proves | Where | Command |
|---|---|---|---|
| 1. Unit | Each pure rule gives the right answer and the right message | `src/**/*.test.ts` | `npm test` |
| 2. Property / fuzz | Invariants hold for hundreds of random inputs (seeded, reproducible) | `src/**/*.property.test.ts` | `npm test` |
| 3. Integration | Server actions + permissions + a real Postgres database work together | `tests/integration/*.test.ts` | `npm run test:integration` |
| 4. End-to-end | Real pages in a real browser, through the dev server | `e2e/*.spec.ts` | `npm run test:e2e` |
| 5. Performance | The solver stays inside its time budget on small and large colleges | `scripts/bench.ts` | `npx tsx scripts/bench.ts` |
| 6. Static | Types, lint rules and a production build | – | `npm run typecheck`, `npm run lint`, `npm run build` |

## 1. Unit tests

Pure modules have no database or framework imports, so they are tested directly.

| Area | Module | Cases |
|---|---|---|
| Solver | `lessons`, `engine`, `construct`, `solve` | L-T-P expansion, batches, baskets; demo college solves with 0 violations |
| Validator | `validate` | Every hard rule is detected on a hand-broken timetable: teacher, room and student clashes, room type, capacity, closed periods, teacher unavailable, daily/weekly load, back-to-back limit, pins, split baskets, walking time, custom rules |
| Score | `score` | Quality is 0–100; each soft goal moves its penalty in the expected direction |
| Pre-checks | `explain` | Overloaded teacher, missing room type, impossible rule are reported with fixes |
| Hand edits | `edit` | Move/swap/blocked options; pins respected |
| Custom rules | `custom-rules`, `rules/parse`, `rules/draft`, `rules/ai-spec` | Parser reads/refuses sentences; summaries; AI answers resolved to ids, unknown names refused |
| Setup | `setup/*` | CSV/Excel mapping, aliases, errors with row numbers, bell schedule, suggest-teachers, step routing |
| Live operations | `calendar`, `cover`, `utilization` | Holidays, swaps; substitute ranking; room-use stats |
| Phase 4 modules | `venues`, `appointments`, `placements`, `electives`, `downtime` | Conflicts and priorities, slot maths, impact counts, seat limits, downtime scope |
| Permissions | `permissions` | The full role × action matrix, HOD scoping |

## 2. Property and fuzz tests

Seeded random generators (`mulberry32`) make failures reproducible: the seed is in the test name.

- Any feasible random college (with random custom rules) solves with **0 violations** by the independent validator.
- The parser **never throws** on random text or random word salads, and anything it accepts has days/periods in range.
- Elective sizes never exceed seat limits and never exceed the number of students.
- Venue alternatives are always really free; appointment slots are never in busy periods or double booked.

## 3. Integration tests

Run the real server actions against a **separate test database** (`<your DATABASE_URL database>_test`, created and migrated
automatically; the runner refuses any database whose name doesn't end in `_test`). Only the sign-in session is faked
(`tests/integration/setup.ts`), so permission checks, tenancy checks and database constraints are all real.

| Scenario | Checks |
|---|---|
| Tenancy | A member of college A can't touch college B's rooms, drives or bookings |
| Permissions | Wrong roles are refused by every action (students can't book rooms, HODs can't approve other departments' rooms) |
| Venue booking | Request → approver notified → approve → lower-priority overlap declined with alternatives; class slots refused |
| Office hours | Save hours, book, weekly limit, two students racing for one slot (one wins), leave calls bookings off |
| Electives | Window, choose, switch, last seat race, apply counts → offerings' class sizes |
| Placement drives | Roll list → counts, venue requested at Placement priority, round removed → booking withdrawn |
| Lab downtime | Booking called off, classes listed, move to a free room, venue rules refuse the room |
| Setup | Custom rules saved with the rules; the shared demo is read-only |

## 4. End-to-end tests

Playwright drives Microsoft Edge (installed with Windows, so no browser download) against the running dev server.

- Landing page, the public demo and its timetables render.
- The demo's Generate runs the solver in the browser and reports 0 clashes.
- Signing in with the dev accounts and opening each role's pages (needs `npx tsx scripts/seed-dev-users.ts <slug>`).
- Access control in the browser: a student is refused the Setup pages.

## 5. Performance

`scripts/bench.ts` solves the demo college and a large synthetic college and prints the time and the result.

## Order to run before a release

```bash
npm run typecheck && npm run lint && npm test && npm run test:integration && npm run test:e2e && npm run build
```

## Results (2026-10-25)

| Layer | Result |
|---|---|
| Typecheck, lint | clean |
| Unit + property (`npm test`) | **149 passed** in 21 files (79 before this round); property tests cover ~4,800 random cases |
| Integration (`npm run test:integration`) | **17 passed** in 5 files, stable over 3 runs |
| End-to-end (`npm run test:e2e`, Edge) | **9 passed** |
| Performance (`scripts/bench.ts`, `scripts/stress*.ts`) | Demo college (198 classes): 0.1–0.2 s, 0 violations. Tight variants (rooms removed, 5-day week): 0.1–2.4 s; when truly impossible, 0 violations and every unplaced class explained |
| Production build | succeeds |

### Bugs the tests found (all fixed)

1. **AI rule answers with full day names were refused.** "Tuesday" didn't match a college day named "Tue"; days now match on their first three letters (unit test).
2. **Slot checks skipped bookings without an id.** A comparison treated "no id" as "the booking being edited" (property test).
3. **The loser of a booking race saw a raw database error.** Two students booking the same office-hour slot (or the last elective seat) at the same moment: the database correctly let only one through, but the other got Prisma's internal message. It now reads "Someone has just booked that slot." / "Seats changed while you chose." (integration test with truly concurrent users).
4. **The room pre-check could call a feasible timetable impossible.** With staggered lunches a room offers every slot open in *any* grid, not just the most open grid; the readiness check undercounted (found by the stress benchmark; regression test added).

5. **The solver could stall on a large college** (found with GNDEC's real data, 796 classes): two classes that kept ejecting each other were always chosen next, so hundreds of easy classes were never tried and only 312 of 796 were placed. Ejected classes now get priority for a few rounds only; GNDEC places 788/796 with every unplaced class explained. `src/lib/setup/gndec.test.ts` imports the GNDEC CSVs (local test data in `data/gndec`, not in git; skipped when absent) and checks that construction never stops while a class still has a free legal slot.

### Known limitations

- An unknown college URL shows the not-found page with HTTP 200 plus a `noindex` tag (a "soft 404"), because the college is looked up inside a streamed section. Visitors and search engines are handled correctly; only the status code differs.
- Integration tests fake the sign-in session (Better Auth itself is exercised by the end-to-end tests).
- End-to-end tests use the local dev database and the dev accounts; they only read, apart from opening and closing the rule-confirmation card.
