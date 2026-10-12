# 2. Local setup and configuration

The step-by-step first-time setup is in [CONTRIBUTING.md, section 3](../../CONTRIBUTING.md). This page explains **what each piece is**, lists **every setting and script**, and covers day-to-day development.

## 2.1 Local services (docker-compose.yml)

| Service | Image | Ports | What it replaces in production | Notes |
| --- | --- | --- | --- | --- |
| `db` | `postgres:16` | 5432 | Neon | User `nstconnect`, password `nstconnect_dev`, database `nstconnect`. Data persists in the `dbdata` volume. |
| `s3` | `rustfs/rustfs:latest` | 9000 (API), 9001 (console) | Cloudflare R2 | Access key `nstconnect`, secret `nstconnect_dev_secret`. (MinIO is no longer published on Docker Hub, so RustFS is used.) Data in `s3data`. |
| `mailpit` | `axllent/mailpit` | 1025 (SMTP), 8025 (web UI) | Gmail/Brevo SMTP | Catches all mail. Open http://localhost:8025. |

Commands:
```bash
docker compose up -d      # start
docker compose ps         # status
docker compose logs -f db # logs of one service
docker compose down       # stop (data kept)
docker compose down -v    # stop AND delete all local data
```

You can inspect the database with `npm run db:studio -w apps/api` (Prisma Studio on port 5555) or `docker compose exec db psql -U nstconnect -d nstconnect`.

## 2.2 Environment variables

A single `.env` file at the **repository root** is used by everything: the API (`ConfigModule` loads `../../.env`), the Prisma CLI (`prisma.config.ts`), the seed and scripts (via `dotenv`). Copy `.env.example` to start. The file is git-ignored.

On Vercel the same names are set in each project's **Environment Variables** screen.

### API variables (validated in `apps/api/src/config/env.ts`)

| Variable | Default | Meaning |
| --- | --- | --- |
| `NODE_ENV` | `development` | `development`, `test` or `production`. `production` turns on the safety checks (2.3). `test` is set by the e2e script and changes behaviour (see 2.5). |
| `PORT` | `3000` | API port. |
| `WEB_URL` | `http://localhost:3001` | The public address of the web app. Used for the CORS origin, the links in emails (verification, reset, invitations) and the storage CORS rule. Must be `https://` in production. |
| `DATABASE_URL` | (required) | Postgres connection string. On Neon use the **pooled** string for the running API and the **direct** string only for migrations. |
| `DB_POOL_MAX` | `10` | Connections per API instance. **Use `1` on Vercel**, where many instances run at once. |
| `JWT_SECRET` | (required, ≥ 32 chars) | Signs access tokens and email links. Rotating it logs everyone out and invalidates open links. |
| `ACCESS_TOKEN_TTL_SECONDS` | `900` | Access token lifetime (15 minutes). |
| `REFRESH_TOKEN_TTL_DAYS` | `7` | How long a login lasts without activity. |
| `STUDENT_EMAIL_DOMAIN` | `adypu.edu.in` | Domain(s) allowed to sign up as students. Comma-separated for testing (`adypu.edu.in,gmail.com`). |
| `POC_EMAIL_DOMAIN` | `newtonschool.co` | Domain(s) allowed for staff. |
| `ALLOW_TEST_STUDENT_DOMAINS` | `false` | Lets production start with more than one domain per list or a domain in both lists. **Testing only.** |
| `SMTP_HOST` / `SMTP_PORT` | `localhost` / `1025` | Mail server. Defaults point at Mailpit. |
| `SMTP_USER` / `SMTP_PASS` | empty | Set both to send real mail. Empty user = plain local delivery. Setting a user without a password throws. |
| `SMTP_SECURE` | `false` | `true` for implicit TLS (port 465). Port 587 uses STARTTLS automatically. |
| `MAIL_FROM` | `NST Connect <no-reply@nstconnect.local>` | The sender shown to recipients. |
| `ESCALATION_JOB_ENABLED` | `true` | Runs the escalation check on a timer inside the API process. **Must be `false` on Vercel.** |
| `ESCALATION_INTERVAL_MINUTES` | `15` | Timer interval when the in-process job is on. |
| `TAT_WARNING_HOURS` | `12` | How long before a deadline the (recorded) warning is created. |
| `JOB_SECRET` | unset | ≥ 16 chars. Enables `POST /internal/escalation/run` (header `x-job-secret`). Unset = the endpoint answers 404. |
| `COOKIE_PATH` | `/auth` | Path of the refresh cookie. Behind the `/api` forward set it to `/api/auth`. |
| `TRUST_PROXY` | unset | `true`, a number of proxies, or an address list, so the rate limiter sees the real visitor address. On Vercel it is trusted automatically (see 7.5). |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | unset | Shared rate-limit store. Without them, counters live in each instance's memory (much weaker on serverless). |
| `STORAGE_AUTO_SETUP` | `true` | Create the bucket and its CORS rule when the API starts. Set `false` on Vercel and run `npm run storage:setup` once. |
| `S3_ENDPOINT` | `http://localhost:9000` | Object storage address. |
| `S3_REGION` | `auto` | R2 uses `auto`. |
| `S3_BUCKET` | `nst-connect-attachments` | Bucket name. |
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` | (required) | Storage credentials. |

Also read directly (not in the schema): `VERCEL` (set by Vercel; enables proxy trust and skips the mail connection check), `MAILPIT_URL` (tests; default `http://localhost:8025`), `SEED_MODE`, `SEED_RESET`, `ADMIN_EMAIL` (seed), `STAFF_PASSWORD`, `STAFF_EMAIL`, `DEMO_ON_HOSTED_DB`, `DEMO_STAFF_PASSWORD` (scripts).

