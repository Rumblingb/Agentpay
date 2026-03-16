/**
 * Global pause (circuit-breaker) middleware.
 *
 * Mirrors the AGENTPAY_GLOBAL_PAUSE check in src/middleware/spendingPolicy.ts.
 *
 * When the AGENTPAY_GLOBAL_PAUSE Workers variable is set to "true", ALL
 * payment-mutating requests are rejected with 503 immediately.  Health checks
 * and read-only GET routes are NOT paused so monitoring continues to work.
 *
 * To activate: set AGENTPAY_GLOBAL_PAUSE=true via wrangler secret put or in
 *              the Cloudflare Workers dashboard → Variables.
 * To deactivate: remove the variable or set it to anything other than "true".
 *
 * This is an emergency circuit-breaker for production incidents.  It does not
 * require a new deployment — the variable change takes effect on the next
 * request.
 */

import type { Context, Next } from 'hono';
import type { Env } from '../types';
import { isGlobalPause } from '../config/env';

// Routes excluded from the global pause (health checks and read-only probes).
const PAUSE_EXEMPT_PATHS = new Set(['/health', '/api/health', '/api']);

export async function globalPauseMiddleware(
  c: Context<{ Bindings: Env }>,
  next: Next,
): Promise<void | Response> {
  if (
    !PAUSE_EXEMPT_PATHS.has(c.req.path) &&
    c.req.method !== 'GET' &&
    isGlobalPause(c.env)
  ) {
    return c.json(
      {
        error: 'SERVICE_PAUSED',
        message: 'Service temporarily paused for security. Please try again shortly.',
      },
      503,
    );
  }
  await next();
}
