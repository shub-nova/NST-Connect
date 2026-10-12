# 1. Overview and tech stack

## 1.1 What NST Connect is

An internal helpdesk for Newton School. Students raise a ticket about a hostel, food, academics, fees or any other topic. The ticket is routed to the team that owns that topic. A team is a chain of three levels of staff (**POCs**: points of contact): **L1** handles it first, **L2** is the next level, **L3** is the top. If a ticket is not solved within a time limit (2 days by default, set by the admin) the system moves it up a level on its own. Students see only a team label ("Hostel team"), never a person or a level.

### Roles

| Role | Created how | Can do |
| --- | --- | --- |
| **Student** | Signs up with a college email (`@adypu.edu.in`) | Raise tickets, attach files, follow them, close their own, give feedback, reopen finished ones |
| **POC** (L1, L2, L3) | Signs up with a staff email (`@newtonschool.co`); gets access only when an L2, an L3 or the admin adds them to a category and level | Work tickets in their category and level; L2 and L3 also manage the people below them |
| **Super Admin** | Seeded; password set by sign-up or a script | Manage categories and topics, build teams, set the escalation time, see all analytics, send notes. **Cannot open individual tickets.** |

Role is stored in `user.role`; who a POC is *assigned to* is stored in `poc_assignment` (category + level), and that is what decides which tickets they can see.

### Core flows (one line each)
- **Raise:** pick topic and issue, title, description, optional files → ticket created and assigned to the least-loaded L1 with a deadline.
- **Work:** POC replies, marks in progress, then Solves, Closes (both need a note) or Escalates.
- **Auto-escalate:** a scheduled job moves tickets past their deadline one level up with a fresh deadline; at the top level it flags them Critical.
- **Finish:** Solved/Closed → student may give feedback and may reopen (unless an L3 finished it).
- **Observe:** analytics for each role; the admin can send notes to POCs.

## 1.2 Architecture at a glance

```
                       Browser (student, POC, admin)
                                   |
                      https://<web>.vercel.app  (one address)
                                   |
        +--------------------------+--------------------------+
        |   Vercel project "web": Next.js 16 (App Router)     |
        |   pages + client code; /api/* is REWRITTEN to API   |
        +--------------------------+--------------------------+
                                   |  /api/...  (server-side forward)
        +--------------------------v--------------------------+
        |   Vercel project "api": NestJS 12 as ONE serverless  |
        |   function (api/index.js -> dist/serverless.bundle)  |
        +----+-----------+------------+-----------+-----------+
             |           |            |           |
          Neon        Cloudflare   Upstash     SMTP (Gmail /
        PostgreSQL       R2          Redis       Brevo)
        (data)        (attachments) (rate-limit  (verification,
                                     counters)    invites, notes)

   cron-job.org  --every 30 min-->  POST /api/internal/escalation/run  (header x-job-secret)

   Browser --(signed URL, direct)--> R2   (uploads and downloads of files never pass through the API)
```

Key points:
- **One public address.** The web project forwards `/api/*` to the API project (`next.config.ts` rewrites). The refresh-token cookie belongs to the web address, so it survives a page refresh. (Two separate `*.vercel.app` addresses would be different sites.)
- **The API is stateless.** Everything lives in Postgres (and files in R2). Each serverless instance builds the Nest app once and reuses it.
- **Files go straight to storage** with short-lived signed URLs. The API only validates the request, hands out the URL, and later inspects the stored file.
- **Time-based work is triggered from outside** because Vercel has no always-running process.

## 1.3 Repository layout

```
NST-Connect/
├── apps/
│   ├── api/                 NestJS backend (see 03-backend-architecture.md)
│   │   ├── src/             modules: auth, tickets, poc, staff, catalog, settings, notes,
│   │   │                    analytics, escalation, attachments, storage, mail, prisma, common, config
│   │   ├── prisma/          schema.prisma, migrations/, seed.ts, categories.ts, demo-data.ts, activate-staff.ts
│   │   ├── test/            end-to-end tests (*.e2e-spec.ts) + helpers + global-setup
│   │   ├── scripts/         bundle-serverless.mjs, set-admin-password.ts, setup-storage.ts, send-test-mail.ts
│   │   ├── api/index.js     the Vercel function entry
│   │   └── vercel.json      rewrites + function settings
│   └── web/                 Next.js frontend (see 06-frontend.md)
│       ├── src/app/         routes (App Router)
│       ├── src/components/  screens and shared UI
│       ├── src/lib/         api client, auth context, file rules, types, hooks
│       └── next.config.ts   security headers + the /api rewrite
├── docs/                    diagrams, go-live checklist, user guides, this developer guide
├── .github/workflows/ci.yml lint, unit tests, build, end-to-end tests, schema drift check
├── docker-compose.yml       Postgres, RustFS (S3), Mailpit for local development
├── .env.example             every setting with safe local defaults
├── DEPLOY.md                hosting guide
└── CONTRIBUTING.md
```

