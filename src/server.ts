import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';

// Route Imports
import merchantsRouter from './routes/merchants';
import intentsRouter from './routes/intents';
import certificatesRouter from './routes/certificates';
import webhooksRouter from './routes/webhooks';
import stripeRouter from './routes/stripe';
import stripeWebhooksRouter from './routes/stripeWebhooks';
import agentsRouter from './routes/agents';
import agentIdentityRouter from './routes/agentIdentity';
import delegationRouter from './routes/delegation';
import verifyRouter from './routes/verify';
import fiatRouter from './routes/fiat';
import v1IntentsRouter from './routes/v1Intents';
import { moltbookRouter, adminMoltbookRouter } from './routes/moltbook';
import revenueRouter from './routes/revenue';
import testRouter from './test/routes';

// Middleware & Service Imports
import { logger } from './logger';
import { startSolanaListener } from './services/solana-listener';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// --- RATE LIMITERS ---
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, 
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

// --- SECURITY & UTILITY MIDDLEWARE ---
app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',').map((o) => o.trim())
    : ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:3001'],
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

// --- HEALTH CHECK ---
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'active', timestamp: new Date().toISOString() });
});

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
  app.listen(PORT, () => {
    console.log(`🚀 AgentPay API running on http://localhost:${PORT}`);
  });
  startSolanaListener();
}

export default app;