import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, Role } from '../src/generated/prisma/client';
import { CATEGORIES } from './categories';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const DOMAIN = '@newtonschool.co';

// POC accounts are "invited": the user row exists with no password. The person
// completes registration with their real @newtonschool.co address, which sets
// the password. Role and level come from this list, never from the sign-up form.
async function upsertPoc(email: string, name: string) {
  return prisma.user.upsert({
    where: { email },
    update: {},
    create: { email, name, role: Role.POC },
  });
}

async function main() {
  await prisma.user.upsert({
    where: { email: `admin${DOMAIN}` },
    update: {},
    create: { email: `admin${DOMAIN}`, name: 'NST Admin', role: Role.SUPER_ADMIN },
  });

  for (const [index, cat] of CATEGORIES.entries()) {
    const category = await prisma.category.upsert({
      where: { name: cat.name },
      update: { shortName: cat.shortName, sortOrder: index, active: true, maxLevel: 3 },
      create: { name: cat.name, shortName: cat.shortName, sortOrder: index, maxLevel: 3 },
    });

    for (const [subIndex, subName] of cat.subCategories.entries()) {
      await prisma.subCategory.upsert({
        where: { categoryId_name: { categoryId: category.id, name: subName } },
        update: { sortOrder: subIndex, active: true },
        create: { categoryId: category.id, name: subName, sortOrder: subIndex },
      });
    }

    // Three levels per category: L1 handles tickets, L2 takes escalations from L1, and L3 takes
    // escalations from L2. L3 is the top: its decisions are final.
    const l3User = await upsertPoc(`${cat.slug}.l3${DOMAIN}`, `${cat.shortName} L3`);
    const l3 = await prisma.pOCAssignment.upsert({
      where: { userId_categoryId: { userId: l3User.id, categoryId: category.id } },
      update: { active: true, managerAssignmentId: null },
      create: { userId: l3User.id, categoryId: category.id, level: 3 },
    });

    const l2User = await upsertPoc(`${cat.slug}.l2${DOMAIN}`, `${cat.shortName} L2`);
    const l2 = await prisma.pOCAssignment.upsert({
      where: { userId_categoryId: { userId: l2User.id, categoryId: category.id } },
      update: { active: true, managerAssignmentId: l3.id },
      create: { userId: l2User.id, categoryId: category.id, level: 2, managerAssignmentId: l3.id },
    });

    // One L1 POC per category. (More can be added to a category later; tickets then go to
    // whichever has the fewest open ones.)
    const l1User = await upsertPoc(`${cat.slug}.l1.1${DOMAIN}`, `${cat.shortName} L1 #1`);
    const l1 = await prisma.pOCAssignment.upsert({
      where: { userId_categoryId: { userId: l1User.id, categoryId: category.id } },
      update: { active: true, managerAssignmentId: l2.id },
      create: { userId: l1User.id, categoryId: category.id, level: 1, managerAssignmentId: l2.id },
    });
    // Retire any other L1 left over from earlier seeds. They are deactivated, not deleted,
    // because tickets may still point at them.
    await prisma.pOCAssignment.updateMany({
      where: { categoryId: category.id, level: 1, id: { not: l1.id }, active: true },
      data: { active: false },
    });
  }

  // Categories from earlier seeds that are no longer in the list are hidden, not deleted,
  // because existing tickets still point at them.
  const keep = CATEGORIES.map((c) => c.name);
  const retired = await prisma.category.updateMany({ where: { name: { notIn: keep }, active: true }, data: { active: false } });

  console.log('Seed complete:', {
    categories: await prisma.category.count({ where: { active: true } }),
    subCategories: await prisma.subCategory.count({ where: { active: true } }),
    retiredCategories: retired.count,
    users: await prisma.user.count(),
    pocAssignments: await prisma.pOCAssignment.count(),
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
