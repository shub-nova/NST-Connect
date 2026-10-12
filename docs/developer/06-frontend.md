# 6. Frontend (`apps/web`)

Next.js 16 (App Router) + React 19 + Tailwind CSS 4. Every screen is a **client component** (`"use client"`): the pages depend on the logged-in user and talk to the API from the browser. There is no server-side data fetching and no data library: state is local `useState`/`useEffect`.

> **Read first:** this Next.js has breaking changes versus most tutorials. See `apps/web/AGENTS.md` and `apps/web/node_modules/next/dist/docs/`. Example: dynamic route `params` are a **Promise**; pages use `use(params)`.

## 6.1 Folder map

```
src/
├── app/                                   routes
│   ├── layout.tsx                         root: Inter font, <AuthProvider>, globals.css
│   ├── globals.css                        Tailwind import + palette tokens (brand, ink, muted, line, surface, accent)
│   ├── page.tsx                           "/": redirects by role (student → /new, POC → /poc, admin → /admin, anonymous → /login)
│   ├── login/page.tsx, register/page.tsx  <AuthScreen mode="login" | "signup" />
│   ├── verify/page.tsx                    email verification link target (?token=)
│   ├── forgot-password/page.tsx           request a reset link
│   ├── reset-password/page.tsx            choose a new password (?token=)
│   └── (app)/                             signed-in area; layout wraps pages in <AppShell>
│       ├── new/page.tsx                   student: raise a ticket (<TicketComposer>)
│       ├── tickets/page.tsx               student: My tickets (tabs All / Open / Done)
│       ├── tickets/[id]/page.tsx          student: ticket detail, close, feedback, reopen, timeline
│       ├── poc/page.tsx                   POC: My queue (tabs, sort, paging, bulk selection)
│       ├── poc/tickets/[id]/page.tsx      POC: ticket detail, reply, in progress, close/escalate
│       ├── poc/analytics/page.tsx         My analytics        → <AnalyticsView endpoint="/analytics/me">
│       ├── poc/analytics/team/page.tsx    Team analytics      → "/analytics/team"
│       ├── poc/analytics/overall/page.tsx Overall analytics   → "/analytics/overall"
│       ├── admin/page.tsx                 admin: All teams    → "/analytics/admin" with filters
│       ├── admin/categories/page.tsx      admin: categories and topics
│       └── settings/page.tsx              L2 / L3 / admin: team management (+ escalation time for admin)
├── components/                            see 6.5
└── lib/                                   api.ts, auth.tsx, files.ts, types.ts, use-dismiss.ts
```
`next.config.ts` (project root of the web app) adds security headers to every page and the `/api` rewrite (6.7). `public/logo.png` is the logo; `src/app/icon.png` the favicon.

## 6.2 Authentication in the browser (`lib/api.ts`, `lib/auth.tsx`)

- **Access token (15 min) lives only in a JavaScript variable** (`accessToken` in `api.ts`): never in `localStorage` or a cookie, so a script injected into a page cannot persist it.
- **Refresh token is an httpOnly cookie** set by the API; scripts cannot read it.
- `AuthProvider` (root layout): on every page load calls `refreshSession()` (`POST /auth/refresh` with `credentials: "include"`). If the cookie is valid it gets a new access token and the user; status becomes `authed`, otherwise `anon`. States: `loading` → `authed` | `anon`.
- `api<T>(path, {method, body, signal})`: adds `Authorization: Bearer`, JSON body, `credentials: "include"`. On **401** (not for `/auth/*` paths, and only once) it calls `refreshSession()` and retries the request. Otherwise a non-OK response throws `ApiError(status, message, issues)`. A **429** is rewritten to a plain "Too many attempts. Please wait a minute and try again."
- **Refresh de-duplication:** `refreshing` is a shared promise. Refresh tokens rotate, so two parallel refreshes would look like theft and end the session. React strict mode runs effects twice in development, which makes this essential.
- `login()` stores the token and user; `logout()` calls the API then clears state.
- `AppShell` redirects: anonymous → `/login`; a role on a page of another role → that role's home. These are conveniences; **the API enforces access regardless**.

