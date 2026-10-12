import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import * as argon2 from 'argon2';
import { PrismaPg } from '@prisma/adapter-pg';
import { EventType, Prisma, PrismaClient, Role, TicketStatus } from '../src/generated/prisma/client';

/**
 * DEVELOPMENT ONLY. Fills the database with realistic tickets from the last ~90 days so the
 * analytics screens have something to show:
 *
 *   npm run db:demo-data -w apps/api            # 2500 tickets
 *   npm run db:demo-data -w apps/api -- 6000    # more
 *   npm run db:demo-data -w apps/api -- --clean # only remove the demo data
 *
 * A category with nobody assigned gets made-up staff (demo.staff.<team>.l1/l2/l3@newtonschool.co, no password, so
 * nobody can log in as them) to play the workflow. Categories that already have real staff use them. --clean
 * removes the made-up students, the made-up staff and all their tickets; real people and real tickets stay.
 *
 * To log in as the made-up staff (for example to see the L1, L2 and L3 screens), also set DEMO_STAFF_PASSWORD (10+
 * characters). Without it nobody can log in as them. Use a throwaway password: --clean removes the accounts again.
 *
 * Against a hosted database (Neon), it refuses unless you also set DEMO_ON_HOSTED_DB=yes.
 *
 * Tickets belong to made-up students (demo.student.N@adypu.edu.in, no password, so nobody can
 * log in as them). Running it again replaces the previous demo data. Real tickets are never touched.
 * The generator plays the real workflow: assignment, acting within 48h, manual escalation,
 * automatic escalation when a POC is too slow, critical tickets at L3, and reopens.
 */
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const DEMO_DOMAIN = '@adypu.edu.in';
const DEMO_PREFIX = 'demo.student.';
const DEMO_STAFF_PREFIX = 'demo.staff.';
const DEMO_STAFF_DOMAIN = '@newtonschool.co';
const HOUR = 3600_000;
const DAY = 24 * HOUR;
const DAYS = 90;

// Small seeded random generator so a given count always produces the same data.
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(20261007);
const pick = <T>(items: T[]): T => items[Math.floor(rand() * items.length)];
const chance = (p: number) => rand() < p;
/** Median `m` hours, long right tail. */
const lognormal = (m: number) => m * Math.exp(0.9 * (rand() + rand() + rand() - 1.5) * 1.6);
/** Skewed pick: earlier items are much more likely. */
const skewed = <T>(items: T[]): T => items[Math.min(items.length - 1, Math.floor(Math.pow(rand(), 2.2) * items.length))];

