/**
 * Escrow API routes — endpoints for managing A2A escrow transactions.
 *
 * POST /escrow/create       — Create a new escrow
 * POST /escrow/:id/complete — Mark work as complete
 * POST /escrow/:id/approve  — Approve and release funds
 * POST /escrow/:id/dispute  — Dispute an escrow
 * GET  /escrow/:id          — Get escrow by ID
 * GET  /escrow/agent/:agentId — List escrows for an agent
 *
 * PRODUCTION FIX — ADDED BY COPILOT
 *
 * @module routes/escrow
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { authenticateApiKey, AuthRequest } from '../middleware/auth.js';
import {
  createEscrow,
  markComplete,
  approveWork,
  disputeWork,
  getEscrow,
  listEscrowsForAgent,
  getEscrowStats,
  getReleasedEscrows,
} from '../escrow/trust-escrow.js';
import { adjustScore } from '../services/agentrankService.js';
import { logger } from '../logger.js';

const router = Router();

// --- Validation schemas ---
const escrowCreateSchema = z.object({
  hiringAgent: z.string().min(1).max(128),
  workingAgent: z.string().min(1).max(128),
  amountUsdc: z.number().positive().max(1_000_000),
  workDescription: z.string().max(1024).optional(),
  deadlineHours: z.number().int().positive().max(720).optional(),
});

const callerAgentSchema = z.object({
  callerAgent: z.string().min(1).max(128),
});

const disputeSchema = z.object({
  callerAgent: z.string().min(1).max(128),
  reason: z.string().min(1).max(1024),
  guiltyParty: z.string().min(1).max(128),
});

// PRODUCTION FIX — rate limit on escrow endpoints
const escrowLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many escrow requests, please try again later.' },
});

router.use(escrowLimiter);

/**
 * GET /escrow/stats
 * Returns aggregate escrow statistics (released count, total revenue, etc.).
 * Must be registered BEFORE /:id to avoid being captured as a param.
 */
router.get('/stats', async (_req: Request, res: Response) => {
  try {
    const stats = getEscrowStats();
    const released = getReleasedEscrows();
    res.json({
      success: true,
      ...stats,
      recentReleased: released.slice(0, 50).map((e) => ({
        id: e.id,
        amountUsdc: e.amountUsdc,
        status: e.status,
        createdAt: e.createdAt.toISOString(),
        updatedAt: e.updatedAt.toISOString(),
      })),
    });
  } catch (error: any) {
    logger.error('Escrow stats error:', error);
    res.status(500).json({ error: 'Failed to fetch escrow stats' });
  }
});

/**
 * POST /escrow/create
 */
router.post('/create', async (req: Request, res: Response) => {
  const parsed = escrowCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation error', details: parsed.error.issues.map((e) => e.message) });
    return;
  }

  try {
    const { hiringAgent, workingAgent, amountUsdc, workDescription, deadlineHours } = parsed.data;

    const escrow = createEscrow({
      hiringAgent,
      workingAgent,
      amountUsdc,
      workDescription,
      deadlineHours,
    });

    logger.info('Escrow created', { escrowId: escrow.id, hiringAgent, workingAgent, amountUsdc });
    res.status(201).json({ success: true, escrow });
  } catch (error: any) {
    logger.error('Escrow creation error:', error);
    res.status(400).json({ error: error.message || 'Failed to create escrow' });
  }
});

/**
 * POST /escrow/:id/complete
 */
router.post('/:id/complete', async (req: Request, res: Response) => {
  const parsed = callerAgentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation error', details: parsed.error.issues.map((e) => e.message) });
    return;
  }

  try {
    const escrow = markComplete(req.params.id, parsed.data.callerAgent);
    logger.info('Escrow marked complete', { escrowId: escrow.id, callerAgent: parsed.data.callerAgent });
    res.json({ success: true, escrow });
  } catch (error: any) {
    logger.error('Escrow complete error:', error);
    res.status(400).json({ error: error.message || 'Failed to mark complete' });
  }
});

/**
 * POST /escrow/:id/approve
 */
router.post('/:id/approve', authenticateApiKey, async (req: AuthRequest, res: Response) => {
  const parsed = callerAgentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation error', details: parsed.error.issues.map((e) => e.message) });
    return;
  }

  try {
    const escrow = approveWork(req.params.id, parsed.data.callerAgent);
    logger.info('Escrow approved', { escrowId: escrow.id, callerAgent: parsed.data.callerAgent });

    // Update AgentRank scores (+10) for both agents via unified service
    const REPUTATION_DELTA = 10;
    await Promise.all([
      adjustScore(escrow.hiringAgent, REPUTATION_DELTA, 'escrow_release', `Escrow ${escrow.id} released`),
      adjustScore(escrow.workingAgent, REPUTATION_DELTA, 'escrow_release', `Escrow ${escrow.id} released`),
    ]);

    res.json({ success: true, escrow });
  } catch (error: any) {
    logger.error('Escrow approve error:', error);
    res.status(400).json({ error: error.message || 'Failed to approve work' });
  }
});

/**
 * POST /escrow/:id/dispute
 */
router.post('/:id/dispute', async (req: Request, res: Response) => {
  const parsed = disputeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation error', details: parsed.error.issues.map((e) => e.message) });
    return;
  }

  try {
    const { callerAgent, reason, guiltyParty } = parsed.data;
    const escrow = disputeWork(req.params.id, callerAgent, reason, guiltyParty);
    logger.info('Escrow disputed', { escrowId: escrow.id, callerAgent, reason });

    // Apply reputation penalty (−20) to guilty party via unified service
    const DISPUTE_PENALTY = -20;
    await adjustScore(guiltyParty, DISPUTE_PENALTY, 'escrow_dispute', `Escrow ${escrow.id}: ${reason}`);

    res.json({ success: true, escrow });
  } catch (error: any) {
    logger.error('Escrow dispute error:', error);
    res.status(400).json({ error: error.message || 'Failed to dispute escrow' });
  }
});

/**
 * GET /escrow/:id
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const escrow = getEscrow(req.params.id);
    if (!escrow) {
      res.status(404).json({ error: 'Escrow not found' });
      return;
    }

    res.json({ success: true, escrow });
  } catch (error: any) {
    logger.error('Escrow fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch escrow' });
  }
});

/**
 * GET /escrow/agent/:agentId
 */
router.get('/agent/:agentId', async (req: Request, res: Response) => {
  try {
    const escrows = listEscrowsForAgent(req.params.agentId);
    res.json({ success: true, escrows });
  } catch (error: any) {
    logger.error('Escrow list error:', error);
    res.status(500).json({ error: 'Failed to list escrows' });
  }
});

export default router;
