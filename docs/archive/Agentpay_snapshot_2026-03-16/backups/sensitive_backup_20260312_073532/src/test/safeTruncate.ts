import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

/**
 * Truncates only tables that exist in the database.
 * @param {string[]} tables - List of table names to truncate.
 */
export async function safeTruncate(tables: string[]): Promise<void> {
  const client = await pool.connect();
  try {
    for (const table of tables) {
      const res = await client.query(
        `SELECT EXISTS (
          SELECT 1 FROM information_schema.tables WHERE table_name = $1
        ) AS exists`,
        [table]
      );
      if (res.rows[0].exists) {
        await client.query(`TRUNCATE ${table} RESTART IDENTITY CASCADE`);
      }
    }
  } finally {
    client.release();
  }
}
