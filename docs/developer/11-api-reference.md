# 11. API reference

Base address: in development `http://localhost:3000`; in production `https://<web>/api` (the web project forwards to the API, which has no `/api` prefix internally).

**Conventions**
- JSON in, JSON out. Dates are ISO 8601 strings (UTC).
- **Auth:** `Authorization: Bearer <access token>` on everything except endpoints marked *public*. Role = who may call it (others get 403).
- Errors: `{ "message": "...", "statusCode": ... }`; validation errors add `"issues": [{ "path", "message" }]`.
- Status codes: 400 invalid input · 401 not logged in/invalid token · 403 role or level not allowed (or inactive/unverified account) · 404 not found *or not yours* · 409 state does not allow it · 422 uploaded file failed inspection · 429 rate limited.
- IDs are UUIDs (non-UUID in a path → 400).
- Default rate limit 120/min per address; stricter limits are noted.
- The shapes below are summaries; the types in `apps/web/src/lib/types.ts` and the services are the exact source.

---

## Health
| Method & path | Role | Description |
| --- | --- | --- |
| `GET /health` | public | `{"status":"ok","database":"up"}` or 503 `{"status":"error","database":"down"}` |

## Auth (`/auth`)
| Method & path | Role | Body / notes | Result |
| --- | --- | --- | --- |
| `POST /auth/register` | public, 10/min | `{ email, name (2–100), password (10–128) }` | 202 `{message}`. Same answer whether or not the address exists. Student domain → student; staff domain → POC without assignment. Sends a verification email. |
| `POST /auth/verify` | public | `{ token }` | 200 `{message}`; 400 if invalid/expired |
| `POST /auth/login` | public, 10/min | `{ email, password }` | 200 `{ accessToken, user }` + `refresh_token` cookie. 401 wrong credentials; 403 deactivated or unverified |
| `POST /auth/refresh` | public | cookie only | 200 `{ accessToken, user }` + new cookie; 401 otherwise (reuse after grace revokes all sessions) |
| `POST /auth/logout` | public | cookie | 204; clears cookie |
| `GET /auth/me` | any logged in | | `{ id, name, email, role }` |
| `POST /auth/forgot-password` | public, 5/min | `{ email }` | 202 `{message}` always; takes ≥ 1.5 s |
| `POST /auth/reset-password` | public, 10/min | `{ token, password (10–128) }` | 200 `{message}`; 400 invalid/expired link; revokes all sessions |

## Catalogue for students
| Method & path | Role | Description |
| --- | --- | --- |
| `GET /categories` | any logged in | Active categories that have an active topic and are staffed at every level: `[{ id, name, shortName, subCategories: [{ id, name }] }]` |

## Student tickets (`@Roles(STUDENT)`)
| Method & path | Body / query | Result and rules |
| --- | --- | --- |
| `POST /tickets` | `{ title (3–200), description (10–5000), subCategoryId }` | 201 student ticket detail. 400 unknown topic or category not taking tickets |
| `GET /tickets` | `status?, categoryId?, from?, to?, cursor? (uuid), limit? (1–50, default 20)` | `{ items: StudentTicketSummary[], nextCursor }` newest first, own tickets only |
| `GET /tickets/:id` | | `StudentTicketDetail` (description, `canReopen`, `canGiveFeedback`, `feedback`, `timeline[]`, `attachments[]`). No staff identity or level |
| `POST /tickets/:id/close` | `{}` | Student closes own open ticket → detail. 409 if already finished |
| `POST /tickets/:id/reopen` | `{ comment (5–2000) }` | Reopen a Solved/Closed ticket. 409: not finished; outcome final; nobody on duty |
| `POST /tickets/:id/feedback` | `{ rating: SATISFIED｜OKAY｜NOT_SATISFIED, comment? (≤ 500) }` | `{ rating, comment, canChange }`. 409 if not finished or older than 7 days |