// Words students actually use per category, so "most repeated words" has something to find.
const TEMPLATES: Record<string, [string, string][]> = {
  hostel: [
    ['Wi-Fi not working in my hostel room', 'The hostel wifi keeps disconnecting every night in room {n}. Cannot attend online classes.'],
    ['Room change request', 'Requesting a room change because of constant noise near room {n}.'],
    ['Water leakage in bathroom', 'There is a water leakage in the bathroom of room {n}, maintenance has not come yet.'],
    ['Laundry service delayed', 'My laundry has not been returned for three days, please check the laundry service.'],
    ['Power cut at night in hostel', 'Frequent power cut at night in block {n}, no backup.'],
  ],
  mess: [
    ['Food quality is poor in mess', 'The mess food quality has dropped, dal was cold and rice was undercooked today.'],
    ['Hygiene problem in mess', 'Found hair in food at the mess. Hygiene needs attention.'],
    ['Meal coupon not working', 'My meal coupon is not scanning at the mess counter.'],
    ['Food poisoning symptoms after dinner', 'Several students felt sick after dinner at the mess last night.'],
  ],
  academics: [
    ['Faculty teaching pace too fast', 'The faculty teaching pace is too fast and concepts are not clear in the algorithms class.'],
    ['Lab session not effective', 'The lab session had no guidance, we only copied code in the lab.'],
    ['Too many deadlines this week', 'Assignment deadlines are too dense this week, workload is overwhelming.'],
    ['Need more revision sessions', 'Please arrange revision sessions before the contest, practice problems are missing.'],
  ],
  exams: [
    ['Marks discrepancy in mid-term', 'My mid-term marks do not match the answer sheet, requesting re-evaluation.'],
    ['Exam platform crashed', 'The exam platform crashed twice during the test and I lost time.'],
    ['Medical exam reschedule', 'I was ill during the exam, requesting a medical reschedule. Certificate attached.'],
    ['Contest marks not updated', 'Contest marks are not updated on the portal after two weeks.'],
  ],
  attendance: [
    ['Attendance not marked', 'Face recognition did not mark my attendance in class even though I was present.'],
    ['Attendance deduction wrong', 'My attendance was deducted for the day I attended, please correct the attendance.'],
    ['Medical leave request', 'Requesting medical leave for three days, doctor note attached.'],
    ['Emergency leave for home', 'Family emergency, requesting emergency leave to travel home.'],
  ],
  fees: [
    ['Fee receipt not received', 'I paid the semester fee but have not received the fee receipt.'],
    ['Scholarship eligibility query', 'Want to know scholarship eligibility and the documents required.'],
    ['Education loan bank verification', 'The bank needs a verification letter for my education loan.'],
    ['Fee breakdown question', 'Please share the fee breakdown for this semester.'],
  ],
  documents: [
    ['Bonafide certificate request', 'I need a bonafide certificate for a visa application.'],
    ['Gap certificate needed', 'Requesting a gap certificate, please tell me the process.'],
    ['Document upload failing', 'Admission document upload fails with an error on the portal.'],
  ],
  placements: [
    ['Internship report verification pending', 'My monthly internship report verification is pending for two weeks.'],
    ['Mentor not assigned', 'My progression mentor has not been assigned yet, please assign a mentor.'],
    ['Placement interview scheduling clash', 'The placement interview is scheduled during my exam, please reschedule.'],
    ['Profile review request', 'Requesting a career profile review before the placement season.'],
  ],
  campus: [
    ['Campus Wi-Fi very slow', 'Campus wifi is very slow in the library and the labs.'],
    ['Cannot login to LMS portal', 'I cannot log in to the portal, password reset email does not arrive.'],
    ['College bus late every day', 'The college bus is late every morning, causing missed classes.'],
    ['MacBook issue under ADLD', 'My MacBook screen is damaged, how do I claim ADLD?'],
  ],
  activities: [
    ['Club meetings clash with classes', 'The coding club meetings clash with class timings every week.'],
    ['Need lab access for club', 'Robotics club needs shared lab access in the evening.'],
    ['Hackathon teammate search', 'Looking for a platform to find hackathon teammates.'],
  ],
  other: [
    ['Other: general suggestion', 'I have a general suggestion about campus facilities.'],
    ['Need help with something', 'Not sure which category this belongs to, please advise.'],
  ],
};

// What students write, by how they felt.
const COMMENTS = {
  SATISFIED: [
    'Quick and clear, thank you.',
    'Problem fixed the same day.',
    'Very helpful and polite.',
    'Sorted out without any follow-up.',
    'Great support from the team.',
    'Clear explanation, thanks a lot.',
    'Handled with care and patience.',
    'Replied faster than I expected.',
    'Exactly what I needed.',
    'Easy process from start to finish.',
  ],
  OKAY: [
    'It worked, but it took longer than expected.',
    'Fixed, though I had to ask twice.',
    'Fine in the end, but the updates were slow.',
    'Got there eventually, but communication was unclear.',
    'Decent help, nothing special.',
    'Needed a reminder before anyone replied.',
  ],
  NOT_SATISFIED: [
    'Still facing the same problem.',
    'No proper explanation was given.',
    'Took too many days and I had to follow up.',
    'The reply did not answer my question.',
    'Nobody replied for a long time.',
    'Closed without solving the issue.',
    'Had to explain the issue again and again.',
    'Not happy with the response.',
    'Feels like my concern was ignored.',
    'Waiting too long for an update.',
  ],
} as const;

