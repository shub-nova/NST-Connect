# Deploying NST Connect (free tiers, both apps on Vercel)

Two Vercel projects from this one repository, plus a few free services.

> **Testing mode:** while testing, extra email domains (Gmail) and demo data are allowed. Before real users arrive, follow [docs/go-live-checklist.md](docs/go-live-checklist.md).


| Part | Where | Free plan |
| --- | --- | --- |
| Web app (`apps/web`) | Vercel project **nst-connect-web** | Vercel Hobby |
| API (`apps/api`) | Vercel project **nst-connect-api** (serverless function) | Vercel Hobby |
| Database | Neon (Postgres) | Free |
| File uploads | Cloudflare R2 (or Backblaze B2, Supabase Storage) | Free |
| Rate-limit counters | Upstash Redis | Free |
| Email | Gmail SMTP (or Brevo) | Free |
| Escalation schedule | GitHub Actions | Free |

Free plans change. Check each provider's current limits before relying on them.

**How logins keep working:** the browser only ever talks to the web project's address. Anything under `/api/...` is forwarded to the API project, so the login cookie belongs to one site and survives a page refresh. (Two separate `*.vercel.app` addresses would otherwise count as different sites.)

---

## 0. Before you start

- Put the code on GitHub (a private repository is fine) and push `main`.
- Decide the project names, because they set the addresses. Below we assume
  `https://nst-connect-web.vercel.app` (web) and `https://nst-connect-api.vercel.app` (API). Use your real ones.
- Make a long random secret for the API, and another for the escalation job:
  ```bash
  node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
  ```
  Run it twice: one is `JWT_SECRET`, the other is `JOB_SECRET`. Never reuse the development ones.

## 1. Database (Neon)

1. Create a project at neon.tech and a database.
2. Copy **two** connection strings from the dashboard:
   - the **pooled** one (the host contains `-pooler`): used by the running API, as `DATABASE_URL`
   - the **direct** one: used only to create the tables
3. Create the tables and the starting data, from your computer, using the **direct** string:
   ```bash
   DATABASE_URL='<direct connection string>' npm run db:deploy -w apps/api
   DATABASE_URL='<direct connection string>' ADMIN_EMAIL='you@newtonschool.co' npm run db:seed:production -w apps/api
   ```
   The seed creates the 11 categories, their 57 sub-categories and one admin account (no password yet). It does **not**
   create any made-up POC accounts. If you can open the `ADMIN_EMAIL` mailbox, sign up with it in the app. If you
   cannot (for example a shared `admin@` address), set the password directly instead. It asks at a hidden prompt:
   ```bash
   DATABASE_URL='<direct connection string>' ADMIN_EMAIL='admin@newtonschool.co' npm run admin:set-password -w apps/api
   ```
   This only works for an existing Super Admin and also marks the address verified.
4. Whenever a new version adds database changes, run the `db:deploy` line again **before** deploying.

## 2. File storage (Cloudflare R2)

1. Create a bucket (for example `nst-connect-attachments`) and an API token with read and write access to it.
2. Note the S3 address (`https://<account-id>.r2.cloudflarestorage.com`), the access key and the secret.
3. The bucket must allow uploads from the web app (CORS). An **Object Read & Write** token cannot change CORS, so
   `npm run storage:setup -w apps/api` fails with "Access Denied". Set it in the dashboard instead: bucket → **Settings →
   CORS Policy → Add**, and paste (with your real web address):
   ```json
   [{"AllowedOrigins":["https://<your-web-address>"],"AllowedMethods":["PUT","GET","HEAD"],"AllowedHeaders":["*"],"ExposeHeaders":["ETag"],"MaxAgeSeconds":3000}]
   ```
   `storage:setup` only works with a temporary **Admin Read & Write** token.

## 3. Rate-limit counters (Upstash Redis)

Create a free Redis database at upstash.com and copy its **REST URL** and **REST token**. Without it, the rate limits only
count inside each serverless instance and are much weaker.

## 4. Email

Gmail: turn on 2-Step Verification, create an app password at https://myaccount.google.com/apppasswords, and use
`smtp.gmail.com`, port `587`, your Gmail address as `SMTP_USER` and the app password as `SMTP_PASS`. Check it from your computer first:
```bash
npm run mail:test -w apps/api -- your-address@gmail.com
```
Emails to `@adypu.edu.in` inboxes may land in spam at first, because the sender is a Gmail address.

## 5. The API project (Vercel)

1. Vercel → **Add New → Project** → import the repository.
2. **Name:** `nst-connect-api`. **Root Directory:** `apps/api`. Leave "include source files outside the Root Directory" on.
   **Node.js version:** 24.x (also set by `engines` in `apps/api/package.json`; NestJS 12 is an ES module and the API loads it with `require`, which needs a current Node). The settings in `apps/api/vercel.json` do the rest.
