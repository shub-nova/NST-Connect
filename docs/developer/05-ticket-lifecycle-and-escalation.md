# 5. Ticket lifecycle and escalation

The most important chapter. Everything the product promises is implemented here. Diagram: [../state-diagram.md](../state-diagram.md).

## 5.1 Two separate ideas: status and level

- **Status** (`ticket.status`): where the ticket is in its life: `CREATED`, `ASSIGNED`, `IN_PROGRESS`, `ESCALATED`, `RESOLVED` (Solved), `CLOSED`, `REOPENED`.
- **Level** (`ticket.current_level`): who is responsible: 1, 2 or 3. Changes on escalation, reopen and hand-over.
- **Owner** (`ticket.assigned_poc_id`): a specific person at that level.

Students see only the status label and a team name; level and owner are staff-only.

## 5.2 The lifecycle

```
student raises ──► ASSIGNED (L1 owner, deadline = now + limit)
                     │  reply / "in progress" (does NOT move the deadline)
                     ▼
                IN_PROGRESS ──┐
                     │        │ not solved by the deadline  → job moves it up: ESCALATED (next level, fresh deadline)
                     │        │ POC chooses Escalate         → ESCALATED (next level, fresh deadline)
                     ▼        ▼
   Solved (RESOLVED) / Closed (CLOSED)   ← POC outcome, note required, deadline cleared
                     │
        student: reopen (comment required) → REOPENED (level that finished it, fresh deadline)
                     │            unless the finishing level was the top level: final
   student any time while open: Close → CLOSED + closed_by_student (not a POC outcome; reopenable)
```
At the top level a missed deadline does not escalate: the ticket becomes `critical`, the deadline is cleared, and it stays so until solved or closed.

## 5.3 Creation (`TicketsService.create`)

1. Find the active topic (and active category). Re-check the category is **staffed at every level**.
2. In a transaction:
   - Choose the owner: start at level 1, call `pickLeastLoadedOwner`; if nobody (everyone on leave), try level 2, then 3. If nobody at all, the ticket is stored as `CREATED` with no owner and **no deadline**; the scheduled job assigns it as soon as someone is available (see 5.6).
   - Create the ticket: status `ASSIGNED`, `currentLevel` = the level it started at, `assignedPocId`, `tatDeadline = deadlineAfter(now, getTatHours(tx))`.
   - Events: `CREATED` (actor student), and `ASSIGNED` (assignee; note "Nobody on duty at level 1" when it started higher).
   - Notification row `NEW_TICKET` for the owner.

## 5.4 The deadline ("TAT")

- **Set** (to now + limit) when a ticket reaches a level: creation, reopen, escalation (manual or automatic), hand-over on leave/removal. The limit is read **inside the same transaction** (`getTatHours(tx)`).
- **Not moved** by replying, marking in progress, viewing, or anything else.
- **Cleared** by solve/close (and by the student closing, and by going critical).
- The limit is whole days between 1 and 14 (default 2 = 48 h); stored in hours in `app_setting.escalation_hours`. An invalid stored value falls back to 48.
- **Changing the setting never touches existing deadlines**; it applies the next time a clock starts. So a change cannot cause a wave of escalations.
- Hours are wall-clock: nights and weekends count.

## 5.5 Staff actions (`PocService`)

All run through `act()` (see chapter 3): lock → verify scope → run action → `assignedPocId = actor` → apply changes.

| Action | Rule | Events and effects |
| --- | --- | --- |
| Reply | text 1–5000 | `COMMENTED` event + public comment + student notification; moves `ASSIGNED/ESCALATED/REOPENED` to `IN_PROGRESS` (own `STATUS_CHANGED` event). Deadline untouched. |
| Mark in progress | 409 if already | `STATUS_CHANGED`; student notification; deadline untouched. |
| Solve | note 5–2000 | `RESOLVED` event with note; status `RESOLVED`; `resolvedAt`, `resolvedLevel = currentLevel`; clear deadline/warning/critical; student notification. |
| Close | note 5–2000 | same with `CLOSED`. |
| Escalate | note 5–2000; a higher level must exist and some level above must have someone on duty (a level with nobody is skipped, as automatic escalation does) | `ESCALATED` (reason `MANUAL`, assignee, note); status `ESCALATED`; level+1; new owner (least loaded); fresh deadline; clears warning/critical; notifies student and new owner. The old POC loses access (scope is by level). |
| Bulk | ≤ 50 ids per request | each ticket separately with the same rules; per-ticket failures returned. |

## 5.6 Automatic escalation (`EscalationService.runOnce`)

Triggered by cron-job.org every 30 minutes (`POST /internal/escalation/run`) or, on an always-on host, by the in-process timer. Safe to run any time and from several places at once.

