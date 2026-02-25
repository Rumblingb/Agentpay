import { Router, Request, Response } from 'express';
import * as stripeService from '../services/stripeService';
import * as webhooksService from '../services/webhooks';
import type { WebhookPayload } from '../services/webhooks';
import { logger } from '../logger';

const router = Router();

/**
 * POST /webhooks/stripe
 * Receives Stripe webhook events with raw body for signature validation.
 * Handles checkout.session.completed → marks intent verified and fires
 * the payment_verified webhook via the existing webhook system.
 */
router.post('/', async (req: Request, res: Response) => {
  const sig = req.headers['stripe-signature'] as string | undefined;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || '';

  if (!sig) {
    logger.warn('Stripe webhook: missing stripe-signature header');
    res.status(400).json({ error: 'Missing stripe-signature header' });
    return;
  }

  let event;
  try {
    event = stripeService.constructStripeEvent(req.body as Buffer, sig, webhookSecret);
  } catch (err: any) {
    logger.warn('Stripe webhook signature validation failed', { error: err.message });
    res.status(400).json({ error: `Webhook signature verification failed: ${err.message}` });
    return;
  }

  // Acknowledge receipt immediately
  res.status(200).json({ received: true });

  // Handle supported event types
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as any;
    const sessionId: string = session.id;
    const merchantId: string | undefined = session.metadata?.merchantId;

    try {
      // Find the linked transaction by stripe_payment_reference
      const intent = await stripeService.getIntentByStripeReference(sessionId);

      if (!intent) {
        logger.warn('Stripe webhook: no transaction linked to session', { sessionId });
        return;
      }

      // Mark the transaction verified
      await stripeService.markIntentVerified(intent.id, sessionId);

      // Build and fire payment_verified webhook via PR2 system
      const payload: WebhookPayload = {
        event: 'payment.verified',
        transactionId: intent.id,
        merchantId: intent.merchantId,
        verified: true,
        timestamp: new Date().toISOString(),
      };

      // Look up the merchant's webhookUrl
      const { query } = await import('../db/index');
      const merchantResult = await query(
        `SELECT webhook_url as "webhookUrl" FROM merchants WHERE id = $1`,
        [intent.merchantId]
      );
      const webhookUrl: string | null = merchantResult.rows[0]?.webhookUrl ?? null;

      if (webhookUrl) {
        webhooksService
          .scheduleWebhook(webhookUrl, payload, intent.merchantId, intent.id)
          .catch((err) => logger.error('Stripe webhook scheduling error', { err }));
      }

      logger.info('checkout.session.completed handled', { sessionId, transactionId: intent.id });
    } catch (err: any) {
      logger.error('Error handling checkout.session.completed', { error: err.message, sessionId });
    }
  }
});

export default router;
