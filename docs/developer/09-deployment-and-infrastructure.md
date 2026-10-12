# 9. Deployment and infrastructure

Hosting is **entirely on free tiers**. The click-by-click setup is in [DEPLOY.md](../../DEPLOY.md); this chapter explains the **design**, **why each service**, **how they connect**, **limits to watch**, the **deployment order**, and an **operations runbook**.

> Free plans change. Always re-check each provider's current limits and terms before relying on them. In particular, confirm that Vercel's free (Hobby) plan terms permit your organisation's use: it has historically been meant for personal, non-commercial projects, and an institution may need a paid plan.

## 9.1 Topology

| Piece | Where | Free plan used | Environment |
| --- | --- | --- | --- |
| Web app (`apps/web`) | Vercel project **nst-connect-web** | Vercel Hobby | `API_ORIGIN`, `NEXT_PUBLIC_API_URL=/api` |
| API (`apps/api`) | Vercel project **nst-connect-api** (one serverless function) | Vercel Hobby | all API variables (chapter 2) |
| Database | Neon PostgreSQL | Neon Free | pooled string in Vercel; direct string for migrations |
| Attachments | Cloudflare R2 bucket | R2 free allowance | `S3_*` variables |
| Rate-limit counters | Upstash Redis (REST) | Upstash Free | `UPSTASH_REDIS_REST_URL/TOKEN` |
| Email | Gmail SMTP (app password) or Brevo | Free | `SMTP_*`, `MAIL_FROM` |
| Escalation schedule | cron-job.org job every 30 min | Free | `JOB_SECRET` |
| CI | GitHub Actions | Free | none |

### Why this shape
- **Zero servers to run.** A student helpdesk for a college can run on managed free tiers; nobody has to patch or reboot a machine.
- **Two Vercel projects from one repository** (different "Root Directory": `apps/web`, `apps/api`). Each deploys on a push to `main`.
- **One public address for the browser.** The web project **rewrites** `/api/*` to the API project. The browser only ever sees the web address, so the refresh cookie (`path=/api/auth`) is same-site and a page refresh keeps you logged in. Two different `*.vercel.app` addresses would be different sites and the cookie would not be sent.
- **The API is a serverless function.** Each instance builds the Nest app once per cold start and is reused for later requests; many instances may run in parallel, hence `DB_POOL_MAX=1` and a shared Redis for rate limits.
- **Files bypass the API.** Signed URLs let the browser upload to and download from R2 directly, which avoids serverless request-size/time limits and keeps file bytes off the function.
- **An external scheduler** drives escalation because a serverless function has no clock of its own.

## 9.2 Each service: what, why, limits, gotchas

### Vercel (web + API)
- **Web project:** Root Directory `apps/web`, Node 22, env `API_ORIGIN=https://<api>.vercel.app` and `NEXT_PUBLIC_API_URL=/api`. Linux native packages for Next/Tailwind are listed as `optionalDependencies` in `apps/web/package.json` so the Vercel build finds them.
- **API project:** Root Directory `apps/api`, "include source files outside the Root Directory" **on** (the workspace needs the root lockfile), Node 24, `Install Command` `cd ../.. && npm ci` if packages are not found. `vercel.json` sets the build command, the `/api/(.*) → /api` rewrite, and function `api/index.js` with `maxDuration: 30` and `includeFiles: dist/**`.
- **Why a bundle step:** see 3.9 (NestJS 12 is an ES module; the function loads one CommonJS bundle).
- **Limits to watch:** function execution time (the config uses 30 s), cold starts (a second or two), request body size, monthly function/bandwidth allowances, and the plan's terms of use.
- **Failure messages that guide you:** "This is not safe to run in production yet" (lists unsafe settings), `ERR_REQUIRE_ESM @nestjs/core` (the bundle step did not run), "Cannot find module argon2" (native module not traced; the fix is to switch to `@node-rs/argon2`), a missing Prisma `.wasm` file (add it to `includeFiles`).

### Neon (PostgreSQL)
- **Why:** free serverless Postgres with real transactions and locks, and **branching**.
- **Two connection strings:** *pooled* (host has `-pooler`) for the running API with `DB_POOL_MAX=1`; *direct* only for migrations and admin scripts.
- **Branches as safety copies:** before any migration that removes something, create a branch from `production` (Branches → Create branch, "Branch data and schema", optional auto-delete). It is an instant copy to return to.
- **Gotchas:** the compute **suspends when idle** (first query after a quiet period is slower); storage and compute-hours are capped on the free plan; keep demo data out of production.

