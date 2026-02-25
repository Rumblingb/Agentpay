import { Router, Request, Response } from 'express';
import * as reputationService from '../services/reputationService';
import { logger } from '../logger';

const router = Router();

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
