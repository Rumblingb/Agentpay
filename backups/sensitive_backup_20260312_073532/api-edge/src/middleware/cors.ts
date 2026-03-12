/**
 * CORS middleware for the AgentPay Workers API.
 *
 * Mirrors the exact allowlist logic from src/server.ts:
 *   1. No Origin header (non-browser / same-origin) → always allow.
 *   2. Explicit allowlist from the CORS_ORIGIN binding (comma-separated).
 *   3. Vercel preview deployment URLs matching the known project prefix.
 *
 * Uses Hono's built-in cors() which also handles OPTIONS preflight automatically.
 * The origin function receives the Hono Context `c` so it can read c.env.CORS_ORIGIN
 * per-request (Workers bindings are per-invocation, not static).
 *
 * credentials: true is required for the dashboard's BFF cookie flow.
 */

import { cors } from 'hono/cors';
import type { Context } from 'hono';
import type { Env } from '../types';
import { parseCorsOrigins } from '../config/env';

// Vercel preview URL pattern — mirrors src/server.ts exactly.
// Matches: https://<agentpay|apay>-<hash>-<team>.vercel.app
const VERCEL_PREVIEW_PATTERN = /^https:\/\/(agentpay|apay)-[a-z0-9-]+\.vercel\.app$/;

/**
 * Determines whether `origin` is allowed, based on:
 *   - CORS_ORIGIN binding (comma-separated list)
 *   - Vercel preview URL pattern
 *
 * Returns the origin string to echo back (required for credentialed requests),
 * or undefined to deny the request.
 */
function resolveAllowedOrigin(
  origin: string,
  c: Context<{ Bindings: Env }>,
): string | undefined {
  // No origin header → non-browser request; allow unconditionally.
  if (!origin) return '*';

  const allowlist = parseCorsOrigins(c.env.CORS_ORIGIN);
  if (allowlist.includes(origin)) return origin;

  if (VERCEL_PREVIEW_PATTERN.test(origin)) return origin;

  return undefined;
}

export const corsMiddleware = cors({
  origin: (origin, c) =>
    resolveAllowedOrigin(origin, c as Context<{ Bindings: Env }>) ?? '',
  credentials: true,
  allowHeaders: ['Content-Type', 'Authorization', 'X-Api-Key', 'X-Request-Id'],
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  exposeHeaders: ['X-Request-Id'],
});
