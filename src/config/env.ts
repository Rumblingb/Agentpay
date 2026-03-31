/**
 * Canonical environment schema for the AgentPay backend.
 *
 * This module is the single source of truth for:
 *   - Which environment variables the backend reads
 *   - Their types, defaults, and required/optional status
 *   - Production startup validation (fail-fast on missing or insecure secrets)
 *
 * Usage: import { env } from './config/env.js';
 */

import dotenv from 'dotenv';

// Load .env (and .env.test for test runs) before parseEnv() reads process.env.
// This is required because env.ts is a static ESM import — the Node.js module
// loader evaluates it before the dotenv.config() call in server.ts body runs.
// dotenv.config() is idempotent: it skips vars already present in process.env,
// so calling it here and again in server.ts is safe.
dotenv.config();

// ---------------------------------------------------------------------------
// Schema types
// ---------------------------------------------------------------------------

export interface Env {
  // ── Server ─────────────────────────────────────────────────────────────
  NODE_ENV: 'development' | 'test' | 'production';
  PORT: number;
  LOG_LEVEL: string;

  // ── Database ────────────────────────────────────────────────────────────
  /** PostgreSQL connection string (pooled for runtime queries). */
  DATABASE_URL: string;
  /** Direct (non-pooled) PostgreSQL URL — required by Prisma Migrate. */
  DIRECT_URL: string | undefined;

  // ── Required secrets ────────────────────────────────────────────────────
  /** HMAC-SHA256 secret for signing outgoing webhook payloads. */
  WEBHOOK_SECRET: string;
  /** HMAC secret for AP2 payment receipt signatures and wallet encryption. */
  AGENTPAY_SIGNING_SECRET: string;
  /** HMAC secret for verification certificate signatures. */
  VERIFICATION_SECRET: string;
  /** Bearer token for admin API endpoints (x-admin-key header). */
  ADMIN_SECRET_KEY: string;

  // ── Solana ──────────────────────────────────────────────────────────────
  SOLANA_RPC_URL: string;
  /** Minimum on-chain confirmations before a payment is considered final. */
  CONFIRMATION_DEPTH: number;
  LISTENER_POLL_INTERVAL_MS: number;
  HELIUS_API_KEY: string | undefined;

  // ── Stripe (optional) ───────────────────────────────────────────────────
  STRIPE_SECRET_KEY: string | undefined;
  STRIPE_WEBHOOK_SECRET: string | undefined;
  /** Absolute URL to redirect to after a successful Stripe Checkout session. */
  STRIPE_SUCCESS_URL: string | undefined;
  /** Absolute URL to redirect to after a cancelled Stripe Checkout session. */
  STRIPE_CANCEL_URL: string | undefined;

  // ── URLs & CORS ─────────────────────────────────────────────────────────
  /** Comma-separated list of allowed CORS origins. */
  CORS_ORIGIN: string;
  /**
   * Public base URL of this API server.
   * Used when building absolute callback URLs (e.g. Stripe success/cancel).
   * Also referenced by protocol handlers (ACP, x402) to resolve their own
   * verification endpoints.
   */
  API_BASE_URL: string;
  /** Base URL of the merchant-facing dashboard (for post-payment redirects). */
  FRONTEND_URL: string;

  // ── Rate limiting ───────────────────────────────────────────────────────
  RATE_LIMIT_MAX_REQUESTS: number;

  // ── Feature flags ───────────────────────────────────────────────────────
  /** When true, accepts the bypass key `sk_test_sim`. Must be false in production. */
  AGENTPAY_TEST_MODE: boolean;
  /** Emergency circuit-breaker: set to true to halt all new payments immediately. */
  AGENTPAY_GLOBAL_PAUSE: boolean;
  /** Enable/disable the automatic liquidity rebalancing cron job. */
  LIQUIDITY_BOT_ENABLED: boolean;

