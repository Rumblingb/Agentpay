import { Router, Request, Response } from 'express';
import * as reputationService from '../services/reputationService.js';
import { authenticateApiKey } from '../middleware/auth.js';
import prisma from '../lib/prisma.js';
import { z } from 'zod';
import { logger } from '../logger.js';

const router = Router();

// --- Schemas ---
const createAgentSchema = z.object({
  displayName: z.string().min(1).max(255),
  publicKey: z.string().max(512).optional(),
  riskScore: z.number().int().min(0).max(1000).optional(),
});

/**
 * POST /api/agents
 * Create a new first-class agent entity linked to the authenticated merchant.
 */
router.post('/', authenticateApiKey, async (req: Request, res: Response) => {
  const parsed = createAgentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Validation error',
      details: parsed.error.issues.map((e) => e.message),
    });
    return;
  }

  try {
    const merchantId = (req as any).merchant!.id as string;
    const { displayName, publicKey, riskScore } = parsed.data;

    const agent = await prisma.agent.create({
      data: {
        merchantId,
        displayName,
        ...(publicKey ? { publicKey } : {}),
        ...(riskScore !== undefined ? { riskScore } : {}),
      },
    });

    logger.info('Agent created', { agentId: agent.id, merchantId });

    res.status(201).json({
      success: true,
      agent: {
        id: agent.id,
        merchantId: agent.merchantId,
        displayName: agent.displayName,
        publicKey: agent.publicKey ?? null,
        riskScore: agent.riskScore,
        createdAt: agent.createdAt.toISOString(),
      },
    });
  } catch (err: any) {
    logger.error('Agent creation error', { err });
    res.status(500).json({ error: 'Failed to create agent' });
  }
});

/**
 * GET /api/agents/:agentId
 * Returns agent details (public — no auth required).
 */
router.get('/:agentId', async (req: Request, res: Response) => {
  const { agentId } = req.params;

  try {
    const agent = await prisma.agent.findUnique({
      where: { id: agentId },
      select: {
        id: true,
        displayName: true,
        publicKey: true,
        riskScore: true,
        merchantId: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!agent) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }

    res.json({
      success: true,
      agent: {
        id: agent.id,
        displayName: agent.displayName,
        publicKey: agent.publicKey ?? null,
        riskScore: agent.riskScore,
        merchantId: agent.merchantId ?? null,
        createdAt: agent.createdAt.toISOString(),
        updatedAt: agent.updatedAt.toISOString(),
      },
    });
  } catch (err: any) {
    logger.error('Agent fetch error', { err });
    res.status(500).json({ error: 'Failed to fetch agent' });
  }
});

/**
 * GET /api/agents/:agentId/reputation
 * Returns the reputation record for an agent identified by agentId (wallet address).
 */
router.get('/:agentId/reputation', async (req: Request, res: Response) => {
  try {
    const { agentId } = req.params;

    if (!agentId || agentId.trim().length === 0) {
      res.status(400).json({ error: 'Invalid agentId' });
      return;
    }

    const reputation = await reputationService.getReputation(agentId);

    if (!reputation) {
      res.status(404).json({ error: 'Agent reputation not found' });
      return;
    }

    res.json({
      success: true,
      reputation: {
        agentId: reputation.agentId,
        trustScore: reputation.trustScore,
        totalPayments: reputation.totalPayments,
        successRate: reputation.successRate,
        disputeRate: reputation.disputeRate,
        lastPaymentAt: reputation.lastPaymentAt,
        createdAt: reputation.createdAt,
        updatedAt: reputation.updatedAt,
      },
      fastTrackEligible: reputationService.shouldFastTrack(reputation),
    });
  } catch (error: any) {
    logger.error('Reputation fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch reputation' });
  }
});

export default router;
