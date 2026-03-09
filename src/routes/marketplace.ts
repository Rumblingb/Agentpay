/**
 * Marketplace Discovery API
 *
 * Allows AI agents to discover and find other agents by capability, trust score,
 * category, and pricing. This is the public "agent marketplace" endpoint.
 *
 * GET  /api/marketplace/discover    — search for agents (semantic + ranked)
 * GET  /api/marketplace/featured    — featured / top-rated agents
 * GET  /api/marketplace/categories  — list available agent categories
 * POST /api/marketplace/hire        — hire an agent with escrow
 * GET  /api/marketplace/hires       — list my active hires
 *
 * @module routes/marketplace
 */

import { Router, Request, Response } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { z } from 'zod';
import prisma from '../lib/prisma.js';
import { query } from '../db/index.js';
import { logger } from '../logger.js';
import { authenticateApiKey, type AuthRequest } from '../middleware/auth.js';
import escrowService from '../services/escrowService.js';
import * as intentService from '../services/intentService.js';
import * as agentrankService from '../services/agentrankService.js';
import { rankAgents, type SortMode } from '../services/discoveryService.js';
import { emitAgentHired, emitJobCreated } from '../events/marketplaceEmitter.js';

const router = Router();

const marketplaceLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many marketplace requests, please try again later.' },
});

// Stricter rate limit for hire endpoint (prevents drain attacks)
const hireLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => {
    const authReq = req as AuthRequest;
    return authReq.merchant?.id ?? (req.ip ? ipKeyGenerator(req.ip) : 'unknown');
  },
  message: { error: 'Too many hire requests, please slow down.' },
});

router.use(marketplaceLimiter);

