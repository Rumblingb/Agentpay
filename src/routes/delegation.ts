import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authenticateApiKey } from '../middleware/auth.js';
import * as delegationService from '../services/delegationService.js';
import { logger } from '../logger.js';

const router = Router();

const createDelegationSchema = z.object({
  agentId: z.string().min(1).max(128),
  publicKey: z.string().min(1).max(256),
  spendingLimit: z.number().positive().max(1_000_000).optional(),
  expiresAt: z.string().datetime().optional(),
});

const delegationActionSchema = z.object({
  delegationId: z.string().min(1).max(128),
  agentId: z.string().min(1).max(128),
});

router.post('/create', authenticateApiKey, async (req: Request, res: Response) => {
  const parsed = createDelegationSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation error', details: parsed.error.issues.map((e) => e.message) });
    return;
  }
  try {
    const { agentId, publicKey, spendingLimit, expiresAt } = parsed.data;
    const result = await delegationService.createDelegation(agentId, { publicKey, spendingLimit, expiresAt });
    res.status(201).json({ success: true, data: result });
  } catch (err: any) {
    logger.error('Create delegation error', { err });
    res.status(500).json({ error: 'Failed to create delegation' });
  }
});

router.post('/authorize', authenticateApiKey, async (req: Request, res: Response) => {
  const parsed = delegationActionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation error', details: parsed.error.issues.map((e) => e.message) });
    return;
  }
  try {
    const { delegationId, agentId } = parsed.data;
    await delegationService.authorizeDelegation(delegationId, agentId);
    res.json({ success: true });
  } catch (err: any) {
    logger.error('Authorize delegation error', { err });
    res.status(400).json({ error: err.message || 'Failed to authorize delegation' });
  }
});

router.post('/revoke', authenticateApiKey, async (req: Request, res: Response) => {
  const parsed = delegationActionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation error', details: parsed.error.issues.map((e) => e.message) });
    return;
  }
  try {
    const { delegationId, agentId } = parsed.data;
    await delegationService.revokeDelegation(delegationId, agentId);
    res.json({ success: true });
  } catch (err: any) {
    logger.error('Revoke delegation error', { err });
    res.status(400).json({ error: err.message || 'Failed to revoke delegation' });
  }
});

export default router;
