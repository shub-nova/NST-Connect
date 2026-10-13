# 13. Edge-case testing: what is covered, how to repeat it, and what it found

This chapter records the edge-case pass done on 2026-10-13: the automated tests that now guard each rule, the browser checks that were run by hand-scripted tests, a checklist for repeating it on a staging copy, and the defects it found and fixed. **Never run any of this against the live site or with real people's data.**

## 13.1 What was added to the automated suite (181 → 265 tests, 18 → 25 suites)

| File | Covers |
| --- | --- |
| `test/edge-auth.e2e-spec.ts` | Sign-up input: exact name/password/email limits, look-alike domains (`@adypu.edu.in.evil.com`, `a@@x`, over-long ids), capital letters and spaces, extra fields (`role`, `emailVerifiedAt`) ignored, malformed/oversized/wrong-type bodies (400/413, never 500), hostile text stored as plain text. Takeover attempts (re-registering a verified address changes nothing), unverified/deactivated logins, expired and wrong-purpose tokens, tampered/`none`-algorithm JWTs, cookie flags, logout and refresh rules |
| `test/edge-tickets.e2e-spec.ts` | Exact title/description/comment limits, hostile and unicode text, unknown/retired topics, fields a student must not set (status, level, owner, deadline), simultaneous creates, list parameter validation and paging, foreign ids, close/reopen/feedback limits, attachments (exactly 10, exact 10 MB / 100 MB, odd names, capital extensions, confirm twice, unreadable text files) |
| `test/edge-poc-staff.e2e-spec.ts` | Reply/note limits, bulk input and unknown ids, odd ids, a removed POC holding a still-valid token, one person on two teams, adding people (capitals, wrong domains, levels, managers), leave dates, removing twice, routing around people who have not registered |
| `test/edge-admin.e2e-spec.ts` | Category/topic names and limits, tidying, duplicates in any capitals, rename/remove/restore idempotence, escalation-time values, notes limits and empty audiences, analytics ranges (one day, 366 vs 367 days, reversed, future, impossible days), empty data returns zeros not `NaN` |
| `test/edge-escalation.e2e-spec.ts` | The 500-tickets-per-run cap (505 overdue tickets: 500, then 5, then 0), exact deadline and 12-hour-warning boundaries, tickets the job must ignore, ownerless tickets, a year-overdue ticket moving one level per run, overlapping runs |
| `test/edge-rate-limit.e2e-spec.ts` | Rate limits switched **back on** (the suite normally disables them): per-visitor login/sign-up/forgot-password/default limits, visitors do not share a counter behind a trusted proxy, invented forwarded addresses cannot dodge the limit without proxy trust |
| `test/edge-security.e2e-spec.ts` | CORS, protective headers, unknown routes, `__proto__` tricks, very deep/wide JSON, odd `Authorization` headers, the escalation trigger secret, and a **never-crash sweep**: every endpoint × (no login, student, POC, admin) × 12 nonsense bodies, plus nonsense paths and query strings, must never answer 5xx |
| `test/helpers.ts` → `startCleanup(app)` | Heavy specs call it first and run the returned function last, so they remove their tickets, notes, audit rows, setting changes and "Catalog Test" categories. Without it, later specs that count or page those things fail |

Run them like the rest: `npm run test:e2e -w apps/api` (Docker running, `nstconnect_test` created).

## 13.2 Browser checks that were run

A scripted Playwright run drove the real UI (local API with `NODE_ENV=test`, so no rate limits and mail only to Mailpit): **about 160 checks, all passing after the fixes**. Areas:

- **Accounts:** disabled/enabled login button, wrong credentials, a 400-character email, simulated 429 and server-down messages, sign-up refusals, verification/reset/invitation pages with good, broken and missing tokens, who is redirected where for each role and for signed-out visitors.
- **Student:** every composer validation message, double-clicking Send creates one ticket, markup/emoji/RTL text shown as plain text, 200-letter titles and 5,000-letter descriptions on desktop and phone, 12 files (keeps 10), program/empty/11 MB/no-extension/zip files refused, a failed upload still creates the ticket and says so, other students' and malformed ticket ids, close dialog (Cancel/Escape/confirm), reopen rules, "outcome is final", feedback rules.
- **POC:** a staff sign-up with no team, a queue of 28+ (paging, sort, tabs), right-click/long-press selection, bulk action with one ticket finished behind the screen (partial failure listed), reply/note limits, replying to a ticket the student just closed, escalate and "highest level", phone layout.
- **Admin and L2:** add/edit/leave/remove POC dialogs and their refusals, escalation time, category dialogs (including duplicates and open tickets), analytics periods and custom ranges, notes, two-tab logout.

