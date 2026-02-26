/**
 * wait-for-db.js — polls the test database until it accepts connections,
 * then exits so the next step in the pipeline can proceed.
 *
 * Usage: node scripts/wait-for-db.js
 * Reads DATABASE_URL from the environment (or .env.test via dotenv).
 */
import pkg from 'pg';
const { Pool } = pkg;
import dotenv from 'dotenv';

dotenv.config({ path: '.env.test' });

const MAX_RETRIES = 20;
const RETRY_INTERVAL_MS = 2000;

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ||
    'postgresql://postgres:postgres@localhost:5433/agentpay_test',
  connectionTimeoutMillis: 3000,
});

let retries = 0;

async function waitForDb() {
  while (retries < MAX_RETRIES) {
    try {
      await pool.query('SELECT 1');
      console.log('✅ Database is ready!');
      await pool.end();
      process.exit(0);
    } catch (err) {
      retries++;
      const msg = err instanceof Error ? err.message : String(err);
      console.log(
        `⏳ Waiting for database to become ready… (${retries}/${MAX_RETRIES}) — ${msg}`
      );
      await new Promise((resolve) => setTimeout(resolve, RETRY_INTERVAL_MS));
    }
  }

  console.error('❌ Database did not become ready within the timeout. Aborting.');
  await pool.end().catch(() => {});
  process.exit(1);
}

waitForDb();
