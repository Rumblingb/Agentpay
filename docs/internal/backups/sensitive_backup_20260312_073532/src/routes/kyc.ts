/**
 * KYC/AML Routes
 *
 * POST /api/kyc/submit  — submit KYC documents for an agent
 * GET  /api/kyc/status  — retrieve KYC status for an agent
 * POST /api/kyc/aml-check — (internal/admin) run AML check on an agent
 *
 * All routes require merchant authentication except the admin AML check which
 * additionally requires the x-admin-key header.
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authenticateApiKey, AuthRequest } from '../middleware/auth.js';
import { requireRole, resolveRoles } from '../middleware/requireRole.js';
import { submitKyc, getKycStatus, runAmlCheck } from '../services/kycService.js';
import { logger } from '../logger.js';

const router = Router();

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------
const submitSchema = z.object({
  agentId: z.string().min(1),
  ownerEmail: z.string().email(),
  ownerId: z.string().optional(),
  kycProvider: z.string().optional(),
  documentType: z.string().optional(),
  documentRef: z.string().optional(),
  regionCode: z.string().length(2).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const amlCheckSchema = z.object({
  agentId: z.string().min(1),
  walletAddress: z.string().optional(),
  ipAddress: z.string().optional(),
  regionCode: z.string().optional(),
  amountUsdc: z.number().positive().optional(),
});

// ---------------------------------------------------------------------------
// POST /api/kyc/submit
// ---------------------------------------------------------------------------
router.post(
  '/submit',
  authenticateApiKey,
  async (req: AuthRequest, res: Response): Promise<void> => {
    const parsed = submitSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
      return;
    }

    try {
      const result = await submitKyc(parsed.data);
      res.status(202).json({
        success: true,
        submissionId: result.id,
        status: result.status,
        message: 'KYC submission received. Review typically takes 1–3 business days.',
      });
    } catch (err: any) {
      logger.error({ err: err.message }, '[KYC Route] Submit error');
      res.status(500).json({ error: 'Failed to submit KYC' });
    }
  },
);

// ---------------------------------------------------------------------------
// GET /api/kyc/status?agentId=...
// ---------------------------------------------------------------------------
router.get(
  '/status',
  authenticateApiKey,
  async (req: Request, res: Response): Promise<void> => {
    const agentId = req.query.agentId as string | undefined;
    if (!agentId) {
      res.status(400).json({ error: 'agentId query parameter is required' });
      return;
    }

    try {
      const status = await getKycStatus(agentId);
      if (!status) {
        res.status(404).json({ error: 'No KYC submission found for this agent' });
        return;
      }
      res.json({ success: true, agentId, ...status });
    } catch (err: any) {
      logger.error({ err: err.message }, '[KYC Route] Status error');
      res.status(500).json({ error: 'Failed to retrieve KYC status' });
    }
  },
);

// ---------------------------------------------------------------------------
// POST /api/kyc/aml-check  (admin only)
// ---------------------------------------------------------------------------
router.post(
  '/aml-check',
  resolveRoles,
  requireRole(['admin']),
  async (req: Request, res: Response): Promise<void> => {
    const parsed = amlCheckSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
      return;
    }

    try {
      const result = await runAmlCheck(parsed.data);
      res.json({ success: true, ...result });
    } catch (err: any) {
      logger.error({ err: err.message }, '[AML Route] Check error');
      res.status(500).json({ error: 'AML check failed' });
    }
  },
);

export default router;
