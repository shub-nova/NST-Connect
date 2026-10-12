import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { getTatHours } from '../settings/tat';
import type { DateRange } from './range';
import { topCommentPhrases, topTerms } from './words';

/**
 * What a dashboard is "about".
 *  - userIds: tickets that passed through these POCs, and actions done by them. Omit for everyone.
 *  - categoryIds: limit to these categories. Omit for all.
 */
export interface Scope {
  userIds?: string[];
  categoryIds?: string[];
}

/** Tickets that took 10 or more days are grouped into the last bar. */
const MAX_FINISH_DAYS = 10;

/** Fewer answers than this and a percentage would be noise, so it is not shown. */
const MIN_FEEDBACK_ANSWERS = 5;

const HOUR = 3600;
const OPEN_STATUSES = Prisma.sql`('CREATED','ASSIGNED','IN_PROGRESS','ESCALATED','REOPENED')`;

const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
const hours = (seconds: unknown) => (seconds === null || seconds === undefined ? null : Math.round((Number(seconds) / HOUR) * 10) / 10);
const pct = (part: number, whole: number) => (whole === 0 ? null : Math.round((part / whole) * 1000) / 10);

/**
 * All dashboard numbers come from here, so "My", "Team", "Overall" and the Super Admin views
 * can never disagree: they are the same queries with a different scope.
 *
 * Definitions (shown to users in the UI too):
 *  - Time to finish: ticket created -> the moment a POC marked it Solved or Closed. Only finished
 *    tickets count. Reopened tickets count again when finished again.
 *  - Done by me: Solved / Closed / Escalated events whose actor is that POC.
 *  - Action needed: open tickets currently assigned to the POC. Total: tickets that had any
 *    activity involving the POC in the period.
 *  - Auto-escalated from me: the POC held the ticket past the time limit without acting (TAT_BREACHED event).
 *    Auto-escalated to me: the ticket came to the POC because the previous level ran out of time.
 */
@Injectable()
export class AnalyticsEngine {
  constructor(private readonly prisma: PrismaService) {}

  // ---- scope fragments --------------------------------------------------------------------

  private ticketScope(scope: Scope): Prisma.Sql {
    const cat = scope.categoryIds
      ? Prisma.sql`AND t.category_id = ANY(${scope.categoryIds}::uuid[])`
      : Prisma.empty;
    const users = scope.userIds
      ? Prisma.sql`AND (t.assigned_poc_id = ANY(${scope.userIds}::uuid[]) OR EXISTS (
          SELECT 1 FROM ticket_event se WHERE se.ticket_id = t.id
            AND (se.actor_id = ANY(${scope.userIds}::uuid[]) OR se.assignee_id = ANY(${scope.userIds}::uuid[]))))`
      : Prisma.empty;
    return Prisma.sql`SELECT t.id FROM ticket t WHERE TRUE ${cat} ${users}`;
  }

  /** Scoped tickets that had activity involving the scope's POCs inside the range. */
  private touched(scope: Scope, from: Date, to: Date): Prisma.Sql {
    const who = scope.userIds
      ? Prisma.sql`AND (te.actor_id = ANY(${scope.userIds}::uuid[]) OR te.assignee_id = ANY(${scope.userIds}::uuid[]))`
      : Prisma.empty;
    return Prisma.sql`SELECT s.id FROM (${this.ticketScope(scope)}) s WHERE EXISTS (
      SELECT 1 FROM ticket_event te WHERE te.ticket_id = s.id AND te.created_at >= ${from} AND te.created_at < ${to} ${who})`;
  }

  private actorIs(scope: Scope): Prisma.Sql {
    return scope.userIds ? Prisma.sql`AND e.actor_id = ANY(${scope.userIds}::uuid[])` : Prisma.empty;
  }

  // ---- headline numbers (also used per POC / per category in comparisons) -----------------

