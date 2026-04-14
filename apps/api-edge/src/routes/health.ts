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
 *   Mirrors the Express backend semantics with a live `SELECT 1`.
 *   Missing DB config or a failed probe marks the database as `degraded`
 *   and downgrades the endpoint to HTTP 503.
 */

import { Hono, type Context } from 'hono';
import type { Env } from '../types';
import { createDb } from '../lib/db';

// Must stay in sync with src/server.ts API_VERSION
const API_VERSION = '1.0.0';

const router = new Hono<{ Bindings: Env }>();

async function getDatabaseStatus(env: Env): Promise<'operational' | 'degraded'> {
  const hasConnectionString = Boolean(env.HYPERDRIVE?.connectionString ?? env.DATABASE_URL);
  if (!hasConnectionString) return 'degraded';

  let sql: ReturnType<typeof createDb> | null = null;
  try {
    sql = createDb(env);
    await sql`SELECT 1`;
    return 'operational';
  } catch (err) {
    console.error('[health] database probe failed:', err instanceof Error ? err.message : err);
    return 'degraded';
  } finally {
    if (sql) {
      await sql.end().catch((err) => {
        console.error('[health] database probe close failed:', err instanceof Error ? err.message : err);
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Shared handler — reused by /health and /api/health
// ---------------------------------------------------------------------------

async function healthHandler(c: Context<{ Bindings: Env }>) {
  const dbStatus = await getDatabaseStatus(c.env);

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
