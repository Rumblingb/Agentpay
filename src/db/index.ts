import { Pool, QueryResult } from "pg";
import dotenv from "dotenv";

dotenv.config();

// Initialize the Postgres Pool
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Use ssl if connecting to Supabase/AWS in production
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

pool.on("error", (err) => {
  console.error("Unexpected error on idle client", err);
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
        console.warn(`Query took ${duration}ms`, { text });
      }

      if (err) {
        // Suppress duplicate key errors in test mode to keep logs clean
        if (process.env.NODE_ENV !== "test" || err.code !== "23505") {
          console.error("Database query error:", { err: err.message || String(err), text });
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
    console.log("Pool already closed or error during close:", e);
  }
}

export default {
  query,
  getClient,
  pool,
  closePool,
};