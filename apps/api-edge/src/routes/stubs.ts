/**
 * Deferred routes — endpoints that are on the roadmap but not yet migrated
 * to the Workers runtime.
 *
 * Rules:
 *   - Returns 503 with a JSON body so callers get a clear, actionable message.
 *   - Never returns 200 with an error body (that pattern masks failures in SDKs).
 *   - Removed/deprecated routes return 410 Gone.
 *   - Each stub documents when it will be implemented.
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../types';

const router = new Hono<{ Bindings: Env; Variables: Variables }>();

const deferred = (feature: string, eta?: string) =>
  new Response(
    JSON.stringify({
      error: 'NOT_YET_AVAILABLE',
      feature,
      message: `${feature} is not yet available. ${eta ? `Expected: ${eta}.` : 'Check the changelog for updates.'}`,
      docs: 'https://github.com/Rumblingb/Agentpay/tree/main/docs',
    }),
    { status: 503, headers: { 'content-type': 'application/json' } },
  );

const removed = (reason: string) =>
  new Response(
    JSON.stringify({
      error: 'ENDPOINT_REMOVED',
      message: reason,
      docs: 'https://github.com/Rumblingb/Agentpay/tree/main/docs',
    }),
    { status: 410, headers: { 'content-type': 'application/json' } },
  );

// ── Deferred: escrow stats requires in-memory state not yet migrated ──────────
router.get('/api/escrow/stats', () =>
  deferred('A2A escrow statistics', 'Phase 2'),
);

// ── Removed: internal test endpoints not for public use ───────────────────────
router.post('/api/test-tip', () =>
  removed('This was an internal test endpoint and has been removed.'),
);

// ── Removed: Prometheus metrics not applicable in Cloudflare Workers ──────────
// Use Cloudflare Analytics in the dashboard instead.
router.get('/metrics', () =>
  removed('Prometheus metrics are not available in the Workers runtime. Use Cloudflare Analytics.'),
);

export { router as stubsRouter };
