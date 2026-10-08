import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3000),
  WEB_URL: z.string().url().default('http://localhost:3001'),

  DATABASE_URL: z.string().min(1),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().default(15 * 60),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().default(7),

  STUDENT_EMAIL_DOMAIN: z.string().default('adypu.edu.in'),
  POC_EMAIL_DOMAIN: z.string().default('newtonschool.co'),

  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().default(1025),
  MAIL_FROM: z.string().default('NST Connect <no-reply@nstconnect.local>'),
  // Leave SMTP_USER empty for local development (Mailpit catches everything). Set it with SMTP_PASS to send real email.
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  /** True for implicit TLS (port 465). Port 587 uses STARTTLS automatically. */
  SMTP_SECURE: z.stringbool().default(false),

  // Automatic escalation: a ticket whose assigned POC does nothing for 48h moves up a level.
  ESCALATION_JOB_ENABLED: z.stringbool().default(true),
  ESCALATION_INTERVAL_MINUTES: z.coerce.number().int().min(1).default(15),
  TAT_WARNING_HOURS: z.coerce.number().int().min(1).default(12),
  /** Lets a scheduler (GitHub Actions, Render cron) call POST /internal/escalation/run. Unset = endpoint off. */
  JOB_SECRET: z.string().min(16, 'JOB_SECRET must be at least 16 characters').optional(),

  /** Database connections per instance. Keep it at 1 or 2 on serverless (Vercel), where there are many instances. */
  DB_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),
  /** Where the login cookie applies. Behind a proxy that adds a prefix (/api) set it to /api/auth. */
  COOKIE_PATH: z.string().default('/auth'),
  /** "true" or the number of proxies in front of the API, so rate limiting sees the real visitor address. */
  TRUST_PROXY: z.string().optional(),
  /** Shared store for rate limiting: a free Upstash Redis (REST address and token). Without it, counts live in each instance's memory. */
  UPSTASH_REDIS_REST_URL: z.string().url().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().optional(),
  /** Create the bucket and its browser-upload rules when the API starts. Turn off on serverless and run `npm run storage:setup` once. */
  STORAGE_AUTO_SETUP: z.stringbool().default(true),

  S3_ENDPOINT: z.string().url().default('http://localhost:9000'),
  S3_REGION: z.string().default('auto'),
  S3_BUCKET: z.string().default('nst-connect-attachments'),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
});

export type Env = z.infer<typeof schema>;

const isLocal = (url: string | undefined) => !url || /(^|\/\/|@)(localhost|127\.0\.0\.1|\[::1\])([:/]|$)/.test(url);

/**
 * What is unsafe or unfinished about this configuration for a real deployment. In production the API refuses
 * to start while this list is not empty, so a forgotten development setting cannot go live quietly.
 */
export function productionProblems(env: Env, platform: { onVercel?: boolean } = {}): string[] {
  const problems: string[] = [];
  if (/change-me|example|your-secret/i.test(env.JWT_SECRET)) problems.push('JWT_SECRET is still an example value. Generate a new random one.');
  if (!env.WEB_URL.startsWith('https://')) problems.push('WEB_URL must be the public https:// address of the web app.');
  if (isLocal(env.DATABASE_URL)) problems.push('DATABASE_URL points at this computer. Use the hosted database.');
  if (isLocal(env.S3_ENDPOINT)) problems.push('S3_ENDPOINT points at this computer. Use real file storage (R2, B2 or Supabase).');
  if (env.S3_ACCESS_KEY === 'nstconnect') problems.push('S3_ACCESS_KEY is the development key. Use the storage provider key.');
  if (isLocal(env.SMTP_HOST) || !env.SMTP_USER) problems.push('Email is not set up for real delivery (SMTP_HOST, SMTP_USER, SMTP_PASS).');
  if (env.STUDENT_EMAIL_DOMAIN.split(',').filter((d) => d.trim()).length > 1) {
    problems.push('STUDENT_EMAIL_DOMAIN lists more than one domain. Extra domains are for testing only: remove them.');
  }
  if (platform.onVercel && (!env.JOB_SECRET || env.ESCALATION_JOB_ENABLED)) {
    problems.push('On Vercel there is no always-on process: set ESCALATION_JOB_ENABLED=false and JOB_SECRET, and call /internal/escalation/run on a schedule.');
  }
  return problems;
}

// Fail fast at startup with a readable list of what is wrong.
export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  if (parsed.data.NODE_ENV === 'production') {
    const problems = productionProblems(parsed.data, { onVercel: !!process.env.VERCEL });
    if (problems.length) throw new Error(`This is not safe to run in production yet:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  }
  return parsed.data;
}
