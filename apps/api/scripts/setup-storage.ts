import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import type { ConfigService } from '@nestjs/config';
import { StorageService } from '../src/storage/storage.service';

/**
 * One-time setup of the file storage: creates the bucket if needed and lets the web app upload to it from the
 * browser. Run it after changing the storage settings or the web address:
 *
 *   npm run storage:setup -w apps/api
 */
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

async function main() {
  const env = process.env;
  const config = {
    get: (k: string) => (k === 'STORAGE_AUTO_SETUP' ? true : env[k]),
    getOrThrow: (k: string) => {
      const v = env[k];
      if (v === undefined || v === '') throw new Error(`${k} is not set in .env`);
      return v;
    },
  } as unknown as ConfigService;
  console.log(`Setting up bucket "${env.S3_BUCKET}" at ${env.S3_ENDPOINT} for uploads from ${env.WEB_URL} ...`);
  await new StorageService(config).ensureBucketAndCors();
  console.log('Done: the bucket exists and allows uploads from the web app.');
}

main().catch((e) => {
  console.error(`Could not set up storage: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
