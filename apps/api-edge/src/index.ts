/**
 * AgentPay API — Cloudflare Workers entrypoint
 *
 * This is the Hono application that replaces the Render/Express backend
 * for all public HTTP routes.
 *
 * Phase state:
 *   Phase 2 — scaffold (compiled, no routes)
 *   Phase 3 — env validation middleware wired in
 *
 * Architecture:
 *   Hono<{ Bindings: Env }> types c.env as the Workers Bindings object so
 *   every handler has full TypeScript coverage over secrets and vars without
 *   any process.env usage.
 */

import { Hono } from 'hono';
import type { Env } from './types';
import { validateEnv, EnvValidationError } from './config/env';
import { healthRouter } from './routes/health';

// ---------------------------------------------------------------------------
// Application
// ---------------------------------------------------------------------------

const app = new Hono<{ Bindings: Env }>();

// ---------------------------------------------------------------------------
// Global middleware — env validation
//
// Workers have no persistent startup hook, so we validate required secrets
// on the first middleware of every incoming request.  EnvValidationError is
// caught below and returned as a production-safe 500 that never leaks secret
// names or values to the caller.
// ---------------------------------------------------------------------------

app.use('*', async (c, next) => {
  validateEnv(c.env);
  await next();
});

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// Health checks — GET /health, GET /api/health, GET /api
// Mounted first so liveness probes are never blocked by auth middleware.
app.route('/', healthRouter);

// ---------------------------------------------------------------------------
// Global error handler
//
// Catches any unhandled error from route handlers or middleware.
// EnvValidationError → 500 with a generic message (never exposes secrets).
// All other errors → 500 with a generic message.
// ---------------------------------------------------------------------------

app.onError((err, c) => {
  if (err instanceof EnvValidationError) {
    // Log to Cloudflare Workers tail logs (server-side only, not sent to client)
    console.error('[startup] env validation failed:', err.message);
    return c.json(
      { error: 'CONFIGURATION_ERROR', message: 'Server configuration error.' },
      500,
    );
  }

  console.error('[error]', err.message);
  return c.json(
    { error: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' },
    500,
  );
});

// ---------------------------------------------------------------------------
// Export — required by the Workers runtime.
// ---------------------------------------------------------------------------

export default app;
