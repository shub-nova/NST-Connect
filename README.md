# NST Connect

Helpdesk and ticketing system for Newton School students. Students raise tickets, each ticket is routed to its category's POC, and a ticket that is not solved within the time limit (2 days by default, set by the admin) escalates automatically up the POC chain (L1 → L2 → L3). Students see only a team label such as "Assigned to Academics team", never an individual POC.

**What is in it:** the student ticket flow (with attachments, reopen, self-close and feedback), the POC queue with bulk actions, automatic escalation, team management with leave, notes from the Super Admin, and analytics for every role. [DEPLOY.md](DEPLOY.md) covers hosting it, and [docs/go-live-checklist.md](docs/go-live-checklist.md) lists what to switch off before real users arrive; `docs/` has the database and ticket-lifecycle diagrams. New here? Read [CONTRIBUTING.md](CONTRIBUTING.md), the [developer guide](docs/developer/README.md) and the [user guides](docs/user-guide/README.md).

## Repository layout

| Path | Contents |
| --- | --- |
| `apps/web` | Next.js frontend (Tailwind) |
| `apps/api` | NestJS backend |
| `docs/` | Database diagram (`er-diagram.md`), ticket lifecycle (`state-diagram.md`) and the go-live checklist (`go-live-checklist.md`) |
| `DEPLOY.md` | Step-by-step hosting guide (Vercel, Neon, R2, Upstash) |
| `docker-compose.yml` | Local Postgres, S3-compatible storage, Mailpit |

## Prerequisites

- Node.js 22.12 or newer, 24 recommended (with npm). The API loads NestJS 12, an ES module, with `require`, which needs a current Node.
- Docker Desktop, running
- Git

## Setup

1. Install dependencies from the repo root (never inside `apps/*`, so there is one lockfile):

   ```bash
   npm install
   ```

2. Copy the environment template, then set `JWT_SECRET` to a long random value (at least 32 characters). The API refuses to start without it:

   ```bash
   cp .env.example .env
   ```

   ```bash
   node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
   ```

3. Start the local services:

   ```bash
   docker compose up -d
   ```

4. Create the database tables and seed categories, the POC hierarchy and an admin:

   ```bash
   npm run db:migrate -w apps/api
   ```

   ```bash
   npm run db:seed -w apps/api
   ```

## Run

API (port 3000):

```bash
npm run dev:api
```

Web (port 3001):

```bash
npm run dev:web
```

Check the API:

```bash
curl http://localhost:3000/health
```

It should return `{"status":"ok","database":"up"}`. Then open http://localhost:3001, register with an `@adypu.edu.in` address, and open the verification link from Mailpit at http://localhost:8025.

## Accounts

**Students** register themselves with an `@adypu.edu.in` address and verify by email.

**Forgot password:** on the login page, **Forgot password?** asks for the email and sends a link (valid for 1 hour, usable once). The page always answers the same ("if an account exists…") and takes the same time, so it cannot be used to find out who is registered. Only a verified, active account with a password gets a link, and another is not sent within 2 minutes of the last. Choosing a new password signs the account out everywhere. It works for students and staff alike. The Super Admin's own address on a shared mailbox nobody can open can still use `npm run admin:set-password -w apps/api`.

**Staff cannot choose their own role.** Their accounts are created by the seed from a fixed list: one L1, one L2 and one L3 per category, plus one Super Admin. A ticket starts with L1 and can be escalated L1 → L2 → L3. **L3 is the top level**: it cannot escalate further, and a ticket it Solves or Closes is final (the student cannot reopen it).

