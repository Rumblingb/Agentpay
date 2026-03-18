/**
 * Cloudflare Workers environment bindings for the AgentPay API.
 *
 * This interface is the single source of truth for every secret and variable
 * that the Workers runtime provides via the second argument to the `fetch`
 * handler (and via Hono's `c.env`).
 *
 * ─── How secrets/vars reach this type ────────────────────────────────────
 * Secrets:   `wrangler secret put <NAME>`  (or .dev.vars for local dev)
 * Variables: [vars] block in wrangler.toml (non-sensitive only)
 * Hyperdrive: [[hyperdrive]] binding becomes `env.HYPERDRIVE`
 *
 * Keep this in sync with wrangler.toml [vars] and .dev.vars.example.
 * ──────────────────────────────────────────────────────────────────────────
 */

export interface Env {
  // ── Database ─────────────────────────────────────────────────────────────
  /**
   * PostgreSQL Direct connection string (Supabase port 5432, NOT the pooled
   * PgBouncer URL on port 6543).
   *
   * Use the Direct URL here because:
   *   - Without Hyperdrive: Workers connect directly to Supabase; using the
   *     pooled URL wastes a PgBouncer slot per Worker invocation.
   *   - With Hyperdrive: This secret is not used at runtime — Hyperdrive
   *     provides its own connection string.  When creating the Hyperdrive
   *     config in the Cloudflare dashboard, also supply the Direct URL
   *     (port 5432) as the Hyperdrive source URL to avoid double-pooling.
   *
   * Always a secret — never put this value in wrangler.toml.
   */
  DATABASE_URL: string;

  /**
   * Cloudflare Hyperdrive binding.
   * Exposes a `.connectionString` property that replaces DATABASE_URL
   * once Hyperdrive is configured in the Cloudflare dashboard.
   * Uncomment the [[hyperdrive]] block in wrangler.toml to enable.
   */
  // HYPERDRIVE: Hyperdrive;

  // ── Required secrets ──────────────────────────────────────────────────────
  /** HMAC-SHA256 secret for signing outgoing webhook payloads (≥32 chars). */
  WEBHOOK_SECRET: string;
  /** HMAC secret for AP2 payment receipt signatures and wallet encryption (≥32 chars). */
  AGENTPAY_SIGNING_SECRET: string;
  /** HMAC secret for verification certificate signatures (≥32 chars). */
  VERIFICATION_SECRET: string;
  /** Bearer token for admin API endpoints (x-admin-key header). */
  ADMIN_SECRET_KEY: string;

  // ── Stripe (optional) ────────────────────────────────────────────────────
  /** Stripe secret key — set to enable Stripe routes. */
  STRIPE_SECRET_KEY?: string;
  /** Stripe webhook signing secret — required for /webhooks/stripe. */
  STRIPE_WEBHOOK_SECRET?: string;
  /** Absolute URL to redirect after a successful Stripe Checkout session. */
  STRIPE_SUCCESS_URL?: string;
  /** Absolute URL to redirect after a cancelled Stripe Checkout session. */
  STRIPE_CANCEL_URL?: string;

  // ── URLs & CORS ───────────────────────────────────────────────────────────
  /**
   * Comma-separated list of allowed CORS origins.
   * Non-sensitive — lives in wrangler.toml [vars].
   * e.g. "https://apay-delta.vercel.app,https://dashboard.agentpay.gg"
   */
  CORS_ORIGIN: string;
  /**
   * Public base URL of this Workers deployment.
   * Used when building absolute callback URLs (Stripe, protocol handlers).
   * Non-sensitive — lives in wrangler.toml [vars].
   */
  API_BASE_URL: string;
  /** Merchant-facing dashboard URL (post-payment redirects). */
  FRONTEND_URL: string;

  // ── Runtime environment ───────────────────────────────────────────────────
  /**
   * Runtime environment name.
   * Set to "production" in the Cloudflare Workers dashboard [vars].
   * Defaults to "development" in wrangler.toml for local dev.
   * Used to enforce production safety invariants (e.g. block test-mode bypass).
   */
  NODE_ENV?: string;

  /**
   * When "true", activates the test-key bypass in auth middleware.
   * MUST be absent or "false" in production — enforced by validateEnv().
   * Mirrors the Node.js backend's AGENTPAY_TEST_MODE check in src/config/env.ts.
   */
  AGENTPAY_TEST_MODE?: string;

  /**
   * When "true", all non-GET, non-health requests are rejected with 503.
   * Emergency circuit-breaker — set in Cloudflare dashboard.
   */
  AGENTPAY_GLOBAL_PAUSE?: string;

  // ── Platform fee configuration ────────────────────────────────────────────
  /**
   * Platform treasury wallet address (Solana).
   * Fee transfers go here. Set via `wrangler secret put PLATFORM_TREASURY_WALLET`.
   * Value: 3gnAvryBAuZXCoY95mjwQYud4ep3J8f4KH6ZUPuQnajd
   */
  PLATFORM_TREASURY_WALLET?: string;

  /**
   * Platform fee in basis points (100 bps = 1%).
   * Default: 50 (0.5%). Set in wrangler.toml [vars] or dashboard.
   */
  PLATFORM_FEE_BPS?: string;

  // ── Durable Objects ───────────────────────────────────────────────────────
  /** Singleton Solana listener DO — replaces Render listener. */
  SOLANA_LISTENER_DO: DurableObjectNamespace;

  // ── Solana / hosted payer ─────────────────────────────────────────────────
  /** Solana RPC endpoint URL (mainnet). Used by cron reconciler and Solana listener DO. */
  SOLANA_RPC_URL?: string;

  /** Base mainnet JSON-RPC URL. Used by /api/verify?chain=base. Default: public node. */
  BASE_RPC_URL?: string;

  /** Ethereum mainnet JSON-RPC URL. Used by /api/verify?chain=ethereum. Default: public node. */
  ETHEREUM_RPC_URL?: string;

  /** Hosted payer agent ID — the platform-controlled wallet agent. */
  HOSTED_PAYER_AGENT_ID?: string;

  /** Low USDC balance threshold in dollars — triggers an alert log. Default: 5. */
  LOW_BALANCE_ALERT_THRESHOLD_USDC?: string;
}

// ---------------------------------------------------------------------------
// Hono Context Variables
//
// These are typed values attached to the request context by middleware and
// consumed by route handlers via c.get('merchant').
//
// Usage in routes:
//   const merchant = c.get('merchant');
// ---------------------------------------------------------------------------

/** Authenticated merchant — set by authenticateApiKey middleware. */
export interface MerchantContext {
  id: string;
  name: string;
  email: string;
  walletAddress: string;
  webhookUrl: string | null;
}

/** Hono Variables type — passed as the second generic to Hono<{...}>. */
export interface Variables {
  merchant: MerchantContext;
}