### Cloudflare R2 (attachments)
- **Why:** S3-compatible API (the AWS SDK works unchanged), free allowance, no download fees.
- **Setup:** a bucket (`nst-connect-attachments`), an **Object Read & Write** token, env `S3_ENDPOINT` (`https://<account>.r2.cloudflarestorage.com`), `S3_REGION=auto`, `S3_ACCESS_KEY/SECRET`.
- **CORS must allow the web origin** for browser uploads (PUT/GET/HEAD). An Object Read & Write token cannot change CORS, so set it in the Cloudflare dashboard (bucket → Settings → CORS Policy; JSON in DEPLOY.md), or run `npm run storage:setup -w apps/api` with a temporary Admin token.
- Set `STORAGE_AUTO_SETUP=false` on Vercel.

### Upstash Redis (rate limits)
- **Why:** serverless instances do not share memory; a shared counter makes "10 logins a minute" real. HTTP/REST access works from serverless without a TCP connection.
- **Without it** the limits count per instance and are far weaker. **If Redis is down** the app keeps working (fail-open).
- **Verify after deploy:** hammer the login with wrong passwords; it should block after a while.

### Email (Gmail SMTP or Brevo)
- Gmail: 2-Step Verification, an app password, `smtp.gmail.com:587`, user = the Gmail address. About **500 messages a day**; messages to college inboxes may land in spam at first.
- Before real launch move to a proper sender on a company domain and update `SMTP_*` and `MAIL_FROM`.
- Test: `npm run mail:test -w apps/api -- you@example.com`.
- What sends mail: verification, password reset, staff invitations and removals, admin notes. **Nothing about tickets** (known gap).

### cron-job.org (escalation)
- **Why:** nothing else on the free tier can call the API every 30 minutes reliably (Vercel's free plan limits cron frequency; GitHub's scheduled workflows ran late).
- **Job:** `POST https://<api>.vercel.app/api/internal/escalation/run`, every 30 minutes, header `x-job-secret: <JOB_SECRET>`, timeout 30 s. Test run must return HTTP 200 with `{"escalated":0,"flaggedCritical":0,"warned":0}`; 401 means the secret differs; 404 means `JOB_SECRET` is not set in Vercel.
- Turn on failure notifications in cron-job.org.
- **Visibility:** the admin's Settings → Escalation time shows "Last escalation check ran … ago" (from `job_heartbeat`) and turns red after 3 hours.
- Safe to add a second caller as a backup: the job is idempotent.

### GitHub Actions
Two CI jobs (chapter 8). No deployment happens from Actions: Vercel deploys from Git pushes itself.

## 9.3 Environment checklist per Vercel project

**API project (Production):** `NODE_ENV=production`, `DATABASE_URL` (pooled), `DB_POOL_MAX=1`, `JWT_SECRET`, `WEB_URL`, `COOKIE_PATH=/api/auth`, `TRUST_PROXY=true` (optional on Vercel), `STUDENT_EMAIL_DOMAIN`, `POC_EMAIL_DOMAIN`, `SMTP_HOST/PORT/USER/PASS`, `MAIL_FROM`, `S3_ENDPOINT/REGION/BUCKET/ACCESS_KEY/SECRET_KEY`, `STORAGE_AUTO_SETUP=false`, `UPSTASH_REDIS_REST_URL/TOKEN`, `ESCALATION_JOB_ENABLED=false`, `JOB_SECRET`. While testing, also `ALLOW_TEST_STUDENT_DOMAINS=true` (remove before launch: [go-live checklist](../go-live-checklist.md)).

**Web project:** `API_ORIGIN`, `NEXT_PUBLIC_API_URL=/api`.

A changed variable only applies after a **redeploy**.

## 9.4 First-time deployment (summary of DEPLOY.md)
1. Neon project; copy the pooled and direct strings.
2. `DATABASE_URL='<direct>' npm run db:deploy -w apps/api`.
3. `DATABASE_URL='<direct>' ADMIN_EMAIL='you@newtonschool.co' npm run db:seed:production -w apps/api` (categories, topics, one admin; **no** made-up staff).
4. Set the admin's password: sign up with that address and click the link, or `npm run admin:set-password -w apps/api` (hidden prompt).
5. R2 bucket + token + CORS rule; Upstash database; email app password.
6. Create the API Vercel project, then the web project; check `/api/health` on both addresses.
7. Create the cron-job.org job; test run returns 200.
8. Check list in DEPLOY.md section 8.

## 9.5 Updating later: the order rule

Push to `main`; both projects redeploy. **If the change includes a migration the order matters:**

| Migration | Do this |
| --- | --- |
| **Only ADDS** (table, column, index) | Run `db:deploy` **before** pushing, so new code finds what it needs. Old code ignores additions. |
| **REMOVES** something | **Push first**, wait until **both** projects say **Ready**, **then** run `db:deploy`. The code live before the push may still read what is about to be removed. |