| Category | L1 | L2 | L3 |
| --- | --- | --- | --- |
| Hostel & Accommodation | `hostel.l1.1@newtonschool.co` | `hostel.l2@newtonschool.co` | `hostel.l3@newtonschool.co` |
| Food, Mess & Canteen | `mess.l1.1@newtonschool.co` | `mess.l2@newtonschool.co` | `mess.l3@newtonschool.co` |
| Academics | `academics.l1.1@newtonschool.co` | `academics.l2@newtonschool.co` | `academics.l3@newtonschool.co` |
| Examinations, Evaluation & Grading | `exams.l1.1@newtonschool.co` | `exams.l2@newtonschool.co` | `exams.l3@newtonschool.co` |
| Attendance & Leave | `attendance.l1.1@newtonschool.co` | `attendance.l2@newtonschool.co` | `attendance.l3@newtonschool.co` |
| Fees, Scholarships & Financial Matters | `fees.l1.1@newtonschool.co` | `fees.l2@newtonschool.co` | `fees.l3@newtonschool.co` |
| Post Admission Document Requirements | `documents.l1.1@newtonschool.co` | `documents.l2@newtonschool.co` | `documents.l3@newtonschool.co` |
| Internship, Placement & Progression Mentoring | `placements.l1.1@newtonschool.co` | `placements.l2@newtonschool.co` | `placements.l3@newtonschool.co` |
| Campus Infrastructure, IT & Facilities | `campus.l1.1@newtonschool.co` | `campus.l2@newtonschool.co` | `campus.l3@newtonschool.co` |
| Student Activities & Campus Life | `activities.l1.1@newtonschool.co` | `activities.l2@newtonschool.co` | `activities.l3@newtonschool.co` |
| Other (anything not covered above) | `other.l1.1@newtonschool.co` | `other.l2@newtonschool.co` | `other.l3@newtonschool.co` |

Super Admin: `admin@newtonschool.co` (lands on **All teams**; also has Categories and Settings).

### Logging in as a staff account in development

Either use the invitation link (an admin or team lead presses **Resend invite** in Settings; read the email in Mailpit; signing up without that link is refused for an address that was added by name), or activate **all** of them at once with a password you choose (development only; refuses to run in production):

```bash
STAFF_PASSWORD='choose-your-own-password' npm run db:activate-staff -w apps/api
```

It prints the list of accounts it activated. Use that password to log in as any of them.

To add or change categories, sub-categories or POCs, edit `apps/api/prisma/categories.ts` and `apps/api/prisma/seed.ts`, then run `npm run db:seed -w apps/api`.

## Automatic escalation

Every ticket has a **deadline for solving it** at its current level: **2 days by default, and the Super Admin can change it** (1 to 14 days) from **Settings → Escalation time**.

- **Only solving or closing the ticket stops the clock.** Replying, or marking it in progress, does **not** restart it, so a POC cannot keep a ticket by replying "looking into it".
- **A fresh clock starts** when a ticket reaches a level: a new ticket, a reopen, an escalation (automatic or by hand), or a hand-over when someone goes on leave. Each level gets the full time.
- **If the deadline passes**, the ticket moves up one level (L1 → L2 → L3), the POC who held it is recorded as having missed it, and the next level gets a fresh clock. A ticket that is not solved in time at the top level is flagged **critical** and stays critical until it is solved or closed.
- **A change to the limit applies from then on:** a ticket's current deadline is left alone, and the new limit is used the next time a clock starts for it.
- Students only see "Escalated to <team>".

> **Alerts are not delivered yet.** The system records a notification row for the important events (a new ticket, a reply, a solved ticket, an escalation, the 12-hour warning, a missed deadline, a critical ticket), but no screen shows them and no email is sent for them. Today people see changes only by opening the app: a POC finds new and escalated tickets in **My queue**, and a student sees replies on their ticket page. The only emails sent are sign-up verification, staff invitations and the admin's notes. Delivering these alerts (email or in-app) is listed in the go-live checklist.

- **On a server that stays running:** inside the API every 15 minutes (and once ~10 seconds after it starts, to catch up after downtime). Settings: `ESCALATION_JOB_ENABLED`, `ESCALATION_INTERVAL_MINUTES`, `TAT_WARNING_HOURS` in `.env`.
- **On serverless hosting (Vercel):** there is no timer, so set `ESCALATION_JOB_ENABLED=false` and `JOB_SECRET` (16+ characters), and let an outside scheduler call `POST /api/internal/escalation/run` with the header `x-job-secret`. We use a free **cron-job.org** job every 30 minutes (steps in [DEPLOY.md](DEPLOY.md), section 7). Without `JOB_SECRET` that endpoint does not exist. The admin sees when the check last ran under **Settings → Escalation time**.
- **Try it locally:** raise a ticket, then push its deadline into the past and restart the API:

```bash
docker exec nst-connect-db-1 psql -U nstconnect -d nstconnect -c "UPDATE ticket SET tat_deadline = now() - interval '1 hour' WHERE id = '<ticket id>';"
```