## 6.3 Pages and what they call

| Page | API calls |
| --- | --- |
| `/new` | `GET /categories`; submit: `POST /tickets`, then per file `POST /tickets/:id/attachments` → `PUT` to the signed URL → `POST /attachments/:id/confirm` |
| `/tickets` | `GET /tickets?limit=30` (+ `&cursor=`); filtering by tab is done in the browser over the loaded items |
| `/tickets/[id]` | `GET /tickets/:id`; `POST /tickets/:id/close`, `/reopen`, `/feedback`; `GET /attachments/:id/download` |
| `/poc` | `GET /poc/queue?view=&sort=&limit=25&cursor=`; bulk via `POST /poc/tickets/bulk` in chunks of 50 |
| `/poc/tickets/[id]` | `GET /poc/tickets/:id`; `POST …/comments`, `…/status`, `…/close`; `GET /poc/attachments/:id/download` |
| analytics pages | `GET /analytics/{me,team,overall,admin}?from=&to=&categoryId=&level=`; admin also `GET /analytics/admin/categories` |
| `/admin/categories` | `GET /catalog` and the `/catalog/...` write endpoints |
| `/settings` | `GET /staff/team`, `/staff/options`, `/staff/audit`, `GET /analytics/access`; writes on `/staff/...`; admin card: `GET/PUT /settings/escalation` |
| `AppShell` | `GET /analytics/access` (menu items, unread notes, leave state) |
| `AdminNotes` | `POST /notes`, `GET /notes/mine`, `POST /notes/:id/seen`, `GET /notes/sent` |

## 6.4 Types (`lib/types.ts`)
Hand-written TypeScript shapes for every API response (`TicketDetail`, `PocQueuePage`, `AnalyticsData`, `StaffPerson`, `CatalogCategory`, …). They are **not generated**: when you change an API response, update the matching type by hand. `isFinished(status)` mirrors the server's `FINISHED_STATUSES`.

## 6.5 Components

### Shell and shared building blocks
| File | Purpose |
| --- | --- |
| `AppShell.tsx` | Top bar and navigation per role, account menu (Settings for L2/L3/admin, Categories for admin, Log out), notes bells, "On leave" tag; redirects; skeleton while the session is restored (`ShellSkeleton`). Exports `LogoMark`. |
| `ui.tsx` | Style constants (`inputCls`, `btnCls`, `btnGhostCls`, `cardCls`), `Field`, `ErrorNote`, `StatusBadge` + `STATUS_TEXT`, `Avatar`, date helpers (`formatDate`, `timeAgo`, `isPast`), `PillSelect`, `Modal`, `Segmented`, `BackLink`, `SubCategoryIcon` (category/topic icons), `AttachmentList`. |
| `DialogParts.tsx` | `DialogActions` (cancel/confirm row), `errorText`. Shared by the staff and catalogue dialogs. |
| `lib/use-dismiss.ts` | `useDismiss(open, ref, close, {escape?, scroll?})`: closes a popup on outside press, optionally Escape/scroll. Used by menus, bells, the queue context menu. |
| `AuthScreen.tsx`, `AuthCard.tsx`, `AuthIllustration.tsx` | Login/sign-up screens, the card used by verify/forgot/reset pages, the login artwork. `PasswordInput` (show/hide) is exported from `AuthScreen`. |

### Student
| File | Purpose |
| --- | --- |
| `TicketComposer.tsx` | The raise-a-ticket card: topic chips, issue dropdown (hidden when a topic has one issue), title, description, file picking, live validation shown after the first Send, and the upload sequence (create ticket first, then upload each file; failures are counted, the ticket still exists). |
| `FeedbackCard.tsx` | Satisfied / Okay / Not satisfied with optional comment; shows the saved answer and a "Change" link while allowed. |
| `lib/files.ts` | Mirrors the server's file rules (types, extensions, limits, `MAX_FILES = 10`) for instant feedback. The server enforces them again. |

