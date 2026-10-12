# 8. Testing

Two layers, both in `apps/api` (the web app has no automated tests yet: it is checked by lint, type check, build and manual/browser testing).

| Layer | Files | Needs services? | Count (at time of writing) |
| --- | --- | --- | --- |
| **Unit tests** | `src/**/*.spec.ts` | No | 9 suites, 54 tests |
| **End-to-end (e2e) tests** | `test/*.e2e-spec.ts` | Yes: Postgres, S3 storage, Mailpit | 17 suites, 173 tests |

## 8.1 Unit tests

Pure logic with no database: they are fast and run in CI's first job.

| Spec | Covers |
| --- | --- |
| `auth/email-domains.spec.ts` | domain classification, student local-part rule, `+staff` testing trick |
| `attachments/file-rules.spec.ts` | allowed types, size limits, extension matching, magic bytes, file-name sanitising |
| `catalog/staffing.spec.ts` | `missingLevels`, `describeLevels` |
| `settings/tat.spec.ts` | parsing/describing the escalation limit and its fallbacks |
| `analytics/analytics.spec.ts` | text mining (`topTerms`, phrases) and range resolution |
| `common/trust-proxy.spec.ts` | the proxy-trust rule |
| `common/redis-throttler.storage.spec.ts` | the Redis rate-limit store, including fail-open |
| `config/env.spec.ts` | `validateEnv` and `productionProblems` |
| `mail/mail.options.spec.ts` | which mail transport is chosen |

Run: `npm test` (root) or `npm run test -w apps/api`. Watch mode: `npm run test:watch -w apps/api`. Coverage: `npm run test:cov -w apps/api`.

> Jest runs with `--experimental-vm-modules` (already in the npm script). Some ES-module-only packages (for example `@nestjs/config`) cannot be imported by plain unit tests, which is why pure logic such as `resolveTrustProxy` lives in its own file (`common/trust-proxy.ts`) instead of inside `app.setup.ts`.

## 8.2 End-to-end tests

They boot the **real Nest application** (`createTestApp()` in `test/helpers.ts`, which uses the same `configureApp` as production), send real HTTP requests with **supertest**, and use the **real database**, **real S3-compatible storage** and **real Mailpit** (to read verification emails). They are the main safety net.

### Prerequisites
1. `docker compose up -d` (Postgres, RustFS, Mailpit).
2. The test database `nstconnect_test` exists, migrated and seeded (see CONTRIBUTING step 3.9).
3. `.env` exists at the repo root (the global setup reads it).

Run all (serial; a few minutes):
```bash
npm run test:e2e -w apps/api
```
One file:
```bash
npm run test:e2e -w apps/api -- test/reopen.e2e-spec.ts
```
One test by name: add `-t "part of the test name"`.

The npm script sets `NODE_ENV=test`, the two email domains and `DATABASE_URL` for `nstconnect_test`, and uses `--runInBand` (one test file at a time, because they share a database).

### What `NODE_ENV=test` changes
Rate limiting off; mail always to Mailpit; escalation timer off; no artificial delay on forgot-password (see 2.5).

### Safety: `test/global-setup.ts`
Runs once before the suite:
1. **Refuses unless the database name ends with `_test`** (it deletes data).
2. Truncates ticket-related tables (`ticket_feedback, staff_audit, admin_note_receipt, admin_note, ticket_event, attachment, notification, comment, ticket, refresh_token`) and deletes all students and the `app_setting` rows (escalation time back to the default).
3. Deletes staff created by tests (`staff.test.%` emails) and catalogue test data (`Catalog Test %` categories).
4. Resets non-student accounts to "invited" (no password, unverified, not deactivated).
5. Runs the seed with `SEED_RESET=true` so categories, topics and teams are exactly the canonical set.

So no test relies on another having cleaned up perfectly.

### `test/helpers.ts`
| Helper | Does |
| --- | --- |
| `createTestApp()` | boots the app with production HTTP setup |
| `prismaOf(app)` | the app's `PrismaService`, for arranging and checking data |
| `verificationTokenFor(email)` | reads the verification link out of the real email in Mailpit (retries for ~5 s) |
| `registerAndLogin(app, email, name?)` | register → read email → verify → login; returns an access token |
| `loginAsPoc(app, email)` | resets a seeded POC to "invited", then registers and logs in |
| `uniqueStudentEmail()` | a fresh `@adypu.edu.in` address per call |
| `categoryByShortName(app, 'Hostel')` | a category with its active topics |
| `PASSWORD` | the password all test users use |

