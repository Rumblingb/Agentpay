import { Router, Request, Response } from 'express';
import Joi from 'joi';
import { z } from 'zod';
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
        protocol: true,
        agentId: true,
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
        protocol: i.protocol ?? null,
        agentId: i.agentId ?? null,
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

const attachAgentSchema = z.object({
  agentId: z.string().uuid('agentId must be a valid UUID'),
});

/**
 * PATCH /api/intents/:intentId/agent
 * Attach an agent to an existing intent (must be owned by the authenticated merchant).
 */
router.patch('/:intentId/agent', authenticateApiKey, async (req: Request, res: Response) => {
  const parsed = attachAgentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Validation error',
      details: parsed.error.issues.map((e) => e.message),
    });
    return;
  }

  try {
    const merchant = (req as any).merchant;
    const { intentId } = req.params;
    const { agentId } = parsed.data;

    const intent = await prisma.paymentIntent.findUnique({
      where: { id: intentId },
      select: { merchantId: true },
    });

    if (!intent) {
      res.status(404).json({ error: 'Payment intent not found' });
      return;
    }

    if (intent.merchantId !== merchant.id) {
      res.status(403).json({ error: 'Unauthorized access to this payment intent' });
      return;
    }

    const updated = await prisma.paymentIntent.update({
      where: { id: intentId },
      data: { agentId },
      select: {
        id: true,
        amount: true,
        currency: true,
        status: true,
        protocol: true,
        agentId: true,
        expiresAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    logger.info('Agent attached to intent', { intentId, agentId, merchantId: merchant.id });

    res.json({
      success: true,
      intent: {
        intentId: updated.id,
        amount: Number(updated.amount),
        currency: updated.currency,
        status: updated.status,
        protocol: updated.protocol ?? null,
        agentId: updated.agentId ?? null,
        expiresAt: updated.expiresAt.toISOString(),
        createdAt: updated.createdAt?.toISOString() ?? null,
        updatedAt: updated.updatedAt?.toISOString() ?? null,
      },
    });
  } catch (err: any) {
    logger.error('Attach agent error', { err });
    res.status(500).json({ error: 'Failed to attach agent to intent' });
  }
});

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

// GET /api/activity — return last 20 transactions for activity feed
router.get('/activity', authenticateApiKey, async (req: Request, res: Response) => {
  try {
    const merchant = (req as any).merchant;
    const rows = await prisma.transactions.findMany({
      where: { merchant_id: merchant.id },
      orderBy: { created_at: 'desc' },
      take: 20,
      select: {
        id: true,
        amount_usdc: true,
        recipient_address: true,
        status: true,
        metadata: true,
        created_at: true,
      },
    });

    const activity = rows.map((r) => {
      const meta = (r.metadata as Record<string, unknown>) ?? {};
      return {
        id: r.id,
        amount: Number(r.amount_usdc),
        currency: 'USDC',
        recipientAddress: r.recipient_address,
        sourceAgent: (meta['source_agent'] as string) ?? 'Autonomous Agent',
        destinationService: (meta['destination_service'] as string) ?? null,
        status: r.status,
        createdAt: r.created_at?.toISOString() ?? null,
      };
    });

    res.json({ success: true, activity });
  } catch (err: any) {
    logger.error('Activity feed error:', err);
    res.status(500).json({ error: 'Failed to fetch activity feed' });
  }
});

export default router;
