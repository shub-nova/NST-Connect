# 3. Backend architecture (`apps/api`)

A NestJS 12 application. Everything is under `apps/api/src`. Routes have **no `/api` prefix** inside the app (`/auth/login`, `/tickets`); in production the Vercel entry file strips the `/api` that the web project adds (see 3.9).

## 3.1 How a request travels

```
HTTP request
  → Express (helmet headers, cookie-parser, CORS for WEB_URL with credentials, trust-proxy setting)
  → Global guard 1: ThrottlerGuard   (rate limit; 120 requests/min per address by default; skipped when NODE_ENV=test)
  → Global guard 2: JwtAuthGuard     (Authorization: Bearer <access token>; skipped for @Public() endpoints)
  → Global guard 3: RolesGuard       (if the endpoint has @Roles(...), the caller's role must be in the list; else 403)
  → Controller method                (validates input with a zod schema via parseOrThrow → 400 with issues)
  → Service                          (all rules; talks to Prisma / raw SQL / storage / mail)
  → Response (JSON)
```
The order is fixed in `AppModule.providers` and is intentional: rate limit first (so attackers are throttled before any work), then identity, then role.

### The three decorators (`common/decorators.ts`)
- `@Public()` — opt out of login (register, login, verify, forgot/reset password, refresh, logout, health, escalation job).
- `@Roles(Role.POC, ...)` — restrict by role. Placed on a controller or a method.
- `@CurrentUser()` — parameter decorator giving `{ id, role }` taken from the verified token. **Controllers always use this, never an id from the request body.**

### Input validation (`common/zod.ts`)
Every controller defines `zod` schemas at the top of the file and calls `parseOrThrow(schema, body)`. A failure returns HTTP 400:
```json
{ "message": "Validation failed", "issues": [{ "path": "title", "message": "Add a title (at least 3 characters)" }] }
```
The web client's `ApiError` turns `issues` into a sentence for the user.

### Errors
Services throw Nest HTTP exceptions: `BadRequestException` (400), `UnauthorizedException` (401), `ForbiddenException` (403), `NotFoundException` (404), `ConflictException` (409, "this ticket is already finished"), `UnprocessableEntityException` (422, a stored file failed inspection). **Not found is used deliberately for "exists but not yours"** so existence of other people's data is not revealed.

## 3.2 Start-up and configuration

| File | Role |
| --- | --- |
| `main.ts` | Normal server: `NestFactory.create(AppModule)` → `configureApp(app)` → listen on `PORT`. Used locally and on any always-on host. |
| `app.setup.ts` | `configureApp(app)`: sets Express `trust proxy` (via `resolveTrustProxy`), `helmet()`, `cookieParser()`, CORS (`origin = WEB_URL`, `credentials = true`). **Shared by `main.ts`, `serverless.ts` and the e2e tests** so tests run the same HTTP setup as production. |
| `serverless.ts` | The Vercel function: builds the Nest app once per instance on an Express server (shared promise so concurrent cold-start requests share one start-up; a failed start is retried), then forwards every request. |
| `app.module.ts` | Wires `ConfigModule` (loads `../../.env`, runs `validateEnv`), `ThrottlerModule` (Redis store if Upstash is configured), all feature modules and the three global guards. |
| `config/env.ts` | The zod schema for every setting, `productionProblems`, `validateEnv`. |
| `common/trust-proxy.ts` | `resolveTrustProxy(setting, onVercel)`: trusted automatically on Vercel; elsewhere only when `TRUST_PROXY` says so. Needed because the rate limiter keys on `req.ip`; without it every visitor would look like the same address behind the proxy and share one bucket. |
| `health.controller.ts` | `GET /health` (public): runs `SELECT 1`; `{"status":"ok","database":"up"}` or 503. |
| `prisma/prisma.service.ts` | `PrismaClient` with the `pg` driver adapter and `DB_POOL_MAX`; connects on module init, disconnects on destroy. |

## 3.3 Modules, one by one

