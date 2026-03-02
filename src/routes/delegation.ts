import { Router, Request, Response } from 'express';
import { authenticateApiKey } from '../middleware/auth.js';
import * as delegationService from '../services/delegationService.js';
import { logger } from '../logger.js';

const router = Router();

router.post('/create', authenticateApiKey, async (req: Request, res: Response) => {
  try {
    const { agentId, publicKey, spendingLimit, expiresAt } = req.body;
    if (!agentId || !publicKey) {
      res.status(400).json({ error: 'agentId and publicKey are required' });
      return;
    }
    const result = await delegationService.createDelegation(agentId, { publicKey, spendingLimit, expiresAt });
    res.status(201).json({ success: true, data: result });
  } catch (err: any) {
    logger.error('Create delegation error', { err });
    res.status(500).json({ error: 'Failed to create delegation' });
  }
});

router.post('/authorize', authenticateApiKey, async (req: Request, res: Response) => {
  try {
    const { delegationId, agentId } = req.body;
    if (!delegationId || !agentId) {
      res.status(400).json({ error: 'delegationId and agentId are required' });
      return;
    }
    await delegationService.authorizeDelegation(delegationId, agentId);
    res.json({ success: true });
  } catch (err: any) {
    logger.error('Authorize delegation error', { err });
    res.status(400).json({ error: err.message || 'Failed to authorize delegation' });
  }
});

router.post('/revoke', authenticateApiKey, async (req: Request, res: Response) => {
  try {
    const { delegationId, agentId } = req.body;
    if (!delegationId || !agentId) {
      res.status(400).json({ error: 'delegationId and agentId are required' });
      return;
    }
    await delegationService.revokeDelegation(delegationId, agentId);
    res.json({ success: true });
  } catch (err: any) {
    logger.error('Revoke delegation error', { err });
    res.status(400).json({ error: err.message || 'Failed to revoke delegation' });
  }
});

export default router;