### POC and staff
| File | Purpose |
| --- | --- |
| `BulkDialog.tsx` | Solve/Close/Escalate/Reply for a selection; sends in groups of 50 with progress; lists tickets that could not be changed. |
| `StaffDialogs.tsx` | Add, Edit, Leave, Remove dialogs for Settings. |
| `EscalationTime.tsx` | Admin's escalation-time card with the "last check ran …" heartbeat line (red after 3 hours). |
| `AdminNotes.tsx` | `SendNote` (admin), `NotesBell` (POC), `SentNotesBell` (admin); `NOTES_CHANGED` event refreshes the unread count. |
| `CatalogDialogs.tsx` | Add/edit category, rename topic, confirm remove. |

### Analytics (`AnalyticsView.tsx` + `analytics/`)
`AnalyticsView` is a ~160-line coordinator: it holds the period/filter state, builds the query string, fetches, and lays out the sections inside `<LimitContext.Provider>` (the escalation limit in words, from `data.tatHours`). The parts:

| File | Section |
| --- | --- |
| `FilterBar.tsx` | Period buttons, custom dates, admin category/level filters and "Send a note" |
| `SummaryCards.tsx` | The KPI cards (which cards show depends on view and level) |
| `Charts.tsx` | Escalations chart, finish-time chart, shared chart bits (`ColumnChart`, tooltip, gradients) |
| `TimeLeftSection.tsx` | Open tickets by time left |
| `Donut.tsx` | Outcome shares and auto-escalation rate |
| `FeedbackSection.tsx`, `PhraseCloud.tsx` | Feedback donut and repeated phrases |
| `Breakdown.tsx`, `Bars.tsx` | Per-person / per-category comparison rows and bars |
| `TopicsSection.tsx` | Most repeated categories, sub-categories, phrases |
| `Methodology.tsx` | "How these numbers are calculated" |
| `Primitives.tsx`, `theme.ts`, `format.ts` | Cards (`Kpi`, `Section`), colours, formatting and `LimitContext` |

The analytics screen was split from one 850-line file without changing behaviour; a before/after browser comparison of 17 states showed identical page structure and pixels.

## 6.6 Patterns
- **Fetch in `useEffect` with a `cancelled` flag** so a late response never overwrites a newer one. Some pages store a `key` with the data (`{key, data}`) and ignore data whose key no longer matches the current filters.
- **Versioning to reload:** pages keep a `version` number in the effect dependencies and bump it after an action to refetch.
- **Forms validate in the browser for speed and again on the server for safety**; server messages are shown via `ErrorNote`.
- **Toasts** are simple `role="status"` paragraphs with a timeout.
- **Accessibility:** buttons have `aria-label`s where icon-only, tabs use `role="tab"`/`aria-selected`, errors use `role="alert"`.
- **Responsive:** mobile first; many rows change layout under `sm:`; the queue supports long-press selection on touch.

## 6.7 `next.config.ts`
- `headers()` for every path except `/api/`: `X-Frame-Options: DENY`, `Content-Security-Policy: frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` (camera, microphone, geolocation off). The API sends its own headers through `helmet`.
- `rewrites()`: when `API_ORIGIN` is set, `/api/:path*` → `${API_ORIGIN}/api/:path*`. In development it is unset and the browser calls `http://localhost:3000` directly (`NEXT_PUBLIC_API_URL`).

## 6.8 Styling (`globals.css`)
Tailwind 4 with design tokens in `@theme inline`: `brand` `#2f6df6`, `brand-dark`, `brand-soft`, `accent` `#e8862a`, `ink`, `muted`, `line`, `surface`. Light theme only (dark variants never activate). Font: Inter via `next/font`.

## 6.9 Adding a screen (recipe)
1. Create `src/app/(app)/<route>/page.tsx` as a client component.
2. Add the type(s) to `lib/types.ts`.
3. Fetch with `api<T>()` in an effect with a `cancelled` guard; show loading, error (`ErrorNote`) and empty states.
4. Add a link in `AppShell` for the right role (and, if needed, an `access` flag from `/analytics/access`).
5. Use the existing `ui.tsx` components and tokens; no new colours.
6. Test by hand as each role, on a phone-width window; run `npm run lint` and `npm run build`.
