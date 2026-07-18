/**
 * Health routes — GET /health, GET /api/health, GET /api
 *
 * Mirrors the exact response shape from src/server.ts healthCheckHandler
 * so the dashboard's /api/health polling and Render's healthCheckPath work
 * identically against the new Workers backend.
 *
 * Response contract (preserved from Express backend):
 *   200 OK when overall status is 'active'
 *   503 Service Unavailable when overall status is 'degraded'
 *
 *   Body:
 *   {
 *     status:    'active' | 'degraded',
 *     timestamp: ISO-8601 string,
 *     services: {
 *       database:          { status: 'operational' | 'degraded' },
 *       agentrank:         { status: 'operational' },
 *       escrow:            { status: 'operational' },
 *       kya:               { status: 'operational' },
 *       behavioral_oracle: { status: 'operational' },
 *     },
 *     version: string,
 *   }
 *
 * Database check:
 *   Runs a bounded SELECT 1 through Hyperdrive (or DATABASE_URL in local/CI).
 *   Missing configuration, connection failures, and timeouts fail readiness
 *   closed with a 503 instead of reporting a false-positive healthy service.
 */

import { Hono, type Context } from 'hono';
import { createDb, type Sql } from '../lib/db';
import type { Env } from '../types';

// Must stay in sync with src/server.ts API_VERSION
const API_VERSION = '1.0.0';
const DATABASE_PROBE_TIMEOUT_MS = 2_000;

const router = new Hono<{ Bindings: Env }>();

// ---------------------------------------------------------------------------
// Shared handler — reused by /health and /api/health
// ---------------------------------------------------------------------------

async function healthHandler(c: Context<{ Bindings: Env }>) {
  let dbStatus: 'operational' | 'degraded' = 'degraded';
  let sql: Sql | undefined;

  try {
    sql = createDb(c.env);
    await Promise.race([
      sql`SELECT 1`,
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('DATABASE_PROBE_TIMEOUT')), DATABASE_PROBE_TIMEOUT_MS);
      }),
    ]);
    dbStatus = 'operational';
  } catch {
    // Do not log driver errors here: connection strings and host details can
    // appear in them. The request ID and degraded status are enough to trace.
    console.error('[health] database probe failed');
  } finally {
    if (sql) {
      try {
        await sql.end({ timeout: 1 });
      } catch {
        console.error('[health] database client cleanup failed');
      }
    }
  }

  const overallStatus = dbStatus === 'operational' ? 'active' : 'degraded';
  const httpStatus = overallStatus === 'active' ? 200 : 503;

  return c.json(
    {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      services: {
        database: { status: dbStatus },
        agentrank: { status: 'operational' },
        escrow: { status: 'operational' },
        kya: { status: 'operational' },
        behavioral_oracle: { status: 'operational' },
      },
      version: API_VERSION,
    },
    httpStatus,
  );
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/** GET /health — root-level health check (matches render.yaml healthCheckPath) */
router.get('/health', healthHandler);

/** GET /api/health — same check, API-path variant (used by the dashboard) */
router.get('/api/health', healthHandler);

/**
 * GET /api — API status / discovery endpoint.
 * Mirrors src/server.ts GET /api exactly.
 */
router.get('/api', (c) =>
  c.json({
    status: 'AgentPay API Active',
    version: API_VERSION,
    timestamp: new Date().toISOString(),
    docs: '/api/docs',
  }),
);

export { router as healthRouter };
