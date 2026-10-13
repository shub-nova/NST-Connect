# 7. Security

The app holds students' complaints and staff identities, so security is a feature. This chapter lists every control, where it lives in the code, and how to keep it intact.

## 7.1 Threats we design against

| Threat | Main defences |
| --- | --- |
| Guessing or stealing passwords | argon2id hashing, rate limits, uniform error messages, equal timing, password reset that ends all sessions |
| Stealing a login | Access token only in memory; refresh token in an httpOnly cookie, rotated, hashed at rest, theft detection |
| A user reading another user's data | `@Roles`, queries scoped by `studentId` / category+level, 404 for out-of-scope data |
| A student learning who staff are | Field-by-field student views, `INTERNAL` events, a contract test |
| Account discovery (who is registered) | Same response and same timing for register/forgot-password |
| Malicious uploads | Type allow-list, size limits, magic-byte inspection, no SVG, signed URLs, random storage keys |
| Abuse and flooding | Global and per-route rate limits (Redis-backed), reset-email cooldown, page-size caps |
| Misconfiguration going live | Production start-up checks refuse unsafe settings |
| Injection | zod validation, parameterised SQL (Prisma and tagged `$queryRaw`), React escaping |
| Clickjacking / sniffing | Security headers on pages (`next.config.ts`) and API (`helmet`) |

## 7.2 Authentication

- **Passwords:** argon2id (`argon2` package), minimum 10 characters, maximum 128 (to bound hashing work).
- **Email verification:** a user cannot log in until `emailVerifiedAt` is set by a signed link (JWT `purpose: 'verify'`, 24 h).
- **Staff invitations:** the link carries a signed token naming the invited address (`invite` purpose, 14 days). The sign-up page locks the address and the server enforces it, so an invitation cannot be used to register a different address. Open staff sign-up (without an invitation) is still allowed on the staff domain, but creates an account with **no assignment**, which sees nothing until someone adds that address.
- **Login errors:** wrong email *and* wrong password both give "Invalid email or password." The password is verified against a dummy hash for unknown emails, so response time does not reveal whether the address exists.
- **Access token:** JWT (HS256 via `JWT_SECRET`), claims `{ sub, role, purpose: 'access' }`, 15 minutes. `JwtAuthGuard` rejects tokens whose `purpose` is not `access`.
- **Refresh token:** random 48 bytes; only its SHA-256 is stored (`refresh_token.token_hash`), so a database leak does not yield usable tokens. Cookie flags: `httpOnly`, `SameSite=Lax`, `Secure` in production, `path = COOKIE_PATH`, `maxAge = REFRESH_TOKEN_TTL_DAYS`.
- **Rotation and theft detection:** every refresh revokes the old token and issues a new one. A revoked token reused after the 10-second grace window revokes **all** the user's sessions (`revokedAt = epoch`).
- **Logout** ends the token immediately (epoch marker, no grace window) together with a token rotated just before it, and clears the cookie. A password reset does the same for every token of the account. **Deactivation** blocks login and refresh and deletes the user's tokens.
- **Password reset:** one-hour link bound to the current password hash fingerprint (works once), 2-minute resend cooldown, every session ended after a reset.
- **CSRF:** state-changing API calls need the `Authorization: Bearer` header (not a cookie), which another site cannot add. The only cookie-authenticated endpoints are `/auth/refresh` and `/auth/logout`, protected by `SameSite=Lax` (cross-site POSTs do not carry the cookie) and CORS.

## 7.3 Authorisation (who may do what)

Three global guards run in order: rate limit → login → role (see chapter 3). Beyond roles, **data scope is enforced in queries**:

| Actor | Scope rule |
| --- | --- |
| Student | Every ticket query includes `studentId = me`; otherwise 404. Attachments: `ticket.studentId = me`. |
| POC | Every query includes the OR of their active `(categoryId, currentLevel)` pairs (`PocService.scope`). A ticket that escalated away is a 404. |
| Team management | `StaffService.reach` walks the manager chain; L1 gets 403; outside reach is 404; you cannot add at or above your own level; you cannot remove yourself. |
| Analytics | A POC's scope comes only from their assignments, never from parameters. |
| Admin | `@Roles(SUPER_ADMIN)` on catalogue, settings, notes (send/sent), admin analytics. |
| Escalation endpoint | Public route but requires `x-job-secret` (constant-time compare); 404 when `JOB_SECRET` is unset so it looks nonexistent. |

Rule of thumb: **never take a user id, role, category or level from the request body to decide access.** Use `@CurrentUser()` and the database.

## 7.4 Identity protection (staff are anonymous to students)

- Student responses are typed (`StudentTicketDetail`) and built **field by field** (`student-view.ts`); a spread of a database row would leak new columns automatically, so it is forbidden.
- Student timeline labels use only the team name; levels and persons are not selected from the database for students (`comments.author` selects only `role`).
- Escalation reasons, missed-deadline events, hand-overs: `INTERNAL`, filtered out.
- **Contract test** `test/identity-contract.e2e-spec.ts`: collects every staff id, email and name from the database and fails if any appears in a student response (including errors), or if forbidden field names (`assignedPoc`, `actor`, `level`, `tatDeadline`, `critical`…) appear. It also tests that the detector itself fails when a leak exists.
- The reverse: POCs see the student's name, email and enrollment id (needed to help them); feedback is anonymous to staff (no student id is ever returned to them).

## 7.5 Rate limiting and proxies