### What each e2e file covers
| File | Covers |
| --- | --- |
| `auth.e2e-spec.ts` | registration rules, verification, login, refresh rotation and theft detection, logout, deny-by-default access control |
| `password-reset.e2e-spec.ts` | forgot/reset flow, single-use links, cooldown, no account discovery, sessions ended |
| `tickets.e2e-spec.ts` | creating, listing, detail, routing to the least-loaded L1, category staffing rule |
| `identity-contract.e2e-spec.ts` | no staff identity or internal field in any student response |
| `attachments.e2e-spec.ts` | upload flow, type/size/content checks, ownership, limits |
| `poc-workflow.e2e-spec.ts` | scope by category and level, reply, in progress, solve/close/escalate with notes, finished tickets locked |
| `bulk.e2e-spec.ts` | bulk actions and partial failures |
| `queue-paging.e2e-spec.ts` | cursor paging and sorts under change |
| `escalation.e2e-spec.ts` | the job: warnings, overdue → escalate, skipping empty levels, critical at the top, idempotence, leave, external trigger endpoint and its secret |
| `reopen.e2e-spec.ts` | reopen routing, fresh clock, final outcome at the top level |
| `self-close.e2e-spec.ts` | student close/reopen, analytics ignore it |
| `feedback.e2e-spec.ts` | rating rules, 7-day change window, re-rating after reopen, anonymity, analytics credit and the 5-answer threshold |
| `staff.e2e-spec.ts` | team management rules, reach, leave and hand-over, removal rules, audit |
| `catalog.e2e-spec.ts` | categories/topics, rename notes, removal blocked by open tickets, restore |
| `settings.e2e-spec.ts` | escalation time range, who may change it, effect on new deadlines only |
| `notes.e2e-spec.ts` | notes, receipts, seen counts, who may read |
| `analytics.e2e-spec.ts` | scopes and numbers |

## 8.3 Writing a new e2e test (recipe)

```ts
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { categoryByShortName, createTestApp, loginAsPoc, prismaOf, registerAndLogin, uniqueStudentEmail } from './helpers';

describe('My feature (e2e)', () => {
  let app: INestApplication;
  beforeAll(async () => { app = await createTestApp(); });
  afterAll(async () => { await app.close(); });

  it('lets a student do X and refuses Y', async () => {
    const student = await registerAndLogin(app, uniqueStudentEmail());
    const poc = await loginAsPoc(app, 'hostel.l1.1@newtonschool.co');
    const category = await categoryByShortName(app, 'Hostel');
    const server = app.getHttpServer();

    const created = await request(server)
      .post('/tickets')
      .set('Authorization', `Bearer ${student}`)
      .send({ title: 'Test ticket', description: 'A long enough description', subCategoryId: category.subCategories[0].id })
      .expect(201);

    // ... act, then assert the response AND the database (prismaOf(app).ticketEvent.findMany(...))
  });
});
```
Guidelines:
- Test **the allowed case, each refusal** (wrong role, someone else's ticket, bad input, wrong state) **and the data written** (events, status, deadline).
- To test time-based behaviour, move data in the database (`UPDATE ticket SET tat_deadline = ...`) and call the job directly or via `POST /internal/escalation/run`.
- Use `uniqueStudentEmail()` so runs never collide. Do not depend on test order.
- Do not weaken a test to make it pass; fix the code or explain in the pull request.

## 8.4 Continuous integration (`.github/workflows/ci.yml`)

Runs on every pull request and every push to `main`, Node 24.

**Job 1: "Lint, unit tests, build"**: `npm ci` → `npm run db:generate -w apps/api` → `npm run lint` → `npm test` → `npm run build`.

**Job 2: "End-to-end tests"**: `npm ci` → `docker compose up -d` → wait for Postgres and Mailpit → create `nstconnect_test` → `cp .env.example .env` → `prisma generate` and `prisma migrate deploy` on the test database → **schema drift check** (`prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code`; fails if `schema.prisma` and the migrations disagree) → `npm run test:e2e -w apps/api`.

A pull request cannot merge while CI is red.

## 8.5 Manual and browser testing
For UI changes: run both apps with demo data (`npm run db:demo-data -w apps/api`, then `db:activate-staff`), exercise the flow as each affected role on desktop and a narrow mobile window, and look for console errors. For refactors of screens, compare before/after (page structure and screenshots) as was done for the analytics split. Remove demo data afterwards.
