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

2. Copy the environment template and adjust if needed:

   ```bash
   cp .env.example .env
   ```

3. Start the local services:

   ```bash
   docker compose up -d
   ```

## Run

API (port 3000):

```bash
npm run dev:api
```

Web (use another port so the two don't collide):

```bash
PORT=3001 npm run dev:web
```

Check the API:

```bash
curl http://localhost:3000/health
```

It should return `{"status":"ok"}`.

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
