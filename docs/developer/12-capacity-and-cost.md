# 12. Capacity and cost: how many users, and what it costs to grow

> **Status: estimates, not measurements.** The app has **never been load-tested**. Everything below is reasoning from the code and from the free-tier services' published limits at the time of writing. Prices and limits change: check each provider's pricing page before budgeting. Replace these estimates with measured numbers after running the load test in 12.6.

## 12.1 What "concurrent users" means here

"2,000 concurrent users" usually means 2,000 people with the app open, not 2,000 requests in the same instant. A helpdesk user clicks every 20 to 60 seconds, so:

| Open users | Requests per second (rough) |
| --- | --- |
| 200 | 3 to 10 |
| 1,000 | 15 to 50 |
| 2,000 | **30 to 100** |

A page load makes several API calls (session refresh, then data). A peak (a 9 a.m. login wave, an exam-result day) can be several times the average. Most requests are cheap indexed reads. The expensive ones are:

- **Login and register:** an argon2id hash, about 100 ms of CPU and tens of MB of memory each.
- **Analytics (staff only):** many aggregate queries per view, reading up to 5,000 tickets of text.
- **Escalation run:** every 30 minutes, up to 500 tickets.

## 12.2 Estimated capacity today (free tiers)

My estimate, unmeasured: **a few hundred people active at once is comfortable; up to about 1,000 might work; 2,000 will not hold** without the changes below. The code and indexes are sound at that scale; the limits are in the services and a few settings.

## 12.3 What breaks first (in order of likelihood)

| # | Limit | Why it bites | Fix |
| --- | --- | --- | --- |
| 1 | **Per-address rate limits behind a shared IP** (code/config) | The default limit is 120 requests/min per public IP and login/register 10/min per IP (`@Throttle`, `AppModule`). Hundreds of students on one campus or hostel Wi-Fi share one public address, so they share one bucket. 2,000 first logins at 10/min would take over three hours. | Key signed-in routes by **user id**, keep per-IP only for login/register/forgot-password and raise those limits for campus addresses; consider a per-account limit on login instead. |
| 2 | **Gmail SMTP, about 500 emails a day** | 2,000 sign-up verification emails alone exceed it; password resets add more. | A transactional provider on a company domain (Amazon SES, Brevo, Resend). Also verify SPF/DKIM so mail avoids spam. |
| 3 | **Upstash free command quota** | `RedisThrottlerStorage` spends about 3 to 4 Redis commands on **every** API request. At 30 to 100 requests/s the free allowance is gone in minutes. | A fixed-price Redis plan **and/or** send only the sensitive routes (login, register, forgot/reset) to Redis and count the rest in memory. |
| 4 | **Vercel Hobby quotas and terms** | Invocation, CPU and bandwidth allowances; Hobby is meant for personal, non-commercial use. | Vercel Pro (one team seat covers both projects). |
| 5 | **Neon free compute and hours** | Autoscaling tops out at 2 compute units with capped hours; idle suspend adds latency; analytics are the heaviest queries. | A paid Neon plan (more compute, always-on option); keep the pooled connection string and `DB_POOL_MAX=1`. |
| 6 | **Function region far from the database** | `vercel.json` sets no `regions`. If the API runs in Vercel's default region (US East) while the database is in Singapore, every query pays an ocean round trip, and a request with 3 to 5 queries is slow. | In Vercel set the API project's **Function Region** near the database (a free change), or set `regions` in `vercel.json`. Check this first. |
| 7 | **Cold starts** | A new instance builds the Nest app (a second or two). A burst creates many instances. | Pro plan options (fluid compute, more concurrency per instance); keep the bundle lean; the pooled DB connection (`DB_POOL_MAX=1`) already avoids connection storms. |
| 8 | **Database connections** | Each instance holds 1 connection through Neon's pooler; thousands of instances are fine for the pooler but raw Postgres connections are limited by plan. | Always the **pooled** string for the app; direct only for migrations. |

## 12.4 Estimated monthly cost for about 2,000 users

Ballpark, from memory of public pricing. **Verify each line before budgeting.**

| Item | Why it is needed | Approx. per month |
| --- | --- | --- |
| Vercel Pro | quotas, commercial use, more function time | about $20 per seat, plus usage |
| Neon paid plan | more compute and storage, optional always-on | about $19 to $70 |
| Upstash Redis | fixed plan is cheaper than per-command billing | about $10 (fixed), more if billed per command |
| Transactional email | sign-up, reset, invitation volume | $0 to $20 (SES is cheapest, needs domain setup) |
| Cloudflare R2 | attachment storage; downloads are free | about $0 to $5 |
| Monitoring (UptimeRobot, Sentry free tiers) | outage alerts | $0 |
| cron-job.org | escalation schedule | $0 |
| GitHub Actions | CI | $0 |
| **Total** | | **about $50 to $130** |

If Redis is billed per command and the limiter is unchanged, that line alone could pass $100 to $150. Changing what goes to Redis (12.3 row 3) avoids it.

Costs that are **not** money: the staff time to answer 2,000 students' tickets, moderation, and the privacy/retention work (see [known gaps](10-known-gaps-and-roadmap.md)).

## 12.5 Changes to make before aiming at 2,000 (in priority order)

1. **Check the Vercel Function Region** and put it next to the database (free, possibly the biggest speed-up).
2. **Rate limiting redesign:** per user id for authenticated routes; per-IP (raised) only for login, register, forgot/reset; fewer Redis commands per request. Add tests that two users behind one IP do not block each other.
3. **Transactional email** and verified sender domain before the sign-up wave. Consider staggering invitations.
4. **Upgrade** Vercel (Pro) and Neon (paid), and a fixed-price Redis.
5. **Monitoring** and alerts (uptime on `/api/health`, error tracking).
6. **Load test** (12.6) and fix what it finds (slow queries, missing indexes, analytics read caps).
7. Optional hardening for peaks: cache the `/categories` list and `/analytics/access` for a short time; paginate or cache heavy analytics for staff; add `EXPLAIN`-driven indexes for new filters.

## 12.6 How to load-test properly

Never test against the live site or real people's data. Use a **separate staging copy**: a Neon branch of production (or demo data on a fresh database), a second Vercel project or a local build, and a throwaway admin.

1. **Prepare data:** `npm run db:demo-data -w apps/api -- 6000` (staging only; it refuses hosted databases unless `DEMO_ON_HOSTED_DB=yes`), then `db:activate-staff` or create test users.
2. **Pick a tool:** k6 (JavaScript scripts, simple ramp profiles) or Artillery.
3. **Model real behaviour:** log in (rate limits off in staging, or spread across addresses), then loop: `GET /categories`, `GET /tickets`, a ticket detail, occasionally `POST /tickets`; for POCs `GET /poc/queue`, ticket detail, reply, solve; a few analytics views.
4. **Ramp:** 10 → 50 → 100 requests/s over several minutes, then a spike (a 5x jump for a minute) to see cold-start behaviour.
5. **Watch:** p95 latency per endpoint, error rate (429, 5xx), Vercel function duration and concurrency, Neon CPU and connections, Redis command count.
6. **Targets to agree before testing:** for example p95 under 500 ms for reads, under 1 s for writes, error rate under 0.5% at 100 requests/s.
7. **Record results** in this chapter, replacing the estimates, with the date and configuration.

## 12.7 When not to scale up the infrastructure
If most time is spent in one slow query or one endpoint, fix that first (index, query shape, cache) before paying for more compute. The queue, student list and least-loaded lookup already have indexes (see chapter 4); analytics are the likely hot spot for staff-heavy hours.
