import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { resolveTrustProxy } from './common/trust-proxy';

/** Shared by main.ts and the e2e tests so tests run the same HTTP setup as production. */
export function configureApp(app: INestApplication) {
  const config = app.get(ConfigService);
  const trust = resolveTrustProxy(config.get<string>('TRUST_PROXY'), !!process.env.VERCEL);
  if (trust !== undefined) {
    const express = app.getHttpAdapter().getInstance() as { set: (key: string, value: unknown) => void };
    express.set('trust proxy', trust);
  }
  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({
    origin: config.getOrThrow<string>('WEB_URL'),
    credentials: true,
  });
}
