import { Router, Request, Response } from 'express';
import { recordTrustEvent } from '../services/trustEventService.js';
import * as reputationService from '../services/reputationService.js';
import { logger } from '../logger.js';

const router = Router();

/**
 * POST /api/interactions
 * Records agent-to-agent interaction, updates trust score, and pushes event to feed.
 * Payload:
 * {
 *   "from_agent": "agentA",
 *   "to_agent": "agentB",
 *   "type": "task",
 *   "success": true
 * }
 */
router.post('/', async (req: Request, res: Response) => {
  const { from_agent, to_agent, type, success } = req.body;
  if (!from_agent || !to_agent || !type || typeof success !== 'boolean') {
    res.status(400).json({ error: 'Missing required fields' });
    return;
  }

  try {
    // Step 0: Verify Agent Passport (identity)
    const agentPassport = await require('../lib/prisma').default.agent.findUnique({ where: { id: from_agent } });
    if (!agentPassport) {
      res.status(404).json({ error: 'Agent Passport not found' });
      return;
    }

    // Step 1: Record interaction (trust event)
    const trustCategory = success ? 'successful_interaction' : 'failed_interaction';
    const trustEventResult = await recordTrustEvent(
      from_agent,
      trustCategory,
      `${type} with ${to_agent}`,
      to_agent,
      { interactionType: type, outcome: success ? 'success' : 'failure' }
    );

    // Step 2: Auto-update trust_score in Agent table
    const [successCount, totalCount] = await Promise.all([
      require('../lib/prisma').default.trustEvent.count({
        where: {
          agentId: from_agent,
          category: 'successful_interaction',
        },
      }),
      require('../lib/prisma').default.trustEvent.count({
        where: {
          agentId: from_agent,
          category: { in: ['successful_interaction', 'failed_interaction'] },
        },
      }),
    ]);
    const trustScore = totalCount > 0 ? Math.round((successCount / totalCount) * 100) : 0;
    await require('../lib/prisma').default.agent.update({
      where: { id: from_agent },
      data: { trustScore },
    });

    // Step 3: Update TrustEdge (trust graph)
    await require('../services/trustGraphService').updateTrustEdge(from_agent, to_agent, success);

    // Step 4: Emit event to feed
    const { addSseClient } = require('../events/marketplaceEmitter.js');
    const event = {
      type: 'interaction',
      from: agentPassport.displayName || from_agent,
      to: to_agent,
      status: success ? 'completed' : 'failed',
      timestamp: new Date().toISOString(),
    };
    // This is a stub: in production, use a proper event bus or emitter
    if (typeof addSseClient === 'function') {
      // Broadcast to all SSE clients (simulate event feed)
      addSseClient.broadcast?.(event);
    }

    logger.info('Interaction recorded', {
      from_agent,
      to_agent,
      type,
      success,
      trustScore,
      trustEventResult,
      event,
    });

    res.status(201).json({
      success: true,
      interaction: {
        from_agent,
        to_agent,
        type,
        success,
        trust_score: trustScore,
      },
      event,
    });
  } catch (err: any) {
    logger.error('Interaction record error', { err });
    res.status(500).json({ error: 'Failed to record interaction' });
  }
});

export default router;
