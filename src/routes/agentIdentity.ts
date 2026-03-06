import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authenticateApiKey } from '../middleware/auth.js';
import * as agentIdentityService from '../services/agentIdentityService.js';
import { logger } from '../logger.js';

const router = Router();

// --- Validation schemas ---
const registerAgentSchema = z.object({
  agentPublicKey: z.string().min(1).max(256).optional(),
  spendingLimit: z.number().positive().max(1_000_000).optional(),
  pin: z.string().min(4).max(16).optional(),
  deviceFingerprint: z.string().min(1).max(512).optional(),
});

const updateAgentSchema = z.object({
  agentId: z.string().uuid(),
  agentPublicKey: z.string().min(1).max(256).optional(),
  spendingLimit: z.number().positive().max(1_000_000).optional(),
  pin: z.string().min(4).max(16).optional(),
  deviceFingerprint: z.string().min(1).max(512).optional(),
});

const verifyPinSchema = z.object({
  agentId: z.string().uuid(),
  pin: z.string().min(4).max(16),
});

router.post('/register', async (req: Request, res: Response) => {
  const parsed = registerAgentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation error', details: parsed.error.issues.map((e) => e.message) });
    return;
  }
  try {
    const result = await agentIdentityService.registerAgent(parsed.data);
    res.status(201).json({ success: true, data: result });
  } catch (err: any) {
    logger.error('Agent registration error', { err });
    res.status(500).json({ error: 'Failed to register agent' });
  }
});

router.patch('/update', authenticateApiKey, async (req: Request, res: Response) => {
  const parsed = updateAgentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation error', details: parsed.error.issues.map((e) => e.message) });
    return;
  }
  try {
    const { agentId, ...updates } = parsed.data;
    await agentIdentityService.updateAgent(agentId, updates);
    res.json({ success: true });
  } catch (err: any) {
    logger.error('Agent update error', { err });
    res.status(500).json({ error: 'Failed to update agent' });
  }
});

router.post('/verify-pin', async (req: Request, res: Response) => {
  const parsed = verifyPinSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation error', details: parsed.error.issues.map((e) => e.message) });
    return;
  }
  try {
    const { agentId, pin } = parsed.data;
    const valid = await agentIdentityService.verifyPin(agentId, pin);
    if (!valid) {
      res.status(401).json({ error: 'Invalid PIN' });
      return;
    }
    res.json({ success: true, verified: true });
  } catch (err: any) {
    logger.error('PIN verification error', { err });
    res.status(500).json({ error: 'Failed to verify PIN' });
  }
});

export default router;
