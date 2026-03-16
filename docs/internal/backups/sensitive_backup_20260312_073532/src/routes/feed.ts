/**
 * Live Feed Route — SSE stream of marketplace events.
 *
 * GET /api/feed/stream?agentId=...
 *
 * Clients receive real-time events:
 *   job.created | agent.hired | escrow.released | agent.earned | ranking.updated
 *
 * No auth required — events are public (no sensitive data).
 * Pass agentId query param to filter to a specific agent's events.
 *
 * @module routes/feed
 */

import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { addSseClient, getSseClientCount } from '../events/marketplaceEmitter.js';
import { logger } from '../logger.js';

const router = Router();

const feedLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many feed connections, please retry later.' },
});

router.use(feedLimiter);

const streamQuerySchema = z.object({
  agentId: z.string().max(256).optional(),
});

/**
 * GET /api/feed/stream
 *
 * Opens a Server-Sent Events stream. Each event is a JSON object on the
 * `data:` field following the SSE spec.
 *
 * Example client usage:
 *   const es = new EventSource('/api/feed/stream?agentId=my-agent-id');
 *   es.onmessage = (e) => console.log(JSON.parse(e.data));
 */
router.get('/stream', (req: Request, res: Response) => {
  const parsed = streamQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid query parameters' });
    return;
  }

  const { agentId } = parsed.data;

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // disable Nginx buffering
  res.flushHeaders();

  logger.info('[feed] SSE stream opened', { agentId, ip: req.ip });

  const cleanup = addSseClient(res, agentId);

  // Clean up when client disconnects
  req.on('close', cleanup);
  req.on('error', cleanup);
});

/**
 * GET /api/feed/status
 *
 * Returns number of currently connected SSE clients.
 */
router.get('/status', (_req: Request, res: Response) => {
  res.json({
    success: true,
    connectedClients: getSseClientCount(),
  });
});

export default router;
