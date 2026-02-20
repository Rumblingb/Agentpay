import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { 
  verifyPaymentRecipient, 
  isValidSolanaAddress 
} from './security/payment-verification';
import { randomBytes } from 'crypto';

// Add this function definition
const generateApiKey = (): string => {
  const buffer = randomBytes(32);
  return `ag_live_${buffer.toString('hex')}`;
};

// ... rest of your existing imports and app setup
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({
  origin: 'http://localhost:3002' // Allow your specific dashboard port
}));
app.use(express.json());

// --- MIDDLEWARE ---

/**
 * Week 2 Task: Merchant Authentication
 * Validates the X-API-KEY header against the database.
 */
const authenticateMerchant = (req: Request, res: Response, next: Function) => {
  const apiKey = req.headers['x-api-key'];
  
  if (!apiKey) {
    return res.status(401).json({ error: 'Missing API Key' });
  }

  // TODO: In Phase 2, query your PostgreSQL/Supabase table: 
  // SELECT * FROM merchants WHERE api_key_hash = hash(apiKey)
  
  // For now, we allow a bypass to keep you on pace for the demo
  next();
};

// --- ENDPOINTS ---

/**
 * Health Check - Vital for Vercel/Docker deployment monitoring
 */
app.get('/health', (req, res) => {
  res.json({ status: 'active', timestamp: new Date().toISOString() });
});

/**
 * CORE ENDPOINT: Verify Payment
 * This is the "Verification Engine" exposed as a service.
 */
app.post('/api/v1/verify-payment', authenticateMerchant, async (req: Request, res: Response) => {
  const { transactionSignature, expectedRecipient } = req.body;

  // Input Validation (Layer 1: Protocol Translation)
  if (!transactionSignature || !expectedRecipient) {
    return res.status(400).json({ error: 'Missing required parameters' });
  }

  if (!isValidSolanaAddress(expectedRecipient)) {
    return res.status(400).json({ error: 'Invalid recipient address format' });
  }

  try {
    const result = await verifyPaymentRecipient(transactionSignature, expectedRecipient);
    
    if (result.valid) {
      // Week 2 Task: Webhook Trigger
      // Here you would trigger: axios.post(merchant.webhook_url, result)
      return res.json({
        success: true,
        data: result
      });
    } else {
      return res.status(402).json({
        success: false,
        error: result.error
      });
    }
  } catch (error) {
    console.error('Verification Error:', error);
    res.status(500).json({ error: 'Internal Server Error during verification' });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 AgentPay API running on http://localhost:${PORT}`);
  console.log(`Mode: ${process.env.NODE_ENV || 'development'}`);
});
// src/server.ts

app.post('/api/v1/merchants/keys', async (req, res) => {
  try {
    const { merchantId } = req.body;
    
    // 1. Generate the new secure key
    const newKey = generateApiKey();
    
    // 2. Update your database (Mocked logic below, replace with your DB call)
    // await db.merchants.update(merchantId, { apiKey: newKey });
    
    console.log(`🔐 New key generated for Merchant: ${merchantId}`);
    
    res.json({ 
      success: true, 
      apiKey: newKey,
      message: "Please store this key securely. It will not be shown again." 
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to generate API key" });
  }
});
export default app;