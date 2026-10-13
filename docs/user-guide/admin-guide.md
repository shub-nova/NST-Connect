# NST Connect: Super Admin guide

The Super Admin sets the structure (categories and topics), builds the teams, sets the escalation time, and watches how every team is doing. This guide lists everything the admin can do, the rules the app enforces, and the limits.

---

## 1. The short version

1. **Categories** decide what students can raise (Categories page).
2. **Teams** decide who answers: every category needs a person at **L1, L2 and L3** (Settings). A category with a gap is **hidden from students**.
3. **Escalation time** (Settings) is how long a POC has before a ticket moves up. Default **2 days**, range 1 to 14.
4. **All teams** (home page) shows the numbers for everyone, filterable by category and level. You can send **notes** to POCs from here.
5. **The admin does not open or answer tickets.** The admin sees numbers, not individual tickets.

---

## 2. Your account

- There is **no sign-up for admins** in the app. The admin account is created when the system is set up (using the `ADMIN_EMAIL` address), and the first password is either set by signing up with that address (if you can open its mailbox, then clicking the verification link) or set by a person with server access using the `admin:set-password` script.
- To add a **second admin** today, a developer must do it with that script. (Adding admins from inside the app is planned.)
- You log in like everyone else and land on **All teams**. Forgot password works the same way (link valid 1 hour, once).
- The admin has **no queue and no leave**.
- Menu (round avatar, top right): **Settings**, **Categories**, **Log out**. The megaphone icon shows the notes you sent.

---

## 3. Categories and topics ("Categories" page)

Students pick a **category** (a chip such as Hostel) and then an **issue** (a topic inside it). Only the admin manages these. Nothing is ever deleted: removing **hides** it from new tickets, and it can be **restored**, so tickets and statistics keep their names.

### Add a category
1. **Add category**. Fill in:
   - **Category name** (3 to 80 characters), unique ignoring capitals. If a *removed* category already has that name, you are told to restore it instead.
   - **Short name** (optional, 2 to 30 characters): what shows on chips and as the team name ("Hostel team"). Defaults to the name.
   - **Topics**: one per line, **at least one**, up to 40 at once, each 3 to 120 characters. Blank lines and repeats (ignoring capitals) are dropped.
2. After saving: *"Added ... Add its staff from Settings."* **Students will not see it** until it has staff at L1, L2 and L3.

A red badge **"Hidden from students · needs L2, L3"** means those levels are empty. A green badge **"N people assigned"** means it is live.

### Edit, remove, restore
| Action | Rule |
| --- | --- |
| **Edit** (name, short name) | Renames **everywhere, including old tickets**. Every **open** ticket gets a public "Name updated" note on its timeline so the student knows. |
| **Remove category** | Hides it from students. **Refused while it has open tickets** ("still has 3 open tickets. Remove it once they are solved or closed."). Its tickets and staff assignments are kept. |
| **Restore category** | Brings it back (and its staffing). Under "Show N removed categories". |
| **Add topic** | One line under the category (3 to 120 characters, unique within the category). The category must be active. |
| **Rename topic** | Open tickets with this topic get the "Name updated" note. |
| **Remove topic** | **Refused while tickets with that topic are open.** A live category must always keep **at least one active topic**. |
| **Restore topic** | Under "N removed topics". |

All of these are listed under **Recent changes** in Settings.

### Levels
Every category has exactly **three levels (L1, L2, L3)**. L3 is the top: nothing escalates beyond it and **L3's solve or close is final** (the student cannot reopen it).

---

## 4. Teams ("Settings" page)

You see **everyone in every category**, grouped by level, with status badges (**Active**, **Invited**, **On leave · back 12 Oct**), who they report to, and how many tickets they have open. Use the Category filter to narrow down.

### Build a team (do it in this order)
Each lower level reports to someone one level up, so add from the top:
1. **L3** first (no manager needed).
2. Then **L2** (reports to an L3).
3. Then **L1** (reports to an L2).

If there is no one to report to, the form says "There is no L2 to report to yet." If there are several choices you choose **Reports to**.

