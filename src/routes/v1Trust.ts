/**
 * Trust Event History API — GET /api/v1/trust/events
 *
 * Public, read-only endpoint that returns recent trust events from the
 * canonical trust_events table.  Supports pagination and filtering.
 *
 * No sensitive internal data is exposed — only the structured event
 * fields that are safe to share with external consumers.
 *
 * @module routes/v1Trust
 */

import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { getTrustEvents } from '../services/trustEventService.js';
import { logger } from '../logger.js';

const router = Router();

const trustEventsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

router.use(trustEventsLimiter);

/**
 * GET /api/v1/trust/events
 *
 * Returns recent trust events from the canonical trust event store.
 *
 * Query params:
 *   agentId   — filter to a specific agent (optional)
 *   eventType — filter by event type, e.g. "agent.verified" (optional)
 *   limit     — page size (1–100, default 50)
 *   offset    — pagination offset (default 0)
 *
 * Response shape:
 *   {
 *     events: [{ eventType, agentId, counterpartyId, delta, timestamp, metadata }],
 *     pagination: { total, limit, offset, hasMore }
 *   }
 */
router.get('/events', async (req: Request, res: Response) => {
  try {
    const rawLimit = req.query.limit as string | undefined;
    const rawOffset = req.query.offset as string | undefined;
    const agentId = typeof req.query.agentId === 'string' ? req.query.agentId.trim() : undefined;
    const eventType = typeof req.query.eventType === 'string' ? req.query.eventType.trim() : undefined;

    const limit = Math.min(100, Math.max(1, rawLimit ? parseInt(rawLimit, 10) : 50));
    const offset = Math.max(0, rawOffset ? parseInt(rawOffset, 10) : 0);

    if (isNaN(limit) || isNaN(offset)) {
      res.status(400).json({ error: 'limit and offset must be integers' });
      return;
    }

    const { events, total } = await getTrustEvents({ agentId, eventType, limit, offset });

    res.json({
      events,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + limit < total,
      },
    });
  } catch (err: any) {
    logger.error('GET /api/v1/trust/events failed', { err });
    res.status(500).json({ error: 'Failed to fetch trust events' });
  }
});

export default router;
