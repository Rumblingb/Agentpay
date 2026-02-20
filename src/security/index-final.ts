import { Pool, QueryResult } from 'pg';

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
  ssl:
    process.env.NODE_ENV === 'production'
      ? { rejectUnauthorized: false }
      : false,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
});

export async function query(text: string, params?: any[]): Promise<QueryResult> {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    if (duration > 1000) {
      console.warn(`Query took ${duration}ms`, { text });
    }
    return result;
  } catch (error) {
    console.error('Database query error:', { error, text });
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