  // ── Spending-policy defaults ────────────────────────────────────────────
  DEFAULT_AUTO_APPROVE_UNDER_CENTS: number;
  DEFAULT_DAILY_LIMIT_CENTS: number;
  DEFAULT_PER_TX_LIMIT_CENTS: number;
  DEFAULT_MIN_AGENT_RANK: number;
  WALLET_MAX_SEND_USDC: number;

  // ── Platform ────────────────────────────────────────────────────────────
  DEFAULT_PLATFORM_ID: string;

  // ── KYC / blocklists ────────────────────────────────────────────────────
  /** Comma-separated Solana wallet addresses to reject. */
  BLACKLISTED_WALLETS: string | undefined;
  /** Comma-separated IP prefixes (CIDR or prefix) to block. */
  BLACKLISTED_IP_PREFIXES: string | undefined;
  /** Comma-separated two-letter region codes treated as high-risk. */
  HIGH_RISK_REGIONS: string | undefined;

  // ── Optional integrations ────────────────────────────────────────────────
  SENTRY_DSN: string | undefined;
  OPENAI_API_KEY: string | undefined;
  DUFFEL_API_KEY: string | undefined;
  /** Base58-encoded private key for the on-chain IdentityVerifierAgent. */
  IDENTITY_VERIFIER_PRIVATE_KEY: string | undefined;
}

// ---------------------------------------------------------------------------
// Known insecure placeholder values that must never reach production
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
  // Admin secret must never be defaulted or weak in production
  ADMIN_SECRET_KEY: [
    'admin-dev-key',
    'change-me-in-production',
  ],
};

const MIN_SECRET_LENGTH = 32;

// ---------------------------------------------------------------------------
// Parse & validate
// ---------------------------------------------------------------------------

