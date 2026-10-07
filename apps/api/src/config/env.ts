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

  // Automatic escalation: a ticket whose assigned POC does nothing for 48h moves up a level.
  ESCALATION_JOB_ENABLED: z.stringbool().default(true),
  ESCALATION_INTERVAL_MINUTES: z.coerce.number().int().min(1).default(15),
  TAT_WARNING_HOURS: z.coerce.number().int().min(1).default(12),
  /** Lets a scheduler (GitHub Actions, Render cron) call POST /internal/escalation/run. Unset = endpoint off. */
  JOB_SECRET: z.string().min(16, 'JOB_SECRET must be at least 16 characters').optional(),

  S3_ENDPOINT: z.string().url().default('http://localhost:9000'),
  S3_REGION: z.string().default('auto'),
  S3_BUCKET: z.string().default('nst-connect-attachments'),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
});

export type Env = z.infer<typeof schema>;

// Fail fast at startup with a readable list of what is wrong.
export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}
