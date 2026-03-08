/**
 * Escrow API routes — endpoints for managing A2A escrow transactions.
 *
 * POST /escrow/create       — Create a new escrow
 * POST /escrow/approve      — Approve by escrow ID in request body (static alias)
 * POST /escrow/:id/complete — Mark work as complete
 * POST /escrow/:id/approve  — Approve and release funds
 * POST /escrow/:id/dispute  — Dispute an escrow
 * GET  /escrow/:id          — Get escrow by ID
 * GET  /escrow/agent/:agentId — List escrows for an agent
 *
 * @module routes/escrow
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
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
  EscrowTransaction,
} from '../escrow/trust-escrow.js';
import { adjustScore } from '../services/agentrankService.js';
import { query } from '../db/index.js';
import prisma from '../lib/prisma.js';
import { logger } from '../logger.js';

const router = Router();

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

/**
 * Accepts both canonical field names (hiringAgent, workingAgent, amountUsdc)
 * AND the legacy aliases used by some callers (buyerId, sellerId, amount).
 * The transform step normalises everything to the canonical form so all
 * downstream logic can rely on a single shape.
 */
const escrowCreateSchema = z
  .object({
    hiringAgent: z.string().min(1).max(128).optional(),
    workingAgent: z.string().min(1).max(128).optional(),
    buyerId: z.string().min(1).max(128).optional(),    // alias for hiringAgent
    sellerId: z.string().min(1).max(128).optional(),   // alias for workingAgent
    amountUsdc: z.number().positive().max(1_000_000).optional(),
    amount: z.number().positive().max(1_000_000).optional(), // alias for amountUsdc
    workDescription: z.string().max(1024).optional(),
    deadlineHours: z.number().int().positive().max(720).optional(),
  })
  .transform((data) => ({
    hiringAgent: (data.hiringAgent ?? data.buyerId) as string | undefined,
    workingAgent: (data.workingAgent ?? data.sellerId) as string | undefined,
    amountUsdc: (data.amountUsdc ?? data.amount) as number | undefined,
    workDescription: data.workDescription,
    deadlineHours: data.deadlineHours,
  }))
  .superRefine((data, ctx) => {
    if (!data.hiringAgent) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'hiringAgent (or buyerId) is required', path: ['hiringAgent'] });
    }
    if (!data.workingAgent) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'workingAgent (or sellerId) is required', path: ['workingAgent'] });
    }
    if (data.amountUsdc === undefined || data.amountUsdc === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'amountUsdc (or amount) is required', path: ['amountUsdc'] });
    }
  });

const callerAgentSchema = z.object({
  callerAgent: z.string().min(1).max(128),
});

/** Static approve — caller sends escrowId in the body */
const staticApproveSchema = z.object({
  escrowId: z.string().min(1).max(128),
  callerAgent: z.string().min(1).max(128),
});

const disputeSchema = z.object({
  callerAgent: z.string().min(1).max(128),
  reason: z.string().min(1).max(1024),
  guiltyParty: z.string().min(1).max(128),
});

// ---------------------------------------------------------------------------
// Rate limiter
// ---------------------------------------------------------------------------

const escrowLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many escrow requests, please try again later.' },
});

router.use(escrowLimiter);

// ---------------------------------------------------------------------------
// Helper — persist escrow to payment_intents (best-effort; DB may be offline)
// ---------------------------------------------------------------------------

async function persistEscrowToPaymentIntents(
  escrowId: string,
  merchantId: string,
  amountUsdc: number,
  hiringAgent: string,
  workingAgent: string,
  workDescription: string | null,
  deadlineHours: number,
): Promise<void> {
  const verificationToken = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + deadlineHours * 60 * 60 * 1000);

  try {
    await query(
      `INSERT INTO payment_intents
         (id, merchant_id, amount, currency, status, verification_token, expires_at, metadata, created_at, updated_at)
       VALUES ($1, $2, $3, 'USDC', 'pending', $4, $5, $6, NOW(), NOW())
       ON CONFLICT (id) DO NOTHING`,
      [
        escrowId,
        merchantId,
        amountUsdc,
        verificationToken,
        expiresAt,
        JSON.stringify({ type: 'escrow', hiringAgent, workingAgent, workDescription }),
      ],
    );
    logger.info('Escrow persisted to payment_intents', { escrowId, merchantId });
  } catch (err: any) {
    // Gracefully handle missing table or DB connection issues
    logger.warn('Could not persist escrow to payment_intents (DB may be unavailable)', {
      escrowId,
      error: err?.message,
    });
  }
}

