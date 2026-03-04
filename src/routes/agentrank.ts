/**
 * AgentRank API route — public endpoint for querying agent reputation scores.
 *
 * GET /agentrank/:agentId — returns the AgentRank score, grade, factors, and Sybil flags.
 *
 * @module routes/agentrank
 */

import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import {
  calculateAgentRank,
  type AgentRankFactors,
  type SybilSignals,
} from '../reputation/agentrank-core.js';
import { logger } from '../logger.js';

const router = Router();

// PRODUCTION FIX — rate limit on AgentRank endpoint
const agentrankLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many AgentRank requests, please try again later.' },
});

router.use(agentrankLimiter);

/**
 * GET /agentrank/:agentId
 *
 * Public API — returns the AgentRank for a given agent.
 * In production this will pull real data from the agentrank_scores table;
 * for now it computes a score from default/mock factors to demonstrate the engine.
 */
router.get('/:agentId', async (req: Request, res: Response) => {
  try {
    const { agentId } = req.params;

    if (!agentId || agentId.trim().length === 0) {
      res.status(400).json({ error: 'Invalid agentId' });
      return;
    }

    // TODO: Replace with real DB lookup from agentrank_scores table
    // For now, return a computed score with default factors to demonstrate the engine
    const factors: AgentRankFactors = {
      paymentReliability: 0,
      serviceDelivery: 0,
      transactionVolume: 0,
      walletAgeDays: 0,
      disputeRate: 0,
    };

    const sybilSignals: SybilSignals = {
      walletAgeDays: 0,
      stakeUsdc: 0,
      uniqueCounterparties: 0,
      circularTradingDetected: false,
    };

    const result = calculateAgentRank(agentId, factors, sybilSignals);

    res.json({
      success: true,
      agentRank: {
        agentId: result.agentId,
        score: result.score,
        grade: result.grade,
        factors: result.factors,
        sybilFlags: result.sybilFlags,
      },
    });
  } catch (error: any) {
    logger.error('AgentRank fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch AgentRank' });
  }
});

export default router;
