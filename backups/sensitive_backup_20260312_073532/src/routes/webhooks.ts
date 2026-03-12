import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authenticateApiKey } from '../middleware/auth.js';
import * as webhookController from '../controllers/webhookController.js';
import { verifyWebhookSignature } from '../middleware/verifyWebhook.js';
import { logger } from '../logger.js';

const router = Router();

const ALLOWED_EVENT_TYPES = ['payment_verified'] as const;

const subscribeSchema = z.object({
  url: z.string().url('url must be a valid URL'),
  eventTypes: z
    .array(z.enum(ALLOWED_EVENT_TYPES))
    .min(1, 'eventTypes must contain at least one event type'),
});

// POST /api/webhooks/subscribe
router.post('/subscribe', authenticateApiKey, async (req: Request, res: Response) => {
  const parsed = subscribeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Validation error',
      details: parsed.error.issues.map((e) => e.message),
    });
    return;
  }

  const { url, eventTypes } = parsed.data;
  const merchantId = (req as any).merchant!.id as string;

  try {
    const subscription = await webhookController.createSubscription(merchantId, url, eventTypes);
    logger.info('Webhook subscription created', { merchantId, subscriptionId: subscription.id });
    res.status(201).json({ success: true, subscription });
  } catch (err: any) {
    logger.error('Failed to create webhook subscription', { err });
    res.status(500).json({ error: 'Failed to create subscription' });
  }
});

// GET /api/webhooks
router.get('/', authenticateApiKey, async (req: Request, res: Response) => {
  const merchantId = (req as any).merchant!.id as string;

  try {
    const subscriptions = await webhookController.listSubscriptions(merchantId);
    res.json({ success: true, subscriptions });
  } catch (err: any) {
    logger.error('Failed to list webhook subscriptions', { err });
    res.status(500).json({ error: 'Failed to list subscriptions' });
  }
});

// DELETE /api/webhooks/:id
router.delete('/:id', authenticateApiKey, async (req: Request, res: Response) => {
  const merchantId = (req as any).merchant!.id as string;
  const { id } = req.params;

  try {
    const deleted = await webhookController.deleteSubscription(id, merchantId);
    if (!deleted) {
      res.status(404).json({ error: 'Subscription not found' });
      return;
    }
    logger.info('Webhook subscription deleted', { merchantId, subscriptionId: id });
    res.json({ success: true });
  } catch (err: any) {
    logger.error('Failed to delete webhook subscription', { err });
    res.status(500).json({ error: 'Failed to delete subscription' });
  }
});

/**
 * POST /api/webhooks/inbound
 *
 * Receive inbound webhook events from agents or external partners.
 * Requires valid HMAC-SHA256 signature via x-agentpay-signature header.
 */
router.post('/inbound', verifyWebhookSignature, async (req: Request, res: Response) => {
  try {
    const { event, payload } = req.body ?? {};
    logger.info('[Webhook] Inbound event received', { event });
    // Acknowledge receipt — specific event processing is handled downstream.
    res.status(200).json({ success: true, received: true, event: event ?? 'unknown' });
  } catch (err: any) {
    logger.error('Inbound webhook processing error', { err });
    res.status(500).json({ error: 'Failed to process inbound webhook' });
  }
});

export default router;
