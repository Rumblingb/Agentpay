import { Pool, QueryResult } from "pg";
import dotenv from "dotenv";
import { logger } from "../logger.js";

dotenv.config();

// Initialize the Postgres Pool
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // We allow rejectUnauthorized: false for managed DBs like Supabase/Render
  // This resolves the "self-signed certificate" error while maintaining encryption.
  ssl: process.env.NODE_ENV === 'production' 
    ? { rejectUnauthorized: false } 
    : false
});

pool.on("error", (err) => {
  logger.error({ err }, "Unexpected error on idle DB client");
});

/**
 * Standard query wrapper for logging and error handling
 */
export function query(text: string, params?: any[]): Promise<QueryResult<any>> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    pool.query(text, params || [], (err: any, result: QueryResult<any>) => {
      const duration = Date.now() - start;
      
      if (duration > 1000) {
        logger.warn({ query: text, durationMs: duration }, "Slow DB query");
      }

      if (err) {
        // Suppress duplicate key errors in test mode to keep logs clean
        if (process.env.NODE_ENV !== "test" || err.code !== "23505") {
          logger.error({ err: err.message || String(err), query: text }, "Database query error");
        }
        reject(err);
      } else {
        resolve(result);
      }
    });
  });
}

export async function getClient() {
  return pool.connect();
}

/**
 * Ensures the pool is closed correctly during test teardowns
 */
export async function closePool() {
  try {
    // @ts-ignore - accessing internal property to check state
    if (!pool.ending) {
      await pool.end();
    }
  } catch (e) {
    logger.warn({ err: e }, "Pool already closed or error during close");
  }
}

export default {
  query,
  getClient,
  pool,
  closePool,
};