For each module: what it owns, the important rules, the key functions.

### AuthModule (`auth/`)
Files: `auth.controller.ts`, `auth.service.ts`, `jwt-auth.guard.ts`, `roles.guard.ts`, `email-domains.ts`, `auth.module.ts` (registers a **global** `JwtModule` with `JWT_SECRET`).

- **Register** (`POST /auth/register`, 10/min): classifies the email by domain. Student: creates the user (role `STUDENT`, `enrollmentId` = part before `@`) or, if an **unverified** account exists, replaces its name and password (so a student whose link expired can sign up again). Staff-domain: creates a `POC` user **with no assignment** (or updates an unverified one). **An admin can never register.** Sends a verification email (JWT with `purpose: 'verify'`, 24 h). Always answers `202` with the same message so it cannot be used to discover accounts.
- **Invitations** (`auth/invite.ts`): the staff invitation email links to `/register?invite=<token>`. The token is a JWT `{ purpose: 'invite', email }` valid 14 days (`signInvite`, `readInvite`). `GET /auth/invite?token=` (public, 20/min) returns the invited `{ email, name }` so the sign-up page can show and lock them (400 invalid/expired; 409 if the account already has a password). `POST /auth/register` accepts an optional `invite`: when present it must be valid **and its email must equal the registering email**, otherwise 400 ("sent to a different email address"). Sign-up without an invitation still works for staff domains and creates an account with no assignment.
- **Verify** (`POST /auth/verify`): checks the token (`purpose` must be `verify`), sets `emailVerifiedAt` if still null.
- **Login** (`POST /auth/login`, 10/min): looks up the user, verifies the password **even for unknown emails** (against a dummy hash) to keep timing equal. Order of refusals: wrong credentials → 401 "Invalid email or password."; deactivated → 403; unverified → 403. Success issues tokens.
- **Tokens** (`issueTokens`): access token = JWT `{ sub, role, purpose: 'access' }`, 15 minutes. Refresh token = 48 random bytes (base64url), stored only as a **SHA-256 hash** in `refresh_token` with an expiry (7 days); sent as an **httpOnly, SameSite=Lax, Secure (in production)** cookie `refresh_token` with path `COOKIE_PATH`.
- **Refresh** (`POST /auth/refresh`): rotates the token (old one marked `revokedAt`, new one issued). A token that comes back **within 10 seconds** of rotation is accepted (two tabs or a double fire race); one that comes back **later** means theft: **every** session of that user is revoked (marked with the epoch so the grace window can never apply) and 401 is returned. Expired or deactivated users get 401.
- **Logout** (`POST /auth/logout`, 204): marks the presented token (and any token of that account rotated in the last 10 seconds) with the **epoch**, so it cannot be refreshed even inside the rotation grace window, and clears the cookie. A token carrying the epoch is answered with 401 without touching the user's other sessions.
- **`GET /auth/me`**: current user.
- **Forgot password** (`POST /auth/forgot-password`, 5/min): only a verified, active user *with a password* gets a link; at most one per 2 minutes (`passwordResetSentAt`); always answers 202 and always takes at least 1.5 s (so timing reveals nothing; 0 in tests). Link = JWT `{ sub, purpose: 'reset', fp }`, valid 1 hour, where `fp` = first 24 hex chars of SHA-256 of the **current password hash**.
- **Reset password** (`POST /auth/reset-password`, 10/min): verifies the JWT, loads the user, checks `fp` still matches (so the link works **once**: changing the password changes the fingerprint), hashes the new password and updates with `where: { id, passwordHash: old }` (so two simultaneous uses cannot both win), then revokes **all** refresh tokens.
- `JwtAuthGuard` and `RolesGuard` are described in 3.1. The JWT `purpose` claim stops a verification or reset token being used as an access token.

### TicketsModule (`tickets/`) — the student side
Files: `tickets.controller.ts`, `tickets.service.ts`, `routing.ts`, `ticket-status.ts`, `student-view.ts`.

