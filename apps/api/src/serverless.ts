import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import type { IncomingMessage, ServerResponse } from 'node:http';
import express from 'express';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';

/**
 * The API as a serverless function (Vercel). The Nest app is created once per function instance and reused for
 * every request that instance serves, so only a cold start pays the start-up cost.
 */
let ready: Promise<express.Express> | undefined;

function bootstrap(): Promise<express.Express> {
  return (async () => {
    const server = express();
    const app = await NestFactory.create(AppModule, new ExpressAdapter(server), { logger: ['error', 'warn', 'log'] });
    configureApp(app);
    await app.init();
    return server;
  })();
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  // Two requests arriving together during a cold start share one start-up, and a failed start is retried next time.
  ready ??= bootstrap().catch((err) => {
    ready = undefined;
    throw err;
  });
  const server = await ready;
  server(req as express.Request, res as express.Response);
}
