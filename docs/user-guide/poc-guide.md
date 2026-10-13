# NST Connect: POC (staff) guide

For everyone who answers tickets: levels **L1**, **L2** and **L3** of a category. L2 and L3 also manage the people below them. This guide covers the rules the app enforces, so you know what it will and will not let you do and what happens automatically.

---

## 1. The short version

- Every category has three levels of POCs: **L1** (first line), **L2**, **L3** (top). A new ticket starts with L1.
- You **solve or close** a ticket within the time limit (**2 days by default**, set by the admin). If you do not, the system **escalates it** to the next level on its own.
- Replying, or marking "in progress", does **not** stop the clock. Only **Solved**, **Closed** or **Escalated** do.
- Solving or closing **needs a note** (at least 5 characters). Replying does not.
- **Nothing alerts you** about new or escalated tickets (see section 12). **Open My queue at least twice a day.**

---

## 2. Getting access

1. **Your email must end with the staff domain** (`@newtonschool.co`). Staff cannot sign up with any other address.
2. A team lead (L2 or L3) or the admin **adds you** from **Settings**. You get an email: "You are invited to NST Connect" (or "You were added to ..." if you already have an account).
3. Open the **link in the invitation email**. It opens the sign-up page with **your invited email address already filled in and locked** (it cannot be changed, and any other address is refused). Choose a password (at least 10 characters). Then click the verification link we email you (valid 24 hours) and log in. The invitation link works for 14 days; if it has expired, ask your team lead to use **Resend invite**.
4. If you sign up before being added, you can still log in, but **My queue** says **"You are not assigned to a category yet"**. Ask your team lead or the admin to add you from Settings; your tickets then appear. Signing up never gives access by itself.
5. Forgot your password? Use **Forgot password?** on the login page (link valid 1 hour, one use).

You are always tied to one or more **category and level** pairs (for example "Hostel L1"). You only ever see tickets in your own pairs.

---

## 3. Who gets which ticket

- A new ticket goes to the **least-loaded L1** (fewest open tickets) who is **not on leave**.
- If nobody is available at L1, it starts at the next level that has someone.
- **Important: you see every ticket at your category and level, not only the ones assigned to you.** Whoever opens a ticket and acts on it (reply, in progress, solve, close, escalate) **claims it**: it becomes theirs. Because actions are locked per ticket, two people acting at once cannot clash: the second one waits.
- Once a ticket moves to another level it **disappears from your queue** (you no longer have access to it).
- Students never see your name or your level. They see only "*Hostel team*".

---

## 4. My queue

### Tabs and counts
- **Open**: every ticket in your pairs that is not Solved or Closed. **Done**: Solved or Closed (including those the student closed: shown as "Closed by student").
- The numbers on the tabs are the real totals. The list loads **25 at a time**: press **Load more**; "Showing 25 of 140" tells you how many remain.

### Sorting
- Open: **Least time left** (default: Critical first, then soonest deadline), **Oldest first**, **Newest first**.
- Done: Oldest / Newest (finished tickets have no clock).

### What each row shows
Title, issue, student name, how long ago it was raised, and a due note: "due in 5h" or **"12h overdue"** in red (shown as days from 48 hours). A red **Critical** badge appears on critical tickets. The status badge is Assigned, In progress, Escalated, Reopened (or "Closed by student").

### Acting on many tickets at once (bulk)
1. **Right-click** a ticket and choose **Select** (on a phone, **press and hold** a ticket). Checkboxes appear; click rows to add more. **Select all N** picks everything on screen. You can select up to 500.
2. A bar shows what you can do: **Solve**, **Close**, **Escalate**, **Reply**, **Clear**.
3. Solve/Close/Escalate need a note (5+ characters), Reply needs text. The note is used for every selected ticket and each student gets the message on their own ticket.
4. Escalate is hidden if any selected ticket is at the top level (L3).
5. Tickets are processed one by one under the same rules as a single ticket. Any that cannot be changed (already finished, taken over by someone else, nobody on duty above) are listed with the reason and left untouched; the rest go through. Large selections are sent in groups of 50 with a progress bar.

---

## 5. Working a ticket

Open a ticket to see: title, topic, **student name and email**, when it was raised, **Due** date (turns red when overdue), the description, attachments (click to download; the link works about a minute), and **Activity**: the whole conversation and every step, including internal ones such as "Missed the time limit", "Handed to another POC" (with the reason) and the reason for an escalation. **Students never see those internal entries.**

If a ticket is **Critical** you see a red banner: *This ticket was not solved within the time limit at any level. Please solve or close it now.*

