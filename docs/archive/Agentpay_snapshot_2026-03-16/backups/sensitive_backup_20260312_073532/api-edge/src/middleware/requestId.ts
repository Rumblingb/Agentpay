/**
 * Request ID middleware.
 *
 * Mirrors src/middleware/logging.ts request-ID behaviour:
 *   - Reads x-request-id from incoming headers if present (forwarded by Vercel).
 *   - Otherwise generates a new UUID via the Web Crypto API (no Node.js needed).
 *   - Echoes the ID back in the x-request-id response header for tracing.
 *   - Logs method, path, status, and duration as structured JSON to the
 *     Cloudflare Workers tail log (console.log — no pino/morgan in Workers).
 *
 * pino is not used because it relies on Node.js streams.
 * console.log in Cloudflare Workers goes to the Workers tail log viewer.
 */

import type { Context, Next } from 'hono';
import type { Env } from '../types';

export async function requestIdMiddleware(
  c: Context<{ Bindings: Env }>,
  next: Next,
): Promise<void | Response> {
  const start = Date.now();

  // Prefer the upstream request ID (from Vercel BFF or Cloudflare edge) so
  // traces are correlated across the full Vercel → Workers hop.
  const requestId =
    c.req.header('x-request-id') ?? crypto.randomUUID();

  c.header('x-request-id', requestId);

  await next();

  const durationMs = Date.now() - start;
  const status = c.res.status;
  const level = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info';

  // Structured log — visible in `wrangler tail` and the Cloudflare dashboard.
  // Never log query strings: they may contain tokens or API keys.
  console[level](
    JSON.stringify({
      type: 'http',
      requestId,
      method: c.req.method,
      path: c.req.path,
      status,
      durationMs,
    }),
  );
}