Order inside one run:
1. **End finished leave:** `UPDATE poc_assignment SET on_leave = false … WHERE on_leave AND on_leave_until <= now`.
2. **Warnings** (`sendWarnings`): one atomic `UPDATE ticket SET tat_warned_at = now WHERE status IN (owned open) AND assigned_poc_id IS NOT NULL AND tat_deadline > now AND tat_deadline <= now + TAT_WARNING_HOURS AND tat_warned_at IS NULL RETURNING id, assigned_poc_id`, then a `TAT_WARNING` notification row per ticket. Once per deadline.
3. **Overdue tickets**, up to 500 per run (`MAX_TICKETS_PER_RUN`), one at a time, each in its own transaction:
   - `SELECT id FROM ticket WHERE status IN (owned open) AND tat_deadline IS NOT NULL AND tat_deadline <= now ORDER BY tat_deadline LIMIT 1 FOR UPDATE SKIP LOCKED` (another run holding a ticket just makes this one skip it).
   - Find the next owner: for level = current+1 … `maxLevel`, the first level where `pickLeastLoadedOwner` finds someone (empty levels skipped).
   - Always write an **internal** `TAT_BREACHED` event (actor = the POC who held it) and a `TAT_MISSED` notification row for that POC. This is what analytics count as "Auto-escalated from me".
   - If an owner was found → `escalate()`: `ESCALATED` event (actor null = system, reason `TAT_BREACH`, assignee), notification rows for the student and the new owner, ticket → `ESCALATED`, new level/owner, fresh deadline, `tatWarnedAt` cleared.
   - If none found → `flagCritical()`: `CRITICAL` notification row to every admin, ticket `critical = true`, deadline and warning cleared (so the next run does not log the same miss again).
4. **Unowned tickets and housekeeping** (run before step 3): tickets in status `CREATED` with no owner (raised while nobody was on duty at any level) are given an owner at the first level that has someone available, with a fresh deadline and `ASSIGNED` event, exactly like a new ticket; tickets nobody can take yet are left for the next run. The same run deletes uploads that were requested but never confirmed (`PENDING` for over 15 minutes) and their stored objects.
5. **Heartbeat:** upsert `job_heartbeat('escalation').last_run_at = now`.

Why it is safe to repeat: after handling, a ticket's deadline is in the future (or null), so a second run finds nothing; concurrent runs never claim the same ticket; the heartbeat is only informational.

Why `FINISHED`/`CREATED` tickets are never touched: the claim query only matches `ASSIGNED, IN_PROGRESS, ESCALATED, REOPENED` with a non-null deadline.

## 5.7 Reopening (`TicketsService.reopen`)

- Only the ticket's student; only `RESOLVED`/`CLOSED`.
- `canReopen(status, resolvedLevel, topLevel)` = finished **and** `(resolvedLevel ?? 1) < topLevel`. So a ticket solved/closed by the **top level** (`category.maxLevel`, 3 today) is **final**; a student-closed ticket has `resolvedLevel = null` and is always reopenable.
- Start level for owner search: the level that finished it (`resolvedLevel`), or `currentLevel` for a student-closed ticket; search upward; if nobody at all → 409.
- Writes: `REOPENED` event (assignee), the comment, a `COMMENT` notification row; resets the ticket fields (`REOPENED`, level, owner, fresh deadline, warning/critical/resolved fields cleared, `closedByStudent = false`).

## 5.8 Student self-close (`closeOwn`)
Locks the row; refuses finished tickets; writes `CLOSED_BY_STUDENT`; `status = CLOSED`, `closedByStudent = true`, clears deadline/warning/critical; notifies the previous owner (`STATUS_CHANGE`). Not a POC outcome: analytics ignore it for Solved/Closed and finish times; no feedback allowed because feedback attaches to a POC `RESOLVED`/`CLOSED` event.

## 5.9 Leave and removal hand-over (`handOffOpenTickets`)
Called in the same transaction **after** the assignment is flagged `on_leave` or inactive (so the person is already out of the pool). For each open ticket they hold in that category and level (oldest first, row-locked): same level (least loaded) → `REASSIGNED` internal event; else the next level up → `ESCALATED` with reason `ON_LEAVE` (system actor); else stays and admins get `CRITICAL` rows. Everything moved gets a fresh deadline (`critical` cleared). Students see nothing about reassignment; an on-leave escalation shows as a normal "Escalated".

## 5.10 Feedback
Attached to the **latest finish event** (`RESOLVED`/`CLOSED`) of the ticket by `finish_event_id` (unique). Stores the finishing POC and level, so analytics credit them. Changeable for 7 days from the answer's creation. Percentages shown only with ≥ 5 answers.

## 5.11 Concurrency summary

| Situation | Protection |
| --- | --- |
| Two POCs act on the same ticket | `FOR UPDATE` lock in `act()`; second waits, then sees the new state |
| Student closes/reopens while a POC acts | same lock (`closeOwn`, `reopen` lock the row too) |
| Two escalation runs at once | `FOR UPDATE SKIP LOCKED` + deadlines pushed into the future |
| Two reset-link uses at once | `updateMany where passwordHash = old` counts 1 |
| Two parallel refreshes (two tabs) | 10-second reuse grace window; client also de-duplicates refreshes |
| Leave/removal during an action | tickets locked `FOR UPDATE` in hand-over |

## 5.12 Events and who may see them

| Event | Visible to student? | Notes |
| --- | --- | --- |
| `CREATED`, `ASSIGNED` (to the team), `STATUS_CHANGED`, `ESCALATED` ("Escalated to … team"), `CLOSED_BY_STUDENT`, `RESOLVED`, `CLOSED`, `REOPENED`, `RENAMED` | Yes (generic wording; solved/closed notes and rename text shown; escalation note hidden) | `COMMENTED` events are not listed; the comments themselves are |
| `TAT_BREACHED`, `REASSIGNED`, `NUDGED` | No (`INTERNAL`) | Shown to POCs in the activity list |
