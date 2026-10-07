import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import * as argon2 from 'argon2';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';

/**
 * DEVELOPMENT ONLY. Gives every seeded staff account (all category POCs and the Super Admin)
 * the same password you choose and marks their email as verified, so you can log in as any
 * of them without registering each through Mailpit.
 *
 *   STAFF_PASSWORD='your-own-password' npm run db:activate-staff
 *
 * To change just one account (the others keep their passwords), also set STAFF_EMAIL:
 *
 *   STAFF_EMAIL=admin@newtonschool.co STAFF_PASSWORD='your-own-password' npm run db:activate-staff
 *
 * The password is read from the environment, never stored in the repo.
 */
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to run in production.');
  const password = process.env.STAFF_PASSWORD ?? '';
  if (password.length < 10) {
    throw new Error("Set STAFF_PASSWORD to a password of at least 10 characters, e.g. STAFF_PASSWORD='...' npm run db:activate-staff");
  }

  const onlyEmail = process.env.STAFF_EMAIL?.trim().toLowerCase();

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  try {
    const hash = await argon2.hash(password, { type: argon2.argon2id });
    const staff = await prisma.user.findMany({
      where: {
        ...(onlyEmail ? { email: onlyEmail } : {}),
        OR: [{ role: 'SUPER_ADMIN' }, { role: 'POC', pocAssignments: { some: { active: true, category: { active: true } } } }],
      },
      select: { id: true, email: true, role: true, pocAssignments: { where: { active: true, category: { active: true } }, select: { level: true } } },
      orderBy: { email: 'asc' },
    });
    if (onlyEmail && staff.length === 0) throw new Error(`No staff account found for ${onlyEmail}.`);
    await prisma.user.updateMany({
      where: { id: { in: staff.map((u) => u.id) } },
      data: { passwordHash: hash, emailVerifiedAt: new Date() },
    });
    await prisma.refreshToken.deleteMany({ where: { userId: { in: staff.map((u) => u.id) } } });

    console.log(`Activated ${staff.length} staff account${staff.length === 1 ? '' : 's'} with the password you supplied:\n`);
    for (const u of staff) {
      const level = u.role === 'SUPER_ADMIN' ? 'Super Admin' : `L${u.pocAssignments[0]?.level}`;
      console.log(`  ${level.padEnd(12)} ${u.email}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
