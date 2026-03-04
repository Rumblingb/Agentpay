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
import rateLimit from 'express-rate-limit';
import {
  createEscrow,
  markComplete,
  approveWork,
  disputeWork,
  getEscrow,
  listEscrowsForAgent,
} from '../escrow/trust-escrow.js';
import { logger } from '../logger.js';

const router = Router();

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
 * POST /escrow/create
 */
router.post('/create', async (req: Request, res: Response) => {
  try {
    const { hiringAgent, workingAgent, amountUsdc, workDescription, deadlineHours } = req.body;

    if (!hiringAgent || !workingAgent || !amountUsdc) {
      res.status(400).json({ error: 'hiringAgent, workingAgent, and amountUsdc are required' });
      return;
    }

    const escrow = createEscrow({
      hiringAgent,
      workingAgent,
      amountUsdc: Number(amountUsdc),
      workDescription,
      deadlineHours: deadlineHours ? Number(deadlineHours) : undefined,
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
  try {
    const { callerAgent } = req.body;
    if (!callerAgent) {
      res.status(400).json({ error: 'callerAgent is required' });
      return;
    }

    const escrow = markComplete(req.params.id, callerAgent);
    logger.info('Escrow marked complete', { escrowId: escrow.id, callerAgent });
    res.json({ success: true, escrow });
  } catch (error: any) {
    logger.error('Escrow complete error:', error);
    res.status(400).json({ error: error.message || 'Failed to mark complete' });
  }
});

/**
 * POST /escrow/:id/approve
 */
router.post('/:id/approve', async (req: Request, res: Response) => {
  try {
    const { callerAgent } = req.body;
    if (!callerAgent) {
      res.status(400).json({ error: 'callerAgent is required' });
      return;
    }

    const escrow = approveWork(req.params.id, callerAgent);
    logger.info('Escrow approved', { escrowId: escrow.id, callerAgent });
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
  try {
    const { callerAgent, reason, guiltyParty } = req.body;
    if (!callerAgent || !reason || !guiltyParty) {
      res.status(400).json({ error: 'callerAgent, reason, and guiltyParty are required' });
      return;
    }

    const escrow = disputeWork(req.params.id, callerAgent, reason, guiltyParty);
    logger.info('Escrow disputed', { escrowId: escrow.id, callerAgent, reason });
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
