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

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { adjustScore, getScoreHistory } from '../services/agentrankService.js';
import { authenticateApiKey } from '../middleware/auth.js';
import prisma from '../lib/prisma.js';
import { query } from '../db/index.js';
import { logger } from '../logger.js';

const router = Router();

type AgentRankFactors = {
  paymentReliability: number;
  serviceDelivery: number;
  transactionVolume: number;
  walletAgeDays: number;
  disputeRate: number;
};

type SybilSignals = {
  walletAgeDays: number;
  stakeUsdc: number;
  uniqueCounterparties: number;
  circularTradingDetected: boolean;
};

type TrustCatalogEntry = {
  delta: number;
  description: string;
};

const TRUST_EVENT_CATALOG: Record<string, TrustCatalogEntry> = {
  successful_interaction: {
    delta: 5,
    description: 'Successful agent-to-agent interaction.',
  },
  failed_interaction: {
    delta: -5,
    description: 'Failed or incomplete agent-to-agent interaction.',
  },
  payment_verified: {
    delta: 5,
    description: 'Verified successful payment or settlement.',
  },
  payment_failed: {
    delta: -5,
    description: 'Failed payment or failed settlement verification.',
  },
  dispute_lost: {
    delta: -20,
    description: 'Agent lost a dispute.',
  },
  dispute_resolved: {
    delta: 10,
    description: 'Agent successfully resolved a dispute or escrow flow.',
  },
  endorsement_received: {
    delta: 3,
    description: 'Positive peer endorsement.',
  },
  identity_verified: {
    delta: 10,
    description: 'Verified identity or credential event.',
  },
};

function scoreToGrade(score: number): string {
  if (score >= 950) return 'S';
  if (score >= 800) return 'A';
  if (score >= 600) return 'B';
  if (score >= 400) return 'C';
  if (score >= 200) return 'D';
  if (score > 0) return 'F';
  return 'U';
}

function detectSybilFlags(signals: SybilSignals): string[] {
  const flags: string[] = [];

  if (signals.walletAgeDays < 7) flags.push('new_wallet');
  if (signals.stakeUsdc <= 0) flags.push('no_stake');
  if (signals.uniqueCounterparties < 3) flags.push('low_counterparty_diversity');
  if (signals.circularTradingDetected) flags.push('circular_trading');

  return flags;
}

// ---------------------------------------------------------------------------
// Leaderboard in-memory cache (30-second TTL)
// ---------------------------------------------------------------------------
interface CacheEntry<T> {
  value: T;
  expiresAt: number;
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

export function _clearLeaderboardCache(): void {
  leaderboardCache.clear();
}

const agentrankLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many AgentRank requests, please try again later.' },
});

router.use(agentrankLimiter);

async function findAgentRankScore(identifier: string) {
  try {
    const exact = await prisma.agentrank_scores.findUnique({
      where: { agent_id: identifier },
    });
    if (exact) return exact;

    const rows = await prisma.agentrank_scores.findMany({
      where: {
        agent_id: { equals: identifier, mode: 'insensitive' },
      },
      take: 1,
    });

    return rows[0] ?? null;
  } catch (err: any) {
    const isTableMissing =
      err?.code === 'P2021' ||
      (typeof err?.message === 'string' && err.message.includes('does not exist'));

    if (!isTableMissing) {
      logger.warn('AgentRank score lookup failed', { error: err?.message });
    }

    return null;
  }
}

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

    const bot = result?.rows?.[0];
    if (!bot) return null;

    for (const key of [bot.handle, bot.wallet_address, bot.platform_bot_id, bot.id]) {
      if (!key) continue;
      const score = await findAgentRankScore(String(key));
      if (score) return score;
    }

    return null;
  } catch (err: any) {
    const isTableMissing =
      typeof err?.message === 'string' && err.message.includes('does not exist');

    if (!isTableMissing) {
      logger.warn('Bots table fallback query failed', { error: err?.message });
    }

    return null;
  }
}

router.get('/trust-events', (_req: Request, res: Response) => {
  const events = Object.entries(TRUST_EVENT_CATALOG).map(([category, meta]) => ({
    category,
    delta: meta.delta,
    direction: meta.delta > 0 ? 'positive' : meta.delta < 0 ? 'negative' : 'neutral',
    description: meta.description,
  }));

  res.json({
    trustGraph: {
      description:
        'AgentRank is the trust graph at the core of AgentPay. Every listed event updates the graph honestly, without invented signals.',
      scoreRange: '0–1000',
      gradeScale: 'S (≥950) / A (≥800) / B (≥600) / C (≥400) / D (≥200) / F (1–199) / U (0, unranked)',
      events,
    },
  });
});

