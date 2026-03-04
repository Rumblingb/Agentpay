/**
 * AgentRank API route — public endpoint for querying agent reputation scores.
 *
 * GET /agentrank/:agentId — returns the AgentRank score, grade, factors, and Sybil flags.
 *
 * Accepts both handle (e.g. "DemoAgentSlash150") and agent ID / pubkey.
 * Queries the agentrank_scores table first; falls back to the bots table
 * to resolve handles or wallet addresses to an agent_id.
 *
 * @module routes/agentrank
 */

import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import {
  calculateAgentRank,
  scoreToGrade,
  detectSybilFlags,
  type AgentRankFactors,
  type SybilSignals,
} from '../reputation/agentrank-core.js';
import prisma from '../lib/prisma.js';
import { query } from '../db/index.js';
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
 * Look up an agent in the agentrank_scores table.
 * Tries exact match first, then case-insensitive match.
 */
async function findAgentRankScore(identifier: string) {
  // 1. Exact match on agent_id
  let record = await prisma.agentrank_scores.findUnique({
    where: { agent_id: identifier },
  });
  if (record) return record;

  // 2. Case-insensitive match on agent_id
  const rows = await prisma.agentrank_scores.findMany({
    where: {
      agent_id: { equals: identifier, mode: 'insensitive' },
    },
    take: 1,
  });
  if (rows.length > 0) return rows[0];

  return null;
}

/**
 * Fallback: search the bots table by handle, wallet_address, or platform_bot_id
 * and then look up the corresponding agentrank_scores record.
 */
async function findViaBotsTable(identifier: string) {
  try {
    const result = await query(
      `SELECT id, handle, wallet_address, platform_bot_id
       FROM bots
       WHERE handle = $1
          OR wallet_address = $1
          OR platform_bot_id = $1
          OR LOWER(handle) = LOWER($2)
       LIMIT 1`,
      [identifier, identifier],
    );

    if (result.rows.length === 0) return null;

    const bot = result.rows[0];

    // Try to find an agentrank_scores record matching any bot identifier
    for (const key of [bot.handle, bot.wallet_address, bot.platform_bot_id, bot.id]) {
      if (!key) continue;
      const score = await findAgentRankScore(key);
      if (score) return score;
    }

    return null;
  } catch {
    // bots table may not exist — that's fine, return null
    return null;
  }
}

/**
 * GET /agentrank/:agentId
 *
 * Public API — returns the AgentRank for a given agent.
 * Queries the agentrank_scores table; falls back to the bots table to
 * resolve handles / pubkeys, then returns the stored score and factors.
 * If no record is found, computes a default score (0 / U).
 */
router.get('/:agentId', async (req: Request, res: Response) => {
  try {
    const { agentId } = req.params;

    if (!agentId || agentId.trim().length === 0) {
      res.status(400).json({ error: 'Invalid agentId' });
      return;
    }

    const identifier = agentId.trim();

    // 1. Look up in agentrank_scores (exact + case-insensitive)
    let record = await findAgentRankScore(identifier);

    // 2. Fallback: search the bots table by handle / wallet / platform_bot_id
    if (!record) {
      record = await findViaBotsTable(identifier);
    }

    // 3. If a persisted record exists, return it directly
    if (record) {
      const factors: AgentRankFactors = {
        paymentReliability: Number(record.payment_reliability),
        serviceDelivery: Number(record.service_delivery),
        transactionVolume: record.transaction_volume,
        walletAgeDays: record.wallet_age_days,
        disputeRate: Number(record.dispute_rate),
      };

      const sybilSignals: SybilSignals = {
        walletAgeDays: record.wallet_age_days,
        stakeUsdc: Number(record.stake_usdc),
        uniqueCounterparties: record.unique_counterparties,
        circularTradingDetected: false,
      };

      const sybilFlags = detectSybilFlags(sybilSignals);

      res.json({
        success: true,
        agentRank: {
          agentId: record.agent_id,
          score: record.score,
          grade: record.grade,
          factors,
          sybilFlags,
        },
      });
      return;
    }

    // 4. No record found — compute with default (zero) factors
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

    const result = calculateAgentRank(identifier, factors, sybilSignals);

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
