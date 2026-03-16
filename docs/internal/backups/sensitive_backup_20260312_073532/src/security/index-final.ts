import { Pool, QueryResult } from 'pg';
import { logger } from '../logger.js';

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
  ssl:
    process.env.NODE_ENV === 'production'
      ? { rejectUnauthorized: true }
      : false,
});

pool.on('error', (err) => {
  logger.error({ err }, 'Unexpected error on idle DB client');
});

export async function query(text: string, params?: any[]): Promise<QueryResult> {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    if (duration > 1000) {
      logger.warn({ query: text, durationMs: duration }, 'Slow DB query');
    }
    return result;
  } catch (error) {
    logger.error({ err: error, query: text }, 'Database query error');
    throw error;
  }
}

export async function getClient() {
  return pool.connect();
}

export default {
  query,
  getClient,
  pool,
};