## Attachments (`@Roles(STUDENT)`)
| Method & path | Body | Result |
| --- | --- | --- |
| `POST /tickets/:ticketId/attachments` | `{ fileName, mimeType, sizeBytes }` | `{ attachmentId, uploadUrl, headers, expiresInSeconds: 300 }`. 400 type/size/extension/limit (10 per ticket) |
| `POST /attachments/:id/confirm` | `{}` | The attachment `{ id, fileName, mimeType, sizeBytes }`. 409 not uploaded yet; 422 content/size/type mismatch (file removed) |
| `GET /attachments/:id/download` | | `{ url, expiresInSeconds: 60 }` (own files, `CLEAN` only) |

The browser then `PUT`s the file to `uploadUrl` with the returned `headers` (see 7.6).

## POC (`@Roles(POC)`, `/poc`)
| Method & path | Body / query | Result and rules |
| --- | --- | --- |
| `GET /poc/queue` | `view=open｜done (default open), sort=time-left｜oldest｜newest, limit (1–50, default 25), cursor` | `{ tickets[], total, counts:{open,done}, nextCursor, assigned }`. Only tickets in the POC's category+level pairs |
| `GET /poc/tickets/:id` | | Full ticket incl. student name/email/enrollment id, `currentLevel`, `critical`, `tatDeadline`, attachments, `thread[]` (comments and events incl. internal). 404 outside scope |
| `POST /poc/tickets/:id/comments` | `{ body (1–5000) }` | Updated detail. First reply moves Assigned/Escalated/Reopened → In progress. 409 if finished |
| `POST /poc/tickets/:id/status` | `{ status: "IN_PROGRESS" }` | Updated detail. 409 if already in progress or finished |
| `POST /poc/tickets/:id/close` | `{ outcome: SOLVED｜CLOSED｜ESCALATED, note (5–2000) }` | Detail, or `{ escalated: true }` when escalated. 409: finished; top level; nobody on duty at next level |
| `POST /poc/tickets/bulk` | `{ ticketIds[1–50], action: SOLVED｜CLOSED｜ESCALATED｜REPLY, note }` (note ≥ 5 for outcomes, ≥ 1 for reply) | `{ done, failed: [{ id, reason }] }` |
| `GET /poc/attachments/:id/download` | | `{ url, expiresInSeconds: 60 }` for tickets in scope |

## Staff / team management (`@Roles(POC, SUPER_ADMIN)`, `/staff`)
Access is further decided by reach (L1 → 403; outside reach → 404).

| Method & path | Body | Description |
| --- | --- | --- |
| `GET /staff/team?categoryId=` | | `{ people: [{ id, userId, name, email, level, category, managerId, managerName, status: active｜invited｜on_leave, onLeave, onLeaveUntil, openTickets }] }` |
| `GET /staff/options` | | Categories the caller may add to, with the levels they may add and the possible managers |
| `GET /staff/audit` | | `{ changes: [{ id, action, summary, createdAt, by }] }` (latest 15) |
| `POST /staff` | `{ name, email (staff domain), categoryId, level 1–3, managerAssignmentId? }` | Adds/reactivates; sends invitation. 400 domain/manager; 403 level; 409 already on category |
| `PATCH /staff/:id` | `{ name?, managerAssignmentId? }` | Edit |
| `POST /staff/:id/leave` | `{ onLeave: boolean, until?: "YYYY-MM-DD" }` (until required and in the future when going on leave) | Returns `{ onLeave, onLeaveUntil, moved:{reassigned,escalated,stranded} }` |
| `POST /staff/:id/remove` | | `{ removed: true, moved }`. 409 has reports / only person at level; 403 yourself |
| `POST /staff/:id/resend-invite` | | `{ sent: true }`; 400 if already registered |

## Catalogue management (`@Roles(SUPER_ADMIN)`, `/catalog`)
| Method & path | Body | Description |
| --- | --- | --- |
| `GET /catalog` | | All categories (incl. removed) with counts, `missingLevels`, topics |
| `POST /catalog/categories` | `{ name (3–80), shortName? (2–30), topics: string[] (≥ 1 after cleaning, ≤ 40) }` | `{ id }`. 409 duplicate name |
| `PATCH /catalog/categories/:id` | `{ name?, shortName? }` | `{ id, updated }` (open tickets that got a "Name updated" note) |
| `POST /catalog/categories/:id/remove` | | Hide. 409 while open tickets exist |
| `POST /catalog/categories/:id/restore` | | Restore |
| `POST /catalog/categories/:id/topics` | `{ name (3–120) }` | `{ id }`. 409 duplicate |
| `PATCH /catalog/topics/:id` | `{ name }` | Rename |
| `POST /catalog/topics/:id/remove` | | Hide. 409 open tickets; 400 last active topic |
| `POST /catalog/topics/:id/restore` | | Restore |

