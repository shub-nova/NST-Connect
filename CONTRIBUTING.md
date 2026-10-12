# Contributing to NST Connect

Thank you for helping. This page takes you from an empty computer to a merged pull request. If a step is unclear or wrong, fix this page in your pull request: that is a welcome contribution too.

Two other documents go with this one:

- [Developer guide](docs/developer/README.md): how the whole codebase works (read it before a bigger change).
- [User guides](docs/user-guide/README.md): what the app does for students, POCs and the admin.

---

## 1. Before you start

### What you need installed

| Tool | Version | Why |
| --- | --- | --- |
| Node.js | **24** recommended (22.12 or newer works) | NestJS 12 is an ES module that the API loads with `require`, which needs a current Node. The API's `engines` field says `24.x`. |
| npm | the one that ships with Node | The repo is an npm workspace. Do not use yarn or pnpm: there is one `package-lock.json`. |
| Docker Desktop (running) | any recent | Starts Postgres, file storage and a mail catcher locally. The end-to-end tests need it. |
| Git | any recent | |

Check:

```bash
node -v
```
```bash
docker --version
```

### Ground rules

1. **Never commit secrets.** `.env` is git-ignored. `.env.example` holds placeholders only. Never paste a real database address, API key or password into an issue, a pull request, code or a chat.
2. **Do not run anything against the live (production) database or site** while contributing. Everything below uses local Docker services.
3. **One change per pull request.** A bug fix, a feature or a refactor, not all three.
4. **Behaviour changes need tests**, and need the docs updated (see section 9).
5. Be kind in reviews. Explain the why, not only the what.

---

## 2. Get the code

1. Fork the repository on GitHub (or, if you have write access, clone it directly).
2. Clone your fork:
   ```bash
   git clone <your-fork-url> NST-Connect
   ```
   ```bash
   cd NST-Connect
   ```
3. (Fork only) add the original as `upstream` so you can stay up to date:
   ```bash
   git remote add upstream <original-repository-url>
   ```

---

## 3. Set it up (first time, about 10 minutes)

Run every command from the repository root unless a step says otherwise.

### 3.1 Install the packages
```bash
npm install
```
Always from the root, never inside `apps/api` or `apps/web`, so there is a single lockfile. This also generates the Prisma database client (the `postinstall` step).

### 3.2 Create your settings file
```bash
cp .env.example .env
```
Open `.env` and replace the `JWT_SECRET` value with a long random one (at least 32 characters). Generate one:
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```
The API refuses to start without a proper `JWT_SECRET`. The rest of `.env.example` already works for local development.

### 3.3 Start the local services
```bash
docker compose up -d
```
This starts three containers:

| Service | Address | What it is |
| --- | --- | --- |
| Postgres 16 | `localhost:5432` | The database (user, password and database are all derived from `nstconnect`). |
| RustFS (S3-compatible) | API `localhost:9000`, console `localhost:9001` | A local stand-in for Cloudflare R2, where attachments are stored. |
| Mailpit | UI `http://localhost:8025`, SMTP `localhost:1025` | Catches all outgoing email so nothing reaches a real inbox. |

Check they are running:
```bash
docker compose ps
```

### 3.4 Create the tables and the starting data
```bash
npm run db:migrate -w apps/api
```
```bash
npm run db:seed -w apps/api
```
`db:migrate` applies every migration to your local database. `db:seed` creates the 11 categories, their topics, a team of one L1, one L2 and one L3 per category, and the admin. See [the root README](README.md) for the list of seeded accounts.

### 3.5 Make the seeded staff accounts usable
The seeded staff exist without passwords. To log in as any of them in development, set one password for all (development only; it refuses to run in production):
```bash
STAFF_PASSWORD='choose-a-password-of-10-or-more-characters' npm run db:activate-staff -w apps/api
```

### 3.6 (Optional) demo data
So the analytics screens have charts to show:
```bash
npm run db:demo-data -w apps/api
```
Remove it again with `npm run db:demo-data -w apps/api -- --clean`.

### 3.7 Run the apps
Two terminals.

