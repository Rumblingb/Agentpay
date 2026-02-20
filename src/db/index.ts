import { Pool, QueryResult } from "pg";
import dotenv from "dotenv";

dotenv.config();

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

pool.on("error", (err) => {
  console.error("Unexpected error on idle client", err);
});

export function query(text: string, params?: any[]): Promise<QueryResult<any>> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    pool.query(text, params || [], (err: any, result: QueryResult<any>) => {
      const duration = Date.now() - start;
      if (duration > 1000) {
        console.warn(`Query took ${duration}ms`, { text });
      }
      if (err) {
        if (process.env.NODE_ENV !== "test" || err.code !== "23505") {
          console.error("Database query error:", { err: err.message, text });
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

export async function closePool() {
  try {
    // @ts-ignore - accessing internal property
    if (!pool.ending) {
      await pool.end();
    }
  } catch (e) {
    console.log("Pool already closed");
  }
}

export default {
  query,
  getClient,
  pool,
  closePool,
};