function parseEnv(): Env {
  const raw = process.env;
  const nodeEnv = (raw.NODE_ENV ?? 'development') as Env['NODE_ENV'];
  const isProduction = nodeEnv === 'production';
  const isTest = nodeEnv === 'test';

  // Production fast-fail checks
  if (isProduction) {
    const GEN_CMD =
      'node -e "console.log(import(\'crypto\').then(c=>c.randomBytes(32).toString(\'hex\')))"';

    for (const [key, insecureValues] of Object.entries(INSECURE_DEFAULTS)) {
      const val = raw[key];
      if (!val || insecureValues.includes(val) || val.length < MIN_SECRET_LENGTH) {
        console.error(
          `[STARTUP] FATAL: ${key} is missing, is a placeholder, or is shorter than ` +
            `${MIN_SECRET_LENGTH} characters. Refusing to start in production.\n` +
            `  Fix: generate a secure value → ${GEN_CMD}\n` +
            `  Then set ${key}=<generated_value> in your environment.`,
        );
        process.exit(1);
      }
    }

    if (!raw.DATABASE_URL) {
      console.error('[STARTUP] FATAL: DATABASE_URL is not set. Refusing to start in production.');
      process.exit(1);
    }

    if (raw.AGENTPAY_TEST_MODE === 'true') {
      console.error(
        '[STARTUP] FATAL: AGENTPAY_TEST_MODE=true in production. ' +
          'Set AGENTPAY_TEST_MODE=false or remove it from environment variables.',
      );
      process.exit(1);
    }
  } else if (!isTest) {
    // Development: warn but don't exit
    for (const [key, insecureValues] of Object.entries(INSECURE_DEFAULTS)) {
      const val = raw[key];
      if (!val || insecureValues.includes(val) || val.length < MIN_SECRET_LENGTH) {
        console.warn(
          `[STARTUP] WARNING: ${key} is missing, is a placeholder, or is too short. ` +
            `Set a strong secret (≥${MIN_SECRET_LENGTH} chars) before deploying to production. ` +
            `Run: npm run generate:secrets`,
        );
      }
    }
  }

  return {
    NODE_ENV: nodeEnv,
    PORT: parseInt(raw.PORT ?? '3001', 10),
    LOG_LEVEL: raw.LOG_LEVEL ?? 'info',

    DATABASE_URL: raw.DATABASE_URL ?? '',
    DIRECT_URL: raw.DIRECT_URL,

    WEBHOOK_SECRET: raw.WEBHOOK_SECRET ?? '',
    AGENTPAY_SIGNING_SECRET: raw.AGENTPAY_SIGNING_SECRET ?? '',
    VERIFICATION_SECRET: raw.VERIFICATION_SECRET ?? '',
    ADMIN_SECRET_KEY: raw.ADMIN_SECRET_KEY ?? '',

    SOLANA_RPC_URL: raw.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com',
    CONFIRMATION_DEPTH: parseInt(raw.CONFIRMATION_DEPTH ?? '2', 10),
    LISTENER_POLL_INTERVAL_MS: parseInt(raw.LISTENER_POLL_INTERVAL_MS ?? '5000', 10),
    HELIUS_API_KEY: raw.HELIUS_API_KEY,

    STRIPE_SECRET_KEY: raw.STRIPE_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET: raw.STRIPE_WEBHOOK_SECRET,
    STRIPE_SUCCESS_URL: raw.STRIPE_SUCCESS_URL,
    STRIPE_CANCEL_URL: raw.STRIPE_CANCEL_URL,

    CORS_ORIGIN: raw.CORS_ORIGIN ?? 'http://localhost:3000,http://localhost:3001',
    API_BASE_URL: raw.API_BASE_URL ?? `http://localhost:${raw.PORT ?? '3001'}`,
    FRONTEND_URL: raw.FRONTEND_URL ?? 'http://localhost:3000',

    RATE_LIMIT_MAX_REQUESTS: parseInt(raw.RATE_LIMIT_MAX_REQUESTS ?? '100', 10),

    AGENTPAY_TEST_MODE: raw.AGENTPAY_TEST_MODE === 'true',
    AGENTPAY_GLOBAL_PAUSE: raw.AGENTPAY_GLOBAL_PAUSE === 'true',
    LIQUIDITY_BOT_ENABLED: raw.LIQUIDITY_BOT_ENABLED !== 'false',

    DEFAULT_AUTO_APPROVE_UNDER_CENTS: parseInt(raw.DEFAULT_AUTO_APPROVE_UNDER_CENTS ?? '500', 10),
    DEFAULT_DAILY_LIMIT_CENTS: parseInt(raw.DEFAULT_DAILY_LIMIT_CENTS ?? '1000000', 10),
    DEFAULT_PER_TX_LIMIT_CENTS: parseInt(raw.DEFAULT_PER_TX_LIMIT_CENTS ?? '100000', 10),
    DEFAULT_MIN_AGENT_RANK: parseInt(raw.DEFAULT_MIN_AGENT_RANK ?? '0', 10),
    WALLET_MAX_SEND_USDC: parseFloat(raw.WALLET_MAX_SEND_USDC ?? '100000'),

    DEFAULT_PLATFORM_ID: raw.DEFAULT_PLATFORM_ID ?? 'default',

    BLACKLISTED_WALLETS: raw.BLACKLISTED_WALLETS,
    BLACKLISTED_IP_PREFIXES: raw.BLACKLISTED_IP_PREFIXES,
    HIGH_RISK_REGIONS: raw.HIGH_RISK_REGIONS,

    SENTRY_DSN: raw.SENTRY_DSN,
    OPENAI_API_KEY: raw.OPENAI_API_KEY,
    DUFFEL_API_KEY: raw.DUFFEL_API_KEY,
    IDENTITY_VERIFIER_PRIVATE_KEY: raw.IDENTITY_VERIFIER_PRIVATE_KEY,
  };
}

// Singleton — evaluated once at module load time (after dotenv.config()).
export const env: Env = parseEnv();