## Settings (`@Roles(SUPER_ADMIN)`, `/settings`)
| Method & path | Body | Result |
| --- | --- | --- |
| `GET /settings/escalation` | | `{ hours, days, defaultDays, minDays: 1, maxDays: 14, lastRunAt }` |
| `PUT /settings/escalation` | `{ days: integer 1–14 }` | the same object; writes an audit row |

## Notes
| Method & path | Role | Body | Description |
| --- | --- | --- | --- |
| `POST /notes` | admin | `{ body (3–2000), categoryId?, level? (1–3), pocId?, context? (≤ 200) }` | `{ id, recipients, audience }`; emails every recipient. 400 if nobody matches |
| `GET /notes/sent` | admin | | `{ notes: [{ id, body, audience, context, createdAt, recipients, seen }] }` (last 20) |
| `GET /notes/mine` | POC | | `{ notes: [{ id, body, context, createdAt, seen }] }` (last 20) |
| `POST /notes/:id/seen` | POC | | `{ ok: true }`; 404 if not a recipient |

## Analytics (`/analytics`)
All accept `from` and `to` as `YYYY-MM-DD` (inclusive UTC days; default last 30; max 366 days).

| Method & path | Role | Extra query | Description |
| --- | --- | --- | --- |
| `GET /analytics/access` | POC, admin | | `{ me, team, overall, admin, manage, unreadNotes, onLeave, onLeaveUntil }` for menus |
| `GET /analytics/me` | POC | | My analytics (403 if not assigned) |
| `GET /analytics/team` | POC L2/L3 | | People below me in my categories (403 for L1) |
| `GET /analytics/overall` | POC | | Whole category, read-only |
| `GET /analytics/admin` | admin | `categoryId?, level? (1–3), pocId?` | All teams; without a category it compares categories, with one it lists people |
| `GET /analytics/admin/categories` | admin | | `[{ id, shortName }]` |

Dashboard payload: `{ view, title, range, tatHours, headline, finishTimes, categories, subCategories, trend, words, phrases, feedbackTerms, timeLeft, ... }` plus `members` (team) or `breakdown` (admin). `headline` = solved, closed, escalated, finished, avg/median finish hours, `withinTatPct`, `actionNeeded`, `overdue`, `critical`, `total`, `autoEscalatedFrom/To`, `reopened`, `reopenRatePct`, `feedback{responses,satisfied,okay,notSatisfied,satisfactionPct}`.

## Internal
| Method & path | Auth | Description |
| --- | --- | --- |
| `POST /internal/escalation/run` | header `x-job-secret` = `JOB_SECRET`; **404 when `JOB_SECRET` is unset**; 401 wrong secret | Runs the escalation check once → `{ escalated, flaggedCritical, warned }`. Safe to call repeatedly or concurrently |

## Student ticket shapes (what a student receives)
```jsonc
// StudentTicketSummary
{ "id": "…", "title": "…", "category": {"id":"…","name":"…","shortName":"Hostel"},
  "subCategory": {"id":"…","name":"…"}, "status": "IN_PROGRESS", "statusLabel": "In progress",
  "closedByYou": false, "assignedTo": "Hostel team", "createdAt": "…", "updatedAt": "…" }
// StudentTicketDetail adds: description, resolvedAt, canReopen, canGiveFeedback, feedback,
//   timeline: [{ type, label, message, at }], attachments: [{ id, fileName, mimeType, sizeBytes }]
```
There is deliberately **no** `assignedPoc`, `level`, `actor`, `tatDeadline` or `critical` field: the identity contract test fails the build if one appears.