### Web variables
| Variable | Where | Meaning |
| --- | --- | --- |
| `NEXT_PUBLIC_API_URL` | browser code | Base address the browser calls. Default `http://localhost:3000` in development. In production set `/api` (same site, goes through the rewrite). |
| `API_ORIGIN` | server (`next.config.ts`) | The API project's address, e.g. `https://nst-connect-api.vercel.app`. When set, `/api/:path*` is forwarded there. Unset in development. |

### 2.3 Production safety checks
When `NODE_ENV=production`, `validateEnv` throws "This is not safe to run in production yet" listing every problem (`productionProblems` in `env.ts`):
- `JWT_SECRET` looks like an example (`change-me`, `example`, `your-secret`).
- `WEB_URL` is not `https://`.
- `DATABASE_URL` or `S3_ENDPOINT` points at localhost.
- `S3_ACCESS_KEY` is the development key.
- Email is not set up for real delivery (`SMTP_HOST` local or no `SMTP_USER`).
- More than one student or staff domain, or a domain in both lists, without `ALLOW_TEST_STUDENT_DOMAINS=true`.
- On Vercel: `JOB_SECRET` missing or `ESCALATION_JOB_ENABLED` still on.

This means a forgotten development value cannot go live quietly: the deployment fails with the list of what to fix.

### 2.4 Email domains in detail (`auth/email-domains.ts`)
- `classifyEmail(email, studentDomains, staffDomains)` returns `STUDENT`, `STAFF` or `null` (refused).
- Student local part must match `^[a-z0-9][a-z0-9._-]{1,62}$`.
- Staff may use any local part on a staff domain.
- Testing trick: one domain (gmail.com) listed in **both** lists means `name@gmail.com` is a student and `name+staff@gmail.com` is staff (both reach the same inbox). Forbidden in production unless `ALLOW_TEST_STUDENT_DOMAINS`.

### 2.5 What `NODE_ENV=test` changes
- Rate limiting is skipped (`skipIf` in `AppModule`).
- Mail always goes to `localhost:1025` (Mailpit), whatever `.env` says (`buildTransportOptions`), so tests cannot send real email.
- The in-process escalation timer does not start (`EscalationScheduler`).
- "Forgot password" does not add its artificial delay.
- The mail connection check at start-up is skipped.

## 2.6 Every script

