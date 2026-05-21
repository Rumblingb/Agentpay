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
 *   Runs a lightweight SELECT 1 using the same database factory as the API.
 *   Missing or failing database configuration degrades the service and returns
 *   503 so deploy monitors do not report a healthy API when persistence is down.
 */

import { Hono, type Context } from 'hono';
import { createDb, type Sql } from '../lib/db';
import type { Env } from '../types';

// Must stay in sync with src/server.ts API_VERSION
const API_VERSION = '1.0.0';

const router = new Hono<{ Bindings: Env }>();

// ---------------------------------------------------------------------------
// Shared handler — reused by /health and /api/health
// ---------------------------------------------------------------------------

async function healthHandler(c: Context<{ Bindings: Env }>) {
  let dbStatus: 'operational' | 'degraded' = 'degraded';

  if (c.env.DATABASE_URL || c.env.HYPERDRIVE?.connectionString) {
    let sql: Sql | undefined;
    try {
      sql = createDb(c.env);
      await sql`SELECT 1`;
      dbStatus = 'operational';
    } catch (err) {
      console.error('Health check database probe failed', err);
      dbStatus = 'degraded';
    } finally {
      if (sql) {
        try {
          await sql.end();
        } catch (err) {
          console.error('Health check database close failed', err);
        }
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
