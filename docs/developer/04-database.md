# 4. Database

PostgreSQL, managed with **Prisma 7**. The source of truth is `apps/api/prisma/schema.prisma`; the diagram is in [../er-diagram.md](../er-diagram.md). This chapter explains every table, enum, index and migration, and how to change them safely.

## 4.1 Conventions

- Prisma model names are PascalCase; the **tables are snake_case** via `@@map` (`TicketEvent` → `ticket_event`) and **columns too** via `@map` (`tatDeadline` → `tat_deadline`). Raw SQL must use the snake_case names.
- Primary keys are `uuid` (`@default(uuid())`, `@db.Uuid`). In raw SQL cast parameters: `${id}::uuid`.
- Times are `timestamp` (UTC). `createdAt` defaults to `now()`; `updatedAt` uses `@updatedAt`.
- Enums are real PostgreSQL enums.
- **Nothing is hard-deleted**: `active` flags (categories, topics, assignments), `deactivated_at` (users), `revoked_at` (tokens). The only cascade is `admin_note_receipt → admin_note`.
- The generated client goes to `apps/api/src/generated/prisma` (git-ignored). Generator: `prisma-client` with `moduleFormat = "cjs"`.

## 4.2 Enums

| Enum | Values | Meaning |
| --- | --- | --- |
| `Role` | `STUDENT`, `POC`, `SUPER_ADMIN` | Account type. |
| `TicketStatus` | `CREATED`, `ASSIGNED`, `IN_PROGRESS`, `ESCALATED`, `RESOLVED`, `CLOSED`, `REOPENED` | `RESOLVED` is shown to people as "Solved". `RESOLVED`/`CLOSED` are the finished states. |
| `EventType` | `CREATED`, `ASSIGNED`, `COMMENTED`, `STATUS_CHANGED`, `ESCALATED`, `TAT_BREACHED`, `NUDGED`, `RESOLVED`, `CLOSED`, `REOPENED`, `REASSIGNED`, `CLOSED_BY_STUDENT`, `RENAMED` | What happened. `NUDGED` has a staff label but nothing creates it today. |
| `FeedbackRating` | `SATISFIED`, `OKAY`, `NOT_SATISFIED` | Student answer. |
| `Visibility` | `PUBLIC`, `INTERNAL` | Whether a student may see an event or comment. |
| `ScanStatus` | `PENDING`, `CLEAN`, `INFECTED` | Attachment state. Antivirus is not wired yet: a file that passes size/type/content checks becomes `CLEAN`. |
| `NotificationType` | `STATUS_CHANGE`, `COMMENT`, `ESCALATION`, `RESOLVED`, `NEW_TICKET`, `TAT_WARNING`, `TAT_MISSED`, `CRITICAL` | Kinds of notification rows (not delivered yet). |
| `EscalationReason` | `MANUAL`, `TAT_BREACH`, `ON_LEAVE` | Why a ticket was escalated. |

## 4.3 Tables

### `user`
| Column | Notes |
| --- | --- |
| `id`, `email` (unique), `name` | `email` is stored lowercase. |
| `password_hash` | argon2id; **null for invited staff** who have not registered yet. |
| `role` | `Role`. |
| `enrollment_id` | students: the part of the email before `@`. Returned to POCs in ticket detail. |
| `email_verified_at` | null until the verification link is used. Login is refused while null. |
| `deactivated_at` | set when a staff member loses their last role. Login refused; refresh refused. |
| `password_reset_sent_at` | when the last reset email was sent (2-minute cooldown). |
| `created_at` | |

### `category`
`id`, `name` (unique), `short_name` (chip and team label, e.g. "Hostel"), `sort_order`, `max_level` (default **3**; the number of levels), `active`.

### `sub_category` (called *topic* in the UI)
`id`, `category_id`, `name` (unique **within** its category), `sort_order`, `active`.

### `poc_assignment` (who works where)
`id`, `user_id`, `category_id`, `level` (1–3), `manager_assignment_id` (self-reference: the assignment this person **reports to**, one level up), `active`, `on_leave`, `on_leave_until`. Unique `(user_id, category_id)`: one level per person per category. Index `(category_id, level, active)`.
This table decides: which tickets a POC can see (category + level), who a manager can manage (walk `manager_assignment_id`), who gets new tickets (active, not on leave), and whether a category is staffed.

