/**
 * Postgres database client for the AgentPay Workers API.
 *
 * Uses `postgres` (porsager/postgres.js) which supports Cloudflare Workers
 * via the `nodejs_compat` compatibility flag (set in wrangler.toml).
 *
 * Connection strategy:
 *
 *   Without Hyperdrive (local dev / production before Hyperdrive is set up):
 *     DATABASE_URL is used directly.  Use the Supabase Direct connection string
 *     (port 5432, NOT the pooled/PgBouncer URL on port 6543) to avoid saturating
 *     the small per-project connection limit with one connection per Worker
 *     invocation.
 *
 *   With Hyperdrive (production, after configuring [[hyperdrive]] in wrangler.toml):
 *     HYPERDRIVE.connectionString replaces DATABASE_URL at runtime.  Hyperdrive
 *     does its own connection pooling.  The Hyperdrive SOURCE URL configured in
 *     the Cloudflare dashboard MUST be the Supabase Direct URL (port 5432),
 *     NOT the pooled/PgBouncer URL (port 6543).  Using the pooled URL as
 *     Hyperdrive's source creates double-pooling (PgBouncer inside Hyperdrive),
 *     which causes unexpected connection errors and latency spikes.
 *
 * Per-invocation lifecycle:
 *   Workers isolates can be warm (reused) or cold (fresh).  `postgres.js`
 *   handles connection management internally.  We use `max: 1` so each
 *   Worker invocation holds at most one connection.  Call `sql.end()` via
 *   `ctx.waitUntil()` after the response is sent so the connection closes
 *   gracefully without blocking the response.
 *
 * SSL:
 *   Supabase requires TLS.  `ssl: 'require'` matches the Express backend's
 *   `ssl: { rejectUnauthorized: false }` behaviour for managed Postgres hosts.
 */

import postgres from 'postgres';
import type { Env } from '../types';

export type Sql = ReturnType<typeof postgres>;

/**
 * Creates a postgres.js client for the current Workers invocation.
 *
 * Prefer HYPERDRIVE.connectionString when the binding is available (production).
 * Falls back to DATABASE_URL for local `wrangler dev` and CI.
 */


export function createDb(env: Env): Sql {
  const hyperdrive = (env as unknown as Record<string, { connectionString?: string }>)["HYPERDRIVE"]?.connectionString;

  const connectionString = hyperdrive ?? env.DATABASE_URL;
  const usingHyperdrive = Boolean(hyperdrive);

  return postgres(connectionString, usingHyperdrive
    ? {
        max: 1,
        fetch_types: false,
        prepare: false,
        idle_timeout: 5,
        connect_timeout: 10,
      }
    : {
        max: 1,
        idle_timeout: 20,
        connect_timeout: 10,
        ssl: "require",
      });
}
