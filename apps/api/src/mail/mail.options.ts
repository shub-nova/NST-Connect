import type { SendMailOptions, Transport } from 'nodemailer';

export interface MailEnv {
  NODE_ENV?: string;
  SMTP_HOST?: string;
  SMTP_PORT?: string | number;
  SMTP_USER?: string;
  SMTP_PASS?: string;
  SMTP_SECURE?: string | boolean;
}

export interface TransportOptions {
  host: string;
  port: number;
  /** True for implicit TLS (port 465). */
  secure: boolean;
  /** Upgrade a plain connection to TLS (port 587) before logging in. */
  requireTLS?: boolean;
  auth?: { user: string; pass: string };
}

const truthy = (v: unknown) => v === true || String(v).toLowerCase() === 'true';

/**
 * How to talk to the mail server, from the environment.
 *  - No SMTP_USER: plain local delivery (Mailpit in development). Nothing leaves the machine.
 *  - With SMTP_USER and SMTP_PASS: a real provider, with a login and TLS (port 465 implicit, 587 STARTTLS).
 *  - NODE_ENV=test is always local Mailpit, so the test suite can never send real email.
 */
export function buildTransportOptions(env: MailEnv): TransportOptions {
  if (env.NODE_ENV === 'test') return { host: 'localhost', port: 1025, secure: false };

  const host = env.SMTP_HOST || 'localhost';
  const port = Number(env.SMTP_PORT ?? 1025);
  if (!env.SMTP_USER) return { host, port, secure: false };

  if (!env.SMTP_PASS) throw new Error('SMTP_USER is set but SMTP_PASS is missing.');
  const secure = truthy(env.SMTP_SECURE) || port === 465;
  return { host, port, secure, requireTLS: !secure, auth: { user: env.SMTP_USER, pass: env.SMTP_PASS } };
}

export type { SendMailOptions, Transport };
