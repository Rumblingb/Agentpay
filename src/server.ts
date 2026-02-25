import express, { Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import merchantsRouter from './routes/merchants';
import webhooksRouter from './routes/webhooks';
import { authenticateApiKey } from './middleware/auth';
import * as auditService from './services/audit';
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
  // This tells the browser: "It's okay for the Dashboard on 3000 to see my data"
  origin: ['http://localhost:3000', 'http://127.0.0.1:3000'],
  credentials: true,
}));
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('combined'));
}
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(globalLimiter);

// --- HEALTH CHECK ---
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'active', timestamp: new Date().toISOString() });
});

// --- MERCHANT API ROUTES ---
app.use('/api/merchants', merchantsRouter);

// --- WEBHOOK SUBSCRIPTION ROUTES ---
app.use('/api/webhooks', webhooksRouter);

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

// Only start the listener when not running under Jest
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`🚀 AgentPay API running on http://localhost:${PORT}`);
    console.log(`Mode: ${process.env.NODE_ENV || 'development'}`);
  });
}

export default app;