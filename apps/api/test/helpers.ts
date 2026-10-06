import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/prisma/prisma.service';

const MAILPIT = process.env.MAILPIT_URL ?? 'http://localhost:8025';

export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();
  return app;
}

export function prismaOf(app: INestApplication): PrismaService {
  return app.get(PrismaService);
}

/** Read the verification token out of the real email that Mailpit captured. */
export async function verificationTokenFor(email: string): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const search = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`);
    const { messages } = (await search.json()) as { messages: { ID: string }[] };
    if (messages?.length) {
      const msg = await fetch(`${MAILPIT}/api/v1/message/${messages[0].ID}`);
      const { Text } = (await msg.json()) as { Text: string };
      const match = Text.match(/verify\?token=([A-Za-z0-9._-]+)/);
      if (match) return match[1];
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`No verification email found for ${email}`);
}

export const PASSWORD = 'correct-horse-battery';

/** Register, verify through the real email, and log in. Returns the access token. */
export async function registerAndLogin(app: INestApplication, email: string, name = 'Test User') {
  const server = app.getHttpServer();
  await request(server).post('/auth/register').send({ email, name, password: PASSWORD }).expect(202);
  const token = await verificationTokenFor(email);
  await request(server).post('/auth/verify').send({ token }).expect(200);
  const login = await request(server).post('/auth/login').send({ email, password: PASSWORD }).expect(200);
  return login.body.accessToken as string;
}

export function uniqueStudentEmail(prefix = 'e') {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}@adypu.edu.in`;
}

/** Look up a main category and its first sub-category by the short name students see. */
export async function categoryByShortName(app: INestApplication, shortName: string) {
  return prismaOf(app).category.findFirstOrThrow({
    where: { shortName, active: true },
    include: { subCategories: { where: { active: true }, orderBy: { sortOrder: 'asc' } } },
  });
}

/** Log in as a seeded (invited) POC. Resets the account first so this is repeatable. */
export async function loginAsPoc(app: INestApplication, email: string) {
  const prisma = prismaOf(app);
  await prisma.refreshToken.deleteMany({ where: { user: { email } } });
  await prisma.user.update({ where: { email }, data: { passwordHash: null, emailVerifiedAt: null } });
  return registerAndLogin(app, email, 'POC User');
}