- `ThrottlerModule`: 120 requests per minute per client address by default. Route overrides: login 10/min, register 10/min, forgot-password 5/min, reset-password 10/min (`@Throttle`). Skipped when `NODE_ENV=test`.
- **Store:** with `UPSTASH_REDIS_REST_URL/TOKEN` the counters live in Redis (`RedisThrottlerStorage`), shared by all serverless instances. Without them each instance counts in its own memory (weak). If Redis is unreachable the store **fails open**.
- **Real visitor address:** the throttler keys on `req.ip`. Behind Vercel's proxy every request would appear to come from the proxy, putting all visitors in one bucket. `resolveTrustProxy` trusts the proxy automatically on Vercel (`VERCEL` env var set), because Vercel sets `X-Forwarded-For` itself and discards a client-supplied value; elsewhere `TRUST_PROXY` must be set. Never enable trust where a client can spoof the header.
- The web client shows a friendly message on 429.

## 7.6 File uploads

Direct-to-storage flow (the API never handles file bytes):

1. `POST /tickets/:id/attachments` (student, own ticket) with `{fileName, mimeType, sizeBytes}`: `checkDeclaration` verifies the type is allowed, the size is within its limit (10 MB; 100 MB for video), the file name's extension matches the type; max 10 non-infected attachments per ticket. An `attachment` row is created (`PENDING`) with a random storage key; a **signed PUT URL (5 minutes)** is returned, with the content type and length part of the signature.
2. The browser PUTs the file to storage.
3. `POST /attachments/:id/confirm`: `head` the object (must exist; size and content type must equal what was declared), read the **first 32 bytes** and compare with the declared type's signature (PNG, JPEG, GIF, WebP, PDF, ZIP-based Office files, MP4/MOV, WebM; text types must be valid UTF-8 without NUL bytes). On any mismatch the object and row are deleted and 422 is returned. Otherwise the row becomes `CLEAN`.
4. Downloads and viewing: a **60-second signed GET URL** with `Content-Disposition: attachment` (download). When the app asks to **view** a file (`?inline=1`) and the type is in the viewable list (`canPreview` in `file-rules.ts`: PNG, JPEG, GIF, WebP, PDF, MP4, WebM, MOV, TXT, CSV), the link is `inline`, states the content type, and lasts **10 minutes** (a playing video keeps making requests). Anything else falls back to a download. The files are served from the **storage origin**, not the app's origin, so a viewed file cannot run code in the app; SVG and HTML are never accepted. Text files are fetched and shown as plain text in a `<pre>` (never as a page), first 200 KB only. Students can view their own files; POCs files of tickets in their scope.

Allowed: PNG, JPEG, GIF, WebP, PDF, DOCX, XLSX, PPTX, CSV, TXT/LOG/MD, MP4, MOV, WEBM. **Not allowed:** SVG (can carry scripts), executables, archives. File names are sanitised (no paths, control characters or `<>:"|?*`, max 150 chars) and never appear in the storage key.

**Not done yet:** antivirus scanning (the `ScanStatus` field and `INFECTED` value exist for it).

## 7.7 Input validation
- Every body/query goes through a zod schema (`parseOrThrow`); lengths are bounded (title 200, description 5000, notes 2000…).
- Ids in paths use `ParseUUIDPipe`.
- Cursors are base64url JSON validated by a zod schema (`decodeCursor`).
- SQL is parameterised. The only dynamic SQL fragments are built from constants (`Prisma.raw('ASC')`, the bucket unit chosen from a fixed enum), never from user text.
- React escapes all rendered text; there is no `dangerouslySetInnerHTML` in the code.

## 7.8 Secrets and configuration safety
- `.env` is git-ignored; `.env.example` has placeholders and local-only values.
- `validateEnv` fails fast; in production `productionProblems` refuses example secrets, non-https `WEB_URL`, localhost database/storage, development storage key, missing SMTP, extra email domains, and Vercel without `JOB_SECRET`/with the in-process timer on.
- Rotate `JWT_SECRET` to log everyone out. If a secret was pasted anywhere (chat, screenshot, log) treat it as exposed and rotate (Neon password, R2 keys, Gmail app password, `JOB_SECRET`).
- Dev-only scripts refuse production: `db:activate-staff` (checks `NODE_ENV`), `db:demo-data` (hosted database needs `DEMO_ON_HOSTED_DB=yes`), e2e `global-setup` (database name must end `_test`).
- `admin:set-password` reads the password at a hidden prompt, requires a TTY, and only works for an existing Super Admin.

## 7.9 Headers and CORS
- API: `helmet()` default headers.
- Pages: `X-Frame-Options: DENY`, `frame-ancestors 'none'`, `nosniff`, strict referrer policy, restrictive permissions policy.
- CORS: only `WEB_URL` with credentials. In production the browser uses the same-site `/api` forward, so CORS is rarely exercised; uploads to R2 are cross-origin and need R2's own CORS rule (set by `storage:setup` or in the Cloudflare dashboard).

## 7.10 Privacy notes
- Emails are stored lowercase; names and enrollment ids are shown to the staff handling a student's ticket.
- Student feedback is not linked to staff views.
- Nothing is deleted on request through the app; deletion of personal data would need a database operation (see known gaps: a privacy notice and retention policy are still to be written).

## 7.11 Security checklist for a change
- [ ] New endpoint has the right `@Roles` / `@Public`?
- [ ] Every query is scoped to the caller (student id, POC scope, reach)?
- [ ] Input validated with zod and bounded?
- [ ] Student-visible output built field by field? Identity contract test still passes?
- [ ] No raw string-built SQL?
- [ ] Rate limit needed (anything that sends email or checks a secret)?
- [ ] No secret or personal data logged or put in a URL?
- [ ] A state-changing action uses a transaction (and lock where two people could collide)?
