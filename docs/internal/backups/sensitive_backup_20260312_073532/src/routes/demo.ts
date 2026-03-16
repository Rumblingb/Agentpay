import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { authenticateApiKey } from '../middleware/auth.js';
import prisma from '../lib/prisma.js';
import { logger } from '../logger.js';

const router = Router();

/**
 * POST /api/demo/run-agent-payment
 *
 * Simulates a full agent-initiated payment end-to-end without needing a real
 * Solana wallet. Creates a $0.10 USDC payment intent, immediately marks it
 * as confirmed, inserts a transactions record, and returns a success payload.
 *
 * This is intended for investor demos and development testing only.
 */
router.post('/run-agent-payment', authenticateApiKey, async (req: Request, res: Response) => {
  try {
    const merchant = (req as any).merchant;

    const intentId = uuidv4();
    const verificationToken = `APV_DEMO_${Date.now()}_${uuidv4().replace(/-/g, '').slice(0, 8)}`;
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
    const amount = 0.10;
    const currency = 'USDC';
    const sourceAgent = (req.body as any)?.sourceAgent ?? 'DemoAgent';
    const destinationService = (req.body as any)?.destinationService ?? 'WeatherDataAPI';

    // Create and immediately confirm the payment intent
    await prisma.paymentIntent.create({
      data: {
        id: intentId,
        merchantId: merchant.id,
        amount,
        currency,
        status: 'verified',
        verificationToken,
        expiresAt,
        metadata: {
          demo: true,
          source_agent: sourceAgent,
          destination_service: destinationService,
        },
      },
    });

    // Insert a confirmed transaction record
    const transactionId = uuidv4();
    const paymentId = uuidv4();
    await prisma.transactions.create({
      data: {
        id: transactionId,
        merchant_id: merchant.id,
        payment_id: paymentId,
        amount_usdc: amount,
        recipient_address: merchant.walletAddress ?? 'demo-recipient',
        status: 'confirmed',
        confirmation_depth: 3,
        required_depth: 2,
        expires_at: expiresAt,
        metadata: {
          demo: true,
          intent_id: intentId,
          source_agent: sourceAgent,
          destination_service: destinationService,
        },
      },
    });

    logger.info('Demo agent payment simulated', {
      merchantId: merchant.id,
      intentId,
      transactionId,
      sourceAgent,
      destinationService,
    });

    res.status(201).json({
      success: true,
      simulation: true,
      intentId,
      transactionId,
      amount,
      currency,
      sourceAgent,
      destinationService,
      status: 'confirmed',
      message: 'Demo agent payment completed successfully',
    });
  } catch (err: any) {
    logger.error('Demo payment error:', err);
    res.status(500).json({ error: 'Demo payment simulation failed' });
  }
});

export default router;
