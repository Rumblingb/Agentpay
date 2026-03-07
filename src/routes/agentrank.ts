/**
 * AgentRank API route — public endpoint for querying agent reputation scores.
 *
 * GET  /agentrank/leaderboard      — Top agents ranked by score
 * GET  /agentrank/:agentId         — Score, grade, factors, and Sybil flags
 * GET  /agentrank/:agentId/history — Score change history
 * POST /agentrank/:agentId/adjust  — Manual score adjustment (admin)
 *
 * Accepts both handle (e.g. "DemoAgentSlash150") and agent ID / pubkey.
 * Queries the agentrank_scores table first; falls back to the bots table
 * to resolve handles or wallet addresses to an agent_id.
 *
 * @module routes/agentrank
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import {
  calculateAgentRank,
  scoreToGrade,
  detectSybilFlags,
  type AgentRankFactors,
  type SybilSignals,
} from '../reputation/agentrank-core.js';
import { adjustScore, getScoreHistory } from '../services/agentrankService.js';
import prisma from '../lib/prisma.js';
import { query } from '../db/index.js';
import { logger } from '../logger.js';

const router = Router();

// ---------------------------------------------------------------------------
// Leaderboard in-memory cache (30-second TTL)
// Avoids hammering the DB on every public leaderboard hit.
// No external Redis dependency required.
// ---------------------------------------------------------------------------
interface CacheEntry<T> {
  value: T;
  expiresAt: number; // Unix ms
}
const leaderboardCache = new Map<string, CacheEntry<unknown>>();

function cacheGet<T>(key: string): T | null {
  const entry = leaderboardCache.get(key) as CacheEntry<T> | undefined;
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    leaderboardCache.delete(key);
    return null;
  }
  return entry.value;
}

function cacheSet<T>(key: string, value: T, ttlMs = 30_000): void {
  leaderboardCache.set(key, { value, expiresAt: Date.now() + ttlMs });
}

/** For testing only — clears the leaderboard cache */
export function _clearLeaderboardCache(): void {
  leaderboardCache.clear();
}

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
  try {
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
  } catch (err: any) {
    // agentrank_scores table may not exist yet (e.g. before first migration).
    // Prisma throws P2021 when the table is missing. Return null so the
    // caller falls through to default score computation.
    const isTableMissing =
      err?.code === 'P2021' ||
      (typeof err?.message === 'string' && err.message.includes('does not exist'));
    if (!isTableMissing) {
      logger.warn('AgentRank score lookup failed', { error: err?.message });
    }
    return null;
  }
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
  } catch (err: any) {
    // bots table may not exist in environments that don't use Moltbook.
    // Log unexpected errors for debugging but don't fail the request.
    const isTableMissing =
      typeof err?.message === 'string' && err.message.includes('does not exist');
    if (!isTableMissing) {
      logger.warn('Bots table fallback query failed', { error: err?.message });
    }
    return null;
  }
}

/**
 * GET /agentrank/leaderboard
 *
 * Public API — returns the top agents ranked by AgentRank score.
 * Supports pagination and optional tier filter.
 *
 * IMPORTANT: This route must be defined BEFORE /:agentId to avoid
 * "leaderboard" being captured as an agentId param.
 *
 * Query params:
 *   limit    — number of results (1–100, default 20)
 *   offset   — pagination offset (default 0)
 *   tier     — filter by tier: S, A, B, C, D, F (optional)
 *   minScore — minimum score threshold (optional)
 */
