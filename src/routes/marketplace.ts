/**
 * Marketplace Discovery API
 *
 * Allows AI agents to discover and find other agents by capability, trust score,
 * category, and pricing. This is the public "agent marketplace" endpoint.
 *
 * GET /api/marketplace/discover  — search for agents
 * GET /api/marketplace/featured  — featured / top-rated agents
 * GET /api/marketplace/categories — list available agent categories
 *
 * @module routes/marketplace
 */

import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import prisma from '../lib/prisma.js';
import { query } from '../db/index.js';
import { logger } from '../logger.js';

const router = Router();

const marketplaceLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many marketplace requests, please try again later.' },
});

router.use(marketplaceLimiter);

// Query schema for /discover
const discoverQuerySchema = z.object({
  q: z.string().max(200).optional(),
  category: z.string().max(100).optional(),
  minRank: z.coerce.number().min(0).max(1000).optional(),
  maxRank: z.coerce.number().min(0).max(1000).optional(),
  minScore: z.coerce.number().min(0).max(1000).optional(),
  tier: z.enum(['S', 'A', 'B', 'C', 'D', 'F']).optional(),
  sortBy: z.enum(['score', 'volume', 'recent']).default('score'),
  limit: z.coerce.number().min(1).max(100).default(20),
  offset: z.coerce.number().min(0).default(0),
});

// Agent categories (static registry — extend with DB in production)
const AGENT_CATEGORIES = [
  { id: 'data', name: 'Data Providers', description: 'Agents that provide structured data, APIs, or datasets' },
  { id: 'compute', name: 'Compute Services', description: 'Agents offering LLM inference, embeddings, or task execution' },
  { id: 'research', name: 'Research Agents', description: 'Web search, summarization, and research automation' },
  { id: 'code', name: 'Code Assistants', description: 'Agents that write, review, or deploy code' },
  { id: 'financial', name: 'Financial Agents', description: 'Payment processing, accounting, and trading agents' },
  { id: 'content', name: 'Content Creation', description: 'Writing, image generation, and media production' },
  { id: 'workflow', name: 'Workflow Automation', description: 'Task orchestration, scheduling, and automation' },
  { id: 'security', name: 'Security & Audit', description: 'Security scanning, vulnerability analysis, and auditing' },
];

/**
 * GET /api/marketplace/discover
 *
 * Search for agents in the marketplace.
 * Returns agents enriched with AgentRank scores.
 */
router.get('/discover', async (req: Request, res: Response) => {
  const parsed = discoverQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Validation error',
      details: parsed.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`),
    });
    return;
  }

  const { q, category, minScore, tier, sortBy, limit, offset } = parsed.data;

  try {
    // Build Prisma where clause for agentrank_scores
    const where: Record<string, any> = {};
    if (tier) where.grade = tier;
    if (minScore !== undefined) where.score = { gte: minScore };

    const orderBy =
      sortBy === 'volume'
        ? { transaction_volume: 'desc' as const }
        : sortBy === 'recent'
        ? { updated_at: 'desc' as const }
        : { score: 'desc' as const };

    let records: any[] = [];
    let total = 0;

    try {
      [records, total] = await Promise.all([
        prisma.agentrank_scores.findMany({
          where,
          orderBy,
          take: limit,
          skip: offset,
        }),
        prisma.agentrank_scores.count({ where }),
      ]);
    } catch (prismaErr: any) {
      const isTableMissing =
        prismaErr?.code === 'P2021' ||
        (typeof prismaErr?.message === 'string' && prismaErr.message.includes('does not exist'));
      if (!isTableMissing) throw prismaErr;
      // Fall through with empty records
    }

    // Enrich with bot profile data if available
    const enriched = await Promise.all(
      records.map(async (r, idx) => {
        let profile: any = null;
        try {
          const botResult = await query(
            `SELECT handle, bio, platform_bot_id, created_at
             FROM bots
             WHERE handle = $1 OR platform_bot_id = $1
             LIMIT 1`,
            [r.agent_id],
          );
          if (botResult.rows.length > 0) profile = botResult.rows[0];
        } catch {
          // bots table may not exist
        }

        return {
          rank: offset + idx + 1,
          agentId: r.agent_id,
          handle: profile?.handle ?? r.agent_id,
          bio: profile?.bio ?? null,
          score: r.score,
          grade: r.grade,
          transactionVolume: r.transaction_volume,
          walletAgeDays: r.wallet_age_days,
          paymentReliability: Number(r.payment_reliability),
          serviceDelivery: Number(r.service_delivery),
          category: category ?? null,
          updatedAt: r.updated_at,
          profileUrl: `/api/agentrank/${encodeURIComponent(r.agent_id)}`,
        };
      }),
    );

    // Apply text search filter (q) after enrichment if provided
    const filtered = q
      ? enriched.filter(
          (a) =>
            a.agentId.toLowerCase().includes(q.toLowerCase()) ||
            (a.handle && a.handle.toLowerCase().includes(q.toLowerCase())) ||
            (a.bio && a.bio.toLowerCase().includes(q.toLowerCase())),
        )
      : enriched;

    res.json({
      success: true,
      agents: filtered,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + limit < total,
      },
      filters: { q, category, minScore, tier, sortBy },
    });
  } catch (error: any) {
    logger.error('Marketplace discover error:', error);
    res.status(500).json({ error: 'Failed to search marketplace' });
  }
});

/**
 * GET /api/marketplace/featured
 *
 * Returns the top 10 agents by AgentRank for display on homepage/landing.
 */
router.get('/featured', async (_req: Request, res: Response) => {
  try {
    let featured: any[] = [];

    try {
      const records = await prisma.agentrank_scores.findMany({
        where: { score: { gte: 700 } },
        orderBy: { score: 'desc' },
        take: 10,
      });

      featured = records.map((r, idx) => ({
        rank: idx + 1,
        agentId: r.agent_id,
        score: r.score,
        grade: r.grade,
        transactionVolume: r.transaction_volume,
        paymentReliability: Number(r.payment_reliability),
        badge: r.score >= 900 ? 'elite' : r.score >= 800 ? 'top-rated' : 'trusted',
      }));
    } catch {
      // table may not exist
    }

    res.json({
      success: true,
      featured,
      _description: 'Top agents with AgentRank ≥ 700 (Platinum / Diamond tier)',
    });
  } catch (error: any) {
    logger.error('Marketplace featured error:', error);
    res.status(500).json({ error: 'Failed to fetch featured agents' });
  }
});

/**
 * GET /api/marketplace/categories
 *
 * Returns the list of available agent categories.
 */
router.get('/categories', (_req: Request, res: Response) => {
  res.json({
    success: true,
    categories: AGENT_CATEGORIES,
    total: AGENT_CATEGORIES.length,
  });
});

export default router;