- `GET /categories`: only categories that are active, have at least one active topic **and** are staffed at every level (`missingLevels` empty). Returns id, name, shortName and active topics.
- `POST /tickets` (student): validates (title 3–200, description 10–5000, `subCategoryId`), re-checks that the category is staffed (a stale page or direct call must not bypass the picker), then **in one transaction**: picks the owner (`pickLeastLoadedOwner`) starting at level 1 and moving up if nobody is on duty (if nobody at any level the ticket stays `CREATED` with no owner and no deadline); creates the ticket (`ASSIGNED`, deadline = now + limit); writes the `CREATED` and `ASSIGNED` events and a `NEW_TICKET` notification row. Returns the student view.
- `GET /tickets` (cursor-paged, filters by status, category, date range) and `GET /tickets/:id` (always `where studentId = me`; anything else is 404).
- `POST /tickets/:id/close` (student closes own ticket): locks the row; refuses if already finished; writes `CLOSED_BY_STUDENT`; sets `status = CLOSED`, `closedByStudent = true`, clears deadline/warning/critical.
- `POST /tickets/:id/reopen`: locks the row; requires `RESOLVED` or `CLOSED`; refuses if `canReopen` is false (finished at the top level); picks an owner starting at the level that finished it (or the current level for a student-closed ticket) going upward; writes `REOPENED` event, the student's comment (public), a notification; resets the ticket (`REOPENED`, new level/owner, fresh deadline, clears warning/critical/resolved fields).
- `POST /tickets/:id/feedback`: only for finished tickets; attaches to the **latest** `RESOLVED`/`CLOSED` event (so a reopened and re-finished ticket can be rated again); changeable for 7 days; stores who finished it and at which level (the credit analytics use); upsert on `finishEventId`.
- `routing.ts` → `pickLeastLoadedOwner(tx, categoryId, level)`: among active, not-on-leave assignments at that category and level, the one with the **fewest open tickets**, **preferring people who have an account** (someone added but not yet registered cannot see their queue, so they are used only when nobody registered is available) (`status NOT IN FINISHED_STATUSES`). Used by create, reopen, escalation, hand-over.
- `student-view.ts`: the response types and the mappers. Contains `timelineLabel` (team wording only), `STATUS_LABELS`, `toStudentSummary` (built field by field). The header comment is the contract: **never spread a database row**.
- `ticket-status.ts`: `FINISHED_STATUSES = [RESOLVED, CLOSED]`, `OWNED_OPEN_STATUSES = [ASSIGNED, IN_PROGRESS, ESCALATED, REOPENED]` (a `CREATED` ticket has no owner).

### AttachmentsModule (`attachments/`) and StorageModule (`storage/`)
Student-only (`@Roles(STUDENT)`). Flow and rules are in 7.6. Files: `file-rules.ts` (allowed types, sizes, magic-byte checks, `sanitizeFileName`, `MAX_ATTACHMENTS_PER_TICKET = 10`), `attachments.service.ts` (`requestUpload`, `confirm`, `downloadUrl`), `storage.service.ts` (S3 client wrapper: `ensureBucketAndCors`, `presignUpload`, `presignDownload`, `head`, `readHead`, `remove`).

### PocModule (`poc/`) — the staff work screen
Files: `poc.controller.ts`, `poc.service.ts`, `queue-query.ts`. `@Roles(Role.POC)` on the whole controller.