interface Poc {
  userId: string;
  level: number;
  /** Typical hours this POC takes to act. Different per person so comparisons show variation. */
  medianHours: number;
}

function refuseHostedDatabase() {
  const host = (() => {
    try {
      return new URL(process.env.DATABASE_URL ?? '').hostname;
    } catch {
      return '';
    }
  })();
  const local = ['localhost', '127.0.0.1', '::1', '[::1]', ''].includes(host);
  if (!local && process.env.DEMO_ON_HOSTED_DB !== 'yes') {
    throw new Error(`DATABASE_URL points at ${host}, not this computer. To put demo data there on purpose, add DEMO_ON_HOSTED_DB=yes. Remove it later with --clean.`);
  }
}

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to run in production.');
  refuseHostedDatabase();
  const args = process.argv.slice(2);
  const cleanOnly = args.includes('--clean');
  const count = Number(args.find((a) => /^\d+$/.test(a)) ?? 2500);

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  try {
    await clean(prisma);
    if (cleanOnly) return console.log('Demo data removed.');

    const now = new Date();
    const loadCategories = () =>
      prisma.category.findMany({
        where: { active: true },
        include: {
          subCategories: { where: { active: true }, orderBy: { sortOrder: 'asc' } },
          pocAssignments: { where: { active: true }, include: { user: true } },
        },
      });
    let categories = await loadCategories();
    const staffPassword = process.env.DEMO_STAFF_PASSWORD ?? '';
    if (staffPassword && staffPassword.length < 10) throw new Error('DEMO_STAFF_PASSWORD must be at least 10 characters.');
    const staffHash = staffPassword ? await argon2.hash(staffPassword, { type: argon2.argon2id }) : null;
    // Give every category with nobody assigned a made-up L3 > L2 > L1 team, so the tickets have someone to move between.
    for (const c of categories.filter((c) => c.pocAssignments.length === 0)) {
      const tag = c.shortName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const make = async (level: number, managerAssignmentId: string | null) => {
        const user = await prisma.user.create({
          data: { email: `${DEMO_STAFF_PREFIX}${tag}.l${level}${DEMO_STAFF_DOMAIN}`, name: `Demo ${c.shortName} L${level}`, role: Role.POC, emailVerifiedAt: now, ...(staffHash ? { passwordHash: staffHash } : {}) },
        });
        return prisma.pOCAssignment.create({ data: { userId: user.id, categoryId: c.id, level, managerAssignmentId } });
      };
      const l3 = await make(3, null);
      const l2 = await make(2, l3.id);
      await make(1, l2.id);
    }
    categories = await loadCategories();
    const slugOf = (shortName: string) =>
      ({ Hostel: 'hostel', 'Mess & Food': 'mess', Academics: 'academics', 'Exams & Grading': 'exams', 'Attendance & Leave': 'attendance',
         'Fees & Finance': 'fees', Documents: 'documents', 'Internship & Placement': 'placements', 'Campus & IT': 'campus',
         'Student Life': 'activities', Other: 'other' } as Record<string, string>)[shortName] ?? 'other';

    // Busier categories get more tickets.
    const weights: Record<string, number> = { hostel: 20, mess: 16, academics: 14, exams: 10, attendance: 9, fees: 6, documents: 5, placements: 8, campus: 9, activities: 3, other: 2 };
    const weighted = categories.flatMap((c) => Array<typeof c>(weights[slugOf(c.shortName)] ?? 2).fill(c));

    const students = await Promise.all(
      Array.from({ length: 300 }, (_, i) =>
        prisma.user.create({
          data: { email: `${DEMO_PREFIX}${i + 1}${DEMO_DOMAIN}`, name: `Demo Student ${i + 1}`, role: Role.STUDENT, emailVerifiedAt: now },
        }),
      ),
    );

    const ticketRows: Prisma.TicketCreateManyInput[] = [];
    const eventRows: Prisma.TicketEventCreateManyInput[] = [];
    const feedbackRows: Prisma.TicketFeedbackCreateManyInput[] = [];
    let selfClosed = 0;

    for (let i = 0; i < count; i++) {
      const category = pick(weighted);
      const pocs: Poc[] = category.pocAssignments.map((a) => ({
        userId: a.userId,
        level: a.level,
        // Stable per person: spread between 5h and 40h, L3 a bit quicker.
        medianHours: 5 + (parseInt(a.userId.slice(0, 4), 16) % 36) * (a.level === 3 ? 0.7 : 1),
      }));
      const ownerAt = (level: number) => pocs.find((p) => p.level === level);
      const subCategory = skewed(category.subCategories);
      const [titleT, descT] = pick(TEMPLATES[slugOf(category.shortName)] ?? TEMPLATES.other);
      const n = String(100 + Math.floor(rand() * 400));

      // Created at a plausible moment: more on weekdays, mostly 9am-midnight IST.
      let createdAt: Date;
      do {
        const t = now.getTime() - rand() * DAYS * DAY;
        createdAt = new Date(t);
        const ist = new Date(t + 5.5 * HOUR);
        const hour = ist.getUTCHours();
        const weekend = [0, 6].includes(ist.getUTCDay());
        if (rand() < (weekend ? 0.45 : 1) * (hour >= 9 ? 1 : 0.18)) break;
      } while (true);
      if (createdAt > now) createdAt = new Date(now.getTime() - HOUR);

      const ticketId = randomUUID();
      const studentId = pick(students).id;
      // Events get an id up front so a finish can be linked to the student's feedback on it.
      const ev = (type: EventType, at: Date, extra: Partial<Prisma.TicketEventCreateManyInput> = {}): string => {
        const id = randomUUID();
        eventRows.push({ id, ticketId, type, createdAt: at, ...extra });
        return id;
      };
      const finishes: { eventId: string; at: Date; userId: string; level: number; hoursToFinish: number; reopenedAfter: boolean }[] = [];

      ev('CREATED', createdAt, { actorId: studentId, toStatus: 'CREATED', toLevel: 1 });
      let level = 1;
      let owner = ownerAt(1);
      let cur = new Date(createdAt.getTime() + 20_000);
      let status = 'ASSIGNED' as TicketStatus;
      let tatDeadline: Date | null = null;
      let resolvedAt: Date | null = null;
      let resolvedLevel: number | null = null;
      let critical = false;
      let last = cur;
      if (owner) ev('ASSIGNED', cur, { fromStatus: 'CREATED', toStatus: 'ASSIGNED', toLevel: 1, assigneeId: owner.userId });

      let reopenedOnce = false;
      let closedByStudent = false;
      while (owner) {
        const deadline = new Date(cur.getTime() + 48 * HOUR);
        const actAt = new Date(cur.getTime() + lognormal(owner.medianHours) * HOUR);
        if (actAt > deadline) {
          // Too slow: the system escalates (or flags critical at the top level).
          const breachAt = new Date(deadline.getTime() + rand() * 14 * 60_000);
          if (breachAt > now) { tatDeadline = deadline; break; }
          ev('TAT_BREACHED', breachAt, { actorId: owner.userId, visibility: 'INTERNAL' });
          last = breachAt;
          const next = ownerAt(level + 1);
          if (!next) { critical = true; tatDeadline = null; break; }
          ev('ESCALATED', breachAt, { fromStatus: status, toStatus: 'ESCALATED', fromLevel: level, toLevel: level + 1, reason: 'TAT_BREACH', assigneeId: next.userId });
          level++; owner = next; status = 'ESCALATED'; cur = breachAt;
          continue;
        }
        if (actAt > now) { tatDeadline = deadline; break; }

        if (chance(0.5) && status !== 'IN_PROGRESS') {
          const at = new Date(cur.getTime() + (actAt.getTime() - cur.getTime()) * 0.4);
          ev('STATUS_CHANGED', at, { actorId: owner.userId, fromStatus: status, toStatus: 'IN_PROGRESS', fromLevel: level, toLevel: level });
          status = 'IN_PROGRESS';
        }
        const next = ownerAt(level + 1);
        if (next && chance(level === 1 ? 0.16 : 0.12)) {
          ev('ESCALATED', actAt, { actorId: owner.userId, fromStatus: status, toStatus: 'ESCALATED', fromLevel: level, toLevel: level + 1, reason: 'MANUAL', note: 'Needs a decision from the next level.', assigneeId: next.userId });
          level++; owner = next; status = 'ESCALATED'; cur = actAt; last = actAt;
          continue;
        }
        const solved = chance(0.84);
        status = solved ? 'RESOLVED' : 'CLOSED';
        const finishEventId = ev(solved ? 'RESOLVED' : 'CLOSED', actAt, { actorId: owner.userId, fromStatus: 'IN_PROGRESS', toStatus: status, fromLevel: level, toLevel: level, note: solved ? 'Sorted out.' : 'Closed after review.' });
        resolvedAt = actAt; resolvedLevel = level; last = actAt; tatDeadline = null;
        finishes.push({ eventId: finishEventId, at: actAt, userId: owner.userId, level, hoursToFinish: (actAt.getTime() - createdAt.getTime()) / HOUR, reopenedAfter: false });

        if (!reopenedOnce && level < 3 && chance(0.06)) {
          const reopenAt = new Date(actAt.getTime() + (1 + rand() * 3) * DAY);
          if (reopenAt < now) {
            reopenedOnce = true;
            finishes[finishes.length - 1].reopenedAfter = true;
            ev('REOPENED', reopenAt, { actorId: studentId, fromStatus: status, toStatus: 'REOPENED', fromLevel: level, toLevel: level, assigneeId: owner.userId });
            status = 'REOPENED'; cur = reopenAt; resolvedAt = null; resolvedLevel = null; last = reopenAt;
            continue;
          }
        }
        break;
      }
      if (!owner) { status = 'CREATED'; tatDeadline = null; }

      // Some students close their own open ticket (they sorted it out). It is not a POC outcome.
      if (owner && !critical && !['RESOLVED', 'CLOSED'].includes(status) && chance(0.05)) {
        const closedAt = new Date(last.getTime() + (1 + rand() * 20) * HOUR);
        if (closedAt < now) {
          ev('CLOSED_BY_STUDENT', closedAt, { actorId: studentId, fromStatus: status, toStatus: 'CLOSED', fromLevel: level, toLevel: level });
          status = 'CLOSED'; tatDeadline = null; last = closedAt; selfClosed++;
          closedByStudent = true;
        }
      }

      // Students answer about half the time. Some POCs are liked more than others, and slow or reopened
      // tickets get worse ratings, so the dashboards show real differences.
      for (const f of finishes) {
        if (!chance(0.5)) continue;
        const liked = 0.55 + (parseInt(f.userId.slice(4, 8), 16) % 36) / 100; // 0.55 to 0.90 per person
        const pSatisfied = Math.max(0.1, liked - (f.hoursToFinish > 72 ? 0.25 : 0) - (f.reopenedAfter ? 0.45 : 0));
        const roll = rand();
        const rating = roll < pSatisfied ? 'SATISFIED' : roll < pSatisfied + (1 - pSatisfied) * (f.reopenedAfter ? 0.2 : 0.45) ? 'OKAY' : 'NOT_SATISFIED';
        const at = new Date(Math.min(now.getTime() - 1000, f.at.getTime() + rand() * 2 * DAY));
        feedbackRows.push({
          ticketId,
          studentId,
          finishEventId: f.eventId,
          rating,
          comment: chance(0.5) ? skewed([...COMMENTS[rating]]) : null,
          finishedById: f.userId,
          finishedLevel: f.level,
          categoryId: category.id,
          subCategoryId: subCategory.id,
          createdAt: at,
          updatedAt: at,
        });
      }

      ticketRows.push({
        id: ticketId,
        title: titleT,
        description: descT.replace('{n}', n),
        categoryId: category.id,
        subCategoryId: subCategory.id,
        studentId,
        status,
        currentLevel: level,
        resolvedLevel,
        assignedPocId: owner?.userId ?? null,
        tatDeadline,
        critical,
        createdAt,
        updatedAt: last,
        resolvedAt,
        closedByStudent,
      });
    }

    for (let i = 0; i < ticketRows.length; i += 500) await prisma.ticket.createMany({ data: ticketRows.slice(i, i + 500) });
    for (let i = 0; i < eventRows.length; i += 2000) await prisma.ticketEvent.createMany({ data: eventRows.slice(i, i + 2000) });
    for (let i = 0; i < feedbackRows.length; i += 1000) await prisma.ticketFeedback.createMany({ data: feedbackRows.slice(i, i + 1000) });

    const open = ticketRows.filter((t) => !['RESOLVED', 'CLOSED'].includes(String(t.status))).length;
    console.log(`Created ${ticketRows.length} demo tickets (${open} still open) and ${eventRows.length} events over the last ${DAYS} days.`);
    console.log(`Plus ${feedbackRows.length} student feedback answers and ${selfClosed} tickets closed by their student.`);
    console.log('Run with --clean to remove them.');
  } finally {
    await prisma.$disconnect();
  }
}