Terminal 1, the API on port 3000:
```bash
npm run dev:api
```
Terminal 2, the web app on port 3001:
```bash
npm run dev:web
```

### 3.8 Check it works
```bash
curl http://localhost:3000/health
```
You should see `{"status":"ok","database":"up"}`. Open http://localhost:3001, sign up with an `@adypu.edu.in` address, and open the verification link from Mailpit at http://localhost:8025. Log in as a staff account such as `hostel.l1.1@newtonschool.co` with the password you chose in step 3.5.

### 3.9 Set up the test database (needed before you run the end-to-end tests)
The end-to-end tests use their own database called `nstconnect_test`. They **delete data** in it, so they refuse to run against any database whose name does not end in `_test`.

```bash
docker compose exec db psql -U nstconnect -d postgres -c "CREATE DATABASE nstconnect_test"
```
```bash
DATABASE_URL=postgresql://nstconnect:nstconnect_dev@localhost:5432/nstconnect_test npm run db:migrate -w apps/api
```
```bash
DATABASE_URL=postgresql://nstconnect:nstconnect_dev@localhost:5432/nstconnect_test npm run db:seed -w apps/api
```

---

## 4. Find something to work on

- Look at the open issues. Comment on one to say you are taking it, so two people do not do the same work.
- For anything bigger than a small fix, **open an issue first** describing the problem and your plan. Wait for a reply before you spend days on it.
- Good first contributions: wording fixes, missing tests, documentation, small UI polish, accessibility.
- Known gaps you could help close (see the [developer guide, "Known gaps"](docs/developer/10-known-gaps-and-roadmap.md)): delivering notifications, antivirus scanning of uploads, adding admins from inside the app.

---

## 5. Make your change

### 5.1 Create a branch
Trunk-based: `main` is always deployable and is never worked on directly. Update it, then branch:
```bash
git switch main
```
```bash
git pull upstream main
```
```bash
git switch -c fix/short-description
```
Branch names: `feat/...` for features, `fix/...` for bug fixes, `docs/...`, `refactor/...`, `chore/...`, `test/...`.

### 5.2 Write the code
Follow what is already there. The codebase is deliberately consistent:

- **Match the surrounding style.** Same naming, same comment density, same idioms. The API uses Prettier (`singleQuote`, `trailingComma: all`); the web app follows its ESLint config.
- **Comments explain why**, in plain language, not what the line does. Many files start with a block comment describing the rule the file implements. Keep that habit.
- **No new dependencies without a good reason.** The project deliberately removed unused packages. If you need one, say why in the pull request.
- **Validate all input on the server** with a `zod` schema through `parseOrThrow` (see any controller). Never trust the browser.
- **Authorisation lives on the server.** Hiding a button is not security. See the [security guide](docs/developer/07-security.md).
- **Students must never learn who staff are.** Student responses are built field by field, and a contract test enforces it. Never spread a database row into a student response.
- **Use the shared helpers**: `FINISHED_STATUSES` / `OWNED_OPEN_STATUSES` (`apps/api/src/tickets/ticket-status.ts`), `pickLeastLoadedOwner` (`routing.ts`), `getTatHours` and `deadlineAfter` (`settings/tat.ts`), `useDismiss` and `DialogParts` on the web side. Do not copy their logic.
- **Changes to a ticket go through a transaction with a row lock** where two people could act at once. Read [the lifecycle guide](docs/developer/05-ticket-lifecycle-and-escalation.md) before touching ticket logic.

### 5.3 Database changes (schema or migrations)
Skip this section if you do not change `apps/api/prisma/schema.prisma`.

1. Edit `schema.prisma`.
2. Create the migration. Run it **inside `apps/api`** so you can name it:
   ```bash
   cd apps/api
   ```
   ```bash
   npx prisma migrate dev --name short_description
   ```
   This writes a new folder in `apps/api/prisma/migrations/`, applies it to your local database and regenerates the client. Commit the folder.