// ---------------------------------------------------------------------------
// Helper — update merchant total_volume on escrow release
// ---------------------------------------------------------------------------

async function incrementMerchantVolume(merchantId: string, amountUsdc: number): Promise<void> {
  try {
    await query(
      `UPDATE merchants SET total_volume = COALESCE(total_volume, 0) + $1, updated_at = NOW() WHERE id = $2`,
      [amountUsdc, merchantId],
    );
    logger.info('Merchant total_volume updated', { merchantId, addedUsdc: amountUsdc });
  } catch (err: any) {
    logger.warn('Could not update merchant total_volume', { merchantId, error: err?.message });
  }
}

// ---------------------------------------------------------------------------
// Helper — persist escrow to escrow_transactions (best-effort; DB may be offline)
// ---------------------------------------------------------------------------

async function persistEscrowToEscrowTransactions(escrow: EscrowTransaction): Promise<void> {
  try {
    await prisma.escrow_transactions.create({
      data: {
        id: escrow.id,
        hiring_agent: escrow.hiringAgent,
        working_agent: escrow.workingAgent,
        amount_usdc: escrow.amountUsdc,
        status: escrow.status,
        work_description: escrow.workDescription ?? null,
        deadline: escrow.deadline ?? null,
      },
    });
    logger.info('Escrow persisted to escrow_transactions', { escrowId: escrow.id });
  } catch (err: any) {
    logger.warn('Could not persist to escrow_transactions (DB may be unavailable)', {
      escrowId: escrow.id,
      error: err?.message,
    });
  }
}

// ---------------------------------------------------------------------------
// Helper — update escrow status in escrow_transactions
// ---------------------------------------------------------------------------

async function updateEscrowTransactionStatus(
  escrowId: string,
  update: {
    status: string;
    completedAt?: Date | null;
    reputationDeltaHiring?: number;
    reputationDeltaWorking?: number;
    disputeReason?: string | null;
    guiltyParty?: string | null;
  },
): Promise<void> {
  try {
    await prisma.escrow_transactions.updateMany({
      where: { id: escrowId },
      data: {
        status: update.status,
        completed_at: update.completedAt ?? undefined,
        reputation_delta_hiring: update.reputationDeltaHiring ?? undefined,
        reputation_delta_working: update.reputationDeltaWorking ?? undefined,
        dispute_reason: update.disputeReason ?? undefined,
        guilty_party: update.guiltyParty ?? undefined,
        updated_at: new Date(),
      },
    });
  } catch (err: any) {
    logger.warn('Could not update escrow_transactions status', {
      escrowId,
      error: err?.message,
    });
  }
}

// ---------------------------------------------------------------------------
// Helper — create a transactions record on escrow release
// ---------------------------------------------------------------------------

async function createTransactionRecord(
  merchantId: string,
  escrowId: string,
  amountUsdc: number,
  recipientAddress: string,
): Promise<void> {
  try {
    await prisma.transactions.create({
      data: {
        // These fields use snake_case because they map directly to the DB columns
        // in the `transactions` Prisma model (which was auto-generated from the schema).
        merchant_id: merchantId,
        payment_id: escrowId,
        amount_usdc: amountUsdc,
        recipient_address: recipientAddress,
        status: 'confirmed',
      },
    });
    logger.info('Transactions record created for escrow release', { escrowId, merchantId });
  } catch (err: any) {
    logger.warn('Could not create transactions record for escrow', {
      escrowId,
      error: err?.message,
    });
  }
}

// ---------------------------------------------------------------------------
// Helper — map a DB escrow_transactions row to the EscrowTransaction shape
// ---------------------------------------------------------------------------

