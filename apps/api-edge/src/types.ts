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
  DATABASE_URL?: string;

  /**
   * Cloudflare Hyperdrive binding.
   * Exposes a `.connectionString` property that replaces DATABASE_URL
   * once Hyperdrive is configured in the Cloudflare dashboard.
   * Uncomment the [[hyperdrive]] block in wrangler.toml to enable.
   */
  HYPERDRIVE?: { connectionString?: string };

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

  // ── Razorpay (India UPI) ──────────────────────────────────────────────────
  /** Razorpay API key ID — enables UPI payment links for India. */
  RAZORPAY_KEY_ID?: string;
  /** Razorpay API key secret — required with RAZORPAY_KEY_ID. */
  RAZORPAY_KEY_SECRET?: string;
  /** Razorpay webhook secret — for verifying /webhooks/razorpay. */
  RAZORPAY_WEBHOOK_SECRET?: string;

  /** Airwallex client ID — enables Airwallex payment intent flows. */
  AIRWALLEX_CLIENT_ID?: string;
  /** Airwallex API key secret — paired with AIRWALLEX_CLIENT_ID. */
  AIRWALLEX_API_KEY?: string;
  /** Set to "true" to target the Airwallex demo environment. */
  AIRWALLEX_SANDBOX?: string;
  /** Airwallex webhook signing secret — for verifying /webhooks/airwallex. */
  AIRWALLEX_WEBHOOK_SECRET?: string;

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

  // ── Email ─────────────────────────────────────────────────────────────────
  /** Resend API key — enables booking confirmation emails from mock agents. */
  RESEND_API_KEY?: string;
  /** Admin email for manual fulfillment alerts — receives a copy of every booking request. */
  ADMIN_EMAIL?: string;

  // ── Google Maps (server key — IP-restricted, never ship in app) ──────────
  /**
   * Google Maps server API key — Powers Places (New), Routes, Geocoding web services.
   * Must be IP-restricted in Cloud Console to Workers egress IPs.
   * NEVER use this key in the mobile app — use separate iOS/Android keys restricted by bundle ID.
   * Enable: Places API (New), Routes API, Geocoding API.
   * npx wrangler secret put GOOGLE_MAPS_API_KEY
   */
  GOOGLE_MAPS_API_KEY?: string;

  // ── Events & Experiences ──────────────────────────────────────────────────
  /**
   * Ticketmaster Discovery API v2 key — 5k req/day free tier, self-serve.
   * Register at: https://developer.ticketmaster.com/
   * npx wrangler secret put TICKETMASTER_API_KEY
   */
  TICKETMASTER_API_KEY?: string;
  /**
   * OpenTable API key — restaurant search and availability.
   * Requires commercial partnership: opentable.com/partners
   * npx wrangler secret put OPENTABLE_API_KEY
   */
  OPENTABLE_API_KEY?: string;
  /**
   * GetYourGuide API key — experiences and activity booking.
   * Requires partnership: partner.getyourguide.com
   * npx wrangler secret put GETYOURGUIDE_API_KEY
   */
  GETYOURGUIDE_API_KEY?: string;
  /**
   * Duffel API key — flights search and booking, 350+ airlines.
   * Test key prefix: duffel_test_  Production prefix: duffel_live_
   * npx wrangler secret put DUFFEL_API_KEY
   */
  DUFFEL_API_KEY?: string;
  /**
   * Aviationstack flight status API — gate changes, delays, cancellations for booked flights.
   * Free: 500 req/mo.  Paid: $9.99/mo (10,000 req).
   * npx wrangler secret put AVIATIONSTACK_API_KEY
   */
  AVIATIONSTACK_API_KEY?: string;

  /**
   * Perplexity Sonar — real-time web search for travel intel.
   * Used for: opening hours, travel advisories, baggage policies, local conditions.
   * Pricing: $5/1M tokens (sonar), $8/1M (sonar-pro).
   * npx wrangler secret put PERPLEXITY_API_KEY
   */
  PERPLEXITY_API_KEY?: string;

  // ── AI ────────────────────────────────────────────────────────────────────
  /** Cloudflare Workers AI binding — used for in-process Whisper STT (no external fetch). */
  AI?: Ai;
  /** Anthropic API key — powers the Bro concierge brain. */
  ANTHROPIC_API_KEY?: string;
  /** OpenAI API key — Whisper STT fallback if CF Workers AI is unavailable. */
  OPENAI_API_KEY?: string;
  /** ElevenLabs API key — premium server-side TTS for Ace voice replies. */
  ELEVENLABS_API_KEY?: string;
  /** Google Gemini API key — opt-in paid tier for high-volume extraction. Get at aistudio.google.com. Enable billing to remove RPD limits. */
  GEMINI_API_KEY?: string;
  /** Firecrawl API key — enables markdown scraping for operators without first-party APIs. */
  FIRECRAWL_API_KEY?: string;

  // ── OpenClaw (automated fulfillment) ──────────────────────────────────────
  /** OpenClaw API base URL — e.g. https://api.openclaw.io */
  OPENCLAW_API_URL?: string;
  /** OpenClaw API key — authenticates fulfillment dispatch requests. npx wrangler secret put OPENCLAW_API_KEY */
  OPENCLAW_API_KEY?: string;

  // ── Bro app client auth ───────────────────────────────────────────────────
  /**
   * Static key sent by the Bro app in `x-bro-key` header.
   * If set, /api/concierge/intent rejects requests without this header.
   * Set via: npx wrangler secret put BRO_CLIENT_KEY
   * Add to EAS build env as: EXPO_PUBLIC_BRO_KEY
   */
  BRO_CLIENT_KEY?: string;

  // ── Darwin (National Rail OpenLDBWS — UK) ────────────────────────────────
  /**
   * Darwin API token — live UK train departure boards.
   * Register at: https://realtime.nationalrail.co.uk/OpenLDBWS/
   * Set via: npx wrangler secret put DARWIN_API_KEY
   */
  DARWIN_API_KEY?: string;

  // ── Indian Railways (RapidAPI IRCTC) ──────────────────────────────────────
  /**
   * RapidAPI key — enables live Indian rail schedule data.
   * Register at rapidapi.com, subscribe to the IRCTC API (free tier available).
   * npx wrangler secret put RAPIDAPI_KEY
   */
  RAPIDAPI_KEY?: string;

  // ── EU Rail aggregators ───────────────────────────────────────────────────
  /**
   * Rail Europe API key — live EU train booking (200+ European operators).
   * Requires partnership: agent.raileurope.com
   * npx wrangler secret put RAIL_EUROPE_API_KEY
   */
  RAIL_EUROPE_API_KEY?: string;

  /**
   * Trainline Partner API key — 270 carriers across 45 countries (UK + EU).
   * Requires commercial partnership: thetrainline.com/solutions/api
   * npx wrangler secret put TRAINLINE_API_KEY
   */
  TRAINLINE_API_KEY?: string;

  /**
   * Distribusion API key — 40+ rail carriers, OSDM-compatible.
   * Requires partnership: distribusion.com
   * npx wrangler secret put DISTRIBUSION_API_KEY
   */
  DISTRIBUSION_API_KEY?: string;

  // ── Global bus aggregators ────────────────────────────────────────────────
  /**
   * Busbud API key — 4,500+ bus carriers, 2.5M+ routes, 80+ countries.
   * Best global intercity bus API. partner-assets.busbud.com/partner/busbud-api/
   * npx wrangler secret put BUSBUD_API_KEY
   */
  BUSBUD_API_KEY?: string;

  /**
   * FlixBus API key — Europe + US + LatAm intercity buses.
   * Requires partner agreement: flixbus.com/company/partners/affiliate-partners
   * npx wrangler secret put FLIXBUS_API_KEY
   */
  FLIXBUS_API_KEY?: string;

  /**
   * redBus API key — India + SE Asia + LatAm bus booking.
   * Requires commercial partnership: partner.redbus.com
   * npx wrangler secret put REDBUS_API_KEY
   */
  REDBUS_API_KEY?: string;

  // ── Rail outside EU/India ─────────────────────────────────────────────────
  /**
   * G2Rail API key — Japan, China, South Korea, USA, Canada + European rail.
   * Best single API for Asia + North America rail. g2rail.com/help/
   * npx wrangler secret put G2RAIL_API_KEY
   */
  G2RAIL_API_KEY?: string;

  /**
   * SilverRail API key — Amtrak + VIA Rail Canada (North American rail).
   * B2B distribution layer. silverrailtech.com
   * npx wrangler secret put SILVERRAIL_API_KEY
   */
  SILVERRAIL_API_KEY?: string;

  /**
   * 12Go API key — SE Asia multimodal: trains, buses, ferries, vans.
   * Self-serve + data feed available. agent.12go.asia/
   * npx wrangler secret put TWELVEGO_API_KEY
   */
  TWELVEGO_API_KEY?: string;

  // ── Apple Wallet pass generation ─────────────────────────────────────────
  /** 10-char Apple Developer team ID — e.g. "ABCDE12345". npx wrangler secret put APPLE_PASS_TEAM_ID */
  APPLE_PASS_TEAM_ID?: string;
  /** Pass Type Identifier — e.g. "pass.so.agentpay.ace". Register at developer.apple.com/account/resources/identifiers. npx wrangler secret put APPLE_PASS_TYPE_ID */
  APPLE_PASS_TYPE_ID?: string;
  /** Pass Type Certificate PEM (no bag attributes). Export from Keychain after creating in Apple Developer portal. npx wrangler secret put APPLE_PASS_CERT_PEM */
  APPLE_PASS_CERT_PEM?: string;
  /** Private key PEM (PKCS8) matching the pass certificate. npx wrangler secret put APPLE_PASS_KEY_PEM */
  APPLE_PASS_KEY_PEM?: string;
  /** Apple WWDR G4 intermediate certificate PEM. Download from https://www.apple.com/certificateauthority/. npx wrangler secret put APPLE_PASS_WWDR_PEM */
  APPLE_PASS_WWDR_PEM?: string;

  // ── Operations (Make.com fulfillment sheet) ───────────────────────────────
  /**
   * Make.com webhook URL — every confirmed booking POSTs here.
   * Make.com creates a Google Sheet row (PENDING) for manual fulfilment.
   * npx wrangler secret put MAKECOM_WEBHOOK_URL
   */
  MAKECOM_WEBHOOK_URL?: string;

  // ── WhatsApp (Twilio) ─────────────────────────────────────────────────────
  /** Twilio Account SID — enables WhatsApp notifications. */
  TWILIO_ACCOUNT_SID?: string;
  /** Twilio Auth Token — paired with TWILIO_ACCOUNT_SID. */
  TWILIO_AUTH_TOKEN?: string;
  /**
   * Twilio WhatsApp sender number — must start with "whatsapp:+".
   * Sandbox: "whatsapp:+14155238886"
   * Production: your verified business number.
   */
  TWILIO_WHATSAPP_FROM?: string;
  /**
   * Your personal WhatsApp number for admin booking alerts.
   * Format: +447700900123 (no spaces, international format).
   * npx wrangler secret put ADMIN_WHATSAPP_NUMBER
   */
  ADMIN_WHATSAPP_NUMBER?: string;
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