## Bulk actions in My queue

When many students report the same problem, right-click a ticket in **My queue** and choose **Select** (on a phone, press and hold). Checkboxes then appear on every ticket, so you can tick more or use "Select all". Use the bar that appears: **Solve**, **Close**, **Escalate** or **Reply**, with one note for the whole batch (up to 50 tickets at a time).

- Each ticket is handled exactly as if it were done alone: same permission checks, its own history entry, its own notice to its own student, and a fresh clock where that applies (escalating). Escalation spreads tickets across the next level's POCs.
- A ticket that cannot be changed (already finished, moved by someone else, nobody on duty above) is listed with the reason and does not stop the rest.
- Students never see that a ticket was part of a batch, and the Escalate reason stays staff-only. Escalate is hidden for L3, the top level.
- API: `POST /poc/tickets/bulk` with `{ ticketIds, action: SOLVED | CLOSED | ESCALATED | REPLY, note }`.

### Large queues

My queue shows 25 tickets at a time, sorted by the server (least time left, oldest or newest), with a **Load more** button and the total on each tab (for example "Open 270"). Paging uses a cursor, so it stays correct while tickets are being raised and solved. **Select all** selects the tickets currently on screen; press **Load more** first to include more. Bulk actions on a large selection run in groups of 50 with a progress message, and anything that could not be changed is listed afterwards.

- API: `GET /poc/queue?view=open|done&sort=time-left|oldest|newest&limit=25&cursor=…` (returns `tickets`, `total`, `counts`, `nextCursor`).

## Settings: managing POCs

Open **Settings** from the account menu (L2, L3 and the Super Admin; L1 does not have it). From there you can add, change, put on leave and remove the POCs below you:

| Who | Can manage |
| --- | --- |
| Super Admin | Any POC in any category (and the only one who can add an L3) |
| L3 | The L2 and L1 below them, in their own category |
| L2 | The L1 below them |

- **Add:** name, `@newtonschool.co` email, level (and who they report to if there is a choice). They get an invite email with a personal sign-up link (valid 14 days; **Resend invite** sends a fresh one). The link names the invited address: the sign-up page shows it and cannot change it, and the server refuses to register that invitation with any other address, so the person who was added is the one who signs up. The link was only ever emailed to that mailbox, so it also verifies the address: there is no second verification email, and the person can log in straight away. Removed people can be added back.
- **Signing up on their own:** anyone with an `@newtonschool.co` address can also register at `/register` and verify their email. That only creates an account with no category: they see an empty queue and a note saying they are not assigned yet, and nothing else, until an admin or team lead adds them here (with the same email, no new invite needed). Signing up never gives access to tickets or management.
- **Edit:** name and who they report to. Email and level are fixed: remove and re-add to change them.
- **Remove:** never a hard delete. Open tickets are handed to colleagues at the same level (or escalated if nobody else is available), the person can no longer log in, and their past work stays in the analytics. You cannot remove the last POC at a level, or someone who still has a team under them.
- **Recent changes** lists who did what. Every rule is enforced on the server, not just hidden in the screen.
- API: `GET /staff/team`, `/staff/options`, `/staff/audit`; `POST /staff`, `PATCH /staff/:id`, `POST /staff/:id/leave|remove|resend-invite`.

### Leave

Nobody puts themselves on leave. It is set from **Settings** by the person's manager, with a required return date: an **L1** by their L2 (or the L3 above), an **L2** by their L3, and an **L3** by the Super Admin. The admin has no leave. A person on leave sees an "On leave · back <date>" note in their account menu, and their manager can bring them back early with **Back from leave**. While on leave a POC gets no new tickets. Their open tickets move to another POC at the same level, or are escalated if nobody else is on duty; if every POC at a level is on leave, new tickets start at the next level up. Students never see any of this, and these moves are not counted as manual or automatic escalations in the analytics.

`npm run db:seed` only creates what is missing, so it never undoes changes made in Settings.

## Students closing their own ticket

A student can close any open ticket from its page (**Close ticket**, with a confirmation), for example when they sorted it out themselves.

