# NST Connect

Helpdesk and ticketing system for Newton School Students. Students raise tickets, each ticket is routed to its category's POC, and tickets that sit untouched for X hours escalate automatically up the POC chain (L1 → L2 → L3). Students see only a team label such as "Assigned to Academics team", never an individual POC.

Status: **Sprint 0 (foundation)**. The scaffold runs; product features start in Increment 1.

## Repository layout

| Path | Contents |
| --- | --- |
| `apps/web` | Next.js frontend (Tailwind) |
| `apps/api` | NestJS backend |
| `packages/shared` | Shared TypeScript types and constants (`@nst-connect/shared`) |
| `docs/` | PRD, implementation plan, ADRs, API spec (to be added) |
| `docker-compose.yml` | Local Postgres, S3-compatible storage, Mailpit |

## Prerequisites

- Node.js 20 or newer (with npm)
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

Super Admin: `admin@newtonschool.co` (no screens yet; it lands on a holding page).

### Logging in as a staff account in development

Either register the address on the sign-up page and verify it from Mailpit, one at a time, or activate **all** of them at once with a password you choose (development only; refuses to run in production):

```bash
STAFF_PASSWORD='choose-your-own-password' npm run db:activate-staff -w apps/api
```

It prints the list of accounts it activated. Use that password to log in as any of them.

To add or change categories, sub-categories or POCs, edit `apps/api/prisma/categories.ts` and `apps/api/prisma/seed.ts`, then run `npm run db:seed -w apps/api`.

## Automatic escalation

Every ticket has a 48-hour clock for the POC it is assigned to. Each action by that POC (reply, mark in progress, solve, close, escalate) restarts the clock. If it runs out, the ticket moves up one level (L1 → L2 → L3), the POC who did nothing gets a "missed" notification, and the next level gets a fresh 48 hours. A ticket that runs out at the top level is flagged **critical** and the Super Admin is notified. POCs get a warning 12 hours before their deadline. Students only see "Escalated to <team>".

- **Runs:** inside the API every 15 minutes (and once ~10 seconds after it starts, to catch up after downtime). Settings: `ESCALATION_JOB_ENABLED`, `ESCALATION_INTERVAL_MINUTES`, `TAT_WARNING_HOURS` in `.env`.
- **From an external scheduler** (GitHub Actions, Render cron): set `JOB_SECRET` (16+ characters) and call `POST /internal/escalation/run` with the header `x-job-secret`. Without `JOB_SECRET` that endpoint does not exist.
- **Try it locally:** raise a ticket, then push its deadline into the past and restart the API:

```bash
docker exec nst-connect-db-1 psql -U nstconnect -d nstconnect -c "UPDATE ticket SET tat_deadline = now() - interval '1 hour' WHERE id = '<ticket id>';"
```

## Bulk actions in My queue

When many students report the same problem, right-click a ticket in **My queue** and choose **Select** (on a phone, press and hold). Checkboxes then appear on every ticket, so you can tick more or use "Select all". Use the bar that appears: **Solve**, **Close**, **Escalate** or **Reply**, with one note for the whole batch (up to 50 tickets at a time).

- Each ticket is handled exactly as if it were done alone: same permission checks, its own history entry, its own notice to its own student, and a fresh 48-hour clock where that applies. Escalation spreads tickets across the next level's POCs.
- A ticket that cannot be changed (already finished, moved by someone else, nobody on duty above) is listed with the reason and does not stop the rest.
- Students never see that a ticket was part of a batch, and the Escalate reason stays staff-only. Escalate is hidden for L3, the top level.
- API: `POST /poc/tickets/bulk` with `{ ticketIds, action: SOLVED | CLOSED | ESCALATED | REPLY, note }`.

## Settings: managing POCs

Open **Settings** from the account menu (L2, L3 and the Super Admin; L1 does not have it). From there you can add, change, put on leave and remove the POCs below you:

| Who | Can manage |
| --- | --- |
| Super Admin | Any POC in any category (and the only one who can add an L3) |
| L3 | The L2 and L1 below them, in their own category |
| L2 | The L1 below them |

- **Add:** name, `@newtonschool.co` email, level (and who they report to if there is a choice). They get an invite email and create their account with that address. Removed people can be added back.
- **Edit:** name and who they report to. Email and level are fixed: remove and re-add to change them.
- **Remove:** never a hard delete. Open tickets are handed to colleagues at the same level (or escalated if nobody else is available), the person can no longer log in, and their past work stays in the analytics. You cannot remove the last POC at a level, or someone who still has a team under them.
- **Recent changes** lists who did what. Every rule is enforced on the server, not just hidden in the screen.
- API: `GET /staff/team`, `/staff/options`, `/staff/audit`; `POST /staff`, `PATCH /staff/:id`, `POST /staff/:id/leave|remove|resend-invite`; `PUT /staff/me/leave`.

### Leave

Any POC (L1 too) can choose **Go on leave** in the account menu, with a required return date, and managers can do it for their reports. While on leave a POC gets no new tickets. Their open tickets move to another POC at the same level, or are escalated if nobody else is on duty; if every POC at a level is on leave, new tickets start at the next level up. Students never see any of this, and these moves are not counted as manual or automatic escalations in the analytics.

`npm run db:seed` only creates what is missing, so it never undoes changes made in Settings.

## Analytics

Staff-only dashboards (students never reach them). Every view runs the same queries with a different scope, so the numbers always agree.

| Who | Pages | What it covers |
| --- | --- | --- |
| L1, L2, L3 | **My analytics** | Tickets that POC handled: outcomes (solved / closed / escalated), action needed / total, will escalate in 24h, auto-escalated from and to them |
| L2, L3 | **Team analytics** | The POCs below them in their category, side by side (alphabetical, not ranked) |
| L1, L2, L3 | **Overall analytics** | What is being raised in their category across all levels: the most repeated categories, sub-categories and phrases. Read only, no personal stats |
| Super Admin | **All teams** | Compare every category; filter by category and level to see each POC |

- **Time to finish** is ticket created → Solved/Closed. Only finished tickets count; the median and "finished within 48h" are shown next to the average.
- **Auto-escalated** means a POC held a ticket for 48 hours without acting. "From me" is the POC who missed it, "to me" is the one who inherited it. Manual and automatic escalations are shown separately.
- Choose 7, 30, 90 days or a custom range. Short ranges plot daily points, long ones weekly.
- API: `GET /analytics/me|team|overall` (POC), `GET /analytics/admin?categoryId=&level=&pocId=` (Super Admin), all with `from` and `to` (`YYYY-MM-DD`).

### Notes from the Super Admin

After looking at the stats, the Super Admin can leave a note for the POCs the current filters select (a category, a level, or one POC). The note appears at the top of their analytics pages with a "Got it" button, adds an unread count in their menu, and is also emailed. The admin sees who has read each note ("Seen 2/3"). Students can never see notes: they are stored in their own tables (`admin_note`, `admin_note_receipt`) and only POC and Super Admin endpoints read them.

- API: `POST /notes` (admin), `GET /notes/sent` (admin), `GET /notes/mine` (POC), `POST /notes/:id/seen` (POC).

**Demo data** so the charts have something to show (development only, never touches real tickets):

```bash
npm run db:demo-data -w apps/api            # about 2500 tickets over the last 90 days
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

Next.js, NestJS, PostgreSQL, S3-compatible storage (Cloudflare R2 in production), GitHub Actions, Docker. Free-tier hosting first (Vercel, Render, Neon).