### `ticket`
| Column | Notes |
| --- | --- |
| `title`, `description` | Student text (3–200, 10–5000 chars enforced by the API). |
| `category_id`, `sub_category_id` | `sub_category_id` is nullable in the schema; tickets are always created with one. |
| `student_id` | the raiser. |
| `status` | `TicketStatus`, default `CREATED`. |
| `current_level` | which level holds it now (default 1). Changes on escalation/reopen/hand-over. |
| `resolved_level` | the level that finished it (null while open, and null for a ticket the student closed). Drives reopen rules. |
| `assigned_poc_id` | the current owner; set when created/escalated/handed over and **changed to whoever acts**. |
| `tat_deadline` | when it must be solved by at its current level. **Null** for finished, critical and ownerless (`CREATED`) tickets. |
| `tat_warned_at` | when the "12 hours left" warning row was made for the current deadline; reset with the deadline. |
| `critical` | at the top and past its deadline. |
| `closed_by_student` | the student closed it (status is `CLOSED`); not a POC outcome. |
| `created_at`, `updated_at`, `resolved_at` | |
Indexes: `(status, current_level, tat_deadline)`, `(student_id, created_at)`, `(category_id, status)`, `(assigned_poc_id, status)` (added by the 2026-10-13 migration; serves the least-loaded lookup and "my tickets").

### `ticket_event` (the append-only history)
`id`, `ticket_id`, `type` (`EventType`), `actor_id` (who did it; **null for the system**), `from_status`/`to_status`, `from_level`/`to_level`, `visibility` (default `PUBLIC`), `assignee_id` (who the ticket went to; set on `ASSIGNED`, `ESCALATED`, `REOPENED`, `REASSIGNED`; this is how analytics know which POC held a ticket), `reason` (`EscalationReason`, on `ESCALATED`), `note` (the solve/close note, escalation reason text, rename text, hand-over reason), `created_at`. Indexes `(ticket_id, created_at)`, `(created_at)`.

### `comment`
`id`, `ticket_id`, `author_id`, `body`, `visibility` (default `PUBLIC`; every comment today is public), `created_at`. Replies from POCs and the student's reopen comment.

### `attachment`
`id`, `ticket_id`, `comment_id` (nullable; **unused** today), `uploader_id`, `storage_key` (unique; `tickets/<ticketId>/<random uuid>`; the file name is never in the path), `file_name` (sanitised), `mime_type`, `size_bytes` (`BigInt`), `scan_status`, `created_at`. Index on `ticket_id`.

### `notification`
`id`, `user_id`, `type`, `ticket_id`, `comment_id`, `read_at`, `emailed_at`, `created_at`. Written alongside events, **read by no screen and never emailed** (`read_at`/`emailed_at` are unused). Index `(user_id, read_at)`.

### `staff_audit`
`id`, `actor_id`, `action` (text: `ADDED`, `UPDATED`, `REMOVED`, `LEAVE_ON`, `LEAVE_OFF`, `INVITE_SENT`, `CATEGORY_ADDED`, `CATEGORY_UPDATED`, `CATEGORY_REMOVED`, `CATEGORY_RESTORED`, `TOPIC_ADDED`, `TOPIC_UPDATED`, `TOPIC_REMOVED`, `TOPIC_RESTORED`, `SETTING_CHANGED`), `target_user_id`, `category_id`, `summary` (readable sentence), `created_at`. Shown as "Recent changes" (last 15; a POC sees only their categories).

### `ticket_feedback`
One row per finish. `ticket_id`, `student_id`, `finish_event_id` (**unique**: the `RESOLVED`/`CLOSED` event it answers), `rating`, `comment` (≤ 500), `finished_by_id` and `finished_level` (who is credited), `category_id`, `sub_category_id`, `created_at`, `updated_at`. Indexes by category/time and finisher/time. Staff APIs never return `student_id`.

### `admin_note` and `admin_note_receipt`
`admin_note`: `author_id`, `body`, `audience` (text, e.g. "Hostel · L2"), `context` (what the admin was looking at), `created_at`. `admin_note_receipt`: composite key `(note_id, user_id)`, `seen_at`; `onDelete: Cascade` from the note. One receipt per recipient fixes the audience at send time.

### `refresh_token`
`id`, `user_id`, `token_hash` (unique; SHA-256 of the cookie value), `expires_at`, `revoked_at`. `revoked_at = 1970-01-01` marks a theft revocation.

### `job_heartbeat`
`job_name` (primary key; currently `escalation`), `last_run_at`. Updated at the end of every escalation run; shown to the admin.