### The four things you can do

**1. Reply** (no note rules, just write something, up to 5,000 characters)
- The student sees it as "*Hostel team replied*". Nobody can tell which POC wrote it.
- If the ticket was Assigned, Escalated or Reopened, your first reply also marks it **In progress**.
- A reply does **not** extend the deadline.

**2. Mark in progress** (button)
- Tells the student you are on it. Only available if it is not already in progress.
- Does **not** extend the deadline.

**3. Close ticket... then choose an outcome** (a note is **required**: at least 5, at most 2,000 characters)

| Outcome | Use it when | Student sees | Result |
| --- | --- | --- | --- |
| **Solved** | The issue is fixed. | "Solved" and your note | Ticket finished. Timer stops. Student is asked for feedback. |
| **Closed** | Finished without a fix (duplicate, invalid, not possible, no response). | "Closed" and your note | Same as above. |
| **Escalate** | You cannot fix it, or it needs more authority. | Only "Escalated to *team*" | Moves to the next level with a fresh timer. **Only staff see your note.** |

**4. Download attachments.** POCs cannot upload files; only students attach them.

### What you cannot do
- Act on a ticket that is already Solved or Closed ("This ticket is already finished.").
- Escalate from the top level: "This ticket is already at the highest level."
- Escalate when nobody is on duty at the next level: "No one is on duty at the next level." (Ask your lead to fix the roster.) Manual escalation goes to the **next** level only.
- Edit the student's ticket, delete a ticket, or add internal comments (there are none).

---

## 6. The time limit and escalation (the rules in full)

### The clock
- A ticket has a **deadline**. A fresh deadline (now + the limit) is set when the ticket: is **created**, is **reopened** by the student, is **escalated** to a new level (manually or automatically), or is **handed over** because someone went on leave or was removed.
- The limit is **2 days (48 hours)** unless the admin changed it (1 to 14 days). It is counted continuously: nights, weekends and holidays count.
- The limit is chosen **when the clock starts**. Changing it later affects only clocks that start afterwards; tickets already open keep their current deadline.
- Only **Solved**, **Closed** or **Escalated** stop a clock. **Replying, marking in progress, or reading the ticket do not.**
- If the student closes their own ticket, the clock stops.

### Warning
About **12 hours before** a deadline the system records a warning for the POC holding the ticket (one per deadline). The app does not display or email these warnings yet. The deadline in the ticket and queue ("due in 5h") is your warning.

### Automatic escalation
A scheduler calls the system **every 30 minutes**. For each ticket whose deadline has passed:
1. The system **records the miss against the POC who held it** (internal; the student never sees it). This counts in analytics as "Auto-escalated from me".
2. It moves the ticket up to the **next level that has someone on duty** (levels with nobody are skipped), status **Escalated**, assigned to the least-loaded person there, with a **fresh deadline**. The student sees "Escalated to *team*". The new owner sees the reason "Escalated to level 2: not solved within the time limit".
3. If there is no higher level (it is already L3, or nobody above is on duty), the ticket is flagged **Critical**, the admins are notified, and its clock is cleared so the miss is not logged again. It stays Critical until a POC solves or closes it.

A manual escalation is **not** a missed deadline.

### When tickets do **not** escalate
- Finished tickets (Solved/Closed) and tickets the student closed.
- Tickets with no owner yet (status Created).
- Critical tickets (already at the end of the chain).
- If the scheduler is not running (the admin sees this in Settings). Then nothing escalates until it runs again.

---

## 7. What happens after a ticket is finished

| Case | What happens |
| --- | --- |
| You **Solve** or **Close** | It leaves Open, goes to Done, the timer stops, the student can give feedback. |
| The student is **not satisfied** | They can **reopen** it with a comment (required). It comes back to the **level that finished it** with status **Reopened** (or one level up if nobody is on duty there) and a **fresh timer**. Their comment appears in the Activity. |
| **L3** solved or closed it | The outcome is **final**: the student cannot reopen it. They raise a new ticket instead. L3's decision is the last word, so be sure. |
| The **student closed it** | Appears in Done as "Closed by student". It is not counted as your Solved/Closed. They may reopen it; it returns to the level it was at. |
| Student feedback | Anonymous: you see ratings and comments in analytics but never who wrote them. Percentages show only with at least 5 answers. |

---

## 8. Being on leave

