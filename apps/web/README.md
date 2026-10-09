# NST Connect Web

The Next.js front end for NST Connect: the student ticket screens, the POC queue and ticket view, Settings, and the analytics dashboards.
See the [root README](../../README.md) for setup and [DEPLOY.md](../../DEPLOY.md) for hosting.

## Scripts

Run from the repo root with `-w apps/web`, or use the root shortcut.

| Command | What it does |
| --- | --- |
| `npm run dev:web` | Start in development mode on port 3001 |
| `npm run build -w apps/web` | Production build |
| `npm run lint -w apps/web` | Lint with ESLint |

## Layout

| Path | Contents |
| --- | --- |
| `src/app/` | Routes (App Router). `(app)/` holds the signed-in screens; `login`, `register` and `verify` are public. |
| `src/components/` | Screens and shared UI: `AppShell` (navigation), `AnalyticsView`, `TicketComposer`, `AdminNotes`, `StaffDialogs`, `BulkDialog`, `FeedbackCard`, `ui.tsx` (small building blocks). |
| `src/lib/` | `api.ts` (all calls to the API, with silent token refresh), `auth.tsx` (session context), `files.ts` (uploads), `types.ts` (response shapes). |

## How it talks to the API

- In development the browser calls the API directly (`NEXT_PUBLIC_API_URL`, default `http://localhost:3000`).
- In production `API_ORIGIN` makes `next.config.ts` forward `/api/*` to the API project, so the browser only ever uses the web address and the login cookie stays same-site.
- The access token lives in memory; the refresh token is an httpOnly cookie set by the API.
