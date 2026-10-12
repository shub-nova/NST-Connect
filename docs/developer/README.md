# NST Connect developer guide

Read this guide in order and you will know how the whole system works: what it is built with and why, how a request travels through it, every table, every rule, how it is tested and how it is deployed on free tiers.

| # | File | What you learn |
| --- | --- | --- |
| 1 | [Overview and tech stack](01-overview-and-tech-stack.md) | What the product is, the roles, the architecture, every technology and **why** it was chosen |
| 2 | [Local setup and configuration](02-local-setup-and-configuration.md) | Running it on your computer, every environment variable, every script, the local services |
| 3 | [Backend architecture](03-backend-architecture.md) | The NestJS app: request lifecycle, guards, every module and file, patterns used everywhere |
| 4 | [Database](04-database.md) | Every table and column, enums, indexes, migrations, the seed, Prisma 7 specifics |
| 5 | [Ticket lifecycle and escalation](05-ticket-lifecycle-and-escalation.md) | The heart of the product: statuses, levels, deadlines, escalation job, hand-over, reopen, locking |
| 6 | [Frontend](06-frontend.md) | The Next.js app: routes, auth flow, the API client, every component, styling |
| 7 | [Security](07-security.md) | Login and tokens, authorisation, rate limiting, identity protection, uploads, headers |
| 8 | [Testing](08-testing.md) | Unit and end-to-end tests, the test database, how to write a test, CI |
| 9 | [Deployment and infrastructure](09-deployment-and-infrastructure.md) | The free-tier services, why each, how the pieces connect, deploy order, operations runbook |
| 10 | [Known gaps and roadmap](10-known-gaps-and-roadmap.md) | What is not built, the sharp edges, and ideas for what comes next |
| 11 | [API reference](11-api-reference.md) | Every endpoint: who may call it, input, output, errors |
| 12 | [Capacity and cost](12-capacity-and-cost.md) | How many users it handles (estimates), what breaks first, what 2,000 users cost, how to load-test |

Also in the repository:

- [CONTRIBUTING.md](../../CONTRIBUTING.md): step by step from nothing to a merged pull request
- [DEPLOY.md](../../DEPLOY.md): the click-by-click hosting steps
- [docs/er-diagram.md](../er-diagram.md) and [docs/state-diagram.md](../state-diagram.md): diagrams
- [docs/go-live-checklist.md](../go-live-checklist.md): leaving testing mode
- [docs/user-guide/](../user-guide/README.md): what the app does for each kind of user

## The ten things to remember

1. **Monorepo, two apps.** `apps/api` (NestJS) and `apps/web` (Next.js), one `package-lock.json`, one `.env` at the root.
2. **The browser only talks to the web address.** `/api/*` is forwarded to the API in production, so the login cookie is same-site.
3. **Deny by default.** Every endpoint needs a login unless marked `@Public()`; `@Roles(...)` limits by role; "which tickets can this POC see" is decided by SQL, never by hiding buttons.
4. **Students never learn who staff are.** Student responses are built field by field and a contract test enforces it.
5. **Tickets move in transactions with row locks.** Two people acting at the same moment cannot corrupt a ticket.
6. **The deadline is for solving.** Only solving, closing or escalating stops it. Replying does not.
7. **Escalation is an external schedule.** Vercel has no always-on process; cron-job.org calls the API every 30 minutes.
8. **Nothing is ever hard-deleted.** Categories, topics and people are hidden or deactivated so history and analytics stay true.
9. **Migrations that remove things are deployed after the code**; migrations that add things before it.
10. **Notifications are recorded but not delivered.** This is the biggest known gap (see [known gaps](10-known-gaps-and-roadmap.md)).
