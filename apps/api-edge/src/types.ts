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
   * PostgreSQL connection string (Supabase pooled endpoint).
   * In production this is the Hyperdrive connection string once Hyperdrive
   * is configured; for the initial pass it is the direct Supabase URL.
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
}
