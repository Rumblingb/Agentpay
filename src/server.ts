import express, { Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import merchantsRouter from './routes/merchants';
import {
  verifyPaymentRecipient,
  isValidSolanaAddress,
} from './security/payment-verification';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Security & utility middleware
app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:3002',
  credentials: true,
}));
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('combined'));
}
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- HEALTH CHECK ---
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'active', timestamp: new Date().toISOString() });
});

// --- MERCHANT API ROUTES ---
app.use('/api/merchants', merchantsRouter);

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
app.post('/api/v1/verify-payment', async (req: Request, res: Response) => {
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
    if (result.valid) {
      res.json({ success: true, data: result });
    } else {
      res.status(402).json({ success: false, error: result.error });
    }
  } catch (error) {
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