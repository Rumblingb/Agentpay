/**
 * Receipt route — GET /api/receipt/:intentId
 *
 * Public endpoint (no auth required) that returns intent + agent + escrow data
 * for the Agent Receipt Page.  The intentId acts as the shareable receipt token.
 */

import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma.js';
import { logger } from '../logger.js';
import { sanitizeIntent } from '../utils/sanitizeIntent.js';
import { receiptLimiter } from '../middleware/rateLimit.js';

const router = Router();

/**
 * GET /api/receipt/:intentId
 * Returns public receipt data for an intent.
 */
router.get('/:intentId', receiptLimiter, async (req: Request, res: Response) => {
  const { intentId } = req.params;

  try {
    const intent = await prisma.paymentIntent.findUnique({
      where: { id: intentId },
      select: {
        id: true,
        amount: true,
        currency: true,
        status: true,
        protocol: true,
        agentId: true,
        verificationToken: true,
        expiresAt: true,
        createdAt: true,
        updatedAt: true,
        agent: {
          select: {
            id: true,
            displayName: true,
            riskScore: true,
          },
        },
      },
    });

    if (!intent) {
      res.status(404).json({ error: 'NOT_FOUND', message: 'Payment intent not found' });
      return;
    }

    const intentPayload = {
      id: intent.id,
      amount: Number(intent.amount),
      currency: intent.currency,
      status: intent.status,
      protocol: intent.protocol ?? null,
      agentId: intent.agentId ?? null,
      verificationToken: intent.verificationToken,
      expiresAt: intent.expiresAt.toISOString(),
      createdAt: intent.createdAt?.toISOString() ?? null,
      updatedAt: intent.updatedAt?.toISOString() ?? null,
      agent: intent.agent
        ? {
            id: intent.agent.id,
            displayName: intent.agent.displayName,
            riskScore: intent.agent.riskScore,
          }
        : null,
    };

    res.json({
      success: true,
      intent: sanitizeIntent(intentPayload),
      // Escrow data is omitted here — in a future release this will query
      // escrow_transactions by the intent/agent relationship.
      escrow: null,
    });
  } catch (err: any) {
    logger.error('Receipt fetch error', { intentId, error: err.message });
    res.status(500).json({ error: 'Failed to fetch receipt data' });
  }
});

export default router;
