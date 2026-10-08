import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import * as argon2 from 'argon2';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, Role } from '../src/generated/prisma/client';

/**
 * Sets the admin's password and marks the address verified, for an admin whose mailbox nobody can open
 * (so the normal sign-up link could never be clicked). Run it once after the production seed:
 *
 *   ADMIN_EMAIL=admin@newtonschool.co npm run admin:set-password -w apps/api
 *
 * The password is typed at a hidden prompt: it is never printed, logged or put in a command line.
 * It only works for an address that is already a Super Admin, so it cannot be used to take over anyone else.
 */
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

function askHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    process.stdout.write(question);
    let value = '';
    stdin.setRawMode?.(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n' || ch === '\u0004') {
          stdin.setRawMode?.(false);
          stdin.pause();
          stdin.off('data', onData);
          process.stdout.write('\n');
          return resolve(value);
        }
        if (ch === '\u0003') process.exit(130);
        if (ch === '\u007f') value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdin.on('data', onData);
  });
}

async function main() {
  const email = (process.env.ADMIN_EMAIL ?? '').trim().toLowerCase();
  if (!email) throw new Error('Set ADMIN_EMAIL, e.g. ADMIN_EMAIL=admin@newtonschool.co npm run admin:set-password -w apps/api');
  if (!process.stdin.isTTY) throw new Error('Run this in a terminal: it asks for the password at a hidden prompt.');

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  try {
    const admin = await prisma.user.findUnique({ where: { email } });
    if (!admin || admin.role !== Role.SUPER_ADMIN) {
      throw new Error(`${email} is not a Super Admin. Run the production seed first (npm run db:seed:production -w apps/api).`);
    }

    const password = await askHidden('New admin password (at least 10 characters): ');
    if (password.length < 10 || password.length > 128) throw new Error('The password must be 10 to 128 characters.');
    if (password !== (await askHidden('Type it again: '))) throw new Error('The two passwords did not match.');

    await prisma.user.update({
      where: { id: admin.id },
      data: { passwordHash: await argon2.hash(password, { type: argon2.argon2id }), emailVerifiedAt: admin.emailVerifiedAt ?? new Date() },
    });
    // End any sessions that existed under an old password.
    await prisma.refreshToken.updateMany({ where: { userId: admin.id, revokedAt: null }, data: { revokedAt: new Date() } });
    console.log(`Done: ${email} can now log in with that password.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(`Could not set the password: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
