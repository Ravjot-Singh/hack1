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