### Add POC
- Fields: **Name**, **Email** (must end in the staff domain, `@newtonschool.co`), **Category**, **Level**, **Reports to**.
- The person receives an email: an **invitation** with a personal sign-up link (it is tied to that email: the sign-up page shows the address and cannot change it, and any other address is refused; the link works for 14 days) or "You were added to ..." if they already have an account. They show as **Invited** until they set a password.
- The same person can hold roles in more than one category. Someone already on that category cannot be added twice. A previously removed person is **reactivated**.
- Each person's access is **only** their category and level pairs. Registering never gives access.
- Email problems or an expired link (14 days): **Resend invite** is in the person's ⋯ menu; it sends a fresh link. If the person says the link does not work, resend it.

### Edit, leave, remove
| Action | Rule |
| --- | --- |
| **Edit** | Change the name or who they report to (a person one level up in the same category). |
| **Put on leave** | A **return date is required** (a future date). You can put **any POC**, including L3s, on leave. Their open tickets are handed over: to another on-duty person at their level, otherwise escalated one level up (with reason "owner on leave"), otherwise left in place and you are notified as critical. Handed-over tickets get a fresh timer. Leave ends on the return date (the 30-minute job ends it) or by **Back from leave**. |
| **Remove** | Refused if they still have people reporting to them ("Move ...'s team to someone else first"), or if they are the **only person at that level** ("Add another L3 first so tickets always have an owner"). Open tickets are handed over like a leave. If it was their last role they are **deactivated, logged out** and emailed. History and statistics are kept. |
| **Recent changes** | The last 15 events (adds, edits, leave, removals, catalogue changes, escalation-time changes) with who and when. |

### Rules to remember
- A category with an **empty level** disappears for students and the server refuses new tickets in it. This can happen suddenly if you remove the last person at a level.
- L2 and L3 can also use Settings, but only for the people below them.
- You cannot remove yourself, and admins are not managed here.

---

## 5. Escalation time (top of Settings)

**What it is:** how long a POC has to **solve** a ticket before the system moves it up a level.

- Choose **1 to 14 days** (the dropdown offers 1, 2, 3, 4, 5, 6, 7, 10, 14), then **Save**. Default **2 days (48 hours)**.
- **Only the Super Admin can change it.** Every change is recorded in "Recent changes" ("Changed the escalation time from 2 days to 3 days").
- It applies **from now on**: a ticket's current deadline is left alone, and the new limit is used the next time a clock starts (new ticket, reopen, escalation, hand-over). So changing it never makes many tickets escalate or stop escalating at once.
- The analytics labels ("Finished within 2 days") use the **current** limit.

### How escalation works
1. A deadline is set when a ticket starts a level (creation, reopen, escalation, hand-over).
2. **Replying or marking in progress does not extend it.** Only Solved, Closed, Escalated (by the POC), or the student closing it, stop it.
3. About **12 hours before** it, a warning is recorded for the POC (not displayed or emailed yet).
4. When it passes, the next run of the escalation check (**every 30 minutes**) records a miss against the holder, moves the ticket to the **next level with someone on duty** (skipping empty levels) with a fresh deadline, and the student sees "Escalated".
5. At the top (L3, or nothing above), the ticket becomes **Critical** and you are notified. Its clock stops so it is not counted twice. It stays Critical until a POC solves or closes it.

### Keep the schedule alive
On the live site a free scheduler (cron-job.org) calls the escalation endpoint every 30 minutes. The Escalation time card shows **"Last escalation check ran 12 min ago"**. If it is older than **3 hours** it turns **red**: *"tickets are not being escalated on time. Check the schedule."* Then check the cron-job.org job (it needs the same `JOB_SECRET` as the server and a POST request; a 401 means the secret is wrong). See DEPLOY.md section 7. **Without the schedule nothing escalates.**

---

## 6. All teams (the home page)

Pick a **period**: 7, 30 or 90 days, or **Custom** (up to 366 days). Filters:
- **Category**: choose one to see that team only (then the breakdown lists each person), or **All categories** to compare categories.
- **Level**: all levels, or L1, L2 or L3.

You see the same numbers POCs see, from the same calculations (so they can never disagree):

