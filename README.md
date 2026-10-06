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