- **Scope** (`pairs`/`scope`): the POC's active `poc_assignment` rows → a list of `(categoryId, level)` pairs. **Every query is limited to these pairs**: queue, detail, attachments, every action. A ticket outside the pairs (or one that moved to another level) is a plain 404. A POC with no assignment gets an empty queue with `assigned: false`.
- **Queue** (`GET /poc/queue?view=open|done&sort=…&limit=…&cursor=…`): keyset ("cursor") paging in SQL (`queue-query.ts`). Each ticket gets a two-number sort key plus its id; a page is "the next N after this key", which stays correct while tickets change and is fast for long queues. Sorts: `time-left` (open only; critical first, then soonest deadline, no-deadline last), `oldest`, `newest` (by created time for open, finished time for done). Also returns `counts` for both tabs.
- **Detail**: everything including the **internal** events (missed time limit, hand-overs, escalation reasons). Students never get these.
- **Actions** all go through one private function `act(pocId, ticketId, action)`: checks scope, then **in one transaction**: `SELECT … FOR UPDATE` on the ticket, re-reads it within scope, refuses finished tickets (409), runs the action (which writes its own events/notifications and returns the field changes), then `update` with `assignedPocId = pocId` (**acting claims the ticket**) plus the changes. The deadline is **not** touched unless the action says so.
  - `comment` → comment + `COMMENTED` event + student notification; if the status was `ASSIGNED/ESCALATED/REOPENED` it also marks `IN_PROGRESS`.
  - `setInProgress` → `STATUS_CHANGED` event; 409 if already in progress.
  - `close(outcome, note)` → `SOLVED`/`CLOSED`: event `RESOLVED`/`CLOSED` with the note, status `RESOLVED`/`CLOSED`, `resolvedAt`, `resolvedLevel`, clears deadline/warning/critical, notifies the student. `ESCALATED`: requires a next level (else 409 "already at the highest level") with someone on duty (else 409 "No one is on duty at the next level."), writes `ESCALATED` (reason `MANUAL`, note), notifies student and new owner, resets the clock.
  - `bulk` → up to 50 ids, **each in its own transaction** with exactly the same rules; failures are returned per ticket (`failed: [{id, reason}]`) and do not stop the rest. The web client sends groups of 50.
- Notes are mandatory (5–2000) for solve/close/escalate; a reply only needs text (1–5000). Enforced in the controller schemas.

### EscalationModule (`escalation/`)
`escalation.service.ts` (the job), `escalation.scheduler.ts` (in-process timer for always-on hosts), `escalation.controller.ts` (`POST /internal/escalation/run`, public but needs `x-job-secret`, constant-time comparison, 404 when `JOB_SECRET` is unset). Full algorithm in [chapter 5](05-ticket-lifecycle-and-escalation.md).

### StaffModule (`staff/`) — teams
`staff.controller.ts` (`@Roles(POC, SUPER_ADMIN)`), `staff.service.ts`, `handoff.ts`.
- **Reach** (`reach(actor)`): the admin reaches every active assignment. A POC reaches the assignments **below** their own L2/L3 assignments by walking `managerAssignmentId` links (breadth-first). An L1 gets 403 ("Settings is for L2, L3 and the admin."). Anything outside reach is 404.
- `team`, `options`, `audit` (read); `add`, `update`, `setLeave`, `remove`, `resendInvite` (write). Rules (staff domain, below your own level, manager choice, "only L at level", "has reports", not yourself) are in the user guides and enforced here.
- `handOffOpenTickets(tx, from, actorId, reason)` (`handoff.ts`): used on leave and removal. For each open ticket (locked, oldest first): another on-duty POC at the same level (least loaded) → `REASSIGNED` event (internal) and `NEW_TICKET` notification; else the next level with someone → status `ESCALATED` with reason `ON_LEAVE`; else left in place and `CRITICAL` notifications to admins. Every moved ticket gets a fresh deadline.
- Removal never deletes: assignment `active = false`; if the user has no other active role they get `deactivatedAt` and their refresh tokens are deleted. Every change writes a `staff_audit` row.
- `endExpiredLeaves` is also run by the escalation job.

### CatalogModule (`catalog/`) — categories and topics (admin)
`catalog.service.ts`, `catalog.controller.ts` (`@Roles(SUPER_ADMIN)`), `staffing.ts`. `missingLevels(maxLevel, staffedLevels)` and `STAFFING_WHERE` (an active assignment held by someone not deactivated) define "staffed". Rename adds a public `RENAMED` event to each **open** ticket; remove is `active = false`, refused while open tickets exist; a live category keeps at least one active topic; names are unique ignoring case (a removed name must be restored instead).

