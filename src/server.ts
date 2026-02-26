import express, { Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import merchantsRouter from './routes/merchants';
import intentsRouter from './routes/intents';
import certificatesRouter from './routes/certificates';
import webhooksRouter from './routes/webhooks';
import stripeRouter from './routes/stripe';
import stripeWebhooksRouter from './routes/stripeWebhooks';
import agentsRouter from './routes/agents';
import v1IntentsRouter from './routes/v1Intents';
import testRouter from './test/routes';
import { authenticateApiKey } from './middleware/auth';
import * as auditService from './services/audit';
import * as transactionsService from './services/transactions';
import { startSolanaListener } from './services/solana-listener';
import {
  verifyPaymentRecipient,
  isValidSolanaAddress,
} from './security/payment-verification';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// --- RATE LIMITERS ---
const globalLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10), // 15 min
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

const verifyLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 min
  max: 20,
  message: { error: 'Too many verification requests, please slow down.' },
});

// Security & utility middleware
app.use(helmet());
app.use(cors({
  // Read from CORS_ORIGIN env var; fall back to the default local dashboard URL
  origin: process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',').map((o) => o.trim())
    : ['http://localhost:3000', 'http://127.0.0.1:3000'],
  credentials: true,
}));
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('combined'));
}

// --- STRIPE WEBHOOKS (must use raw body BEFORE express.json()) ---
app.use('/webhooks/stripe', express.raw({ type: 'application/json' }), stripeWebhooksRouter);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(globalLimiter);

// --- HEALTH CHECK ---
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'active', timestamp: new Date().toISOString() });
});

// --- MERCHANT API ROUTES ---
app.use('/api/merchants', merchantsRouter);

// --- ORCHESTRATION LAYER: PAYMENT INTENTS ---
app.use('/api/intents', intentsRouter);

// --- ORCHESTRATION LAYER: VERIFICATION CERTIFICATES ---
app.use('/api/certificates', certificatesRouter);

// --- WEBHOOK SUBSCRIPTION ROUTES ---
app.use('/api/webhooks', webhooksRouter);

// --- STRIPE CONNECT ROUTES ---
app.use('/api/stripe', stripeRouter);

// --- AGENT API ROUTES ---
app.use('/api/agents', agentsRouter);

// --- AGENT-FACING PAYMENT INTENTS (v1 API) ---
app.use('/api/v1/payment-intents', v1IntentsRouter);

// --- TEST-MODE ROUTES (NODE_ENV=test + AGENTPAY_TEST_MODE=true only) ---
if (process.env.NODE_ENV === 'test' && process.env.AGENTPAY_TEST_MODE === 'true') {
  app.use('/api/test', testRouter);
}

// --- HTTP 402 PAYMENT REQUIRED (protected resource demo) ---
app.get('/api/protected', (_req: Request, res: Response) => {
  res.status(402).json({
    code: 'PAYMENT_REQUIRED',
    message: 'Payment required to access this resource',
    paymentDetails: {
      amount: 0.01,
      currency: 'USDC',
      network: 'solana',
    },
  });
});

// --- STANDALONE PAYMENT VERIFICATION (agent-to-agent) ---
app.post('/api/v1/verify-payment', verifyLimiter, authenticateApiKey, async (req: Request, res: Response) => {
  const merchant = (req as any).merchant;
  const ipAddress = req.ip ?? req.socket.remoteAddress ?? null;
  const { transactionSignature, expectedRecipient } = req.body;

  if (!transactionSignature || !expectedRecipient) {
    res.status(400).json({ error: 'Missing required parameters' });
    return;
  }

  if (!isValidSolanaAddress(expectedRecipient)) {
    res.status(400).json({ error: 'Invalid recipient address format' });
    return;
  }

  try {
    const result = await verifyPaymentRecipient(transactionSignature, expectedRecipient);

    // Audit every attempt
    await auditService.logVerifyAttempt({
      merchantId: merchant?.id ?? null,
      ipAddress,
      transactionSignature,
      transactionId: null,
      endpoint: '/api/v1/verify-payment',
      method: 'POST',
      succeeded: result.valid,
      failureReason: result.valid ? null : result.error ?? null,
    });

    if (result.valid) {
      res.json({ success: true, data: result });
    } else {
      res.status(402).json({ success: false, error: result.error });
    }
  } catch (error) {
    await auditService.logVerifyAttempt({
      merchantId: merchant?.id ?? null,
      ipAddress,
      transactionSignature,
      transactionId: null,
      endpoint: '/api/v1/verify-payment',
      method: 'POST',
      succeeded: false,
      failureReason: error instanceof Error ? error.message : String(error),
    });
    console.error('Verification Error:', error);
    res.status(500).json({ error: 'Internal Server Error during verification' });
  }
});

// --- CONVENIENCE /api/payments ENDPOINT ---
// Accepts snake_case fields (amount_usdc, recipient_address, description)
// so AI agents can use the simpler URL and payload format shown in the docs.
app.post('/api/payments', authenticateApiKey, async (req: Request, res: Response) => {
  const merchant = (req as any).merchant!;

  // Accept both camelCase and snake_case field names
  const amountUsdc: number = req.body.amount_usdc ?? req.body.amountUsdc;
  const recipientAddress: string = req.body.recipient_address ?? req.body.recipientAddress;
  const description: string | undefined = req.body.description;
  const expiryMinutes: number = req.body.expiry_minutes ?? req.body.expiryMinutes ?? 30;

  if (!amountUsdc || typeof amountUsdc !== 'number' || amountUsdc <= 0) {
    res.status(400).json({ error: 'amount_usdc must be a positive number' });
    return;
  }
  if (!recipientAddress || !isValidSolanaAddress(recipientAddress)) {
    res.status(400).json({ error: 'recipient_address must be a valid Solana address (32-44 chars)' });
    return;
  }

  try {
    const metadata = description ? { description } : undefined;
    const { transactionId, paymentId } = await transactionsService.createPaymentRequest(
      merchant.id,
      amountUsdc,
      recipientAddress,
      metadata,
      expiryMinutes
    );

    res.status(201).json({
      success: true,
      transactionId,
      paymentId,
      amount: amountUsdc,
      recipientAddress,
      description: description ?? null,
      instructions: `Send ${amountUsdc} USDC to ${recipientAddress} on Solana within ${expiryMinutes} minutes, then call POST /api/merchants/payments/${transactionId}/verify with your transactionHash.`,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Only start the listener when not running under Jest
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`🚀 AgentPay API running on http://localhost:${PORT}`);
    console.log(`Mode: ${process.env.NODE_ENV || 'development'}`);
  });
  startSolanaListener();
}

export default app;