function dbRowToEscrowTransaction(row: any): EscrowTransaction {
  return {
    id: row.id,
    hiringAgent: row.hiring_agent,
    workingAgent: row.working_agent,
    amountUsdc: Number(row.amount_usdc),
    status: row.status as EscrowTransaction['status'],
    workDescription: row.work_description ?? null,
    deadline: row.deadline ? new Date(row.deadline) : null,
    completedAt: row.completed_at ? new Date(row.completed_at) : null,
    reputationDeltaHiring: row.reputation_delta_hiring ?? 0,
    reputationDeltaWorking: row.reputation_delta_working ?? 0,
    disputeReason: row.dispute_reason ?? null,
    guiltyParty: row.guilty_party ?? null,
    createdAt: row.created_at ? new Date(row.created_at) : new Date(),
    updatedAt: row.updated_at ? new Date(row.updated_at) : new Date(),
  };
}

// ---------------------------------------------------------------------------
// Routes — static paths MUST be registered before param routes
// ---------------------------------------------------------------------------

/**
 * GET /escrow/stats
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
        amountUsdc: Number(e.amountUsdc),
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

    // superRefine guarantees these are set; the ! assertions are safe.
    const escrow = createEscrow({
      hiringAgent: hiringAgent!,
      workingAgent: workingAgent!,
      amountUsdc: amountUsdc!,
      workDescription,
      deadlineHours,
    });

    logger.info('Escrow created', { escrowId: escrow.id, hiringAgent, workingAgent, amountUsdc });

    // Persist to escrow_transactions table (best-effort)
    await persistEscrowToEscrowTransactions(escrow);

    // Persist to payment_intents table if a merchant is authenticated (best-effort)
    const merchant = (req as AuthRequest).merchant;
    if (merchant) {
      await persistEscrowToPaymentIntents(
        escrow.id,
        merchant.id,
        amountUsdc!,
        hiringAgent!,
        workingAgent!,
        workDescription ?? null,
        deadlineHours ?? 72,
      );
    }

    res.status(201).json({
      success: true,
      escrow,
      // Surface the expected payload shape so callers know what to send
      _hint: {
        expectedPayload: {
          hiringAgent: '<string | use buyerId alias>',
          workingAgent: '<string | use sellerId alias>',
          amountUsdc: '<number | use amount alias>',
          workDescription: '<optional string>',
          deadlineHours: '<optional number, default 72>',
        },
      },
    });
  } catch (error: any) {
    logger.error('Escrow creation error:', error);
    res.status(400).json({ error: error.message || 'Failed to create escrow' });
  }
});

/**
 * POST /escrow/approve  (static alias)
 *
 * Backward-compatible route for callers that send the escrow ID in the request body
 * instead of the URL path. Both this route and /:id/approve ultimately call the same
 * approveWork() function — this one must be registered BEFORE the /:id/* param routes.
 *
 * Body: { escrowId: string, callerAgent: string }
 */
