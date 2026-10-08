import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';

/** Shared by main.ts and the e2e tests so tests run the same HTTP setup as production. */
export function configureApp(app: INestApplication) {
  const config = app.get(ConfigService);
  // Behind a proxy (Vercel, Render) the visitor's address comes from X-Forwarded-For, which rate limiting needs.
  const proxy = config.get<string>('TRUST_PROXY');
  if (proxy) {
    const express = app.getHttpAdapter().getInstance() as { set: (key: string, value: unknown) => void };
    express.set('trust proxy', proxy === 'true' ? true : Number.isInteger(Number(proxy)) ? Number(proxy) : proxy);
  }
  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({
    origin: config.getOrThrow<string>('WEB_URL'),
    credentials: true,
  });
}