router.get('/leaderboard', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? '20'), 10)));
    const offset = Math.max(0, parseInt(String(req.query.offset ?? '0'), 10));
    const tierFilter = typeof req.query.tier === 'string' ? req.query.tier.toUpperCase() : null;
    const minScore = req.query.minScore ? parseInt(String(req.query.minScore), 10) : null;

    // Valid tiers as produced by scoreToGrade
    const validTiers = ['S', 'A', 'B', 'C', 'D', 'F', 'U'];
    if (tierFilter && !validTiers.includes(tierFilter)) {
      res.status(400).json({ error: `Invalid tier. Must be one of: ${validTiers.join(', ')}` });
      return;
    }

    // Serve from cache when available (30-second TTL, cache-key encodes all params)
    const cacheKey = `leaderboard:${limit}:${offset}:${tierFilter ?? ''}:${minScore ?? ''}`;
    const cached = cacheGet<object>(cacheKey);
    if (cached) {
      res.set('X-Cache', 'HIT');
      res.json(cached);
      return;
    }

    // Try Prisma first (agentrank_scores table)
    try {
      const whereClause: Record<string, any> = {};
      if (tierFilter) whereClause.grade = tierFilter;
      if (minScore !== null && !isNaN(minScore)) whereClause.score = { gte: minScore };

      const [records, total] = await Promise.all([
        prisma.agentrank_scores.findMany({
          where: whereClause,
          orderBy: { score: 'desc' },
          take: limit,
          skip: offset,
        }),
        prisma.agentrank_scores.count({ where: whereClause }),
      ]);

      const leaderboard = records.map((r, idx) => ({
        rank: offset + idx + 1,
        agentId: r.agent_id,
        score: r.score,
        grade: r.grade,
        paymentReliability: Number(r.payment_reliability),
        serviceDelivery: Number(r.service_delivery),
        transactionVolume: r.transaction_volume,
        walletAgeDays: r.wallet_age_days,
        disputeRate: Number(r.dispute_rate),
        updatedAt: r.updated_at,
      }));

      const response = {
        success: true,
        leaderboard,
        pagination: {
          total,
          limit,
          offset,
          hasMore: offset + limit < total,
        },
      };

      cacheSet(cacheKey, response);
      res.set('X-Cache', 'MISS');
      res.json(response);
      return;
    } catch (prismaErr: any) {
      // Table may not exist yet — fall through to empty response
      const isTableMissing =
        prismaErr?.code === 'P2021' ||
        (typeof prismaErr?.message === 'string' && prismaErr.message.includes('does not exist'));
      if (!isTableMissing) {
        throw prismaErr;
      }
    }

    // Graceful fallback when table does not exist
    res.json({
      success: true,
      leaderboard: [],
      pagination: { total: 0, limit, offset, hasMore: false },
      _note: 'AgentRank scores table not yet populated. Run npm run calculate-scores to seed.',
    });
  } catch (error: any) {
    logger.error('AgentRank leaderboard error:', error);
    res.status(500).json({ error: 'Failed to fetch leaderboard' });
  }
});

// --- Validation schema for adjust endpoint ---
const adjustSchema = z.object({
  delta: z.number().int().min(-1000).max(1000),
  reason: z.string().min(1).max(512),
});

/**
 * GET /agentrank/:agentId/history
 *
 * Returns the score change history for an agent.
 * Must be registered BEFORE the generic /:agentId route.
 */
router.get('/:agentId/history', async (req: Request, res: Response) => {
  try {
    const { agentId } = req.params;
    if (!agentId || agentId.trim().length === 0) {
      res.status(400).json({ error: 'Invalid agentId' });
      return;
    }

    const data = await getScoreHistory(agentId.trim());
    if (!data) {
      res.json({ success: true, agentId, score: 0, grade: 'U', history: [] });
      return;
    }

    res.json({ success: true, agentId, ...data });
  } catch (error: any) {
    logger.error('AgentRank history error:', error);
    res.status(500).json({ error: 'Failed to fetch score history' });
  }
});

/**
 * POST /agentrank/:agentId/adjust
 *
 * Manually adjust an agent's AgentRank score.
 * Requires a delta (integer) and a reason (string).
 */
router.post('/:agentId/adjust', async (req: Request, res: Response) => {
  try {
    const { agentId } = req.params;
    if (!agentId || agentId.trim().length === 0) {
      res.status(400).json({ error: 'Invalid agentId' });
      return;
    }

    const parsed = adjustSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'Validation error',
        details: parsed.error.issues.map((e) => e.message),
      });
      return;
    }

    const { delta, reason } = parsed.data;
    const result = await adjustScore(agentId.trim(), delta, 'manual_adjustment', reason);

    if (!result) {
      res.status(503).json({ error: 'AgentRank service unavailable — database not connected' });
      return;
    }

    res.json({ success: true, agentId, ...result, delta, reason });
  } catch (error: any) {
    logger.error('AgentRank adjust error:', error);
    res.status(500).json({ error: 'Failed to adjust score' });
  }
});

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