router.post('/approve', authenticateApiKey, async (req: AuthRequest, res: Response) => {
  const parsed = staticApproveSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation error', details: parsed.error.issues.map((e) => e.message) });
    return;
  }

  try {
    const { escrowId, callerAgent } = parsed.data;
    const escrow = approveWork(escrowId, callerAgent);
    logger.info('Escrow approved (static route)', { escrowId: escrow.id, callerAgent });

    const REPUTATION_DELTA = 10;
    await Promise.all([
      adjustScore(escrow.hiringAgent, REPUTATION_DELTA, 'escrow_release', `Escrow ${escrow.id} released`),
      adjustScore(escrow.workingAgent, REPUTATION_DELTA, 'escrow_release', `Escrow ${escrow.id} released`),
    ]);

    // Persist escrow status + create transactions record
    await updateEscrowTransactionStatus(escrow.id, {
      status: 'released',
      reputationDeltaHiring: REPUTATION_DELTA,
      reputationDeltaWorking: REPUTATION_DELTA,
    });

    // Update merchant total_volume + payment_intents status + transactions record
    if (req.merchant) {
      await Promise.all([
        incrementMerchantVolume(req.merchant.id, escrow.amountUsdc),
        query(
          `UPDATE payment_intents SET status = 'completed', updated_at = NOW() WHERE id = $1`,
          [escrow.id],
        ).catch((err) => {
          logger.debug('payment_intents update skipped (escrow not in table or DB offline)', { escrowId: escrow.id, err: err?.message });
        }),
        createTransactionRecord(req.merchant.id, escrow.id, escrow.amountUsdc, escrow.workingAgent),
      ]);
    }

    res.json({ success: true, escrow });
  } catch (error: any) {
    logger.error('Escrow approve error (static):', error);
    res.status(400).json({ error: error.message || 'Failed to approve work' });
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

    // Persist status change to escrow_transactions (best-effort)
    await updateEscrowTransactionStatus(escrow.id, {
      status: 'completed',
      completedAt: escrow.completedAt,
    });

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

    const REPUTATION_DELTA = 10;
    await Promise.all([
      adjustScore(escrow.hiringAgent, REPUTATION_DELTA, 'escrow_release', `Escrow ${escrow.id} released`),
      adjustScore(escrow.workingAgent, REPUTATION_DELTA, 'escrow_release', `Escrow ${escrow.id} released`),
    ]);

    // Persist escrow status change
    await updateEscrowTransactionStatus(escrow.id, {
      status: 'released',
      reputationDeltaHiring: REPUTATION_DELTA,
      reputationDeltaWorking: REPUTATION_DELTA,
    });

    // Update merchant total_volume + mark payment_intent completed + create transactions record
    if (req.merchant) {
      await Promise.all([
        incrementMerchantVolume(req.merchant.id, escrow.amountUsdc),
        query(
          `UPDATE payment_intents SET status = 'completed', updated_at = NOW() WHERE id = $1`,
          [escrow.id],
        ).catch((err) => {
          logger.debug('payment_intents update skipped (escrow not in table or DB offline)', { escrowId: escrow.id, err: err?.message });
        }),
        createTransactionRecord(req.merchant.id, escrow.id, escrow.amountUsdc, escrow.workingAgent),
      ]);
    }

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

    const DISPUTE_PENALTY = -20;
    await adjustScore(guiltyParty, DISPUTE_PENALTY, 'escrow_dispute', `Escrow ${escrow.id}: ${reason}`);

    // Persist dispute status to escrow_transactions (best-effort)
    await updateEscrowTransactionStatus(escrow.id, {
      status: 'disputed',
      disputeReason: reason,
      guiltyParty,
      reputationDeltaHiring: guiltyParty === escrow.hiringAgent ? DISPUTE_PENALTY : 0,
      reputationDeltaWorking: guiltyParty === escrow.workingAgent ? DISPUTE_PENALTY : 0,
    });

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
    let escrow: EscrowTransaction | null = getEscrow(req.params.id);

    // Cache miss — try the DB (e.g., after a server restart)
    if (!escrow) {
      const dbRow = await prisma.escrow_transactions
        .findUnique({ where: { id: req.params.id } })
        .catch(() => null);
      if (dbRow) {
        escrow = dbRowToEscrowTransaction(dbRow);
      }
    }

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
    const memEscrows = listEscrowsForAgent(req.params.agentId);
    const memIds = new Set(memEscrows.map((e) => e.id));

    // Merge with DB results so data persisted before a restart is included
    const dbRows = await prisma.escrow_transactions
      .findMany({
        where: {
          OR: [
            { hiring_agent: req.params.agentId },
            { working_agent: req.params.agentId },
          ],
        },
        orderBy: { created_at: 'desc' },
        take: 100,
      })
      .catch(() => []);

    const dbEscrows = dbRows
      .filter((row) => !memIds.has(row.id))
      .map(dbRowToEscrowTransaction);

    const escrows = [...memEscrows, ...dbEscrows];
    res.json({ success: true, escrows });
  } catch (error: any) {
    logger.error('Escrow list error:', error);
    res.status(500).json({ error: 'Failed to list escrows' });
  }
});

export default router;
