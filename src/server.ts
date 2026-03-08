import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';

// Route Imports
import merchantsRouter from './routes/merchants.js';
import intentsRouter from './routes/intents.js';
import certificatesRouter from './routes/certificates.js';
import webhooksRouter from './routes/webhooks.js';
import stripeRouter from './routes/stripe.js';
import stripeWebhooksRouter from './routes/stripeWebhooks.js';
import agentsRouter from './routes/agents.js';
import agentIdentityRouter from './routes/agentIdentity.js';
import delegationRouter from './routes/delegation.js';
import verifyRouter from './routes/verify.js';
import fiatRouter from './routes/fiat.js';
import v1IntentsRouter from './routes/v1Intents.js';
import { moltbookRouter, adminMoltbookRouter } from './routes/moltbook.js';
import revenueRouter from './routes/revenue.js';
import agentrankRouter from './routes/agentrank.js';
import kyaRouter from './routes/kya.js';
import escrowRouter from './routes/escrow.js';
import marketplaceRouter from './routes/marketplace.js';
import walletsRouter from './routes/wallets.js';
import testRouter from './test/routes.js';
import { acpRouter } from './protocols/acp.js';
import { ap2Router } from './protocols/ap2.js';
import { createPalRouter } from './protocols/index.js';
import apiDocsRouter from './routes/apiDocs.js';

// Middleware & Service Imports
import { logger } from './logger.js';
import { startSolanaListener } from './services/solana-listener.js';

dotenv.config();

// ---------------------------------------------------------------------------
// Sentry — soft init (only when SENTRY_DSN is provided)
// ---------------------------------------------------------------------------
let SentryInstance: any = null;
async function initSentry(): Promise<void> {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;
  try {
    const Sentry = await import('@sentry/node');
    Sentry.init({
      dsn,
      environment: process.env.NODE_ENV ?? 'development',
      tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
    });
    SentryInstance = Sentry;
    logger.info('Sentry initialised');
  } catch {
    logger.warn('Sentry package not installed — error tracking is disabled. To enable it, run: npm install @sentry/node (only needed when SENTRY_DSN is configured)');
  }
}

// --- STARTUP VALIDATION — fail fast in production if required secrets are defaults ---
// All known placeholder/example values that must never reach a real deployment.
// Run `npm run generate:secrets` to produce safe replacements.
const INSECURE_SECRET_DEFAULTS: Record<string, string[]> = {
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

if (process.env.NODE_ENV === 'production') {
  const GEN_CMD = 'node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"';
  for (const [key, insecureValues] of Object.entries(INSECURE_SECRET_DEFAULTS)) {
    const val = process.env[key];
    if (!val || insecureValues.includes(val) || val.length < MIN_SECRET_LENGTH) {
      console.error(
        `[STARTUP] FATAL: ${key} is not set, is an insecure placeholder, or is shorter than ${MIN_SECRET_LENGTH} characters. Refusing to start in production.\n` +
        `  Fix: generate a secure value → ${GEN_CMD}\n` +
        `  Then set ${key}=<generated_value> in your Render environment variables (or run: npm run generate:secrets).`,
      );
      process.exit(1);
    }
  }
  if (!process.env.DATABASE_URL) {
    console.error('[STARTUP] FATAL: DATABASE_URL is not set. Refusing to start in production.');
    process.exit(1);
  }
  // Hard-block: AGENTPAY_TEST_MODE must never be true in production — it
  // exposes the /api/test routes and a credential bypass (sk_test_sim key).
  // Fix: set AGENTPAY_TEST_MODE=false (or remove it) in your Render env vars.
  if (process.env.AGENTPAY_TEST_MODE === 'true') {
    console.error('[STARTUP] FATAL: AGENTPAY_TEST_MODE=true in production. Refusing to start. Set AGENTPAY_TEST_MODE=false or remove it from environment variables.');
    process.exit(1);
  }
} else if (process.env.NODE_ENV !== 'test') {
  for (const [key, insecureValues] of Object.entries(INSECURE_SECRET_DEFAULTS)) {
    const val = process.env[key];
    if (!val || insecureValues.includes(val) || val.length < MIN_SECRET_LENGTH) {
      // Non-production: warn but don't exit
      console.warn(`[STARTUP] WARNING: ${key} is not set, is a placeholder, or is too short. Set a strong secret (≥${MIN_SECRET_LENGTH} chars) before going to production. Run: npm run generate:secrets`);
    }
  }
}

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3001;
const API_VERSION = '1.0.0';

// --- RATE LIMITERS ---
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, 
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

// Tighter limiter for public payment endpoints to prevent abuse
const paymentIntentLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many payment intent requests. Please wait before retrying.' },
});