async function clean(prisma: PrismaClient) {
  const demo = await prisma.user.findMany({ where: { email: { startsWith: DEMO_PREFIX, endsWith: DEMO_DOMAIN }, role: Role.STUDENT }, select: { id: true } });
  const studentIds = demo.map((d) => d.id);
  if (!studentIds.length) return cleanStaff(prisma);
  const tickets = { ticket: { studentId: { in: studentIds } } };
  await prisma.notification.deleteMany({ where: { OR: [{ userId: { in: studentIds } }, tickets] } });
  await prisma.comment.deleteMany({ where: tickets });
  await prisma.attachment.deleteMany({ where: tickets });
  await prisma.ticketFeedback.deleteMany({ where: tickets });
  await prisma.ticketEvent.deleteMany({ where: tickets });
  await prisma.ticket.deleteMany({ where: { studentId: { in: studentIds } } });
  await prisma.user.deleteMany({ where: { id: { in: studentIds } } });
  await cleanStaff(prisma);
}

/** The made-up staff. Run after the tickets are gone; if something real still points at them they are only switched off. */
async function cleanStaff(prisma: PrismaClient) {
  const staff = await prisma.user.findMany({ where: { email: { startsWith: DEMO_STAFF_PREFIX, endsWith: DEMO_STAFF_DOMAIN }, role: Role.POC }, select: { id: true } });
  const ids = staff.map((u) => u.id);
  if (!ids.length) return;
  try {
    await prisma.$transaction([
      prisma.pOCAssignment.updateMany({ where: { userId: { in: ids } }, data: { managerAssignmentId: null } }),
      prisma.notification.deleteMany({ where: { userId: { in: ids } } }),
      prisma.pOCAssignment.deleteMany({ where: { userId: { in: ids } } }),
      prisma.user.deleteMany({ where: { id: { in: ids } } }),
    ]);
  } catch {
    await prisma.pOCAssignment.updateMany({ where: { userId: { in: ids } }, data: { active: false } });
    console.log('Some demo staff are still referenced by real records, so they were switched off instead of deleted.');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
