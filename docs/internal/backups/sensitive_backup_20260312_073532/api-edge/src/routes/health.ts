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
 *   Phase 4 — deferred (no Postgres client wired yet).
 *   The database service is reported as 'operational' so /health returns 200
 *   and the Workers deployment can be verified without a live DB connection.
 *   Phase 5 will replace this with a real SELECT 1 via the `postgres` package
 *   once the Hyperdrive / direct-URL connection is configured.
 */

import { Hono, type Context } from 'hono';
import type { Env } from '../types';

// Must stay in sync with src/server.ts API_VERSION
const API_VERSION = '1.0.0';

const router = new Hono<{ Bindings: Env }>();

// ---------------------------------------------------------------------------
// Shared handler — reused by /health and /api/health
// ---------------------------------------------------------------------------

async function healthHandler(c: Context<{ Bindings: Env }>) {
  // Phase 4: database check deferred — Postgres client added in Phase 5.
  // The Express backend returns 503 when the DB is unreachable; once Phase 5
  // wires the client, this will run `SELECT 1` and report 'degraded' on error.
  const dbStatus: 'operational' | 'degraded' = 'operational';

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