The scripts are throwaway (they live outside the repository). If browser tests become permanent, add Playwright to `apps/web` and keep them behind a `test:browser` script that boots the stack on test ports.

## 13.3 Defects found and fixed in this pass

| # | Problem | Impact | Fix |
| --- | --- | --- | --- |
| 1 | **A logged-out session could still be refreshed for about 10 seconds** (logout used the same "grace window" as a normal token rotation) | Someone holding a copied cookie had a short window after the owner logged out | `logout` marks the token with the epoch (no grace) and also ends recently rotated tokens of that account (`AuthService.logout`); `refresh` answers 401 for epoch-revoked tokens without revoking everything else |
| 2 | **After a password reset, old sessions could still refresh for ~10 seconds** | Same window after the most important "end all sessions" event | `resetPassword` marks every token of the account with the epoch |
| 3 | **Impossible dates such as `2026-02-30` were silently moved to March** in analytics ranges | Wrong numbers instead of an error | `parseDay` in `analytics/range.ts` accepts only days that exist |
| 4 | **A category could be created with a 2-letter topic**, while adding a topic alone needs 3 | Inconsistent rule | `createCategorySchema` refuses topics shorter than 3 characters |
| 5 | **A new POC who had not registered yet received the next ticket** (zero open tickets made them "least loaded") and could not see it | The ticket waited until it escalated (2 days by default) | `pickLeastLoadedOwner` prefers people with an account and only uses an unregistered person when nobody else at that level is available |
| 6 | **A very long unbroken title or description made the ticket pages wider than the screen** (student and POC, desktop and phone) | Horizontal scrolling, hidden buttons | `wrap-anywhere` on every place user text is shown |
| 7 | **For L2, L3 (4 menu links) the account menu was pushed off the right edge on a phone** | Staff could not reach Log out or Settings on a phone | Header groups can shrink; the menu links scroll within their own space; the account button never shrinks |

## 13.4 Behaviour confirmed as intended (not defects)

- A tab that did not log out keeps working until its 15-minute access token expires; a reload sends it to login.
- An invited (unregistered) POC shows as **Invited** even when put on leave.
- `CORS` answers with the app's own address (never the other origin or `*`), so browsers on other sites are blocked.
- A deactivated person's **old access token** stays valid for up to 15 minutes but has no team, so it sees and changes nothing.
- `from[]=…` in a query string is ignored (unknown key) rather than rejected.
- Students can request an upload slot for their own finished ticket through the API (the form never offers it); the 10-file cap still applies.

## 13.5 Checklist to repeat on a staging copy

Use a Neon branch of production or demo data, a separate Vercel preview, throwaway accounts and the local mail catcher or a test inbox.

**Accounts**
- [ ] Sign up with: wrong domain, look-alike domain, upper-case address, spaces around the address, 1-letter and 101-letter names, 9- and 129-character passwords
- [ ] Verification link: good, used twice, expired (24 h), broken
- [ ] Forgot password: unknown address (same message), twice within 2 minutes (one email), link used twice, old sessions end
- [ ] Log in on two browsers, log out on one: the other works for ≤ 15 minutes, then must log in
- [ ] 11 wrong logins from one connection: friendly "too many attempts"; a second connection is unaffected

**Student**
- [ ] Every missing-field message in the form; double-click Send (one ticket)
- [ ] Title 200 letters, description 5,000 letters, emoji, `<script>` text: shown as plain text, no sideways scroll on a phone
- [ ] Files: 11 chosen, `.exe`, empty, 11 MB picture, 101 MB video, renamed program; cancel Wi-Fi during upload
- [ ] Open another student's ticket link: "Ticket not found"
- [ ] Close, cancel, reopen with 4 characters, reopen after a top-level (L3) finish ("outcome is final")
- [ ] Feedback: each face, comment limit, change within 7 days

**POC**
- [ ] Sign up without being added: "not assigned yet"; after adding, tickets appear
- [ ] Queue with more than 25 tickets: Load more, sorts, counts; select several and finish one behind the screen
- [ ] Reply 5,000/5,001 characters; solve with a 4-character note; escalate at L3; act on a ticket the student just closed
- [ ] Added POC who has not registered does not receive tickets while a registered colleague is free

**Admin**
- [ ] Escalation time 1, 2, 14; Last escalation check line fresh (< 1 hour) and red when stale
- [ ] Add category with duplicate/blank/2-letter topics; remove a category with open tickets (refused); restore
- [ ] Remove the last person at a level (refused); put a POC on leave with no date (refused)
- [ ] Analytics: 7/30/90 days, custom future range, range over 366 days, empty category

**Operations**
- [ ] The escalation schedule returns 200 with the right secret and 401 without; the heartbeat updates
- [ ] `/api/health` reports the database
- [ ] A phone-sized window on every main page: no sideways scrolling, menu reachable
