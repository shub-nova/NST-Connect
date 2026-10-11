# Go-live checklist: leaving testing mode

While the app is being tested it runs with a few settings that are **not safe for real use**. Do everything on this page before real students and staff are told about the site. Nothing here is urgent today; it exists so it is not forgotten.

## What testing mode currently allows

| Setting (Vercel, API project) | Testing value | Effect |
| --- | --- | --- |
| `STUDENT_EMAIL_DOMAIN` | `adypu.edu.in,gmail.com` | Anyone with a Gmail address can sign up as a **student**. |
| `POC_EMAIL_DOMAIN` | `newtonschool.co,gmail.com` | A Gmail address with a `+staff` tag (for example `you+staff@gmail.com`) can sign up as **staff**. |
| `ALLOW_TEST_STUDENT_DOMAINS` | `true` | Lets the API start with the two extra domains above. Without it, the API **refuses to start** while a second domain is listed. |
| Demo data | loaded | Made-up students, staff and about 600 tickets, so the charts have something to show. |

## 1. Remove the demo data

From your computer, with the **direct** Neon string (no `-pooler`; never paste it into chat or a file in the repository):

```bash
DATABASE_URL='<direct Neon string>' DEMO_ON_HOSTED_DB=yes npm run db:demo-data -w apps/api -- --clean
```

It removes the made-up students (`demo.student.N@adypu.edu.in`), the made-up staff (`demo.staff.<team>.lN@newtonschool.co`) and all their tickets, events, feedback and assignments. Real people and real tickets are never touched.

**Check:** the output says `Demo data removed.` and the admin dashboard shows no demo tickets.

## 2. Allow only the real domains

1. Vercel, project `nst-connect-api`, **Settings, Environment Variables** (Production):
   - set `STUDENT_EMAIL_DOMAIN` to `adypu.edu.in`
   - set `POC_EMAIL_DOMAIN` to `newtonschool.co`
   - **delete** `ALLOW_TEST_STUDENT_DOMAINS`
2. **Redeploy** the API project (a changed variable only applies after a redeploy).

If you forget the redeploy nothing breaks, but the old values stay active. If you remove the switch and leave a second domain in place, the API will refuse to start and the deployment log lists the setting to fix.

**Check:** signing up with a Gmail address now answers "Registration is limited to @adypu.edu.in (students) and @newtonschool.co (staff) email addresses."

## 3. Switch off the test accounts that already exist

Removing a domain only stops **new** sign-ups. A Gmail account created during testing is still a valid account and **can still log in**. Deactivate those accounts.

1. Open Neon, your project, **SQL Editor**.
2. **Look first.** This lists everyone whose address is not on a real domain:

```sql
SELECT email, role, created_at
FROM "user"
WHERE email NOT LIKE '%@adypu.edu.in'
  AND email NOT LIKE '%@newtonschool.co'
ORDER BY created_at;
```

3. If the list is only test accounts, **deactivate** them (they can no longer log in, and their sessions stop working; tickets stay linked to them for the history):

```sql
UPDATE "user"
SET deactivated_at = now()
WHERE email NOT LIKE '%@adypu.edu.in'
  AND email NOT LIKE '%@newtonschool.co'
  AND deactivated_at IS NULL;

UPDATE refresh_token
SET revoked_at = now()
WHERE revoked_at IS NULL
  AND user_id IN (SELECT id FROM "user" WHERE deactivated_at IS NOT NULL);
```

4. Staff accounts that were added in Settings with a `+staff` Gmail address should also be **removed in Settings** (so their team seat is freed and the audit list shows it), then added again with the person's real `@newtonschool.co` address.

Do not delete the rows: tickets, comments and the audit history point at them.

**Check:** logging in with a Gmail test account answers "This account has been deactivated."

## 4. Test tickets

Tickets raised during testing by Gmail students stay in the system. Decide whether to keep them (they will show in analytics) or remove them. If you want a clean start, ask a developer to delete the tickets of the deactivated test students; there is no button for it in the app.

## 5. Other things to settle before launch

| Item | Why |
| --- | --- |
| **Deliver alerts to people** | Notification rows are recorded (new ticket, reply, solved, escalated, 12-hour warning, missed deadline, critical) but nothing shows or emails them. Students learn of a reply or a solved ticket only by opening the app, and POCs are not told of new or escalated tickets. Until this is built, tell staff to check **My queue** at least twice a day, or the 48-hour promise can be missed without anyone noticing. |
| **Staff every category at all three levels** | Students are only offered a category that has someone assigned at L1, L2 and L3. A category with a gap is hidden, and the server refuses tickets in it. Until the teams are added in Settings, students see "Ticket topics are not open yet". Check the Categories page: every category should show a green "people assigned" badge, not a red "Hidden from students" one. |
| Secrets that were shown in chat, screenshots or logs | Treat them as exposed: reset the Neon password (or delete the old Neon project), and re-create any R2 or Gmail app password that was pasted anywhere. |
| Real sender address for email | Verification and notification emails currently come from a Gmail account (limit about 500 a day, may land in spam). Move to a proper sender on a company domain and update the `SMTP_*` and `MAIL_FROM` settings. |
| The escalation schedule (cron-job.org) | Without it nothing escalates on the live site. Check Settings → Escalation time: it should say the check ran within the last hour. See DEPLOY.md, section 7. |
| More than one admin | The admin password is set with a script (`npm run admin:set-password -w apps/api`). Adding verified admins from inside the app is planned. |
| Custom domain | If you add one, add it to `WEB_URL` (API project) and to the R2 bucket's CORS policy, then redeploy. |

## 6. Final check

- [ ] Demo data removed (step 1)
- [ ] Every category shows a green "people assigned" badge on the Categories page (a full team at every level)
- [ ] Only the two real domains allowed, switch deleted, API redeployed (step 2)
- [ ] Test accounts deactivated (step 3)
- [ ] A real student address signs up, receives the email and can raise a ticket with an attachment
- [ ] Forgot password works with a real address: the link arrives (check spam), sets a new password, and the old password stops working
- [ ] A real `@newtonschool.co` person is added in Settings, signs up and sees their queue
- [ ] Settings → Escalation time says the last escalation check ran within the last hour
