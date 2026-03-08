import { Router, Request, Response } from 'express';
import Joi from 'joi';
import { authenticateApiKey } from '../middleware/auth.js';
import { createIntent, getIntentStatus } from '../controllers/intentController.js';
import * as stripeService from '../services/stripeService.js';
import { query } from '../db/index.js';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../logger.js';
import prisma from '../lib/prisma.js';

const router = Router();

// GET /api/intents — list payment intents for the authenticated merchant
router.get('/', authenticateApiKey, async (req: Request, res: Response) => {
  try {
    const merchant = (req as any).merchant;
    const intents = await prisma.paymentIntent.findMany({
      where: { merchantId: merchant.id },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true,
        amount: true,
        currency: true,
        status: true,
        verificationToken: true,
        expiresAt: true,
        metadata: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    res.json({
      success: true,
      intents: intents.map((i) => ({
        intentId: i.id,
        amount: Number(i.amount),
        currency: i.currency,
        status: i.status,
        verificationToken: i.verificationToken,
        expiresAt: i.expiresAt.toISOString(),
        metadata: i.metadata,
        createdAt: i.createdAt?.toISOString() ?? null,
        updatedAt: i.updatedAt?.toISOString() ?? null,
      })),
    });
  } catch (err: any) {
    logger.error('List intents error:', err);
    res.status(500).json({ error: 'Failed to fetch payment intents' });
  }
});

// POST /api/intents – create a new payment intent (merchant auth required)
router.post('/', authenticateApiKey, createIntent);

// GET /api/intents/:intentId/status – get intent status (merchant auth required)
router.get('/:intentId/status', authenticateApiKey, getIntentStatus);

const fiatIntentSchema = Joi.object({
  amountUsd: Joi.number().positive().required(),
  currency: Joi.string().length(3).default('usd'),
  description: Joi.string().max(500).optional(),
});

/**
 * POST /api/intents/fiat
 * Creates a fiat PaymentIntent + Stripe Checkout Session paying directly to the
 * merchant's connected Stripe account (non-custodial).
 */
router.post('/fiat', authenticateApiKey, async (req: Request, res: Response) => {
  try {
    const { error, value } = fiatIntentSchema.validate(req.body);
    if (error) {
      res.status(400).json({
        error: 'Validation error',
        details: error.details.map((d) => d.message),
      });
      return;
    }

    const merchant = (req as any).merchant!;

    const { intentId, sessionId, sessionUrl } = await stripeService.createFiatIntent(
      merchant.id,
      value.amountUsd,
      value.currency || 'usd',
      value.description || 'AgentPay Fiat Payment'
    );

    const transactionId = uuidv4();
    const paymentId = uuidv4();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await query(
      `INSERT INTO transactions
         (id, merchant_id, payment_id, amount_usdc, recipient_address, status,
          confirmation_depth, required_depth, expires_at, stripe_payment_reference, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())`,
      [
        transactionId,
        merchant.id,
        paymentId,
        value.amountUsd,
        '',
        'pending',
        0,
        0,
        expiresAt,
        sessionId,
      ]
    );

    logger.info('Fiat intent created', { merchantId: merchant.id, transactionId, intentId, sessionId });

    res.status(201).json({
      success: true,
      transactionId,
      intentId,
      sessionId,
      sessionUrl,
      currency: value.currency || 'usd',
      amountUsd: value.amountUsd,
    });
  } catch (error: any) {
    logger.error('Fiat intent creation error', { error: error.message });
    res.status(400).json({ error: error.message || 'Failed to create fiat intent' });
  }
});

export default router;