Before a removing migration take a Neon branch. Run migrations with the **direct** string, and check the output ends with "All migrations have been successfully applied".

Write code so it works against both old and new schema where practical (the last migration was verified by running the full e2e suite against each).

## 9.6 Operations runbook

| Situation | What to do |
| --- | --- |
| Site down / 5xx | Vercel → project → Deployments → latest → Logs. Check `/api/health` (503 `database: down` = database unreachable: check Neon status, connection string, project suspended/over limits). |
| Nothing escalates | Settings → Escalation time red? Check cron-job.org execution history; 401 = secret mismatch; 404 = `JOB_SECRET` not set; timeouts = increase to 30 s. Run the Test run. |
| Students not getting verification email | Check `SMTP_*`, sender limits (Gmail 500/day), spam folder; `npm run mail:test`; Vercel logs show "Failed to send …". |
| Uploads fail | R2 CORS rule includes the web origin (PUT/GET/HEAD)? `S3_*` values correct? Bucket exists? |
| Everyone suddenly logged out | `JWT_SECRET` changed, or the refresh cookie path/proxy is wrong (`COOKIE_PATH=/api/auth`, `API_ORIGIN`). |
| "Too many attempts" for many users at once | Rate limits sharing one bucket: check proxy trust (`VERCEL` set; `TRUST_PROXY`) and that Upstash is configured. |
| A category vanished for students | A level lost its last person → staff it (Categories page badge says which level). |
| Need to undo a bad migration | Restore from the Neon branch created before it (point the app at it, or copy data back). Prefer a fix-forward migration where possible. |
| Rotate a secret | Change it in the provider, then in Vercel, redeploy. `JWT_SECRET` logs everyone out. `JOB_SECRET` must also be changed in cron-job.org. |
| A user cannot log in | Verified? Deactivated? (`user.email_verified_at`, `deactivated_at`.) Forgot-password works for verified active accounts. |
| Add an admin | Developer: create/seed the user as `SUPER_ADMIN` then `admin:set-password`. |
| Remove demo/test data | See the go-live checklist (demo `--clean`, test-account deactivation SQL). |

Useful read-only SQL (Neon SQL Editor):
```sql
-- open tickets per category and status
SELECT c.short_name, t.status, count(*) FROM ticket t JOIN category c ON c.id = t.category_id
 WHERE t.status NOT IN ('RESOLVED','CLOSED') GROUP BY 1,2 ORDER BY 1,2;
-- overdue tickets
SELECT id, title, current_level, tat_deadline FROM ticket WHERE tat_deadline < now() AND status NOT IN ('RESOLVED','CLOSED');
-- critical tickets
SELECT id, title, current_level FROM ticket WHERE critical AND status NOT IN ('RESOLVED','CLOSED');
-- when did escalation last run?
SELECT * FROM job_heartbeat;
-- categories missing a level
SELECT c.short_name, l.level FROM category c CROSS JOIN generate_series(1, c.max_level) l(level)
 WHERE c.active AND NOT EXISTS (SELECT 1 FROM poc_assignment a JOIN "user" u ON u.id = a.user_id
   WHERE a.category_id = c.id AND a.level = l.level AND a.active AND u.deactivated_at IS NULL);
```

## 9.7 Scaling and when to leave the free tier

| Symptom | Likely limit | Next step |
| --- | --- | --- |
| Slow first request after quiet time | Neon compute suspend / Vercel cold start | Paid Neon always-on compute; keep the pooled string |
| Database errors under load | connection or compute limits | keep `DB_POOL_MAX=1`, use the pooled string; upgrade Neon |
| Emails delayed or refused | Gmail 500/day | a transactional email provider on a company domain |
| Function timeouts | 30 s configured | optimise the query (analytics reads cap at 5,000 tickets) or raise limits on a paid plan |
| Terms of use concerns | Vercel Hobby non-commercial | Vercel Pro (or another host); the code is portable: `main.ts` runs on any Node host, set `ESCALATION_JOB_ENABLED=true` there |
| Many tickets | queue is keyset-paged and indexed | add indexes for new filters; check `EXPLAIN` |

The API also runs as a normal long-running Node process (`npm run start:prod -w apps/api`) on any host: set the same variables, keep `ESCALATION_JOB_ENABLED=true` (an in-process timer replaces cron-job.org), and `STORAGE_AUTO_SETUP=true` if you want the bucket created at start.

## 9.8 Cost summary
For how many users the free setup handles and what 2,000 users would cost, see [chapter 12](12-capacity-and-cost.md).

All services are on free tiers today: Vercel Hobby ×2, Neon Free, Cloudflare R2 free allowance, Upstash Free, Gmail/Brevo free, cron-job.org free, GitHub Actions free. The recurring risk is not money but **limits and terms** (above): review them before launch and whenever usage grows.