3. If the build says it cannot find packages, set the **Install Command** to `cd ../.. && npm ci`.
4. Add these **Environment Variables** (Production):

   | Name | Value |
   | --- | --- |
   | `NODE_ENV` | `production` |
   | `DATABASE_URL` | the Neon **pooled** string |
   | `DB_POOL_MAX` | `1` |
   | `JWT_SECRET` | the first random secret |
   | `WEB_URL` | `https://nst-connect-web.vercel.app` |
   | `COOKIE_PATH` | `/api/auth` |
   | `TRUST_PROXY` | `true` |
   | `STUDENT_EMAIL_DOMAIN` | `adypu.edu.in` (one domain only) |
   | `POC_EMAIL_DOMAIN` | `newtonschool.co` |
   | `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` | your mail provider |
   | `MAIL_FROM` | `NST Connect <your sender address>` |
   | `S3_ENDPOINT` / `S3_REGION` / `S3_BUCKET` / `S3_ACCESS_KEY` / `S3_SECRET_KEY` | your storage (R2 region is `auto`) |
   | `STORAGE_AUTO_SETUP` | `false` |
   | `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | from Upstash |
   | `ESCALATION_JOB_ENABLED` | `false` |
   | `JOB_SECRET` | the second random secret |

5. Deploy. Open `https://nst-connect-api.vercel.app/api/health`: you should see `{"status":"ok","database":"up"}`.
   If the deploy fails with "This is not safe to run in production yet", the message lists exactly which settings to fix.

## 6. The web project (Vercel)

1. **Add New → Project** → the same repository.
2. **Name:** `nst-connect-web`. **Root Directory:** `apps/web`. **Node.js version:** 22.
3. **Environment Variables:**

   | Name | Value |
   | --- | --- |
   | `API_ORIGIN` | `https://nst-connect-api.vercel.app` |
   | `NEXT_PUBLIC_API_URL` | `/api` |

4. Deploy. Open `https://nst-connect-web.vercel.app/api/health`: the same JSON as above means the forwarding works.

## 7. One-time setup after both are live

1. Put the **real** web address in `WEB_URL` (API project) if you used a different one, and redeploy the API.
2. From your computer, with the production storage values in `.env`:
   ```bash
   npm run storage:setup -w apps/api
   ```
3. **GitHub → repository → Settings → Secrets and variables → Actions**, add:
   - `API_URL` = `https://nst-connect-api.vercel.app`
   - `JOB_SECRET` = the second random secret

   The "Escalation check" workflow then calls the API every hour (at 7 minutes past; every 15 minutes would use up the 2,000 free Actions minutes of a private repository). Run it once by hand (Actions → Escalation check →
   Run workflow) and look for a result like `{"escalated":0,...}`.
4. **Admin:** open the web address → Sign up with the `ADMIN_EMAIL` address, click the link in the email, then log in. You land on
   **All teams**. From **Settings**, add the L3 people for each category; they add L2s, who add L1s. People can also sign up
   themselves and then be added.

## 8. Check it after the first deploy

- [ ] The login page loads, and `/api/health` works on **both** addresses.
- [ ] A student can sign up with an `@adypu.edu.in` address and the verification email arrives.
- [ ] After logging in, **refresh the page**: you stay logged in. (If not, check `COOKIE_PATH` and `API_ORIGIN`.)
- [ ] A student can raise a ticket and attach a file; a POC can open the file.
- [ ] The scheduled workflow runs green.
- [ ] Hammering the login with wrong passwords gets blocked after a while (this proves the Redis counters work).

## If something fails

- **`ERR_REQUIRE_ESM` ... `@nestjs/core`:** Vercel will not `require()` an ES module, and NestJS 12 is one. The build already folds
  `@nestjs/*` into `dist/serverless.bundle.js` (`apps/api/scripts/bundle-serverless.mjs`) and the function loads that file.
  If you see this error, that step did not run: check the build log for "serverless.bundle.js".
- **"Cannot find module argon2" or a missing `.node` file:** the password library has a native part that Vercel may not
  bundle. Fix: switch the dependency to `@node-rs/argon2` (same hash format, so existing passwords still work). Ask for help
  with this swap.
- **A missing Prisma `.wasm` file:** the database client could not be traced. Add its folder to `includeFiles` in
  `apps/api/vercel.json`.
- **Everything works but the first request is slow:** a cold start (a second or two). Normal.
- **Uploads fail in the browser:** run `npm run storage:setup -w apps/api` again, with the right `WEB_URL` and storage values.

## Updating later

Push to `main`. Both projects redeploy on their own. If the change adds database tables, run `db:deploy` (step 1.4) first.
