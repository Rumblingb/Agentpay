import { Router, Request, Response } from 'express';
import { authenticateApiKey } from '../middleware/auth.js';
import * as agentIdentityService from '../services/agentIdentityService.js';
import { logger } from '../logger.js';

const router = Router();

router.post('/register', async (req: Request, res: Response) => {
  try {
    const { agentPublicKey, spendingLimit, pin, deviceFingerprint } = req.body;
    const result = await agentIdentityService.registerAgent({ agentPublicKey, spendingLimit, pin, deviceFingerprint });
    res.status(201).json({ success: true, data: result });
  } catch (err: any) {
    logger.error('Agent registration error', { err });
    res.status(500).json({ error: 'Failed to register agent' });
  }
});

router.patch('/update', authenticateApiKey, async (req: Request, res: Response) => {
  try {
    const { agentId, agentPublicKey, spendingLimit, pin, deviceFingerprint } = req.body;
    if (!agentId) {
      res.status(400).json({ error: 'agentId is required' });
      return;
    }
    await agentIdentityService.updateAgent(agentId, { agentPublicKey, spendingLimit, pin, deviceFingerprint });
    res.json({ success: true });
  } catch (err: any) {
    logger.error('Agent update error', { err });
    res.status(500).json({ error: 'Failed to update agent' });
  }
});

router.post('/verify-pin', async (req: Request, res: Response) => {
  try {
    const { agentId, pin } = req.body;
    if (!agentId || !pin) {
      res.status(400).json({ error: 'agentId and pin are required' });
      return;
    }
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
