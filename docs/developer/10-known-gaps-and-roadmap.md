# 10. Known gaps, sharp edges and roadmap

An honest list of what is **not** built or is easy to trip over, so nobody is surprised. Items marked ★ matter most before real users arrive.

## 10.1 Missing features

| # | Gap | Where it shows | Notes for whoever builds it |
| --- | --- | --- | --- |
| ★1 | **Notifications are recorded but never delivered.** | `notification` rows are written for new tickets, replies, solved, escalations, 12-hour warnings, missed deadlines and critical flags. No screen reads them and nothing is emailed (`read_at`, `emailed_at` unused). | Two parts: an in-app bell (read `notification` for the user, mark `read_at`) and email (a worker or the escalation job sends the unsent rows and sets `emailed_at`). Respect the student identity rule (team names only). Add rate/volume limits (Gmail 500/day). The rows already exist in the right transactions. |
| ★2 | **No monitoring or alerting** beyond the escalation heartbeat on the Settings page. | Outages are noticed by users. | Add an uptime check on `/api/health`, cron-job.org failure alerts, Vercel log alerts. |
| ★3 | **No privacy notice or retention policy.** | Names, emails and complaints are stored indefinitely; no delete/export in the app. | Write the notice; decide retention; implement an export/delete procedure (database operation today). |
| 4 | **Students cannot message on an open ticket.** | The only student message is the reopen comment. POC questions have no reply path. | Add `POST /tickets/:id/comments` for the student (public comment, `COMMENTED` event, notification to the owner); keep the identity rules. `comment.visibility` and `attachment.comment_id` exist already. Decide whether replying affects the clock (it should not, by the same rule as POC replies). |
| 5 | **Abuse limits:** tickets per student, total upload size, sign-up email cooldown. | Only per-request rate limits exist. | Counters in the service layer plus a clear message; per-student caps need a rule agreed with the college. |
| 6 | **Antivirus scanning of uploads.** | `scan_status` `PENDING/CLEAN/INFECTED` exists; files that pass type/size/content checks become `CLEAN` immediately. | A scanner (e.g. ClamAV in a worker) that moves files to `CLEAN`/`INFECTED` after upload; the visibility filters already hide non-`CLEAN`. |
| 7 | **Admins can only be added by a developer** (`admin:set-password`/seed). | One admin. | A Settings screen to add admins (verified), with an audit row. |
| 8 | **Staff cannot attach files or leave private notes** on a ticket. | | New endpoints; `INTERNAL` visibility is already supported by the schema and student filters. |
| 9 | **No duplicate-ticket linking, priorities or mentions.** | Removed as unused (see the 2026-10-13 migration). | Re-add deliberately with a design if needed. |
| 10 | **Working-hours deadlines.** | The limit counts wall-clock time including nights and weekends. | Would need a calendar of working hours and a deadline calculator replacing `deadlineAfter`. |

## 10.2 Sharp edges (behaviour you might not expect)

- **A ticket raised while nobody is on duty** waits in `CREATED` with no deadline until the next scheduled run after someone is available (up to about 30 minutes), then it is assigned.
- **POCs see all tickets at their category and level**, not only theirs; acting claims the ticket (`assigned_poc_id` becomes the actor).
- **Leave ends at the next escalation run** after the return date (midnight UTC), i.e. within about 30 minutes, or immediately when the manager presses "Back from leave". A POC on leave still *sees* their queue; they just receive nothing new.
- **Deleting is not possible** by design. Wrong data is corrected by an admin action (remove/restore) or direct database work.
- **Changing the escalation time** affects only deadlines set afterwards.
- **A category disappears for students** the moment any level has no active, non-deactivated person.
- **Analytics days are UTC.** Custom ranges are inclusive UTC days; the screens format dates in `en-IN`.
- **Percentages are hidden** until there are at least 5 feedback answers.
- **Rate limiting depends on proxy trust** and on Upstash; see 7.5.
- **Hand-written web types** (`lib/types.ts`) can drift from the API. There is no generated client.
- **No automated web tests**; the web app relies on lint, type check, build and manual checks.
- **Free-tier limits and terms** (chapter 9) can change; Neon compute suspends when idle.
- **Dependency audit:** the last cleanup reduced known vulnerabilities from 35 to 4. Run `npm audit` periodically and update.

## 10.3 Inconsistencies to be aware of (comments vs behaviour)

- `tickets.service.ts` comment says "Today the top level is L2"; categories default to `max_level = 3` (L3 is the top) and the code follows the category's value.
- `analytics.service.ts` comment says Overall analytics is for L2 and L3; the code allows **any POC with an assignment** (read-only), and the menu shows it to them.
- The root `README.md` line "Super Admin ... no screens yet; it lands on a holding page" is outdated: the admin has All teams, Categories and Settings.
- `NUDGED` (event) has a staff label but nothing creates it.
- `README.md` lists Node 22.12+; the API `engines` is `24.x` and CI runs 24 (the web project on Vercel uses 22).

## 10.4 Ideas for the roadmap (ordered by value)

1. **Deliver notifications** (in-app bell + email), starting with: a new ticket for the owner, a reply for the student, escalations, and the 12-hour warning.
2. **Monitoring and a privacy page**, then the go-live checklist.
3. **Student replies on open tickets** (removes the biggest usability limit).
4. **Add admins from the app** and a staff-side attachment/private-note feature.
5. **Abuse limits** and **antivirus**.
6. **Web tests** (Playwright for the critical flows; component tests for the dialogs) and a generated, shared API type package to replace hand-written types.
7. **Working-hours aware deadlines** if the college wants them.
8. **Admin tooling:** view a ticket read-only for audits, export analytics to CSV, a retention/cleanup job.
9. **Observability:** structured logs, error tracking (e.g. Sentry), uptime dashboard.
10. **Scale-out path** if the free tier is outgrown: paid Neon/Vercel or a single always-on container (the API already runs as a normal Node server, with the in-process escalation timer).

## 10.5 Before you change core behaviour
Read chapter 5 (lifecycle) and chapter 7 (security), then write the test first. The riskiest areas are: the deadline rules (they are a promise to students), escalation (it runs unattended), identity protection (a leak is a trust failure), and migrations (they run on live data).
