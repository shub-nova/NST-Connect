import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import { defineConfig } from 'prisma/config';

// The single .env lives at the repo root.
loadEnv({ path: path.resolve(__dirname, '../../.env') });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: process.env.DATABASE_URL ?? '',
  },
});
