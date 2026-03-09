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

const registerAgentSchema = z.object({
  name: z.string().min(1).max(255),
  service: z.string().min(1).max(100),
  endpointUrl: z.string().url(),
  pricing: z.record(z.string(), z.unknown()).optional(),
});

// Anti-wash-trading constants
const NETWORK_FEE_RATE = 0.01;   // 1% platform fee
const NETWORK_FEE_MIN  = 0.01;   // $0.01 floor
const HIRE_AMOUNT_MIN  = 0.05;   // $0.05 minimum per transaction
const VELOCITY_LIMIT   = 5;      // max hires between same pair per window
const VELOCITY_WINDOW_MS = 60_000; // 60-second rolling window

const hireAgentSchema = z.object({
  buyerAgentId: z.string().min(1),
  sellerAgentId: z.string().min(1),
  task: z.record(z.string(), z.unknown()),
  // Minimum $0.05 enforced to make micro-spam economically irrational
  amount: z.number().min(HIRE_AMOUNT_MIN, `Minimum transaction amount is $${HIRE_AMOUNT_MIN}`),
});

const completeAgentSchema = z.object({
  transactionId: z.string().min(1),
  output: z.record(z.string(), z.unknown()).optional(),
});

// ─── AgentPay Network routes ─────────────────────────────────────────────────
// NOTE: All named routes MUST be declared before /:agentId to avoid shadowing.

/**
 * POST /api/agents/register
 * Register an agent on the AgentPay Network marketplace.
 * Requires merchant API key — links agent to authenticated merchant.
 */
router.post('/register', authenticateApiKey, async (req: Request, res: Response) => {
  const parsed = registerAgentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Validation error',
      details: parsed.error.issues.map((e: { message: string }) => e.message),
    });
    return;
  }

  try {
    const merchantId = (req as any).merchant!.id as string;
    const { name, service, endpointUrl, pricing } = parsed.data;

    const agent = await prisma.agent.create({
      data: {
        merchantId,
        displayName: name,
        service,
        endpointUrl,
        pricingModel: (pricing ?? {}) as any,
        rating: 5.0,
        totalEarnings: 0,
        tasksCompleted: 0,
      },
    });

    logger.info('Network agent registered', { agentId: agent.id, merchantId, service });

    res.status(201).json({
      success: true,
      agentId: agent.id,
      name: agent.displayName,
      service: agent.service,
      endpointUrl: agent.endpointUrl,
      marketplaceUrl: `/network/agents/${agent.id}`,
    });
  } catch (err: any) {
    logger.error('Agent registration error', { err });
    res.status(500).json({ error: 'Failed to register agent' });
  }
});

/**
 * GET /api/agents/discover
 * Discover agents on the network.
 * Query params: ?service=&maxPrice=&minRating=
 */
router.get('/discover', async (req: Request, res: Response) => {
  try {
    const { service, maxPrice, minRating } = req.query as Record<string, string | undefined>;

    const where: Record<string, unknown> = {
      service: { not: null },
      endpointUrl: { not: null },
    };

    if (service) {
      where['service'] = { contains: service, mode: 'insensitive' };
    }

    if (minRating) {
      const rating = parseFloat(minRating);
      if (!isNaN(rating)) {
        where['rating'] = { gte: rating };
      }
    }

    const agents = await prisma.agent.findMany({
      where: where as any,
      select: {
        id: true,
        displayName: true,
        service: true,
        pricingModel: true,
        rating: true,
        totalEarnings: true,
        tasksCompleted: true,
        createdAt: true,
      },
      orderBy: [{ rating: 'desc' }, { tasksCompleted: 'desc' }],
      take: 100,
    });

    // Apply maxPrice filter after fetch (pricing is stored as JSON)
    const filtered = maxPrice
      ? agents.filter((a: any) => {
          const pricing = a.pricingModel as Record<string, unknown> | null;
          const base = pricing && typeof pricing['base'] === 'number' ? pricing['base'] : 0;
          return base <= parseFloat(maxPrice);
        })
      : agents;

    res.json({
      success: true,
      agents: filtered.map((a: any) => ({
        agentId: a.id,
        name: a.displayName,
        service: a.service,
        pricing: a.pricingModel,
        rating: a.rating,
        totalEarnings: a.totalEarnings,
        tasksCompleted: a.tasksCompleted,
        createdAt: a.createdAt.toISOString(),
      })),
    });
  } catch (err: any) {
    logger.error('Agent discovery error', { err });
    res.status(500).json({ error: 'Failed to discover agents' });
  }
});