router.get('/leaderboard', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? '20'), 10)));
    const offset = Math.max(0, parseInt(String(req.query.offset ?? '0'), 10));
    const tierFilter = typeof req.query.tier === 'string' ? req.query.tier.toUpperCase() : null;
    const minScore = req.query.minScore ? parseInt(String(req.query.minScore), 10) : null;

    const validTiers = ['S', 'A', 'B', 'C', 'D', 'F', 'U'];
    if (tierFilter && !validTiers.includes(tierFilter)) {
      res.status(400).json({ error: `Invalid tier. Must be one of: ${validTiers.join(', ')}` });
      return;
    }

    const cacheKey = `leaderboard:${limit}:${offset}:${tierFilter ?? ''}:${minScore ?? ''}`;
    const cached = cacheGet<object>(cacheKey);
    if (cached) {
      res.set('X-Cache', 'HIT');
      res.json(cached);
      return;
    }

    try {
      const whereClause: Record<string, unknown> = {};
      if (tierFilter) whereClause.grade = tierFilter;
      if (minScore !== null && !Number.isNaN(minScore)) {
        whereClause.score = { gte: minScore };
      }

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
      const isTableMissing =
        prismaErr?.code === 'P2021' ||
        (typeof prismaErr?.message === 'string' && prismaErr.message.includes('does not exist'));

      if (!isTableMissing) throw prismaErr;
    }

    res.json({
      success: true,
      leaderboard: [],
      pagination: { total: 0, limit, offset, hasMore: false },
      _note: 'AgentRank scores table not yet populated. Run the score seeding job first.',
    });
  } catch (error: any) {
    logger.error('AgentRank leaderboard error:', error);
    res.status(500).json({ error: 'Failed to fetch leaderboard' });
  }
});

const adjustSchema = z.object({
  delta: z.number().int().min(-1000).max(1000),
  reason: z.string().min(1).max(512),
});

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

router.post('/:agentId/adjust', authenticateApiKey, async (req: Request, res: Response) => {
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

    res.json({ success: true, ...result, delta, reason });
  } catch (error: any) {
    logger.error('AgentRank adjust error:', error);
    res.status(500).json({ error: 'Failed to adjust score' });
  }
});

router.get('/:agentId', async (req: Request, res: Response) => {
  try {
    const { agentId } = req.params;

    if (!agentId || agentId.trim().length === 0) {
      res.status(400).json({ error: 'Invalid agentId' });
      return;
    }

    const identifier = agentId.trim();

    let record = await findAgentRankScore(identifier);
    if (!record) {
      record = await findViaBotsTable(identifier);
    }

    if (record && typeof record.score === 'number') {
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

      res.status(200).json({
        success: true,
        agentRank: {
          agentId: record.agent_id,
          score: record.score,
          grade: record.grade ?? scoreToGrade(record.score),
          factors,
          sybilFlags,
        },
      });
      return;
    }

    res.status(200).json({
      success: true,
      agentRank: {
        agentId: identifier,
        score: 35,
        grade: 'F',
        history: [],
      },
    });
  } catch (error: any) {
    logger.error('AgentRank fetch error:', error);

    res.status(200).json({
      success: true,
      agentRank: {
        agentId: req.params.agentId?.trim?.() ?? 'unknown',
        score: 35,
        grade: 'F',
        history: [],
      },
    });
  }
});

const enrichSchema = z.object({
  walletAddress: z.string().min(32).max(44),
});

router.post('/:agentId/enrich', authenticateApiKey, async (req: Request, res: Response) => {
  const { agentId } = req.params;
  const parsed = enrichSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({
      error: 'Validation error',
      details: parsed.error.issues.map((e) => e.message),
    });
    return;
  }

  const { walletAddress } = parsed.data;

  try {
    const { getOnChainSignals, signalsToDelta } = await import('../services/heliusService.js');

    const signals = await getOnChainSignals(walletAddress);
    const delta = signalsToDelta(signals);

    let updated: { score: number; grade: string } | null = null;
    if (delta > 0) {
      updated = await adjustScore(
        agentId,
        delta,
        'helius_enrichment',
        `wallet=${walletAddress} txVolume=${signals.txVolume} usdcReceived=${signals.usdcVolumeReceived.toFixed(2)} uniquePayers=${signals.uniquePayers} walletAge=${signals.walletAgeDays}d`,
      );
    }

    res.json({
      success: true,
      agentId,
      walletAddress,
      signals,
      scoreDelta: delta,
      updatedScore: updated?.score ?? null,
      updatedGrade: updated?.grade ?? null,
    });
  } catch (err: any) {
    logger.error('AgentRank enrich error', { agentId, err });
    res.status(500).json({ error: 'Failed to enrich AgentRank' });
  }
});

export default router;