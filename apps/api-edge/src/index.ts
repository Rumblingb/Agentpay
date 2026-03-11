/**
 * AgentPay API — Cloudflare Workers entrypoint
 *
 * Phases complete:
 *   2 — scaffold
 *   3 — env validation middleware
 *   4 — health routes
 *   5 — CORS, request ID, security headers, global pause
 */

import { Hono } from 'hono';
import type { Env } from './types';
import { validateEnv, EnvValidationError } from './config/env';
import { corsMiddleware } from './middleware/cors';
import { requestIdMiddleware } from './middleware/requestId';
import { securityHeadersMiddleware } from './middleware/securityHeaders';
import { globalPauseMiddleware } from './middleware/globalPause';
import { healthRouter } from './routes/health';

// ---------------------------------------------------------------------------
// Application
// ---------------------------------------------------------------------------

const app = new Hono<{ Bindings: Env }>();

// ---------------------------------------------------------------------------
// 1. Security headers — set on every response before any route logic runs.
// ---------------------------------------------------------------------------

app.use('*', securityHeadersMiddleware);

// ---------------------------------------------------------------------------
// 2. CORS — must run early so preflight OPTIONS requests are handled correctly
//    and before any auth middleware rejects the preflight with a 401.
// ---------------------------------------------------------------------------

app.use('*', corsMiddleware);

// ---------------------------------------------------------------------------
// 3. Request ID + structured logging.
// ---------------------------------------------------------------------------

app.use('*', requestIdMiddleware);

// ---------------------------------------------------------------------------
// 4. Env validation — skipped for health paths so liveness probes always work.
//    Workers have no persistent startup hook; validation runs per-request.
// ---------------------------------------------------------------------------

app.use('*', async (c, next) => {
  const path = c.req.path;
  if (path === '/health' || path === '/api/health' || path === '/api') {
    return next();
  }
  validateEnv(c.env);
  await next();
});

// ---------------------------------------------------------------------------
// 5. Global pause (circuit-breaker) — rejects non-GET, non-health mutating
//    requests when AGENTPAY_GLOBAL_PAUSE=true.
// ---------------------------------------------------------------------------

app.use('*', globalPauseMiddleware);

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// Health checks — mounted first; exempt from env validation above.
app.route('/', healthRouter);

// Root splash (matches GET / in Express backend)
app.get('/', (c) => c.text('AgentPay API is Live 🚀'));

// ---------------------------------------------------------------------------
// Global error handler
// ---------------------------------------------------------------------------

app.onError((err, c) => {
  if (err instanceof EnvValidationError) {
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
