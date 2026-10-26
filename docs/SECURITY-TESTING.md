# Break-it review (security and robustness)

An attempt to break the app the way a hostile or careless user would, run on 26 Oct 2026.
The external AI provider was out of scope (free tier); everything else was in.

## Plan

Every server action is a public POST endpoint: anyone can call it with any arguments, skipping
the UI. So the review asked, for each of the 57 actions and the public pages:

1. **Who may call it?** Signed out, wrong role, wrong department, another college, the read-only demo.
2. **Whose data does it touch?** Every id in the arguments, including foreign keys, must belong to
   the caller's college.
3. **What if two people do it at once?** Check-then-write races on bookings, invites and publishing.
4. **What if the input is nonsense?** Impossible dates, huge arrays, out-of-range numbers,
   formulas in names.
5. **What leaks?** Public share links, error messages, CSV exports, redirects and headers.
6. **What can be abused at scale?** Account creation, notifications, database size.

### Method

- **Code review:** three independent reviewers read the code module by module (setup;
  timetables, labs and absences; venues, appointments, placements, electives and calendar). I
  covered auth, invites, redirects, exports and config myself.
- **Live attacks:** every finding rated medium or higher was reproduced as a live attack against
  the real server actions and a real Postgres database.
- **Regression tests:** each attack failed before its fix and passes after it. They are kept in
  [`tests/integration/attacks.test.ts`](../tests/integration/attacks.test.ts), plus unit tests in
  `src/lib/{share-view,safe-next}.test.ts` and `src/lib/setup/setup.test.ts`.

Run them with `npm run test:integration` and `npm test`.

## Results

No critical findings. Tenant isolation held everywhere: every id lookup is scoped to the
caller's college, and no cross-college read or write was possible. Timetable saves re-validate
on the server, so a client can't save a clash.

### High (all fixed)

| # | Finding | Proof | Fix |
|---|---|---|---|
| H1 | **Impossible dates were accepted.** "2026-11-31" passed every date check. JavaScript stores it as 1 Dec, while downtime and calendar checks compared the raw text. Result: a lab out of service on 1 Dec could be booked. "2026-02-30" absences were stored on 2 March. "2026-13-01" crashed several actions (500). | A booking for 31 Nov was approved on a lab under downtime. | One `isoDate` check (`src/lib/dates.ts`): a real calendar date, years 2000–2100. Used in every action and page that reads a date. |
| H2 | **Unlimited college creation.** Any new account could loop "Make my own copy" or `createBlankInstitute`. Each copy is thousands of rows, so a free-tier database could be filled in minutes. `days` also took any strings, unbounded (e.g. 5000 × "Mon", or "Funday"). | 8 colleges were created from one account. "Funday" was accepted. | At most 5 colleges per account. Working days must be distinct real weekdays. Start time must be a valid HH:MM. |
| H3 | **Share links leaked the whole college.** Even a link made for one section sent every section's and teacher's timetable to the browser, plus teachers' unavailability and preferences and the admin's custom rules. A link whose section had gone silently showed everything. An HOD could publish a public link to an unapproved draft. | A section link's payload held 10 sections and all private fields. | `publicView` (`src/lib/share-view.ts`) sends only the shared section's, teacher's or room's lessons, with no private planning data. A missing entity returns 404. Drafts can be shared only by the admin. A link must name something in the timetable. |
| H4 | **A single-use invite could be redeemed twice.** Two people opening the same link at the same moment both joined, including for an admin invite. | 2 memberships from 1 invite. | The invite is claimed with a conditional update inside one transaction before the membership is created. |

### Medium (all fixed)