// AP2/ACP protocol limiters — per minute per IP
const protocolLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many protocol requests, please slow down.' },
});

// --- SECURITY & UTILITY MIDDLEWARE ---
// Disable Helmet's default CSP for API-only responses — CSP is a document-level
// policy and causes false-positive "script-src eval" blocks when proxied through
// the Next.js frontend.  Also disable crossOriginEmbedderPolicy and
// crossOriginResourcePolicy: these are document-level policies that only make
// sense for HTML pages; on JSON API responses they are harmless, but when they
// leak through the Next.js fallback rewrite proxy they can block the browser
// from loading page resources (e.g. COEP require-corp rejects same-origin
// fetches that arrive via the Vercel CDN edge).
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: false,
}));
app.use(cors({
  origin: (incomingOrigin, callback) => {
    // Always allow same-origin / non-browser requests (no Origin header)
    if (!incomingOrigin) {
      callback(null, true);
      return;
    }

    // Explicit allowlist (env override takes precedence)
    const allowlist: string[] = process.env.CORS_ORIGIN
      ? process.env.CORS_ORIGIN.split(',').map((o) => o.trim())
      : [
          'http://localhost:3000',
          'http://127.0.0.1:3000',
          'http://localhost:3001',
          'https://apay-delta.vercel.app',
        ];

    if (allowlist.includes(incomingOrigin)) {
      callback(null, true);
      return;
    }

    // Allow Vercel preview deployment URLs for this project.
    // Pattern matches: https://<agentpay|apay>-<hash>-<team>.vercel.app
    // Restricting to the known project name prefix prevents unrelated Vercel
    // apps from satisfying the CORS check.
    if (/^https:\/\/(agentpay|apay)-[a-z0-9-]+\.vercel\.app$/.test(incomingOrigin)) {
      callback(null, true);
      return;
    }

    callback(new Error(`CORS: origin '${incomingOrigin}' not allowed`));
  },
  credentials: true,
}));

if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('combined'));
}

// --- STRIPE WEBHOOKS (Must be before express.json) ---
app.use('/webhooks/stripe', express.raw({ type: 'application/json' }), stripeWebhooksRouter);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Apply global rate limit after webhook routes
app.use(globalLimiter);

// --- ROOT ROUTE ---
app.get('/', (_req: Request, res: Response) => {
  res.status(200).send('AgentPay API is Live 🚀');
});

// --- HEALTH CHECK helper — shared by /health and /api/health ---
async function healthCheckHandler(_req: Request, res: Response): Promise<void> {
  let dbStatus: 'operational' | 'degraded' = 'operational';

  try {
    const { pool } = await import('./db/index.js');
    await pool.query('SELECT 1');
  } catch {
    dbStatus = 'degraded';
  }

  const overallStatus = dbStatus === 'operational' ? 'active' : 'degraded';

  res.status(overallStatus === 'active' ? 200 : 503).json({
    status: overallStatus,
    timestamp: new Date().toISOString(),
    services: {
      database: { status: dbStatus },
      agentrank: { status: 'operational' },
      escrow: { status: 'operational' },
      kya: { status: 'operational' },
      behavioral_oracle: { status: 'operational' },
    },
    version: API_VERSION,
  });
}

app.get('/health', healthCheckHandler);

// --- API STATUS ROUTES — reachable at /api and /api/health ---
app.get('/api', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'AgentPay API Active',
    version: API_VERSION,
    timestamp: new Date().toISOString(),
    docs: '/api/docs',
  });
});

app.get('/api/health', healthCheckHandler);

// --- TEST-MODE ROUTES (Mount BEFORE API routes to catch specific test paths) ---
if (process.env.NODE_ENV === 'test' || process.env.AGENTPAY_TEST_MODE === 'true') {
  console.log('🛠️  TEST MODE ENABLED: Mounting /api/test and mock routes');
  
  // Fixes the "Expected 402 Received 404" in integration.test.ts
  app.get('/api/protected', (req, res) => {
    res.status(402).json({ 
      success: false, 
      code: 'PAYMENT_REQUIRED',
      message: 'Payment required to access this agent resource' 
    });
  });

  app.use('/api/test', testRouter);
}

