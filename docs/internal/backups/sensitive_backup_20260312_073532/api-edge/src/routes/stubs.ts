/**
 * Stub routes for endpoints not yet migrated to Workers.
 *
 * Purpose: prevent hard 404s when the dashboard's AGENTPAY_API_BASE_URL is
 * pointed at the Workers backend before all routes are migrated.  The stubs
 * return a clearly-labelled 501 response so the dashboard BFF displays a
 * graceful error rather than a confusing 404.
 *
 * Routes stubbed here will be removed as each phase migrates the real implementation.
 *
 * Current stubs (all deferred to Phase 13 or later):
 *   GET /api/escrow/stats          — in-memory escrow (not Workers-compatible)
 *   GET /api/agentrank/:agentId    — AgentRank service (not yet migrated)
 *   POST /api/demo/run-agent-payment — demo endpoint
 *   POST /api/test-tip             — test endpoint
 *   GET /api/metrics               — Prometheus metrics (Render-specific)
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../types';

const router = new Hono<{ Bindings: Env; Variables: Variables }>();

const NOT_MIGRATED = {
  error: 'NOT_YET_MIGRATED',
  message: 'This endpoint is not yet available on the Workers backend. Use the Render backend.',
} as const;

// Escrow stats — in-memory escrow is Render-only for now
router.get('/api/escrow/stats', () => new Response(JSON.stringify(NOT_MIGRATED), {
  status: 200,
  headers: { 'content-type': 'application/json' },
}));

// AgentRank lookup
router.get('/api/agentrank/:agentId', () => new Response(JSON.stringify(NOT_MIGRATED), {
  status: 200,
  headers: { 'content-type': 'application/json' },
}));

// Demo agent payment
router.post('/api/demo/run-agent-payment', () => new Response(JSON.stringify(NOT_MIGRATED), {
  status: 200,
  headers: { 'content-type': 'application/json' },
}));

// Test tip
router.post('/api/test-tip', () => new Response(JSON.stringify(NOT_MIGRATED), {
  status: 200,
  headers: { 'content-type': 'application/json' },
}));

// Prometheus metrics endpoint — not applicable in Workers (use Cloudflare Analytics)
router.get('/metrics', () => new Response(JSON.stringify(NOT_MIGRATED), {
  status: 200,
  headers: { 'content-type': 'application/json' },
}));

export { router as stubsRouter };