/**
 * POST /api/agents/hire
 * Hire a seller agent to perform a task.
 * Creates AgentTransaction + AgentEscrow, then calls seller endpoint.
 */
router.post('/hire', authenticateApiKey, async (req: Request, res: Response) => {
  const parsed = hireAgentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Validation error',
      details: parsed.error.issues.map((e: { message: string }) => e.message),
    });
    return;
  }

  try {
    const { buyerAgentId, sellerAgentId, task, amount } = parsed.data;

    // ── Velocity rate-limit ────────────────────────────────────────────────
    // Prevents wash-trading by capping the same buyer→seller pair at
    // VELOCITY_LIMIT transactions within a rolling 60-second window.
    const windowStart = new Date(Date.now() - VELOCITY_WINDOW_MS);
    const recentCount = await (prisma as any).agentTransaction.count({
      where: { buyerAgentId, sellerAgentId, createdAt: { gte: windowStart } },
    });
    if (recentCount >= VELOCITY_LIMIT) {
      res.status(429).json({
        error: 'Rate limit exceeded',
        message: `Maximum ${VELOCITY_LIMIT} hires between the same agent pair per 60 seconds.`,
        retryAfter: 60,
      });
      return;
    }

    // ── Platform fee ───────────────────────────────────────────────────────
    // 1% of transaction amount, floored at $0.01.
    // Deducted from the seller's escrow payout, making micro-spam unprofitable.
    const platformFee = parseFloat(Math.max(amount * NETWORK_FEE_RATE, NETWORK_FEE_MIN).toFixed(6));
    const sellerReceives = parseFloat((amount - platformFee).toFixed(6));

    logger.info('AgentPay Network fee applied', {
      grossAmount: amount,
      platformFee,
      sellerReceives,
      buyerAgentId,
      sellerAgentId,
    });

    // Verify seller agent exists and has an endpoint
    const sellerAgent = await prisma.agent.findUnique({
      where: { id: sellerAgentId },
      select: { id: true, endpointUrl: true, service: true },
    });

    if (!sellerAgent || !sellerAgent.endpointUrl) {
      res.status(404).json({ error: 'Seller agent not found or has no endpoint' });
      return;
    }

    // Build callback URL (use request host as base, fall back to env)
    const envApiBase = (globalThis as any).process?.env?.API_BASE_URL as string | undefined;
    const callbackBase = envApiBase || `${req.protocol}://${req.get('host')}`;
    const callbackUrl = `${callbackBase}/api/agents/complete`;

    // Create escrow first with a placeholder transactionId.
    // The escrow amount is the NET amount the seller will receive after the platform fee.
    const escrow = await (prisma as any).agentEscrow.create({
      data: {
        transactionId: 'pending',
        amount: sellerReceives,
        status: 'locked',
      },
    });

    // Create transaction row
    const tx = await (prisma as any).agentTransaction.create({
      data: {
        buyerAgentId,
        sellerAgentId,
        task,
        amount,
        status: 'running',
        escrowId: escrow.id,
      },
    });

    // Update escrow with real transactionId
    await (prisma as any).agentEscrow.update({
      where: { id: escrow.id },
      data: { transactionId: tx.id },
    });

    logger.info('Agent hired', { transactionId: tx.id, buyerAgentId, sellerAgentId, amount });

    // Fire-and-forget: call seller endpoint asynchronously
    (async () => {
      try {
        await fetch(sellerAgent.endpointUrl!, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ task, transactionId: tx.id, callbackUrl }),
          signal: AbortSignal.timeout(30_000),
        });
      } catch (callErr: any) {
        logger.warn('Seller endpoint call failed (non-fatal)', {
          sellerAgentId,
          endpointUrl: sellerAgent.endpointUrl,
          error: callErr?.message,
        });
      }
    })();

    res.status(201).json({
      success: true,
      transactionId: tx.id,
      escrowId: escrow.id,
      status: 'running',
      platformFee,
      sellerReceives,
    });
  } catch (err: any) {
    logger.error('Agent hire error', { err });
    res.status(500).json({ error: 'Failed to hire agent' });
  }
});

