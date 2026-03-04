/**
 * KYA (Know Your Agent) API route.
 *
 * POST /kya/register — register an agent identity with owner verification.
 * GET  /kya/:agentId — look up a KYA identity.
 *
 * @module routes/kya
 */

import { Router, Request, Response } from 'express';
import { registerKya, getKya } from '../identity/kya-gateway.js';
import { logger } from '../logger.js';

const router = Router();

/**
 * POST /kya/register
 */
router.post('/register', async (req: Request, res: Response) => {
  try {
    const { agentId, ownerEmail, ownerId, stripeAccount, platformToken, worldIdHash } = req.body;

    if (!agentId || !ownerEmail) {
      res.status(400).json({ error: 'agentId and ownerEmail are required' });
      return;
    }

    const identity = registerKya({
      agentId,
      ownerEmail,
      ownerId,
      stripeAccount,
      platformToken,
      worldIdHash,
    });

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