3. **Read the generated SQL** before committing. If it drops a column, table or enum value, it deletes data. For anything destructive, add a guard like the one in `20261013100000_remove_unused_structure/migration.sql` (it stops the migration with an error if the data to be removed is not empty).
4. Check schema and migrations agree (CI runs this too; it must print "No difference detected"):
   ```bash
   npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code
   ```
5. Update `docs/er-diagram.md` (and `docs/state-diagram.md` if statuses or events changed).
6. In the pull request, say whether the migration **adds** or **removes** something. This decides the deployment order (see [deployment guide](docs/developer/09-deployment-and-infrastructure.md)): additive migrations run before the code is deployed, removals run after.
7. Every migration must still work with the code that is live right now: make new code tolerate both the old and the new schema where you can.
8. After pulling someone else's migration, apply it with `npm run db:migrate -w apps/api` and regenerate the client with `npm run db:generate -w apps/api`.

---

## 6. Test your change

Run these before you push. CI runs the same ones; a red CI cannot be merged.

### 6.1 Lint
```bash
npm run lint
```
(API: oxlint with type-aware rules. Web: ESLint.)

### 6.2 Type check
```bash
cd apps/api && npx tsc --noEmit -p tsconfig.json
```
```bash
cd apps/web && npx tsc --noEmit
```
(Run each from the repo root: the `cd` only applies to that command.)

### 6.3 Unit tests (no services needed)
```bash
npm test
```

### 6.4 End-to-end tests (Docker must be running, test database created in step 3.9)
```bash
npm run test:e2e -w apps/api
```
They run in order, one at a time, against real Postgres, real storage and real Mailpit. A full run takes a few minutes. To run one file:
```bash
npm run test:e2e -w apps/api -- test/reopen.e2e-spec.ts
```

### 6.5 Build
```bash
npm run build
```

### 6.6 Try it by hand
Run the app, repeat the flow you changed as each role it affects (student, POC, admin) and look at it on a narrow phone-sized window too. For UI changes, include a screenshot in the pull request.