npm **workspaces** (`"workspaces": ["apps/*"]`): install once at the root; run a workspace script with `-w apps/api` or `-w apps/web`; the root scripts `dev:api`, `dev:web`, `lint`, `test`, `build` are shortcuts.

## 1.4 Tech stack and why

The guiding constraints: **a small team, free hosting, a real public deployment with real students' data, and rules that must hold under concurrency.** The reasons below are the engineering reasoning that the code and its comments show.

### Languages and runtime
| Choice | Why |
| --- | --- |
| **TypeScript everywhere** (strict) | One language for API and web, shared mental model, the compiler catches the "I renamed a field" class of bugs. The student-facing response models are typed so a field cannot be added by accident. |
| **Node.js 24** | The API is NestJS 12, which ships as ES modules; Vercel's function loader and our bundling need a current Node. `engines` pins `24.x` for the API. (The web project uses Node 22 on Vercel; both work locally from 22.12.) |
| **npm workspaces** | Simplest monorepo with no extra tool; one lockfile means one set of versions. |

### Backend (`apps/api`)
| Technology | Version | Role | Why |
| --- | --- | --- | --- |
| **NestJS** | 12 | HTTP framework | Modules, dependency injection and **guards** give a clear place for "must be logged in" and "must have this role" that cannot be forgotten (they are global). Controllers stay thin; services hold the rules. |
| **Express** (via `@nestjs/platform-express`) | | HTTP server | Nest's default adapter; the serverless entry wraps an Express instance. |
| **Prisma** | 7 (+ `@prisma/adapter-pg`, `pg`) | Database access and migrations | Typed queries, readable schema file as the source of truth, versioned SQL migrations. The **driver adapter** (`pg`) works well in serverless. Complex reads (analytics, the queue) use `$queryRaw` tagged SQL, because they need window/aggregate SQL Prisma cannot express. |
| **PostgreSQL** | 16 locally, Neon in production | Database | Real transactions, **row locks** (`FOR UPDATE`, `SKIP LOCKED`), enums, partial work with dates and percentiles for analytics. |
| **zod** | 4 | Input validation and environment validation | One small library for request bodies, query strings and the `.env` file; errors become readable 400 messages. |
| **argon2** (argon2id) | | Password hashing | Current best practice; memory-hard. |
| **@nestjs/jwt** | | Signed tokens | Access tokens (15 min), email-verification and password-reset links. |
| **cookie-parser**, **helmet** | | Cookie reading, security headers | Standard hardening. |
| **@nestjs/throttler** + custom Redis store | 6 | Rate limiting | Global limit plus stricter limits on login, register, forgot password. The Redis store (Upstash REST) is needed because a serverless function has no shared memory. |
| **@upstash/redis** | | Redis over HTTPS | Works from serverless where a TCP Redis connection is awkward; free tier. |
| **@aws-sdk/client-s3** + presigner | 3 | Object storage | R2 (and the local RustFS) speak the S3 protocol; signed URLs let the browser upload/download directly. |
| **nodemailer** | | Sending email | SMTP with any provider; points at Mailpit in development. |
| **esbuild** | | Bundling for Vercel | NestJS 12 is an ES module; Vercel's Node runtime will not `require()` it, so `bundle-serverless.mjs` folds `@nestjs/*` into one CommonJS file. |
| **Jest + ts-jest + supertest** | 30 | Tests | Unit tests, and end-to-end tests that boot the real app and hit real HTTP. |
| **oxlint** (+ type-aware) | | Linting | Fast; the type-aware rule `no-floating-promises` catches forgotten `await`s, which matter a lot here. |
| **Prettier** | | Formatting | `singleQuote`, `trailingComma: all`. |
| **tsx** | | Running TypeScript scripts | Seed, demo data, admin password script. |