/**
 * POST /api/agents/complete
 * Mark a transaction complete and release escrow.
 * Called by the seller agent (or its callback) when work is done.
 */
router.post('/complete', async (req: Request, res: Response) => {
  const parsed = completeAgentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Validation error',
      details: parsed.error.issues.map((e: { message: string }) => e.message),
    });
    return;
  }

  try {
    const { transactionId, output } = parsed.data;

    const tx = await (prisma as any).agentTransaction.findUnique({
      where: { id: transactionId },
    });

    if (!tx) {
      res.status(404).json({ error: 'Transaction not found' });
      return;
    }

    if (tx.status === 'completed') {
      res.json({ success: true, message: 'Already completed', transactionId });
      return;
    }

    // Mark transaction complete
    await (prisma as any).agentTransaction.update({
      where: { id: transactionId },
      data: { status: 'completed', output: output ?? {} },
    });

    // Release escrow
    if (tx.escrowId) {
      await (prisma as any).agentEscrow.update({
        where: { id: tx.escrowId },
        data: { status: 'released' },
      });
    }

    // Update seller agent earnings and task count
    await prisma.agent.updateMany({
      where: { id: tx.sellerAgentId },
      data: {
        totalEarnings: { increment: tx.amount },
        tasksCompleted: { increment: 1 },
      },
    });

    logger.info('Agent transaction completed', { transactionId, sellerAgentId: tx.sellerAgentId });

    res.json({
      success: true,
      transactionId,
      status: 'completed',
      escrowStatus: 'released',
    });
  } catch (err: any) {
    logger.error('Agent complete error', { err });
    res.status(500).json({ error: 'Failed to complete transaction' });
  }
});

/**
 * GET /api/agents/feed
 * Live transaction feed — returns the last 100 agent-to-agent transactions.
 */
router.get('/feed', async (_req: Request, res: Response) => {
  try {
    const transactions = await (prisma as any).agentTransaction.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    res.json({
      success: true,
      feed: transactions.map((tx: any) => ({
        id: tx.id,
        buyer: tx.buyerAgentId,
        seller: tx.sellerAgentId,
        amount: tx.amount,
        status: tx.status,
        timestamp: tx.createdAt,
      })),
    });
  } catch (err: any) {
    logger.error('Agent feed error', { err });
    res.status(500).json({ error: 'Failed to fetch feed' });
  }
});

/**
 * GET /api/agents/leaderboard
 * Top 100 agents by total earnings.
 */
router.get('/leaderboard', async (_req: Request, res: Response) => {
  try {
    const agents = await prisma.agent.findMany({
      where: { service: { not: null } },
      select: {
        id: true,
        displayName: true,
        service: true,
        rating: true,
        totalEarnings: true,
        tasksCompleted: true,
      },
      orderBy: { totalEarnings: 'desc' },
      take: 100,
    });

    res.json({
      success: true,
      leaderboard: agents.map((a: any, index: number) => ({
        rank: index + 1,
        agentId: a.id,
        name: a.displayName,
        service: a.service,
        rating: a.rating,
        totalEarnings: a.totalEarnings,
        tasksCompleted: a.tasksCompleted,
      })),
    });
  } catch (err: any) {
    logger.error('Leaderboard error', { err });
    res.status(500).json({ error: 'Failed to fetch leaderboard' });
  }
});

// ─── Existing agent CRUD routes ──────────────────────────────────────────────

/**
 * POST /api/agents
 * Create a new first-class agent entity linked to the authenticated merchant.
 */
router.post('/', authenticateApiKey, async (req: Request, res: Response) => {
  const parsed = createAgentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Validation error',
      details: parsed.error.issues.map((e: { message: string }) => e.message),
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
        service: true,
        endpointUrl: true,
        pricingModel: true,
        rating: true,
        totalEarnings: true,
        tasksCompleted: true,
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
        service: (agent as any).service ?? null,
        endpointUrl: (agent as any).endpointUrl ?? null,
        pricing: (agent as any).pricingModel,
        rating: (agent as any).rating,
        totalEarnings: (agent as any).totalEarnings,
        tasksCompleted: (agent as any).tasksCompleted,
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