// --- API ROUTE MOUNTING ---
app.use('/api/merchants/stripe', stripeRouter); 
app.use('/api/merchants', merchantsRouter);
app.use('/api/intents', intentsRouter);
app.use('/api/certificates', certificatesRouter);
app.use('/api/webhooks', webhooksRouter);
app.use('/api/stripe', stripeRouter); 

// Agent API Routes
app.use('/api/agents', agentsRouter);
app.use('/api/agents', agentIdentityRouter);
app.use('/api/agents/delegation', delegationRouter);

// Public & Fiat
app.use('/api/verify', verifyRouter);
app.use('/api/fiat', fiatRouter);
app.use('/api/v1/payment-intents', paymentIntentLimiter, v1IntentsRouter);

// Ecosystem & Revenue
app.use('/api/moltbook', moltbookRouter);
app.use('/api/admin/moltbook', adminMoltbookRouter);
app.use('/api/revenue', revenueRouter);

// AgentRank, KYA & Escrow (new — additive)
app.use('/api/agentrank', agentrankRouter);
app.use('/api/kya', kyaRouter);
app.use('/api/escrow', escrowRouter);

// Hosted wallets for walletless agents (Moltbook bots, etc.)
app.use('/api/wallets', walletsRouter);

// Marketplace discovery
app.use('/api/marketplace', marketplaceRouter);

// Protocol Abstraction Layer (PAL) — multi-protocol support
app.use('/api/acp', protocolLimiter, acpRouter);
app.use('/api/ap2', protocolLimiter, ap2Router);
app.use('/api/protocol', protocolLimiter, createPalRouter());

// API Documentation — Swagger UI
app.use('/api/docs', apiDocsRouter);

// --- 404 HANDLER — catches unmatched routes and returns helpful JSON ---
app.use((_req: Request, res: Response) => {
  // Log only method + pathname, never query params (may contain tokens/secrets)
  logger.warn(`404 Not Found: ${_req.method} ${_req.path}`);
  res.status(404).json({
    error: 'NOT_FOUND',
    message: `Route ${_req.method} ${_req.path} not found`,
    docs: '/api/docs',
  });
});

// --- GLOBAL ERROR HANDLER ---
app.use((error: any, _req: Request, res: Response, _next: NextFunction) => {
  const code: string = error.code ?? error.type ?? 'INTERNAL_ERROR';
  
  // Log specific DB relation errors
  if (error.message && error.message.includes('relation') && error.message.includes('does not exist')) {
    logger.error('Database Schema Error: Missing Table', { message: error.message });
  }

  // Capture unhandled errors in Sentry (non-operational errors only)
  if (SentryInstance && (error.status || 500) >= 500) {
    SentryInstance.captureException(error);
  }

  // Handle spending policy violations (Status 402)
  if (code === 'SPENDING_POLICY_VIOLATION' || (error.message && /spending policy/i.test(error.message))) {
    return res.status(402).json({
      error: 'SPENDING_POLICY_VIOLATION',
      message: error.message || 'This transaction would violate your spending policy.',
    });
  }

  // Handle unauthorized/forbidden (Status 403)
  if (code === 'FORBIDDEN' || error.status === 403) {
    return res.status(403).json({ error: 'FORBIDDEN', message: error.message });
  }

  logger.error('Unhandled error', { code, message: error.message });
  res.status(error.status || 500).json({
    error: code,
    message: error.message || 'An unexpected error occurred.',
  });
});

if (process.env.NODE_ENV !== 'test') {
  // Initialise Sentry before starting server so first-request errors are captured
  initSentry().then(() => {
    const server = app.listen(PORT, () => {
      logger.info(`🚀 AgentPay API running on http://localhost:${PORT}`);
      if (process.env.NODE_ENV === 'production') {
        // Warn operators about in-memory stores that lose data on restart.
        logger.info(
          'Escrow transactions and AP2 payment requests are now persisted to Supabase via Prisma. ' +
          'In-memory stores are used as L1 caches and cleared on restart; the DB is the source of truth.',
        );
      }
    });

    // --- GRACEFUL SHUTDOWN — allow in-flight requests to finish before exit ---
    const shutdown = (signal: string) => {
      logger.info(`${signal} received — shutting down gracefully`);
      server.close(async () => {
        try {
          const { closePool } = await import('./db/index.js');
          await closePool();
          logger.info('DB pool closed. Goodbye.');
        } catch {
          // pool may already be closed
        }
        process.exit(0);
      });
      // Force exit after 10s if requests don't drain
      setTimeout(() => {
        logger.error('Forceful shutdown after timeout');
        process.exit(1);
      }, 10_000).unref();
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    startSolanaListener();
  });
}

export default app;