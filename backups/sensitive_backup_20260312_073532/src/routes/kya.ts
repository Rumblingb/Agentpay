/**
 * KYA (Know Your Agent) API route.
 *
 * POST /kya/register — register an agent identity with owner verification.
 * GET  /kya/:agentId — look up a KYA identity.
 *
 * @module routes/kya
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { registerKya, getKya } from '../identity/kya-gateway.js';
import { logger } from '../logger.js';

const router = Router();

const kyaRegisterSchema = z.object({
  agentId: z.string().min(1).max(128),
  ownerEmail: z.string().email().max(320),
  ownerId: z.string().max(128).optional(),
  stripeAccount: z.string().max(128).optional(),
  platformToken: z.string().max(512).optional(),
  worldIdHash: z.string().max(256).optional(),
});

/**
 * POST /kya/register
 */
router.post('/register', async (req: Request, res: Response) => {
  const parsed = kyaRegisterSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation error', details: parsed.error.issues.map((e) => e.message) });
    return;
  }

  try {
    const identity = registerKya(parsed.data);

    res.status(201).json({ success: true, identity });
  } catch (error: any) {
    if (error.message === 'Agent is already registered') {
      res.status(409).json({ error: error.message });
      return;
    }
    if (error.message === 'Invalid email format') {
      res.status(400).json({ error: error.message });
      return;
    }
    logger.error('KYA registration error:', error);
    res.status(500).json({ error: 'Failed to register agent identity' });
  }
});

/**
 * GET /kya/:agentId
 */
router.get('/:agentId', async (req: Request, res: Response) => {
  try {
    const { agentId } = req.params;
    const identity = getKya(agentId);

    if (!identity) {
      res.status(404).json({ error: 'KYA identity not found' });
      return;
    }

    res.json({ success: true, identity });
  } catch (error: any) {
    logger.error('KYA lookup error:', error);
    res.status(500).json({ error: 'Failed to fetch KYA identity' });
  }
});

export default router;
