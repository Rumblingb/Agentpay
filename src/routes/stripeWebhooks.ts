import { Router, Request, Response } from 'express';
import * as stripeService from '../services/stripeService.js';
import * as webhooksService from '../services/webhooks.js';
import type { WebhookPayload } from '../services/webhooks.js';
import { logger } from '../logger.js';
import { query } from '../db/index.js'; // Use centralized query import

const router = Router();

router.post('/', async (req: Request, res: Response) => {
  const sig = req.headers['stripe-signature'] as string | undefined;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || '';

  if (!sig) {
    logger.warn('Stripe webhook: missing stripe-signature header');
    return res.status(400).json({ error: 'Missing stripe-signature header' });
  }

  let event;
  try {
    event = stripeService.constructStripeEvent(req.body as Buffer, sig, webhookSecret);
  } catch (err: any) {
    logger.warn('Stripe webhook signature validation failed', { error: err.message });
    return res.status(400).json({ error: `Signature verification failed` });
  }

  // Acknowledge receipt immediately to Stripe
  res.status(200).json({ received: true });

  try {
    switch (event.type) {
      /**
       * CASE 1: Payment Completion
       */
      case 'checkout.session.completed': {
        const session = event.data.object as any;
        const sessionId = session.id;
        
        const intent = await stripeService.getIntentByStripeReference(sessionId);
        if (!intent) {
          logger.warn('Stripe webhook: no transaction linked to session', { sessionId });
          break;
        }

        await stripeService.markIntentVerified(intent.id, sessionId);

        const payload: WebhookPayload = {
          event: 'payment.verified',
          transactionId: intent.id,
          merchantId: intent.merchantId,
          verified: true,
          timestamp: new Date().toISOString(),
        };

        const merchantResult = await query(
          `SELECT webhook_url as "webhookUrl" FROM merchants WHERE id = $1`,
          [intent.merchantId]
        );
        
        const webhookUrl = merchantResult.rows[0]?.webhookUrl;

        if (webhookUrl) {
          // This calls your scheduling service which inserts into webhook_events
          await webhooksService.scheduleWebhook(webhookUrl, payload, intent.merchantId, intent.id);
        }

        logger.info('checkout.session.completed handled', { sessionId, transactionId: intent.id });
        break;
      }

      /**
       * CASE 2: Payment Intent Succeeded
       */
      case 'payment_intent.succeeded': {
        const paymentIntent = event.data.object as any;
        const paymentIntentId = paymentIntent.id;

        logger.info('payment_intent.succeeded received', { paymentIntentId });

        const result = await query(
          `UPDATE intents
           SET status = 'confirmed', updated_at = NOW()
           WHERE stripe_payment_reference = $1 AND status != 'confirmed'`,
          [paymentIntentId]
        );

        if (result.rowCount && result.rowCount > 0) {
          logger.info('Intent confirmed via payment_intent.succeeded', { paymentIntentId });
        } else {
          logger.warn('No matching intent found or already confirmed', { paymentIntentId });
        }
        break;
      }

      /**
       * CASE 3: Stripe Connect Onboarding Completion
       * This is what was missing for your "Stripe onboarding done properly" goal.
       */
      case 'account.updated': {
        const account = event.data.object as any;
        
        // details_submitted is true when the merchant finished the Stripe forms
        if (account.details_submitted) {
          await query(
            `UPDATE merchants 
             SET stripe_connected = true, updated_at = NOW() 
             WHERE stripe_account_id = $1`,
            [account.id]
          );
          logger.info('Merchant Stripe Connect onboarding verified', { accountId: account.id });
        }
        break;
      }

      default:
        logger.debug(`Unhandled event type ${event.type}`);
    }
  } catch (err: any) {
    logger.error('Error processing Stripe webhook', { 
      type: event.type, 
      error: err.message 
    });
  }
});

export default router;