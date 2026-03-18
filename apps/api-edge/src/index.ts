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
import type { Env, Variables } from './types';
import { validateEnv, EnvValidationError } from './config/env';
import { corsMiddleware } from './middleware/cors';
import { requestIdMiddleware } from './middleware/requestId';
import { securityHeadersMiddleware } from './middleware/securityHeaders';
import { globalPauseMiddleware } from './middleware/globalPause';
import { rateLimitMiddleware } from './middleware/rateLimit';
import { healthRouter } from './routes/health';
import { merchantsRouter } from './routes/merchants';
import { intentsRouter } from './routes/intents';
import { v1IntentsRouter } from './routes/v1Intents';
import { verifyRouter } from './routes/verify';
import { certificatesRouter } from './routes/certificates';
import { receiptRouter } from './routes/receipt';
import { webhooksRouter } from './routes/webhooks';
import { stripeWebhooksRouter } from './routes/stripeWebhooks';
import { stubsRouter } from './routes/stubs';
import { demoRouter } from './routes/demo';
import { passportRouter } from './routes/passport';
import { v1AgentsRouter } from './routes/v1Agents';
import { x402Router } from './routes/x402';
import { ap2Router } from './routes/ap2';
import { acpRouter } from './routes/acp';
import { marketplaceRouter } from './routes/marketplace';

import { scheduledHandler } from './cron';
import { SolanaListenerDO } from './durable-objects/SolanaListenerDO';

// Re-export Durable Object class — required by Cloudflare Workers module format.
export { SolanaListenerDO };

// ---------------------------------------------------------------------------
// Application
// ---------------------------------------------------------------------------

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

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
// 6. Rate limiting — per-IP sliding window (best-effort; Cloudflare zone-level
//    rules are the authoritative cap for production).
// ---------------------------------------------------------------------------

app.use('*', rateLimitMiddleware);

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// Health checks — mounted first; exempt from env validation above.
app.route('/', healthRouter);



// Merchant / account routes — /api/merchants/*
app.route('/api/merchants', merchantsRouter);

// Payment intent routes — /api/intents/*
app.route('/api/intents', intentsRouter);

// Agent-facing payment intents — /api/v1/payment-intents/*
app.route('/api/v1/payment-intents', v1IntentsRouter);

// Agent self-registration + agent-native payments — /api/v1/agents/*
app.route('/api/v1/agents', v1AgentsRouter);

// Protocol routes
app.route('/api/x402', x402Router);
app.route('/api/ap2', ap2Router);
app.route('/api/acp', acpRouter);

// Marketplace discovery — /api/marketplace/*
app.route('/api/marketplace', marketplaceRouter);

// Verify routes — /api/verify/:txHash
app.route('/api/verify', verifyRouter);

// Certificate routes — /api/certificates/*
app.route('/api/certificates', certificatesRouter);

// Receipt routes — /api/receipt/:intentId
app.route('/api/receipt', receiptRouter);

// AgentPassport — /api/passport/:agentId and /api/passport/rank/:agentId
app.route('/api/passport', passportRouter);

// Webhook subscription routes — /api/webhooks/*
app.route('/api/webhooks', webhooksRouter);

// Stripe webhook — /webhooks/stripe (raw body, no JSON parsing before signature check)
app.route('/webhooks/stripe', stripeWebhooksRouter);

// Stubs for non-migrated endpoints (returns 501 instead of 404)
app.route('/', stubsRouter);

// Demo routes — /api/demo/*
app.route('/api/demo', demoRouter);

// Solana listener admin — POST /api/_admin/solana-listener/start  (admin-key protected)
// This kicks the Durable Object to start its alarm chain.
// Also called by the 5-min cron to auto-restart if the chain breaks.
app.post('/api/_admin/solana-listener/start', async (c) => {
  const adminKey = c.req.header('x-admin-key') ?? c.req.header('X-Admin-Key');
  if (!adminKey || adminKey !== c.env.ADMIN_SECRET_KEY) {
    return c.json({ error: 'UNAUTHORIZED' }, 401);
  }
  const doId = c.env.SOLANA_LISTENER_DO.idFromName('main');
  const stub = c.env.SOLANA_LISTENER_DO.get(doId);
  const res = await stub.fetch(new Request('https://do-internal/start', { method: 'POST' }));
  const body = await res.json();
  return c.json({ success: true, ...body as object });
});

// Solana listener status — GET /api/_admin/solana-listener/status  (admin-key protected)
app.get('/api/_admin/solana-listener/status', async (c) => {
  const adminKey = c.req.header('x-admin-key') ?? c.req.header('X-Admin-Key');
  if (!adminKey || adminKey !== c.env.ADMIN_SECRET_KEY) {
    return c.json({ error: 'UNAUTHORIZED' }, 401);
  }
  const doId = c.env.SOLANA_LISTENER_DO.idFromName('main');
  const stub = c.env.SOLANA_LISTENER_DO.get(doId);
  const res = await stub.fetch(new Request('https://do-internal/status'));
  return c.json(await res.json());
});

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
// The module export format enables both the HTTP fetch handler (Hono app)
// and the Cron Trigger scheduled handler to be exported from the same file.
// ---------------------------------------------------------------------------

export default {
  fetch: app.fetch.bind(app),
  scheduled: scheduledHandler,
};