### Frontend (`apps/web`)
| Technology | Version | Why |
| --- | --- | --- |
| **Next.js** (App Router) | 16 | File-based routing, layouts (`(app)/layout.tsx` wraps every signed-in page in the shell), built-in `rewrites` (the `/api` forward) and `headers` (security headers), first-class Vercel deployment. |
| **React** | 19 | UI. Pages are client components (they depend on the logged-in user and call the API from the browser). |
| **Tailwind CSS** | 4 | Utility styling with a small design palette defined once in `globals.css` (`brand`, `ink`, `muted`, `line`, `surface`, `accent`). Light theme only. |
| **recharts** | 3 | The analytics charts. |
| **lucide-react** | | Icons. |
| **ESLint** (`eslint-config-next`) | 9 | Linting. |
| **No state library, no data-fetching library** | | State is local `useState`/`useEffect` plus one tiny `api()` function and one `AuthProvider`. The app's screens are simple enough that adding Redux, SWR or React Query would add more code than it saves. |

> **Important:** this Next.js version has breaking changes compared with most tutorials. `apps/web/AGENTS.md` says to read the docs in `apps/web/node_modules/next/dist/docs/` before writing framework code. Route `params` arrive as a `Promise` (see `use(params)` in the ticket pages).

### Infrastructure (all on free tiers)
| Service | Used for | Why |
| --- | --- | --- |
| **Vercel** (Hobby) ×2 | Web project and API project | Zero-server hosting; Git push deploys; the API runs as a serverless function. |
| **Neon** | PostgreSQL | Free serverless Postgres; **branching** is used for safety copies before migrations; a pooled connection string for the app and a direct one for migrations. |
| **Cloudflare R2** | Attachments | S3-compatible with a generous free tier and no download (egress) fees. |
| **Upstash Redis** | Rate-limit counters | Free, HTTP-based, works from serverless. |
| **Gmail SMTP** (or Brevo) | Email | Free; Gmail is limited to about 500 messages a day. |
| **cron-job.org** | Escalation schedule | Free external scheduler that can send a POST with a header. Vercel's free plan limits scheduled jobs to infrequent runs (check its current limits), and GitHub's scheduled workflows ran late, so an outside scheduler was chosen (see the commit "drop the late GitHub escalation schedule in favour of cron-job.org"). |
| **GitHub Actions** | CI | Lint, tests, build, schema drift check on every pull request. |
| **Docker Compose** (local only) | Postgres, RustFS, Mailpit | One command gives a full local environment. |

Details, limits and trade-offs of each: [deployment guide](09-deployment-and-infrastructure.md).

## 1.5 Design principles (the "why" behind the code)

1. **Rules live on the server.** The browser is a convenience; every rule (who may see what, how long a note must be, which transitions are allowed) is enforced by the API and by tests.
2. **Deny by default.** Three global guards: rate limit, login required, role check. An endpoint must opt out (`@Public()`) rather than opt in.
3. **Identity protection.** A student can never learn which person or level handles their ticket. Student responses are assembled field by field (`student-view.ts`), never by spreading a database row.
4. **History is append-only.** Every change to a ticket writes a `ticket_event` row in the same transaction. Events are never edited.
5. **Never delete.** "Remove" means hide (`active = false`) or deactivate (`deactivated_at`). Analytics, audit and old tickets keep working.
6. **Make races impossible, not unlikely.** Actions lock the ticket row (`SELECT ... FOR UPDATE`); the escalation job claims tickets with `FOR UPDATE SKIP LOCKED`, so running it twice or from two places is safe.
7. **One definition of each rule.** `FINISHED_STATUSES`, `pickLeastLoadedOwner`, `getTatHours`, `handOffOpenTickets`, `AnalyticsEngine` are each used everywhere instead of being copied, so screens cannot disagree.
8. **Fail loudly at start-up.** `validateEnv` stops the API with a readable list if configuration is wrong; in production it also refuses to start with development leftovers (example secrets, localhost addresses, test domains).
9. **Safe by default for email and test data.** In tests all mail goes to Mailpit; demo data refuses to run on a hosted database unless told; destructive tests refuse to run unless the database name ends in `_test`.
10. **Boring, readable code with comments that explain why.** Files start with a comment describing the rule they implement.
