/**
 * Workers-native environment validation for the AgentPay API.
 *
 * This module is the Cloudflare Workers equivalent of src/config/env.ts.
 *
 * Key differences from the Node.js version:
 *   - NO dotenv / NO process.env — Workers bindings arrive per-request via
 *     the second argument to fetch() (and Hono's c.env).
 *   - NO process.exit() — Workers cannot exit; invalid env throws an error
 *     that Hono's global error handler converts to a safe HTTP 500.
 *   - NO PORT / LOG_LEVEL — not applicable to Workers.
 *   - NO Solana daemon vars — Solana listener is deferred (stays on Render).
 *   - NO DIRECT_URL — no Prisma migrations run inside Workers.
 *
 * Parallel to src/config/env.ts:
 *   - Same secret names (WEBHOOK_SECRET, AGENTPAY_SIGNING_SECRET, etc.)
 *   - Same insecure-placeholder blocklist
 *   - Same MIN_SECRET_LENGTH = 32 enforcement
 *   - Same "warn in dev, hard-fail in prod" philosophy — adapted for Workers
 *     by throwing instead of exiting
 *
 * Usage:
 *   import { validateEnv, parseCorsOrigins } from './config/env';
 *   // in a Hono global middleware:
 *   app.use('*', (c, next) => { validateEnv(c.env); return next(); });
 */

import type { Env } from '../types';

// ---------------------------------------------------------------------------
// Known insecure placeholder values — mirrors src/config/env.ts exactly
// ---------------------------------------------------------------------------

const INSECURE_DEFAULTS: Record<string, string[]> = {
  WEBHOOK_SECRET: [
    'change-me-in-production',
    'your-webhook-secret-here',
    'REPLACE_WITH_STRONG_RANDOM_SECRET',
  ],
  AGENTPAY_SIGNING_SECRET: [
    'your-signing-secret-here',
    'REPLACE_WITH_STRONG_RANDOM_SECRET',
  ],
  VERIFICATION_SECRET: [
    'your-verification-secret-here',
    'REPLACE_WITH_STRONG_RANDOM_SECRET',
  ],
};

const MIN_SECRET_LENGTH = 32;

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

export class EnvValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EnvValidationError';
  }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validates the Workers env bindings for every required secret.
 *
 * Called from the Hono global middleware so validation runs once per
 * incoming request (Workers have no persistent startup hook).
 *
 * Throws EnvValidationError on failure.  The global error handler in
 * index.ts catches this and returns a production-safe HTTP 500 that
 * does NOT leak secret names or values to the caller.
 *
 * @param env  Hono's c.env — the Workers Bindings object
 */
export function validateEnv(env: Env): void {
  // DATABASE_URL is always required
  if (!env.DATABASE_URL) {
    throw new EnvValidationError('DATABASE_URL is not configured');
  }

  // Required HMAC secrets — same rules as src/config/env.ts
  for (const [key, insecureValues] of Object.entries(INSECURE_DEFAULTS)) {
    const val = env[key as keyof Env] as string | undefined;
    if (!val || insecureValues.includes(val) || val.length < MIN_SECRET_LENGTH) {
      throw new EnvValidationError(
        `${key} is missing, is a placeholder, or is shorter than ${MIN_SECRET_LENGTH} characters`,
      );
    }
  }

  // Production safety invariant — mirrors src/config/env.ts line ~166.
  // If NODE_ENV is "production" (set in Cloudflare dashboard [vars]), reject any
  // deployment that still has AGENTPAY_TEST_MODE=true.  This preserves the
  // fail-closed behavior of the original Express backend, preventing an
  // accidental beta cutover with the test-key bypass open.
  if (env.NODE_ENV === 'production' && env.AGENTPAY_TEST_MODE === 'true') {
    throw new EnvValidationError(
      '[FATAL] AGENTPAY_TEST_MODE=true is not allowed in production. ' +
        'Remove AGENTPAY_TEST_MODE from the Workers dashboard variables or set it to false.',
    );
  }
}

// ---------------------------------------------------------------------------
// Helpers consumed by route handlers
// ---------------------------------------------------------------------------

/**
 * Parses the CORS_ORIGIN binding into a trimmed, non-empty string array.
 *
 * Mirrors the CORS allowlist logic in src/server.ts (split on comma, trim).
 * Consumers of this function should also check the Vercel preview URL
 * pattern — see corsMiddleware in middleware/cors.ts (Phase 5).
 */
export function parseCorsOrigins(corsOrigin: string): string[] {
  return corsOrigin
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
}

/**
 * Returns true when the AGENTPAY_GLOBAL_PAUSE binding is the string "true".
 *
 * Workers bindings are always strings (from [vars] in wrangler.toml or
 * wrangler secret put).  This helper centralises the string→boolean coercion
 * and matches the behaviour of `process.env.AGENTPAY_GLOBAL_PAUSE === 'true'`
 * in the Express backend.
 */
export function isGlobalPause(env: Env): boolean {
  return (env as unknown as Record<string, string>)['AGENTPAY_GLOBAL_PAUSE'] === 'true';
}