  async headline(scope: Scope, range: DateRange, now = new Date()) {
    const { from, to } = range;
    const scoped = this.ticketScope(scope);
    // "Finished within the limit" uses the limit as it is set now, the same one shown on the dashboard's labels.
    const tatHours = await getTatHours(this.prisma);

    const [outcomes, finishRows, levelRows, openRows, totalRows, autoOut, autoIn, reopenRows, feedbackRows] = await Promise.all([
      this.prisma.$queryRaw<{ type: string; reason: string | null; n: bigint }[]>`
        SELECT e.type::text AS type, e.reason::text AS reason, count(*) AS n
          FROM ticket_event e JOIN (${scoped}) s ON s.id = e.ticket_id
         WHERE e.created_at >= ${from} AND e.created_at < ${to}
           AND e.type IN ('RESOLVED','CLOSED','ESCALATED') ${this.actorIs(scope)}
         GROUP BY 1, 2`,
      this.prisma.$queryRaw<{ n: bigint; avg_s: number | null; med_s: number | null; within: bigint }[]>`
        SELECT count(*) AS n,
               avg(extract(epoch FROM (e.created_at - t.created_at))) AS avg_s,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (e.created_at - t.created_at))) AS med_s,
               count(*) FILTER (WHERE e.created_at - t.created_at <= make_interval(hours => ${tatHours})) AS within
          FROM ticket_event e JOIN (${scoped}) s ON s.id = e.ticket_id JOIN ticket t ON t.id = e.ticket_id
         WHERE e.created_at >= ${from} AND e.created_at < ${to}
           AND e.type IN ('RESOLVED','CLOSED') ${this.actorIs(scope)}`,
      scope.userIds
        ? this.prisma.$queryRaw<{ avg_s: number | null }[]>`
            SELECT avg(extract(epoch FROM (e.created_at - a.at))) AS avg_s
              FROM ticket_event e
              JOIN LATERAL (
                SELECT max(x.created_at) AS at FROM ticket_event x
                 WHERE x.ticket_id = e.ticket_id AND x.created_at <= e.created_at
                   AND x.assignee_id = ANY(${scope.userIds}::uuid[])) a ON a.at IS NOT NULL
             WHERE e.created_at >= ${from} AND e.created_at < ${to}
               AND e.type IN ('RESOLVED','CLOSED') AND e.actor_id = ANY(${scope.userIds}::uuid[])`
        : Promise.resolve([{ avg_s: null }]),
      this.prisma.$queryRaw<{ open: bigint; overdue: bigint; critical: bigint }[]>`
        SELECT count(*) AS open,
               count(*) FILTER (WHERE t.tat_deadline < ${now}) AS overdue,
               count(*) FILTER (WHERE t.critical) AS critical
          FROM ticket t JOIN (${scoped}) s ON s.id = t.id
         WHERE t.status IN ${OPEN_STATUSES}
           ${scope.userIds ? Prisma.sql`AND t.assigned_poc_id = ANY(${scope.userIds}::uuid[])` : Prisma.empty}`,
      this.prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM (${this.touched(scope, from, to)}) x`,
      scope.userIds
        ? this.prisma.$queryRaw<{ n: bigint }[]>`
            SELECT count(*) AS n FROM ticket_event e JOIN (${scoped}) s ON s.id = e.ticket_id
             WHERE e.type = 'TAT_BREACHED' AND e.created_at >= ${from} AND e.created_at < ${to} ${this.actorIs(scope)}`
        : this.prisma.$queryRaw<{ n: bigint }[]>`
            SELECT count(*) AS n FROM ticket_event e JOIN (${scoped}) s ON s.id = e.ticket_id
             WHERE e.type = 'ESCALATED' AND e.reason = 'TAT_BREACH' AND e.created_at >= ${from} AND e.created_at < ${to}`,
      scope.userIds
        ? this.prisma.$queryRaw<{ n: bigint }[]>`
            SELECT count(*) AS n FROM ticket_event e JOIN (${scoped}) s ON s.id = e.ticket_id
             WHERE e.type = 'ESCALATED' AND e.reason = 'TAT_BREACH' AND e.created_at >= ${from} AND e.created_at < ${to}
               AND e.assignee_id = ANY(${scope.userIds}::uuid[])`
        : Promise.resolve(null),
      this.prisma.$queryRaw<{ n: bigint }[]>`
        SELECT count(*) AS n FROM ticket_event e JOIN (${scoped}) s ON s.id = e.ticket_id
         WHERE e.type = 'REOPENED' AND e.created_at >= ${from} AND e.created_at < ${to}
           ${scope.userIds ? Prisma.sql`AND e.assignee_id = ANY(${scope.userIds}::uuid[])` : Prisma.empty}`,
      // Student feedback is credited to the POC who solved or closed the ticket.
      this.prisma.$queryRaw<{ rating: string; n: bigint }[]>`
        SELECT f.rating::text AS rating, count(*) AS n
          FROM ticket_feedback f JOIN (${scoped}) s ON s.id = f.ticket_id
         WHERE f.created_at >= ${from} AND f.created_at < ${to}
           ${scope.userIds ? Prisma.sql`AND f.finished_by_id = ANY(${scope.userIds}::uuid[])` : Prisma.empty}
         GROUP BY 1`,
    ]);

    const answers = (rating: string) => num(feedbackRows.find((r) => r.rating === rating)?.n);
    const satisfied = answers('SATISFIED');
    const okay = answers('OKAY');
    const notSatisfied = answers('NOT_SATISFIED');
    const responses = satisfied + okay + notSatisfied;

    const count = (type: string, reason?: string) =>
      outcomes.filter((o) => o.type === type && (reason === undefined || o.reason === reason)).reduce((a, o) => a + num(o.n), 0);
    const solved = count('RESOLVED');
    const closed = count('CLOSED');
    const finished = num(finishRows[0]?.n);
    const within = num(finishRows[0]?.within);
    const open = num(openRows[0]?.open);
    const manual = count('ESCALATED', 'MANUAL');

    return {
      solved,
      closed,
      escalated: manual, // escalated by the POC's own decision
      finished,
      avgFinishHours: hours(finishRows[0]?.avg_s),
      medianFinishHours: hours(finishRows[0]?.med_s),
      withinTatPct: pct(within, finished),
      avgHoursAtMyLevel: hours(levelRows[0]?.avg_s),
      actionNeeded: open,
      overdue: num(openRows[0]?.overdue),
      critical: num(openRows[0]?.critical),
      total: num(totalRows[0]?.n),
      autoEscalatedFrom: num(autoOut[0]?.n), // for "everyone" scopes this is all automatic escalations
      // For "everyone" scopes every automatic escalation both leaves one level and reaches another.
      autoEscalatedTo: autoIn ? num(autoIn[0]?.n) : num(autoOut[0]?.n),
      manualEscalations: manual,
      reopened: num(reopenRows[0]?.n),
      reopenRatePct: pct(num(reopenRows[0]?.n), finished),
      feedback: {
        responses,
        satisfied,
        okay,
        notSatisfied,
        // Only shown once there are enough answers for a percentage to mean something.
        satisfactionPct: responses >= MIN_FEEDBACK_ANSWERS ? pct(satisfied, responses) : null,
      },
    };
  }

  // ---- full dashboard ---------------------------------------------------------------------

  /** How many finished tickets took 1 day, 2 days, 3 days... (rounded up). */
  private async finishDistribution(scope: Scope, range: DateRange) {
    const { from, to } = range;
    const start = Prisma.sql`t.created_at`; // always from when the student raised it, across all levels
    const rows = await this.prisma.$queryRaw<{ days: number; n: bigint }[]>`
      SELECT LEAST(GREATEST(ceil(extract(epoch FROM (e.created_at - ${start})) / 86400), 1), ${MAX_FINISH_DAYS})::int AS days,
             count(*) AS n
        FROM ticket_event e JOIN (${this.ticketScope(scope)}) s ON s.id = e.ticket_id JOIN ticket t ON t.id = e.ticket_id
       WHERE e.type IN ('RESOLVED','CLOSED') AND e.created_at >= ${from} AND e.created_at < ${to} ${this.actorIs(scope)}
       GROUP BY 1`;
    return Array.from({ length: MAX_FINISH_DAYS }, (_, i) => ({
      days: i + 1,
      count: num(rows.find((r) => r.days === i + 1)?.n),
    }));
  }

  async dashboard(scope: Scope, range: DateRange, now = new Date()) {
    const { from, to, prevFrom, bucket } = range;
    const scoped = this.ticketScope(scope);
    const touched = this.touched(scope, from, to);
    const touchedPrev = this.touched(scope, prevFrom, from);
    const unit = Prisma.raw(`'${bucket}'`);

    const [headline, finishTimes, cats, catsPrev, subs, subsPrev, subTat, created, ended, escTrend, texts, ageing, feedbackTexts] =
      await Promise.all([
        this.headline(scope, range, now),
        this.finishDistribution(scope, range),
        this.prisma.$queryRaw<{ id: string; name: string; n: bigint }[]>`
          SELECT c.id, c.short_name AS name, count(*) AS n FROM ticket t JOIN (${touched}) x ON x.id = t.id
            JOIN category c ON c.id = t.category_id GROUP BY 1, 2 ORDER BY n DESC, name`,
        this.prisma.$queryRaw<{ id: string; n: bigint }[]>`
          SELECT t.category_id AS id, count(*) AS n FROM ticket t JOIN (${touchedPrev}) x ON x.id = t.id GROUP BY 1`,
        this.prisma.$queryRaw<{ id: string; name: string; category: string; n: bigint }[]>`
          SELECT sc.id, sc.name, c.short_name AS category, count(*) AS n FROM ticket t JOIN (${touched}) x ON x.id = t.id
            JOIN sub_category sc ON sc.id = t.sub_category_id JOIN category c ON c.id = t.category_id
           GROUP BY 1, 2, 3 ORDER BY n DESC, sc.name LIMIT 12`,
        this.prisma.$queryRaw<{ id: string; n: bigint }[]>`
          SELECT t.sub_category_id AS id, count(*) AS n FROM ticket t JOIN (${touchedPrev}) x ON x.id = t.id
           WHERE t.sub_category_id IS NOT NULL GROUP BY 1`,
        this.prisma.$queryRaw<{ id: string; avg_s: number; n: bigint }[]>`
          SELECT t.sub_category_id AS id, avg(extract(epoch FROM (e.created_at - t.created_at))) AS avg_s, count(*) AS n
            FROM ticket_event e JOIN (${scoped}) s ON s.id = e.ticket_id JOIN ticket t ON t.id = e.ticket_id
           WHERE e.type IN ('RESOLVED','CLOSED') AND e.created_at >= ${from} AND e.created_at < ${to} ${this.actorIs(scope)}
             AND t.sub_category_id IS NOT NULL GROUP BY 1`,
        this.prisma.$queryRaw<{ d: Date; n: bigint }[]>`
          SELECT date_trunc(${unit}, t.created_at) AS d, count(*) AS n FROM ticket t JOIN (${touched}) x ON x.id = t.id
           WHERE t.created_at >= ${from} AND t.created_at < ${to} GROUP BY 1`,
        this.prisma.$queryRaw<{ d: Date; type: string; n: bigint }[]>`
          SELECT date_trunc(${unit}, e.created_at) AS d, e.type::text AS type, count(*) AS n
            FROM ticket_event e JOIN (${scoped}) s ON s.id = e.ticket_id
           WHERE e.type IN ('RESOLVED','CLOSED') AND e.created_at >= ${from} AND e.created_at < ${to} ${this.actorIs(scope)}
           GROUP BY 1, 2`,
        scope.userIds
          ? this.prisma.$queryRaw<{ d: Date; kind: string; n: bigint }[]>`
              SELECT date_trunc(${unit}, e.created_at) AS d,
                     CASE WHEN e.type = 'TAT_BREACHED' THEN 'auto' ELSE 'manual' END AS kind, count(*) AS n
                FROM ticket_event e JOIN (${scoped}) s ON s.id = e.ticket_id
               WHERE e.created_at >= ${from} AND e.created_at < ${to} ${this.actorIs(scope)}
                 AND (e.type = 'TAT_BREACHED' OR (e.type = 'ESCALATED' AND e.reason = 'MANUAL'))
               GROUP BY 1, 2`
          : this.prisma.$queryRaw<{ d: Date; kind: string; n: bigint }[]>`
              SELECT date_trunc(${unit}, e.created_at) AS d,
                     CASE WHEN e.reason = 'TAT_BREACH' THEN 'auto' ELSE 'manual' END AS kind, count(*) AS n
                FROM ticket_event e JOIN (${scoped}) s ON s.id = e.ticket_id
               WHERE e.type = 'ESCALATED' AND e.reason IN ('MANUAL', 'TAT_BREACH')
                 AND e.created_at >= ${from} AND e.created_at < ${to} GROUP BY 1, 2`,
        this.prisma.$queryRaw<{ id: string; title: string; description: string }[]>`
          SELECT t.id, t.title, t.description FROM ticket t JOIN (${touched}) x ON x.id = t.id
           ORDER BY t.created_at DESC LIMIT 5000`,
        this.prisma.$queryRaw<{ bucket: string; n: bigint }[]>`
          SELECT CASE WHEN t.tat_deadline IS NULL THEN 'none'
                      WHEN t.tat_deadline < ${now} THEN 'overdue'
                      WHEN t.tat_deadline < ${new Date(now.getTime() + 6 * 3600 * 1000)} THEN 'h6'
                      WHEN t.tat_deadline < ${new Date(now.getTime() + 12 * 3600 * 1000)} THEN 'h12'
                      WHEN t.tat_deadline < ${new Date(now.getTime() + 24 * 3600 * 1000)} THEN 'h24'
                      ELSE 'later' END AS bucket, count(*) AS n
            FROM ticket t JOIN (${scoped}) s ON s.id = t.id
           WHERE t.status IN ${OPEN_STATUSES}
             ${scope.userIds ? Prisma.sql`AND t.assigned_poc_id = ANY(${scope.userIds}::uuid[])` : Prisma.empty}
           GROUP BY 1`,
        // The written feedback itself is never sent to the browser: only what is mentioned most.
        this.prisma.$queryRaw<{ comment: string }[]>`
          SELECT f.comment
            FROM ticket_feedback f JOIN (${scoped}) s ON s.id = f.ticket_id
           WHERE f.comment IS NOT NULL AND f.created_at >= ${from} AND f.created_at < ${to}
             ${scope.userIds ? Prisma.sql`AND f.finished_by_id = ANY(${scope.userIds}::uuid[])` : Prisma.empty}
           ORDER BY f.created_at DESC LIMIT 2000`,
      ]);

    const prevCat = new Map(catsPrev.map((r) => [r.id, num(r.n)]));
    const prevSub = new Map(subsPrev.map((r) => [r.id, num(r.n)]));
    const tatBySub = new Map(subTat.map((r) => [r.id, { hours: hours(r.avg_s), n: num(r.n) }]));

    // Chart series: one point per day/week, with empty periods filled in with zeros.
    const keys: string[] = [];
    const step = bucket === 'day' ? 1 : 7;
    const startKey = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
    if (bucket === 'week') startKey.setUTCDate(startKey.getUTCDate() - ((startKey.getUTCDay() + 6) % 7)); // Postgres weeks start Monday
    for (let d = startKey; d < to; d = new Date(d.getTime() + step * 86400000)) keys.push(d.toISOString().slice(0, 10));
    const at = (d: Date) => d.toISOString().slice(0, 10);
    const trend = keys.map((day) => ({
      day,
      created: num(created.find((r) => at(r.d) === day)?.n),
      solved: num(ended.find((r) => at(r.d) === day && r.type === 'RESOLVED')?.n),
      closed: num(ended.find((r) => at(r.d) === day && r.type === 'CLOSED')?.n),
      autoEscalated: num(escTrend.find((r) => at(r.d) === day && r.kind === 'auto')?.n),
      manualEscalated: num(escTrend.find((r) => at(r.d) === day && r.kind === 'manual')?.n),
    }));

    const terms = topTerms(texts.map((t) => `${t.title}. ${t.description}`));
    // The phrases students repeat in their comments (each said at least twice), not single words.
    const mentioned = topCommentPhrases(feedbackTexts.map((f) => f.comment));
    const left = (k: string) => num(ageing.find((a) => a.bucket === k)?.n);

    return {
      range: { from: from.toISOString(), to: new Date(to.getTime() - 1).toISOString(), days: range.days, bucket },
      /** The escalation limit in hours, so screens can name it ("2 days") instead of repeating a number. */
      tatHours: await getTatHours(this.prisma),
      headline,
      finishTimes,
      categories: cats.map((c) => ({ id: c.id, name: c.name, count: num(c.n), previous: prevCat.get(c.id) ?? 0 })),
      subCategories: subs.map((s) => ({
        id: s.id,
        name: s.name,
        category: s.category,
        count: num(s.n),
        previous: prevSub.get(s.id) ?? 0,
        avgFinishHours: tatBySub.get(s.id)?.hours ?? null,
      })),
      trend,
      words: terms.words,
      phrases: terms.phrases,
      feedbackTerms: mentioned,
      // Open tickets by how much of their time limit is left. Critical tickets have no clock, so they are not in here.
      timeLeft: {
        overdue: left('overdue'),
        within6h: left('h6'),
        within12h: left('h12'),
        within24h: left('h24'),
        later: left('later'),
      },
    };
  }
}