### SettingsModule (`settings/`) — escalation time (admin)
`GET/PUT /settings/escalation`. `tat.ts` defines `DEFAULT_TAT_HOURS = 48`, `MIN_TAT_DAYS = 1`, `MAX_TAT_DAYS = 14`, `TAT_SETTING_KEY = 'escalation_hours'`, `parseTatHours` (anything invalid falls back to 48 so a bad row can never switch escalation off), `getTatHours(db)` (reads inside the same transaction that sets a deadline), `deadlineAfter`, `describeTat`. The setting lives in `app_setting`; a change writes a `staff_audit` row. The GET also returns `lastRunAt` from `job_heartbeat`.

### NotesModule (`notes/`) — admin notes to POCs
Admin sends (`POST /notes`) to a category, a level or one POC; audience is fixed at send time as one `admin_note_receipt` row per recipient; each recipient is emailed. `sent` (admin's last 20 with seen counts), `mine` (POC's last 20), `markSeen`, `unreadCount` (used by `/analytics/access`).

### AnalyticsModule (`analytics/`)
`analytics.controller.ts`, `analytics.service.ts` (decides **which scope** each person may see), `analytics.engine.ts` (all the SQL), `range.ts` (period parsing: `from`/`to` as UTC days, default last 30, max 366, bucket `day` up to 45 days else `week`), `words.ts` (top words/phrases with stop words; each term counted once per ticket; comment phrases need ≥ 2 mentions).
- Scopes: **me** (tickets that passed through me), **team** (people below me in my categories; L2/L3 only), **overall** (my whole category, read-only; any POC), **admin** (any filter, or per-category comparison).
- A POC's scope comes **only** from their own assignments, never from request parameters.
- `AnalyticsEngine.headline(scope, range)` and `.dashboard(scope, range)`: every view runs the **same queries** with a different scope, so numbers always agree. Definitions are in the user-facing "How these numbers are calculated" box and the class comment.
- `GET /analytics/access` tells the web which menu items to show and the unread notes count and leave state.

### MailModule (`mail/`)
`MailService.send` never fails a request (errors are logged); `sendStrict` is used by `mail:test`. `buildTransportOptions` (`mail.options.ts`) chooses Mailpit (no `SMTP_USER`, or `NODE_ENV=test`) or a real provider (TLS rules above).

### PrismaModule, common
`PrismaModule` exports `PrismaService`. `common/redis-throttler.storage.ts` is the Redis-backed throttler store (fails **open** if Redis is down: a rate-limit outage must not lock everyone out).

## 3.4 Patterns used everywhere

1. **Transaction + row lock** for any change where two actors could collide:
   ```ts
   await this.prisma.$transaction(async (tx) => {
     await tx.$queryRaw`SELECT id FROM ticket WHERE id = ${ticketId}::uuid FOR UPDATE`;
     // re-read, check state, write events + notifications + the ticket update
   });
   ```
2. **Event on every change.** `tx.ticketEvent.create` in the same transaction as the update. The timeline, analytics and audit all read events.
3. **Notification rows** are created next to the event (`tx.notification.create`) even though nothing delivers them yet (see known gaps).
4. **Student view mappers** for anything a student reads; **staff views** may include more.
5. **Raw SQL** (`$queryRaw` with tagged templates, so values are parameterised) for the queue, escalation claim, analytics and locks. Never string-concatenate SQL.
6. **Shared constants/helpers** instead of copies (statuses, owner picking, deadline maths, hand-off).
7. **404 for out-of-scope data**, 409 for "state does not allow this", 400 for bad input, 403 for "your role/level cannot".

## 3.5 File map (every source file)