### `app_setting`
`key` (primary key), `value` (text), `updated_at`, `updated_by_id`. Today one row: `escalation_hours`.

## 4.4 Relationships in words
- A **category** has many topics, many assignments and many tickets.
- A **user** (POC) has assignments, each in one category at one level, optionally pointing to a manager assignment.
- A **ticket** belongs to a category (and a topic), a student, and optionally a current owner; it has many events, comments, attachments, notifications and feedback rows.
- **Feedback** points to the finish event, so a ticket reopened and finished again can have several feedback rows.

## 4.5 Migrations (`apps/api/prisma/migrations`)

Folders named `<UTC timestamp>_<name>`; each holds a `migration.sql`. `migration_lock.toml` pins the provider (postgresql). They are applied in order and recorded in the `_prisma_migrations` table.

| Migration | What it did |
| --- | --- |
| `20261006040735_init` | First schema |
| `20261006111537_sub_categories` | Topics under categories |
| `20261006125532_closed_status` | Solved vs Closed |
| `20261006202851_auto_escalation` | Deadlines, warning, critical, heartbeat |
| `20261006204041_event_assignee` | `assignee_id` and escalation reason on events |
| `20261007090811_admin_notes` | Notes and receipts |
| `20261007094055_staff_management` | Leave, audit, manager links |
| `20261007143936_ticket_feedback` | Student feedback |
| `20261007145513_student_self_close` | `closed_by_student`, `CLOSED_BY_STUDENT` |
| `20261011100000_renamed_event` | `RENAMED` event type |
| `20261011200000_app_setting` | Admin-set escalation time |
| `20261012100000_password_reset` | `password_reset_sent_at` |
| `20261013100000_remove_unused_structure` | Dropped never-used columns/table/enum values, added the owner index. Has a **guard** that aborts if the data to drop is not empty. |

### Commands
```bash
# Create + apply a migration locally (run inside apps/api so you can name it)
cd apps/api && npx prisma migrate dev --name what_it_does
# Apply existing migrations (production, CI, a fresh database)
npm run db:deploy -w apps/api
# Regenerate the client
npm run db:generate -w apps/api
# Does schema.prisma equal the migrations? (CI runs this; must report no difference)
cd apps/api && npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code
```
`prisma.config.ts` loads the root `.env` and points Prisma at `prisma/schema.prisma`, `prisma/migrations` and the seed (`tsx prisma/seed.ts`).

### Rules for writing migrations
1. **Read the SQL.** Prisma writes `DROP` statements when you remove something.
2. **Guard destructive migrations** with a `DO $$ ... RAISE EXCEPTION` block that checks the data is empty (see the 2026-10-13 one). Removing an **enum value** needs the type-swap pattern (`CREATE TYPE ..._new`, alter the column `USING`, rename, drop old), as in that file.
3. **Order of deployment:** additive (new table/column/index) before the code that uses it; removing after the code that stops using it is live and Ready. The reason: the live code may still read what you are removing.
4. Make new code work against **both** the old and the new schema where practical (this was proven for the last migration by running the whole e2e suite against each).
5. Never edit a migration that has been applied anywhere. Add a new one.
6. Take a **Neon branch** (safety copy) before any production migration that removes something.

## 4.6 Raw SQL you will meet

| Where | Why |
| --- | --- |
| `SELECT id FROM ticket WHERE id = $1::uuid FOR UPDATE` | Row lock inside a transaction before changing a ticket. |
| Escalation: `SELECT … FOR UPDATE SKIP LOCKED LIMIT 1` | Claim one overdue ticket without waiting on, or double-processing with, another run. |
| Warning: `UPDATE … SET tat_warned_at … RETURNING` | One atomic statement claims and returns the tickets to warn. |
| Queue: keyset query with computed sort keys | Fast, stable paging. |
| Analytics: aggregates, `percentile_cont`, `date_trunc`, lateral joins | Not expressible in Prisma's query builder. |

Always use tagged templates (`prisma.$queryRaw\`...${value}...\``) so values are parameters, never string-built SQL.

## 4.7 Connection strings (Neon)
- **Pooled** (host contains `-pooler`): for the running API (`DATABASE_URL` in Vercel) with `DB_POOL_MAX=1`.
- **Direct** (no `-pooler`): for `prisma migrate deploy`, the production seed and admin scripts; pooled connections are not suitable for migrations.
- Neon's free compute **suspends when idle**, so the first query after a quiet period is slower.
