/**
 * Receipt route — GET /api/receipt/:intentId
 *
 * Public endpoint (no auth required) that returns intent + agent + escrow data
 * for the Agent Receipt Page.  The intentId acts as the shareable receipt token.
 *
 * Phase 8: The response now includes two additional top-level fields:
 *
 *   resolution — Phase 6 engine output (null until the engine runs):
 *     { status, decisionCode, reasonCode, confidenceScore, resolvedAt,
 *       resolvedBy, protocol, externalRef }
 *
 *   settlement — most-recent SettlementIdentity for the intent (null if none):
 *     { status, protocol, externalRef, settledAt }
 *
 * Backward compatibility: all existing fields (intent, escrow) are preserved.
 */

import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma.js';
import { logger } from '../logger.js';
import { sanitizeIntent } from '../utils/sanitizeIntent.js';
import { receiptLimiter } from '../middleware/rateLimit.js';

const router = Router();

/**
 * GET /api/receipt/:intentId
 * Returns public receipt data for an intent, including settlement resolution.
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
        // Phase 8: resolution record written by the Phase 6 engine.
        resolution: {
          select: {
            resolutionStatus: true,
            decisionCode: true,
            reasonCode: true,
            confidenceScore: true,
            resolvedAt: true,
            resolvedBy: true,
            protocol: true,
            externalRef: true,
          },
        },
        // Phase 8: settlement identities (take the most recent one).
        settlementIdentities: {
          select: {
            status: true,
            protocol: true,
            externalRef: true,
            settledAt: true,
          },
          orderBy: { createdAt: 'desc' },
          take: 1,
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
      // verificationToken is intentionally omitted — it is a sensitive internal
      // proof-of-payment token that must not be exposed on the public receipt endpoint.
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

    // Phase 8: resolution summary from the Phase 6 engine output.
    const resolutionRow = intent.resolution;
    const resolutionPayload = resolutionRow
      ? {
          status: resolutionRow.resolutionStatus,
          decisionCode: resolutionRow.decisionCode ?? null,
          reasonCode: resolutionRow.reasonCode ?? null,
          confidenceScore:
            resolutionRow.confidenceScore !== null && resolutionRow.confidenceScore !== undefined
              ? Number(resolutionRow.confidenceScore)
              : null,
          resolvedAt: resolutionRow.resolvedAt.toISOString(),
          resolvedBy: resolutionRow.resolvedBy,
          protocol: resolutionRow.protocol,
          externalRef: resolutionRow.externalRef ?? null,
        }
      : null;

    // Phase 8: most recent settlement identity for the intent.
    const settlementRow = intent.settlementIdentities[0] ?? null;
    const settlementPayload = settlementRow
      ? {
          status: settlementRow.status,
          protocol: settlementRow.protocol,
          externalRef: settlementRow.externalRef ?? null,
          settledAt: settlementRow.settledAt?.toISOString() ?? null,
        }
      : null;

    res.json({
      success: true,
      intent: sanitizeIntent(intentPayload),
      resolution: resolutionPayload,
      settlement: settlementPayload,
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