```
src/
  main.ts, serverless.ts, app.module.ts, app.setup.ts, health.controller.ts
  config/env.ts                       settings schema + production checks
  common/decorators.ts                @Public, @Roles, @CurrentUser
  common/zod.ts                       parseOrThrow
  common/trust-proxy.ts               proxy trust rule
  common/redis-throttler.storage.ts   shared rate-limit counters
  prisma/prisma.module.ts, prisma.service.ts
  auth/       auth.controller.ts, auth.service.ts, auth.module.ts, jwt-auth.guard.ts, roles.guard.ts, email-domains.ts
  tickets/    tickets.controller.ts, tickets.service.ts, tickets.module.ts, routing.ts, ticket-status.ts, student-view.ts
  attachments/ attachments.controller.ts, attachments.service.ts, attachments.module.ts, file-rules.ts
  storage/    storage.service.ts, storage.module.ts
  poc/        poc.controller.ts, poc.service.ts, poc.module.ts, queue-query.ts
  escalation/ escalation.controller.ts, escalation.service.ts, escalation.scheduler.ts, escalation.module.ts
  staff/      staff.controller.ts, staff.service.ts, staff.module.ts, handoff.ts
  catalog/    catalog.controller.ts, catalog.service.ts, catalog.module.ts, staffing.ts
  settings/   settings.controller.ts, settings.service.ts, settings.module.ts, tat.ts
  notes/      notes.controller.ts, notes.service.ts, notes.module.ts
  analytics/  analytics.controller.ts, analytics.service.ts, analytics.engine.ts, analytics.module.ts, range.ts, words.ts
  mail/       mail.service.ts, mail.options.ts, mail.module.ts
  generated/prisma/                   GENERATED client (git-ignored; never edit)
```
`*.spec.ts` files next to sources are unit tests (see [testing](08-testing.md)).

## 3.6 Adding a new endpoint (recipe)

1. Decide who may call it: `@Public()`, or `@Roles(...)`, or any logged-in user.
2. In the controller: write the zod schema, call `parseOrThrow`, pass `user.id` (from `@CurrentUser()`) to the service.
3. In the service: put the rule in one method. If it changes a ticket, use the transaction + lock + event pattern. If a student can read the result, build it field by field in `student-view.ts`.
4. Add an end-to-end test in `apps/api/test/` (allowed case, refused cases, written data).
5. Update [the API reference](11-api-reference.md) and the user guide if behaviour changed.

## 3.7 Performance notes
- Indexes (see [chapter 4](04-database.md)) back the queue (`status, current_level, tat_deadline`), the student list (`student_id, created_at`), the category counts (`category_id, status`) and the least-loaded lookup (`assigned_poc_id, status`).
- Analytics run many aggregate queries in parallel with `Promise.all`; text mining reads at most 5,000 tickets and 2,000 comments per view.
- The escalation job processes at most 500 tickets per run (`MAX_TICKETS_PER_RUN`); the next run continues.
- `DB_POOL_MAX=1` per serverless instance keeps connections within the free database limit.

## 3.8 Logging
Nest's logger is used (`new Logger(Class.name)`). Notable lines: mail readiness at start, a warning at every start while test domains are allowed, escalation run summaries when anything happened, failed email sends, rate-limit storage failures. Vercel shows them in each deployment's logs.

## 3.9 The Vercel function (how the API runs in production)

1. `npm run build` in `apps/api` runs `prisma generate`, `nest build` (compiles to `dist/`), then `scripts/bundle-serverless.mjs`.
2. The bundle script uses **esbuild** to fold `@nestjs/*` into one CommonJS file `dist/serverless.bundle.js` (everything else stays an external dependency Vercel installs). Reason: Vercel's Node runtime will not `require()` an ES module and NestJS 12 is one. It bundles the **compiled** `dist/serverless.js`, not the TypeScript, so decorator metadata is already emitted.
3. `vercel.json`: `rewrites: /api/(.*) → /api`, function `api/index.js` with `maxDuration: 30` and `includeFiles: dist/**`.
4. `api/index.js` requires the bundle, strips the leading `/api` from `req.url`, and calls the handler from `serverless.ts`.
5. The first request in a cold instance pays the Nest start-up; later requests reuse it.