### Root (`package.json`)
| Command | Does |
| --- | --- |
| `npm run dev:api` | API in watch mode (`nest start --watch`) on 3000 |
| `npm run dev:web` | Next.js dev server on 3001 |
| `npm run lint` | lint every workspace |
| `npm test` | unit tests of every workspace (only the API has any) |
| `npm run build` | build every workspace |

### API (`-w apps/api`)
| Command | Does |
| --- | --- |
| `build` | `prisma generate && nest build && node scripts/bundle-serverless.mjs` (the Vercel build) |
| `start`, `start:dev`, `start:debug`, `start:prod` | run the API (plain, watch, debug, compiled `dist/main`) |
| `format` | Prettier write on `src` and `test` |
| `lint` | `oxlint --type-aware src/ test/` |
| `test`, `test:watch`, `test:cov` | Jest unit tests (needs `--experimental-vm-modules`, already in the script) |
| `test:e2e` | end-to-end tests: sets `NODE_ENV=test`, the two email domains and the `nstconnect_test` database URL; runs serially (`--runInBand`) |
| `db:generate` | regenerate the Prisma client into `src/generated/prisma` |
| `db:migrate` | `prisma migrate dev && prisma generate` (create/apply migrations locally) |
| `db:deploy` | `prisma migrate deploy` (apply existing migrations: used in production) |
| `db:seed` | create categories, topics, seeded staff and the admin if missing |
| `db:seed:production` | `SEED_MODE=production`: only categories, topics and the admin (needs `ADMIN_EMAIL`) |
| `db:activate-staff` | give all seeded staff one password and mark them verified (**refuses in production**) |
| `db:demo-data` | fill with ~2,500 demo tickets; `-- --clean` removes them; refuses hosted databases without `DEMO_ON_HOSTED_DB=yes` |
| `db:studio` | Prisma Studio on port 5555 |
| `mail:test -- you@x.com` | send one test email with the current SMTP settings |
| `storage:setup` | create the bucket and set its CORS rule |
| `admin:set-password` | set an existing Super Admin's password at a hidden prompt |

### Web (`-w apps/web`)
`dev` (port 3001), `build`, `start` (port 3001), `lint`.

## 2.7 Seed data

`prisma/seed.ts` is **idempotent and non-destructive**: it only *creates* what is missing, so re-running it never undoes changes the admin made in the app.

- Creates the admin (`admin@newtonschool.co`, or `ADMIN_EMAIL`).
- For each entry of `prisma/categories.ts` (11 categories with their topics, a `slug` for email addresses): upserts the category and topics.
- Unless `SEED_MODE=production`: one L3, one L2, one L1 per category (`<slug>.l3@…`, `<slug>.l2@…`, `<slug>.l1.1@…`), each an "invited" user with no password and reporting lines (L1 → L2 → L3).
- `SEED_RESET=true` (used only by the e2e `global-setup`) puts categories, topics and assignments back to the canonical state.

Production seed: `ADMIN_EMAIL='you@newtonschool.co' npm run db:seed:production -w apps/api` (the address must end in `@newtonschool.co`).

## 2.8 Day-to-day development tips

- **Generated Prisma client** lives in `apps/api/src/generated/prisma` and is git-ignored. It is created by `postinstall`, `db:generate`, `db:migrate` and `build`. If TypeScript says a Prisma type is missing after a pull, run `npm run db:generate -w apps/api`.
- **Hot reload:** `dev:api` restarts on save; the web dev server reloads the browser. After a **schema** change, restart `dev:api`.
- **Logging in as someone:** use `db:activate-staff` for staff; students sign up and click the link in Mailpit.
- **Looking at emails:** http://localhost:8025.
- **Resetting everything local:** `docker compose down -v`, `docker compose up -d`, then migrate and seed again.
- **Real email while developing:** fill `SMTP_*` and `MAIL_FROM` and run `npm run mail:test -w apps/api -- you@example.com`.
- **Try escalation locally:** raise a ticket, then run in the database `UPDATE ticket SET tat_deadline = now() - interval '1 hour' WHERE id = '<ticket id>';` and wait for the in-process job (every 15 minutes, once ~10 seconds after start) or call `POST /internal/escalation/run` with `JOB_SECRET` set.