- It leaves the POC's open queue straight away and its clock stops. The POC who held it gets a quiet notification, and it stays in their **Done** tab marked "Closed by student".
- It is **not a POC outcome**: analytics never count it as Solved or Closed, it is not part of finish times, and the student is not asked for feedback on it.
- The student can change their mind: **Reopen ticket** sends it back to the level it was at. A ticket they closed is never "final", even at the top level.
- API: `POST /tickets/:id/close` (student).

## Deploying

See **[DEPLOY.md](DEPLOY.md)** for the step-by-step guide to hosting both apps free on Vercel (with Neon, Cloudflare R2, Upstash and cron-job.org).

## Email (sign-up verification, invitations and admin notes)

By default every email goes to **Mailpit** (http://localhost:8025), a local catcher: nothing reaches a real inbox, which is handy for development. To send **real email** (so a student gets the verification link in their own inbox), fill in an SMTP provider in `.env`:

```
SMTP_HOST=smtp-relay.brevo.com
SMTP_PORT=587
SMTP_USER=<your SMTP login>
SMTP_PASS=<your SMTP key>
MAIL_FROM="NST Connect <a sender address you verified with the provider>"
```

Check it works with `npm run mail:test -w apps/api -- you@example.com`. When the API starts it logs `Mail ready: <host>` (or a warning if the login is rejected). Port 587 uses STARTTLS and port 465 uses implicit TLS automatically. The automated tests always use Mailpit, whatever `.env` says, so they can never send real email. Verification links point to `WEB_URL`, so set it to the public address once the app is deployed.

### Testing student sign-up with a real inbox

Student sign-up only accepts the college domain. To test the real verification email with an address you own (for example Gmail), add it to the list in `.env`, restart the API, and sign up with it:

```
STUDENT_EMAIL_DOMAIN=adypu.edu.in,gmail.com
```

The API logs a warning at every start while an extra domain is allowed. Remove it when you are done. The automated tests always use the real college domain, whatever `.env` says.

## Categories and topics

The Super Admin manages what students can raise tickets about, from **Categories** in the account menu (top right). A category has topics (called sub-categories in the database), and students pick a topic when they raise a ticket.

- **Add a category** with its first topics (at least one), and add or rename topics any time.
- **Students only see a category once somebody is assigned at every level** (L1, L2 and L3), so a new ticket always has a full chain of people to answer it within 48 hours. A category without a full team is marked "Hidden from students · needs L2, L3" on the Categories page, and the server refuses new tickets in it. Add its team from Settings. If a level later loses everyone, the category is hidden again until it is staffed (existing tickets carry on). People on leave still count as assigned.
- **Remove** never deletes. It hides a category or topic from new tickets, while old tickets, staff assignments and analytics keep their names. **Restore** brings it back. A category or a topic **cannot be removed while it has open tickets** (solve or close them first), and a live category always keeps at least one topic.
- **Renaming** changes the name everywhere, including on old tickets. Each ticket that is still open gets a **"Name updated" note on its timeline** (for example "The topic “Laundry Services” is now “Laundry”."), so the student sees on the ticket itself what changed. No email is sent.
- Changes are recorded under "Recent changes" in Settings.
- The seed only **creates** what is missing. Re-running it never renames, hides or restores anything the admin changed (only the test suite's reset mode does).

## Student feedback

When a ticket is Solved or Closed, the student's ticket page shows **Share your feedback / How did we do?** with three choices (😊 Satisfied, 😐 Okay, 😞 Not satisfied) and an optional comment (up to 500 characters). It is separate from reopening, and L3 outcomes (which cannot be reopened) can still be rated.

- One answer per finish: the student can change it for 7 days. If the ticket is reopened and finished again, they can answer again.
- Feedback is credited to the POC who solved or closed the ticket. Staff see the rating and comment but never the student, and students never see anything about staff.
- **My, Team and All teams analytics** show a **Satisfaction** card (the share of answers that were "Satisfied", only once at least 5 students have answered) and a **Student feedback** donut with the breakdown. Hovering a slice shows its count. Beside it, "Most repeated phrases" lists the two-word phrases students repeat most in their comments; the comments themselves are never shown.
- API: `POST /tickets/:id/feedback` (student); the ticket detail includes `canGiveFeedback` and `feedback`.

## Analytics

Staff-only dashboards (students never reach them). Every view runs the same queries with a different scope, so the numbers always agree.

| Who | Pages | What it covers |
| --- | --- | --- |
| L1, L2, L3 | **My analytics** | Tickets that POC handled: outcomes (solved / closed / escalated), action needed / total, auto-escalated from and to them |
| L2, L3 | **Team analytics** | The POCs below them in their category, side by side (alphabetical, not ranked) |
| L1, L2, L3 | **Overall analytics** | What is being raised in their category across all levels: the most repeated categories, sub-categories and phrases. Read only, no personal stats |
| Super Admin | **All teams** | Compare every category; filter by category and level to see each POC |

- **Time to finish** is ticket created → Solved/Closed. Only finished tickets count; the median and "finished within the limit" are shown next to the average.
- **Auto-escalated** means a POC held a ticket past the time limit without acting. "From me" is the POC who missed it, "to me" is the one who inherited it. Manual and automatic escalations are shown separately.
- Choose 7, 30, 90 days or a custom range. Short ranges plot daily points, long ones weekly.
- API: `GET /analytics/me|team|overall` (POC), `GET /analytics/admin?categoryId=&level=&pocId=` (Super Admin), all with `from` and `to` (`YYYY-MM-DD`).

### Notes from the Super Admin

After looking at the stats, the Super Admin can leave a note for the POCs the current filters select (a category, a level, or one POC). The note appears in a popup from the bell icon in the top bar (with an unread count and a "Got it" button), and is also emailed. The admin sees who has read each note ("Seen 2/3"). Students can never see notes: they are stored in their own tables (`admin_note`, `admin_note_receipt`) and only POC and Super Admin endpoints read them.

- API: `POST /notes` (admin), `GET /notes/sent` (admin), `GET /notes/mine` (POC), `POST /notes/:id/seen` (POC).
- The Super Admin's bell in the top bar lists the notes they have sent, with "Seen 2/3" on each.

**Demo data** so the charts have something to show (development only, never touches real tickets):

```bash
npm run db:demo-data -w apps/api            # about 2500 tickets over the last 90 days, with student feedback and a few tickets closed by students
npm run db:demo-data -w apps/api -- --clean # remove them again
```

## Testing

Unit tests (no services needed):

```bash
npm test
```

End-to-end API tests run against a separate `nstconnect_test` database, real Mailpit and real S3 storage. Create it once:

```bash
docker exec nst-connect-db-1 psql -U nstconnect -d postgres -c "CREATE DATABASE nstconnect_test"
```

```bash
DATABASE_URL=postgresql://nstconnect:nstconnect_dev@localhost:5432/nstconnect_test npm run db:migrate -w apps/api
```

```bash
DATABASE_URL=postgresql://nstconnect:nstconnect_dev@localhost:5432/nstconnect_test npm run db:seed -w apps/api
```

Then run them:

```bash
npm run test:e2e -w apps/api
```

## Local services

| Service | URL | Notes |
| --- | --- | --- |
| Postgres | `localhost:5432` | User, password and database all derive from `nstconnect` (see `.env.example`) |
| S3-compatible storage (RustFS) | API `localhost:9000`, console `localhost:9001` | Local stand-in for Cloudflare R2 |
| Mailpit | UI `http://localhost:8025`, SMTP `localhost:1025` | Catches all outgoing email in development |

Stop services with `docker compose down` (add `-v` to also delete their data).

## Scripts (from the repo root)

| Command | What it does |
| --- | --- |
| `npm run lint` | Lint every workspace |
| `npm test` | Run every workspace's tests |
| `npm run build` | Build every workspace |
| `npm install <pkg> -w apps/api` | Add a dependency to one workspace |

## Workflow

- Trunk-based: `main` is always deployable. Work on short-lived `feat/*` and `fix/*` branches.
- Every change goes through a pull request with at least one review, and CI must pass (lint, test, build).
- Commit messages follow Conventional Commits, for example `feat(tickets): add reopen action`.
- Never commit secrets. `.env` is git-ignored; `.env.example` holds placeholders only.

## Stack

Next.js, NestJS, PostgreSQL (Prisma), S3-compatible storage (Cloudflare R2 in production), Redis for shared rate limits (Upstash), GitHub Actions, Docker for local services. Hosted on free tiers: Vercel (web and API), Neon, Cloudflare R2, Upstash.
