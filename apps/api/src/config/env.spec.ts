import { productionProblems, validateEnv } from './env';

const good = {
  NODE_ENV: 'production',
  JWT_SECRET: 'x'.repeat(48),
  WEB_URL: 'https://helpdesk.example.in',
  DATABASE_URL: 'postgresql://u:p@ep-cool.neon.tech/db',
  S3_ENDPOINT: 'https://acct.r2.cloudflarestorage.com',
  S3_ACCESS_KEY: 'AKIA-real',
  S3_SECRET_KEY: 'real-secret',
  SMTP_HOST: 'smtp.gmail.com',
  SMTP_PORT: '587',
  SMTP_USER: 'someone@gmail.com',
  SMTP_PASS: 'app-password',
  STUDENT_EMAIL_DOMAIN: 'adypu.edu.in',
  POC_EMAIL_DOMAIN: 'newtonschool.co',
};

describe('production safety check', () => {
  it('lets a properly configured production environment start', () => {
    expect(() => validateEnv(good)).not.toThrow();
  });

  it('refuses development leftovers, and says what to fix', () => {
    const bad = {
      ...good,
      JWT_SECRET: 'change-me-to-a-long-random-string-of-at-least-32-chars',
      WEB_URL: 'http://localhost:3001',
      DATABASE_URL: 'postgresql://nstconnect:x@localhost:5432/nstconnect',
      S3_ENDPOINT: 'http://localhost:9000',
      S3_ACCESS_KEY: 'nstconnect',
      SMTP_HOST: 'localhost',
      SMTP_USER: '',
      STUDENT_EMAIL_DOMAIN: 'adypu.edu.in,gmail.com',
    };
    expect(() => validateEnv(bad)).toThrow(/not safe to run in production/);
    const problems = productionProblems(validateEnv({ ...bad, NODE_ENV: 'development' }));
    expect(problems.join('\n')).toMatch(/JWT_SECRET/);
    expect(problems.join('\n')).toMatch(/WEB_URL/);
    expect(problems.join('\n')).toMatch(/DATABASE_URL/);
    expect(problems.join('\n')).toMatch(/S3_ENDPOINT/);
    expect(problems.join('\n')).toMatch(/Email/);
    expect(problems.join('\n')).toMatch(/more than one domain/);
  });

  it('is never applied in development or test', () => {
    expect(() => validateEnv({ ...good, NODE_ENV: 'development', WEB_URL: 'http://localhost:3001' })).not.toThrow();
  });

  it('wants an external schedule for the escalation job on Vercel', () => {
    const env = validateEnv({ ...good, ESCALATION_JOB_ENABLED: 'true' });
    expect(productionProblems(env, { onVercel: true }).join('\n')).toMatch(/JOB_SECRET/);
    const ok = validateEnv({ ...good, ESCALATION_JOB_ENABLED: 'false', JOB_SECRET: 'a-long-random-secret-1234' });
    expect(productionProblems(ok, { onVercel: true })).toEqual([]);
  });

  it('allows extra student domains only when testing is switched on', () => {
    const testing = { ...good, STUDENT_EMAIL_DOMAIN: 'adypu.edu.in,gmail.com' };
    expect(() => validateEnv(testing)).toThrow(/more than one domain/);
    expect(() => validateEnv({ ...testing, ALLOW_TEST_STUDENT_DOMAINS: 'true' })).not.toThrow();
  });

  it('allows extra staff domains while testing, and a shared test domain only with the switch on', () => {
    const base = { ...good, STUDENT_EMAIL_DOMAIN: 'adypu.edu.in,gmail.com', ALLOW_TEST_STUDENT_DOMAINS: 'true' };
    expect(() => validateEnv({ ...base, POC_EMAIL_DOMAIN: 'newtonschool.co,outlook.com' })).not.toThrow();
    expect(() => validateEnv({ ...base, POC_EMAIL_DOMAIN: 'newtonschool.co,gmail.com' })).not.toThrow();
    const shared = { ...good, STUDENT_EMAIL_DOMAIN: 'adypu.edu.in,gmail.com', POC_EMAIL_DOMAIN: 'newtonschool.co,gmail.com' };
    expect(() => validateEnv(shared)).toThrow(/more than one domain/);
    expect(() => validateEnv({ ...good, POC_EMAIL_DOMAIN: 'newtonschool.co,outlook.com' })).toThrow(/POC_EMAIL_DOMAIN lists more than one/);
  });
});