| Number | Meaning |
| --- | --- |
| Action needed / total | Open tickets waiting on POCs, out of all tickets involved in the period. |
| Solved, Closed, Escalated | Outcomes POCs chose in the period. |
| Auto-escalated | Tickets that were not solved within the limit and moved up. (At L3: "Missed the 2-day limit".) |
| Finished within the limit | Share of finished tickets finished within the current limit. |
| Reopened | Share of finished tickets that students reopened. |
| Satisfaction | Share of "Satisfied" answers; **only shown with at least 5 answers**. |
| How long tickets took | Days from raised to Solved/Closed (rounded up; 10+ days grouped). |
| Time left on open tickets | How much of the limit is left; Critical tickets have no clock. |
| Student feedback | Anonymous answers and recurring words in comments. |
| Most repeated categories / sub-categories / phrases | What students raise most, versus the previous period of the same length. |

The "How these numbers are calculated" box at the bottom of the page states the definitions.

**Important limits:** you see **numbers and charts only**. There is **no screen to open a particular ticket** or to see a student's identity. Student feedback is anonymous to everyone.

### Send a note
**Send a note** (megaphone) sends a message to **POCs** matching the current filter: a category, a level, or one person (use "Send to"). The note is 3 to 2,000 characters, is **emailed** to each recipient and appears under their bell. The audience is fixed when you send; you can see how many recipients have **seen** each note in the megaphone list (your last 20). Use it to chase a Critical ticket, praise a team, or ask a level to clear a backlog.

---

## 7. What you will want to check regularly

| What | Where | What it means |
| --- | --- | --- |
| Escalation check is recent | Settings, Escalation time | Red = the scheduler stopped. |
| Every category staffed | Categories, badges | Red "Hidden from students" = students cannot raise tickets there. |
| Critical tickets | All teams (auto-escalated / missed-limit numbers) | Tickets that missed the limit at every level. Tell the L3 with a note. |
| Backlog / overdue | All teams, "Time left on open tickets" | Many tickets with little time left = a team is overloaded. |
| Reopen rate and Satisfaction | All teams | A high reopen rate suggests tickets are closed without a real fix. |
| Everyone back from leave | Settings | A person on leave gets no tickets. |

**Not built yet (be aware):** there is **no email or in-app alert** to staff or students about tickets, escalations or critical flags (they are recorded only). POCs must check their queue themselves, and you must check the numbers above. Ask your team to open **My queue** at least twice a day.

---

## 8. What the admin cannot do

- Open, answer, reassign, reopen or delete a ticket.
- See which student gave which feedback.
- Create another admin or reset another person's password from the app. (People reset their own with **Forgot password**; a developer can set an admin password with the script.)
- Change the number of levels (always three).
- Delete categories, topics or people (they can only be hidden/deactivated, so history stays intact).

---

## 9. Going live checklist (summary)

The full steps are in `docs/go-live-checklist.md` and `DEPLOY.md`. In short:
1. Remove demo data, allow only the real email domains, and deactivate test accounts.
2. Staff every category at L1, L2 and L3 (green badges on Categories).
3. Confirm the escalation check ran within the last hour.
4. Set a proper sender email, rotate any secrets that were shared, add a second admin.
5. Tell POCs to check **My queue** twice a day; tell students to check **My tickets** (no notifications yet).
6. Test with real addresses: student sign-up and ticket with an attachment, forgot password, a real POC being added and seeing their queue.

---

## 10. Quick reference

| Question | Answer |
| --- | --- |
| Who sets the escalation time? | Only the Super Admin (Settings). |
| Range and default? | 1 to 14 days; default 2 days. |
| Does a change affect open tickets? | No. Only clocks that start after the change. |
| How often does escalation run? | Every 30 minutes (external scheduler). |
| Does a reply stop the timer? | No. Only solving/closing/escalating does. |
| What is Critical? | A ticket that missed the limit and has nowhere higher to go. |
| Who can reopen after solve? | The student, unless an L3 finished it. |
| Who creates teams? | Admin (anyone); L3 adds L2/L1; L2 adds L1. |
| Can a category be removed with open tickets? | No. |
| Can I see a student's ticket? | No, only statistics. |