| # | Finding | Fix |
|---|---|---|
| M1 | **Open redirect after sign-in.** `?next=/<tab>/evil.com` and `/\evil.com` passed the "starts with /" check, and the browser then went to evil.com. | `safeNext` refuses control characters and backslashes and confirms the URL stays on our origin. |
| M2 | **Room double-booking by race.** Two self-approving requests, or two approvals, for the same room and time at once could both be approved. A request could also be decided twice. | Bookings and approvals for one room and date run one at a time under a Postgres advisory lock (`src/lib/locks.ts`). A decision applies only while the request is still pending. |
| M3 | **Two published timetables.** Publishing two approved versions at once left both PUBLISHED. The review steps had similar races. | Every timetable status change in a college runs under one lock and re-reads the status inside it. |
| M4 | **Cover for classes the teacher isn't absent for.** Marked absent for P1, the P6 class could still be cancelled. Signed-out visitors could also trigger the day's full load and tell from the error messages whether a class runs. | Cover only for lessons inside the absence. The permission check now runs before anything is loaded. |
| M5 | **Stale pages deleted other people's rows.** Setup saves delete whatever is missing from the submitted list. Saving an old page wiped teachers or rooms a colleague had added since. | Each save sends the ids its page loaded. Only those rows can be deleted. |
| M6 | **Deletes cascaded silently.** Deleting a room removed its upcoming bookings. Deleting a department dropped sign-offs and turned its lab assistant into the owner of every common lab. Deleting a basket or offering removed students' elective choices. Deleting a teacher or section left user accounts linked to nothing. | Each delete is now refused while something still depends on the row, and the message says what. |
| M7 | **Unbounded setup payloads.** One HOD save could send ~10k rows, or a teacher with 150k unavailable slots. That held a database connection for 30 s and slowed the solver. | Saves take at most 5000 rows. Slot lists are capped at one week and slot values are range-checked. Id lists and sizes are capped. |
| M8 | **Notification spam.** A teacher could pile up room requests (each notifies every approver). A student could book and cancel office hours in a loop. A lab "undo move" notified everyone even when nothing had moved. | At most 10 waiting requests per person. At most 10 bookings per student per day. An undo that changes nothing sends no notice. |
| M9 | **CSV formula injection.** A name like `=HYPERLINK(...)` was exported as a live formula. | Exports prefix such cells with `'`, and imports strip it again, so round trips are unchanged. |
| M10 | **No security headers.** Any site could frame the app (clickjacking the Publish button). Share-link tokens could leak in the Referer header. | `X-Frame-Options: DENY`, `frame-ancestors 'none'`, `nosniff`, `Referrer-Policy: same-origin`, and a permissions policy. |

Found and fixed while verifying: `src/app/actions.ts` exported a constant. A `"use server"`
file may export only async functions, so this broke the home page. Typecheck and tests can't
catch it, so `npx next build` belongs in the pre-commit checks.

### Low (open, for later)

- **Lab types (HOD):** an HOD can make any room type count as a "lab" through a subject's lab room type. That widens what lab assistants can mark out of service.
- **Baskets (HOD):** an HOD can move an offering into or out of an elective basket through `basketId`.
- **Share links:** no owner and no expiry. Any HOD can revoke any link.
- **QR poster:** the poster builds its URL from `X-Forwarded-Host`. Take the base URL from config instead.
- **Edits on stale data:** `saveEdits` validates against the version's snapshot, not the current setup data.
- **Old covers hidden after republish:** re-saving a cover keeps its old version id, so the cover can disappear from view after a republish.
- **Unvalidated `solveMs` (admin only):** `saveVersion` stores whatever value the client sends.
- **Placement drives:** placement head counts can exceed section sizes when a section is listed twice. An existing round can be moved into the past.
- **Far-future bookings:** venue bookings accept dates far in the future.
- **Calendar loop (admin only):** `addSpecialDays` loops over the whole range before applying its 120-day cap.
- **Unchecked setup values:** time grids aren't checked to be exactly days × periods. Period times like 99:99 are accepted. Custom rule slots aren't pruned when the week shrinks (this over-constrains but never lets a clash through).
- **Empty elective basket:** an HOD can configure a basket that has no sections.
- **Accounts and invites (accepted, by design):**
  - Sign-up doesn't verify email.
  - Better Auth's rate limit is in-memory, so it is weak on serverless.
  - Sign-up reveals whether an email is registered.
  - Invites aren't tied to an email address: anyone holding the link joins. This is by design for WhatsApp sharing, so treat admin invite links as passwords.

## Checks that held

- Tenant scoping on every lookup and every foreign key in creates and updates.
- HOD department scoping on setup saves and sign-offs.
- The read-only `/demo`.
- Server-side timetable validation (0 violations or nothing is saved).
- Serializable transactions for elective seats and appointment slots.
- 96-bit share tokens and 128-bit invite tokens.
- Next's 1 MB body limit on server actions.