### What to test
- **Bug fix:** first write a test that fails because of the bug, then fix it.
- **New endpoint or rule:** an end-to-end test in `apps/api/test/` covering the allowed case, the refused cases (wrong role, someone else's ticket, bad input), and the data that is written.
- **Pure logic** (parsing, rules, calculations): a unit test next to the file (`*.spec.ts`).
- **Anything a student can fetch:** the identity contract test in `test/identity-contract.e2e-spec.ts` must still pass.

See the [testing guide](docs/developer/08-testing.md) for how the tests are built.

---

## 7. Commit

[Conventional Commits](https://www.conventionalcommits.org/): `type(scope): short summary` in the present tense, no full stop.

| Type | Use for |
| --- | --- |
| `feat` | a new behaviour users can see |
| `fix` | a bug fix |
| `refactor` | code changes with no behaviour change |
| `perf` | speed improvements |
| `test` | tests only |
| `docs` | documentation only |
| `chore` | tooling, dependencies, cleanup |
| `ci` | the GitHub Actions workflow |
| `style` | wording or visual polish with no logic change |

Scopes used so far: `api`, `web`, `db`, or a feature name. Examples:
```
feat(web): Forgot password link, request page and reset page
fix(api): trust the Vercel proxy so rate limits are per visitor, not one shared bucket
chore(db): remove unused columns and tables, add assigned-POC index
```
Add a body (after a blank line) when the reason is not obvious from the summary. Keep commits small and focused; do not mix unrelated changes.

Stage specific files rather than `git add .`, so a stray file never sneaks in:
```bash
git add path/to/changed-file.ts
```
```bash
git commit -m "fix(api): short description"
```

---

## 8. Open a pull request

1. Push your branch:
   ```bash
   git push -u origin fix/short-description
   ```
2. Open a pull request against `main` on GitHub.
3. Fill in:
   - **What and why** (link the issue: `Closes #123`).
   - **How you tested** (commands run, screenshots for UI).
   - **Database change?** If yes: additive or removing.
   - **Docs updated?**
4. Wait for CI (lint, unit tests, build, end-to-end tests, schema drift check). Fix anything red.
5. Respond to review comments by pushing more commits. Do not rewrite history while review is in progress.
6. A maintainer merges after at least one approval and a green CI. Delete your branch afterwards.

### Pull request checklist
- [ ] One change only; the diff has no unrelated edits
- [ ] `npm run lint`, `npm test`, `npm run build` pass
- [ ] End-to-end tests pass (`npm run test:e2e -w apps/api`)
- [ ] New behaviour has tests
- [ ] No secrets, no `.env`, no real emails or connection strings anywhere
- [ ] Migration reviewed, guarded if destructive, ER diagram updated
- [ ] User guides and developer docs updated if behaviour or structure changed
- [ ] Nothing a student can fetch exposes staff identity

---

## 9. Keep the documentation true

The documentation is part of the product. If you change behaviour, update the matching file in the same pull request:

| You changed | Update |
| --- | --- |
| What a student sees or can do | `docs/user-guide/student-guide.md` |
| POC rules, escalation, queue | `docs/user-guide/poc-guide.md`, `docs/state-diagram.md` |
| Admin, categories, settings, analytics | `docs/user-guide/admin-guide.md` |
| Database tables or columns | `docs/er-diagram.md`, `docs/developer/04-database.md` |
| An endpoint | `docs/developer/11-api-reference.md` |
| Hosting, environment variables, free-tier services | `DEPLOY.md`, `docs/developer/09-deployment-and-infrastructure.md` |
| Leaving testing mode | `docs/go-live-checklist.md` |

---

## 10. Reporting a security problem

**Do not open a public issue** for a vulnerability (for example a way to see another student's ticket, learn a staff identity, bypass login, or read someone's files). Contact the maintainers privately (the repository owner, through the email on their GitHub profile) with what you found and how to reproduce it. Please give them reasonable time to fix it before telling anyone else. Never test against the live site with real people's data.

---

## 11. Troubleshooting your setup

| Problem | Fix |
| --- | --- |
| API says `JWT_SECRET must be at least 32 characters` | Set a long random `JWT_SECRET` in `.env` (step 3.2). |
| `Invalid environment configuration: ...` | The message lists each missing or wrong variable. Compare with `.env.example`. |
| Cannot connect to the database | Is Docker running? `docker compose ps`. Is `DATABASE_URL` in `.env` unchanged from `.env.example`? |
| `Cannot find module '.../generated/prisma/client'` | Generate the client: `npm run db:generate -w apps/api`. |
| Port 3000, 3001, 5432, 8025 or 9000 already in use | Stop the other program, or `docker compose down` and start again. |
| Sign-up works but no verification email arrives | Open Mailpit at http://localhost:8025. In development all mail goes there. |
| "Refusing to reset ...: e2e tests must run against a database whose name ends in _test" | The e2e tests use `nstconnect_test`; create it (step 3.9). The test script sets this for you. |
| E2E tests fail with connection or "ECONNREFUSED" errors | Docker is stopped or a service is not up yet. `docker compose up -d`, wait a few seconds, run again. |
| Attachments fail to upload locally | The bucket is created at API start. Restart the API, or run `npm run storage:setup -w apps/api`. |
| Too many requests (429) while testing | Rate limits apply outside tests: 10 logins a minute per address. Wait a minute. |
| The web app behaves oddly after changing the API | Restart both dev servers; hard-refresh the browser. |
| `next` complains about an unknown API or file convention | This project uses a newer Next.js than most tutorials: read `apps/web/AGENTS.md` and the docs in `apps/web/node_modules/next/dist/docs/` first. |

To stop the services: `docker compose down` (add `-v` to also delete their data and start fresh).

---

## 12. Code of conduct

Be respectful and constructive. Assume good intent, give specific feedback, and welcome questions: everyone here was a beginner once. Harassment or discrimination of any kind is not tolerated, and maintainers may remove comments or contributors that break this rule.

By contributing you agree that your contribution may be used under the same terms as the rest of the project (the code is currently marked `UNLICENSED` in `package.json`, meaning all rights are reserved by the project owner; ask the maintainers if you need clarification before contributing).