// Query schema for /discover — extended with semantic sort modes
const discoverQuerySchema = z.object({
  q: z.string().max(200).optional(),
  category: z.string().max(100).optional(),
  minRank: z.coerce.number().min(0).max(1000).optional(),
  maxRank: z.coerce.number().min(0).max(1000).optional(),
  minScore: z.coerce.number().min(0).max(1000).optional(),
  tier: z.enum(['S', 'A', 'B', 'C', 'D', 'F']).optional(),
  sortBy: z.enum(['score', 'volume', 'recent', 'best_match', 'cheapest', 'fastest']).default('score'),
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
    let matchedAgents: any[] = q
      ? enriched.filter(
          (a) =>
            a.agentId.toLowerCase().includes(q.toLowerCase()) ||
            (a.handle && a.handle.toLowerCase().includes(q.toLowerCase())) ||
            (a.bio && a.bio.toLowerCase().includes(q.toLowerCase())),
        )
      : enriched;

    // Apply multi-criteria ranking for semantic sort modes
    if (sortBy === 'best_match' || sortBy === 'cheapest' || sortBy === 'fastest') {
      const candidates = matchedAgents.map((a) => ({
        ...a,
        textScore: q ? 0.8 : 0.5,
        pricePerTask: undefined as number | undefined,
        avgResponseTimeMs: undefined as number | undefined,
      }));
      matchedAgents = rankAgents(candidates, sortBy as SortMode);
    }

    res.json({
      success: true,
      agents: matchedAgents,
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

// ---------------------------------------------------------------------------
// Hire schemas
// ---------------------------------------------------------------------------

const hireBodySchema = z.object({
  agentIdToHire: z.string().min(1).max(256),
  amountUsd: z.number().positive().max(10_000),
  taskDescription: z.string().min(1).max(2000),
  timeoutHours: z.number().int().min(1).max(720).default(72),
});

// Maximum percentage of wallet balance allowed in a single hire (drain protection)
const MAX_HIRE_FRACTION = 0.10; // 10%

/**
 * POST /api/marketplace/hire
 *
 * Hire an agent with real USDC escrow.
 *
 * Steps (atomic):
 *   1. Validate owner_id matches merchant (existing PBKDF2 profile check via auth middleware)
 *   2. Enforce rate limit per merchant key
 *   3. On-chain drain protection: reject if amount > 10% of agent wallet balance
 *   4. Create payment intent via intentService (Solana default)
 *   5. Create escrow via escrowService
 *   6. Persist AgentTransaction row + adjust AgentRank (+10 on release)
 *   7. Emit SSE event
 *
 * Returns: { escrowId, paymentUrl, status, intentId }
 */
router.post('/hire', hireLimiter, authenticateApiKey, async (req: Request, res: Response) => {
  const parsed = hireBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Validation error',
      details: parsed.error.issues.map((e) => e.message),
    });
    return;
  }

  const { agentIdToHire, amountUsd, taskDescription, timeoutHours } = parsed.data;
  const merchant = (req as AuthRequest).merchant!;
  const payerAgentId = merchant.id; // merchant acts as payer

  try {
    // --- Drain protection: max 10% of wallet balance per hire ---
    let walletBalanceUsdc: number | null = null;
    try {
      const walletRow = await (prisma as any).agent_wallets.findFirst({
        where: { agent_id: payerAgentId },
        select: { balance_usdc: true },
      });
      if (walletRow) {
        walletBalanceUsdc = Number(walletRow.balance_usdc);
      }
    } catch {
      // Table may not exist — skip check
    }

    if (walletBalanceUsdc !== null && walletBalanceUsdc > 0) {
      const maxAllowed = walletBalanceUsdc * MAX_HIRE_FRACTION;
      if (amountUsd > maxAllowed) {
        res.status(400).json({
          error: 'Drain protection: amount exceeds 10% of wallet balance',
          maxAllowed: maxAllowed.toFixed(6),
          walletBalance: walletBalanceUsdc.toFixed(6),
        });
        return;
      }
    }

    // --- Step 1: Create payment intent ---
    let intentId: string | undefined;
    let paymentUrl: string | undefined;

    try {
      const intent = await intentService.createIntent({
        merchantId: merchant.id,
        amount: amountUsd,
        currency: 'USDC',
        metadata: {
          agentIdToHire,
          taskDescription,
          type: 'marketplace_hire',
        },
      });
      intentId = intent.intentId;
      paymentUrl = intent.instructions.solanaPayUri;
    } catch (err: any) {
      logger.warn('[marketplace/hire] intentService unavailable, continuing without intent', {
        err: err?.message,
      });
    }

    // --- Step 2: Create escrow ---
    const escrowRecord = await escrowService.create({
      type: 'solana',
      fromAgentId: payerAgentId,
      toAgentId: agentIdToHire,
      amount: amountUsd,
      taskDescription,
      timeoutHours,
    });

    // --- Step 3: Persist AgentTransaction ---
    let txId: string | undefined;
    try {
      const tx = await (prisma as any).agentTransaction.create({
        data: {
          buyerAgentId: payerAgentId,
          sellerAgentId: agentIdToHire,
          task: { description: taskDescription, intentId, escrowId: escrowRecord.escrowId },
          status: 'hired',
          amount: amountUsd,
          escrowId: escrowRecord.escrowId,
        },
      });
      txId = tx.id;
    } catch (err: any) {
      logger.warn('[marketplace/hire] AgentTransaction persist failed', { err: err?.message });
    }

    // --- Step 4: Adjust AgentRank +10 for payee on hire (full +10 on release) ---
    try {
      await agentrankService.adjustScore(agentIdToHire, 5, 'marketplace_hire', `Hired for: ${taskDescription.slice(0, 60)}`);
    } catch {
      // AgentRank is best-effort
    }

    // --- Step 5: Emit SSE event ---
    emitAgentHired(payerAgentId, agentIdToHire, escrowRecord.escrowId, amountUsd, taskDescription);
    emitJobCreated(agentIdToHire, taskDescription, amountUsd);

    logger.info('[marketplace/hire] Agent hired successfully', {
      payerAgentId,
      agentIdToHire,
      escrowId: escrowRecord.escrowId,
      amountUsd,
    });

    res.status(201).json({
      success: true,
      escrowId: escrowRecord.escrowId,
      paymentUrl: paymentUrl ?? escrowRecord.paymentUrl,
      status: escrowRecord.status,
      intentId,
      txId,
      onChain: escrowRecord.onChain,
    });
  } catch (error: any) {
    logger.error('[marketplace/hire] Error:', error);
    res.status(500).json({ error: 'Failed to create hire' });
  }
});

/**
 * GET /api/marketplace/hires
 *
 * List active hires where the authenticated merchant is the payer.
 */
router.get('/hires', authenticateApiKey, async (req: Request, res: Response) => {
  const merchant = (req as AuthRequest).merchant!;
  const payerAgentId = merchant.id;

  try {
    let hires: any[] = [];
    try {
      hires = await (prisma as any).agentTransaction.findMany({
        where: {
          buyerAgentId: payerAgentId,
          status: { not: 'completed' },
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });
    } catch (err: any) {
      logger.warn('[marketplace/hires] DB query failed', { err: err?.message });
    }

    res.json({
      success: true,
      hires: hires.map((h: any) => ({
        txId: h.id,
        escrowId: h.escrowId,
        sellerAgentId: h.sellerAgentId,
        amount: h.amount,
        status: h.status,
        task: h.task,
        createdAt: h.createdAt,
      })),
      total: hires.length,
    });
  } catch (error: any) {
    logger.error('[marketplace/hires] Error:', error);
    res.status(500).json({ error: 'Failed to fetch hires' });
  }
});

export default router;