- **You cannot put yourself on leave.** Your manager does: an L1 by their L2 (or an L3 above), an L2 by their L3, an L3 by the admin.
- A **return date is required** (a future date). It ends automatically on that date (checked by the same 30-minute scheduler, so it can take up to 30 minutes after midnight UTC), or your manager can press **Back from leave**.
- While you are on leave you get **no new tickets** and are skipped in escalations.
- When leave starts, your **open tickets are handed over**: first to another on-duty person at your level (balanced by load); if there is nobody, up to the next level that has someone (they show as Escalated, reason "owner on leave"); if nobody is available anywhere, the ticket stays where it is and the admins are told. Handed-over tickets get a **fresh timer**.
- You see an amber "On leave · back 12 Oct" tag in your account menu.

---

## 9. Your analytics

Menu items depend on your role: **My analytics** (everyone), **Team analytics** (L2 and L3 only), **Overall analytics** (any POC; read-only, the whole category). Choose a period (7, 30, 90 days or Custom, up to 366 days).

### Key numbers
| Number | Meaning |
| --- | --- |
| Action needed / total | Open tickets waiting on you, out of all tickets you were involved with in the period. |
| Solved / Closed / Escalated | Outcomes **you** chose in the period. (Escalated is not shown at L3.) |
| Auto-escalated from me | Tickets you held past the deadline that the system moved up. At L3 this reads "Missed the 2-day limit" (critical tickets). |
| Auto-escalated to me | (Shown for L2 and L3) tickets that came to you because the previous level ran out of time. |
| Finished within the limit | Percentage of tickets finished no more than the current limit after being raised. |
| Reopened | Percentage of tickets finished that students reopened. |
| Satisfaction | Share of "Satisfied" answers (needs 5+ answers). |
| How long tickets took | Days from raised until Solved/Closed, rounded up; 10+ days grouped. Only finished tickets count. |
| Time left on open tickets | How much of the limit is left. Critical tickets have no clock. |

Team analytics lists the people below you in **alphabetical order on purpose**: it is to compare workloads, not to rank people. You only see people **below you** in your own category.

---

## 10. Notes from the admin

The admin can send a note to a category, a level or a person. You get it **by email** and as a **bell icon** in the top bar with an unread count. Open the bell to read it; opening marks it as seen (the admin can see who has read it).

---

## 11. For L2 and L3: managing your team (Settings)

Open **Settings** from the account menu. You see only the people **below you** (L3: the L2s and L1s; L2: the L1s). The admin sees everyone.

| Action | Rule |
| --- | --- |
| **Add POC** | Name, an `@newtonschool.co` email, the category, level, and who they **report to** (picked automatically if there is only one choice). You can only add people **below your own level**. They are emailed an invitation and show as **Invited** until they register. |
| **Edit** | Change the name or who they report to. |
| **Put on leave / Back from leave** | See section 8. A return date is required. |
| **Resend invite** | For someone still "Invited". |
| **Remove** | Not possible if the person still has people reporting to them (move their team first), if they are the **only** person at their level in that category ("add another first so tickets always have an owner"), or for yourself. Their open tickets are handed over like a leave. If they hold no other role they are deactivated and logged out, and they get an email. History and statistics are kept. |
| **Recent changes** | The last 15 changes in your teams, with who made them and when. |

A category is only offered to students when it has someone at **every level** (L1, L2 and L3). If a level becomes empty (everyone removed) students stop being offered that category until it is filled again.

---

## 12. What the app does not do yet

- **No email or in-app alert** is sent to you for new tickets, replies, escalations or the 12-hour warning. They are recorded but not shown. **Check My queue at least twice a day**, or deadlines can be missed without anyone noticing.
- Students cannot reply on an open ticket, so questions you ask appear in their timeline but they answer by raising a new ticket or reopening after you finish. Ask for everything you need in one reply.
- There is no way to attach files as staff, add private comments, or edit a ticket.

---

## 13. Quick reference

| Question | Answer |
| --- | --- |
| Is a note needed to reply? | No (just text). |
| Is a note needed to solve, close or escalate? | **Yes**, 5 to 2,000 characters. |
| Does replying stop the timer? | **No.** |
| Does "in progress" stop the timer? | **No.** |
| Who sees my escalation note? | Staff only. |
| Who sees my solve/close note? | The student, and staff. |
| Can I solve a ticket that is not mine? | Yes, if it is in your category and level; it then becomes yours. |
| Can a student reopen after I solve? | Yes, unless an **L3** finished it. |
| What if a ticket goes Critical? | It is at the end of the chain. Solve or close it as soon as possible. |
| Default time limit? | 2 days (admin can set 1 to 14). |
| How often does escalation run? | Every 30 minutes. |
