import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import type { ConfigService } from '@nestjs/config';
import { MailService } from '../src/mail/mail.service';

/**
 * Sends one test email with the settings in .env, so you can check real email delivery works
 * before relying on it for sign-ups:
 *
 *   npm run mail:test -w apps/api -- you@example.com
 */
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

async function main() {
  const to = process.argv[2];
  if (!to || !to.includes('@')) throw new Error('Give an address to send to, e.g. npm run mail:test -w apps/api -- you@example.com');

  const env = process.env;
  const config = {
    get: (k: string) => env[k],
    getOrThrow: (k: string) => {
      const v = env[k];
      if (v === undefined) throw new Error(`${k} is not set in .env`);
      return v;
    },
  } as unknown as ConfigService;

  const mail = new MailService(config);
  console.log(`Sending from ${env.MAIL_FROM} via ${env.SMTP_HOST}:${env.SMTP_PORT}${env.SMTP_USER ? ` as ${env.SMTP_USER}` : ' (local, no login)'} ...`);
  const info = await mail.sendStrict(to, 'NST Connect test email', 'If you can read this, NST Connect can send real email.');
  console.log(`Sent. Server said: ${info.response}`);
  if (!env.SMTP_USER) console.log('Note: no SMTP_USER is set, so this went to Mailpit (http://localhost:8025), not a real inbox.');
}

main().catch((e) => {
  console.error(`Could not send: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
