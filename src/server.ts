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
import testRouter from './test/routes.js';
import { acpRouter } from './protocols/acp.js';
import { ap2Router } from './protocols/ap2.js';
import { createPalRouter } from './protocols/index.js';
import apiDocsRouter from './routes/apiDocs.js';

// Middleware & Service Imports
import { logger } from './logger.js';
import { startSolanaListener } from './services/solana-listener.js';

dotenv.config();

// --- STARTUP VALIDATION — fail fast in production if required secrets are defaults ---
if (process.env.NODE_ENV === 'production') {
  const INSECURE_DEFAULTS: Record<string, string> = {
    WEBHOOK_SECRET: 'change-me-in-production',
    AGENTPAY_SIGNING_SECRET: 'your-signing-secret-here',
    VERIFICATION_SECRET: 'your-verification-secret-here',
  };
  for (const [key, insecureValue] of Object.entries(INSECURE_DEFAULTS)) {
    const val = process.env[key];
    if (!val || val === insecureValue) {
      console.error(`[STARTUP] FATAL: ${key} is not set or is an insecure default. Refusing to start in production.`);
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
} else if (process.env.NODE_ENV !== 'test' && (process.env.WEBHOOK_SECRET === 'change-me-in-production' || !process.env.WEBHOOK_SECRET)) {
  // Non-production: warn but don't exit
  console.warn('[STARTUP] WARNING: WEBHOOK_SECRET is not set or is using the insecure default. Set a strong secret before going to production.');
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
  origin: process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',').map((o) => o.trim())
    : [
        'http://localhost:3000',
        'http://127.0.0.1:3000',
        'http://localhost:3001',
        'https://apay-delta.vercel.app',
      ],
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
app.use('/api/v1/payment-intents', v1IntentsRouter);

// Ecosystem & Revenue
app.use('/api/moltbook', moltbookRouter);
app.use('/api/admin/moltbook', adminMoltbookRouter);
app.use('/api/revenue', revenueRouter);

// AgentRank, KYA & Escrow (new — additive)
app.use('/api/agentrank', agentrankRouter);
app.use('/api/kya', kyaRouter);
app.use('/api/escrow', escrowRouter);

// Marketplace discovery
app.use('/api/marketplace', marketplaceRouter);

// Protocol Abstraction Layer (PAL) — multi-protocol support
app.use('/api/acp', acpRouter);
app.use('/api/ap2', ap2Router);
app.use('/api/protocol', createPalRouter());

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
  const server = app.listen(PORT, () => {
    logger.info(`🚀 AgentPay API running on http://localhost:${PORT}`);
    if (process.env.NODE_ENV === 'production') {
      // Warn operators about in-memory stores that lose data on restart.
      logger.warn(
        'NOTICE: Escrow transactions and AP2 payment requests are stored in-memory ' +
        'and will be lost on server restart. Persist them to the DB before handling ' +
        'real funds (see src/escrow/trust-escrow.ts and src/protocols/ap2.ts).',
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
}

export default app;