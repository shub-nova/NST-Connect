import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { Client } from 'pg';

/**
 * Runs once before the e2e suite: clears ticket data and test students so runs start from
 * the same state and the database does not grow forever, then re-seeds so categories and
 * POC assignments are exactly the canonical set.
 *
 * Safety: this DELETES DATA, so it refuses to run unless the database name ends in "_test".
 */
export default async function globalSetup() {
  loadEnv({ path: path.resolve(__dirname, '../../../.env') });
  const url = process.env.DATABASE_URL ?? '';
  const dbName = new URL(url).pathname.replace(/^\//, '');
  if (!dbName.endsWith('_test')) {
    throw new Error(`Refusing to reset "${dbName}": e2e tests must run against a database whose name ends in _test.`);
  }

  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(
      'TRUNCATE ticket_feedback, staff_audit, admin_note_receipt, admin_note, ticket_event, attachment, notification, comment_mention, comment, ticket, refresh_token RESTART IDENTITY CASCADE',
    );
    await client.query(`DELETE FROM "user" WHERE role = 'STUDENT'`);
    // The escalation time goes back to the default (2 days), whatever a previous run left.
    await client.query('DELETE FROM app_setting');
    // Seeded staff go back to "invited, not yet registered" so registration tests are repeatable.
    // Staff created by the Settings tests are removed; seeded staff go back to "not yet registered".
    await client.query(`DELETE FROM poc_assignment WHERE user_id IN (SELECT id FROM "user" WHERE email LIKE 'staff.test.%')`);
    await client.query(`DELETE FROM "user" WHERE email LIKE 'staff.test.%'`);
    // Categories made by the catalogue spec, after their staff are gone (tickets and audit rows were cleared above).
    await client.query(`DELETE FROM sub_category WHERE category_id IN (SELECT id FROM category WHERE name LIKE 'Catalog Test %')`);
    await client.query(`DELETE FROM category WHERE name LIKE 'Catalog Test %'`);
    await client.query(`UPDATE "user" SET password_hash = NULL, email_verified_at = NULL, deactivated_at = NULL WHERE role <> 'STUDENT'`);
  } finally {
    await client.end();
  }

  // Put categories and POC assignments back to the canonical seeded state (one L1 and one L2
  // per category). The seed is idempotent, so this also repairs anything an earlier run left
  // behind, and no test has to rely on another test having cleaned up perfectly.
  execFileSync('npx', ['prisma', 'db', 'seed'], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, DATABASE_URL: url, SEED_RESET: 'true' },
    stdio: 'ignore',
  });
}
