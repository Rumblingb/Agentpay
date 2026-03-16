import { Router, Request, Response } from 'express';
import * as stripeService from '../services/stripeService.js';
import * as webhooksService from '../services/webhooks.js';
import type { WebhookPayload } from '../services/webhooks.js';
import { logger } from '../logger.js';
import { query } from '../db/index.js'; // Use centralized query import
import {
  ingestStripeProof,
  normalizeStripeObservation,
  type StripeObservation,
} from '../settlement/settlementEventIngestion.js';
import {
  runResolutionEngine,
  type RunEngineParams,
} from '../settlement/intentResolutionEngine.js';

const router = Router();

// ---------------------------------------------------------------------------
// Internal helper: look up the payment_intent ID from a transactions row.
// transactions.payment_id → payment_intents.id (UUID FK).
// Returns null if not found or on any DB error (non-fatal).
// ---------------------------------------------------------------------------
async function getPaymentIntentId(transactionId: string): Promise<string | null> {
  try {
    const result = await query(
      `SELECT payment_id AS "paymentIntentId" FROM transactions WHERE id = $1`,
      [transactionId],
    );
    return (result.rows[0]?.paymentIntentId as string) ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Internal helper: look up expected amount (USDC) for a payment intent.
// Returns null if not found.
// ---------------------------------------------------------------------------
async function getIntentAmount(paymentIntentId: string): Promise<number | null> {
  try {
    const result = await query(
      `SELECT amount FROM payment_intents WHERE id = $1`,
      [paymentIntentId],
    );
    const raw = result.rows[0]?.amount;
    return raw !== undefined && raw !== null ? Number(raw) : null;
  } catch {
    return null;
  }
}

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
       *
       * Phase 10: after the existing markIntentVerified() call:
       *   1. Emit a settlement event via ingestStripeProof() (fire-and-forget)
       *   2. Look up the payment_intent ID from the transactions row
       *   3. Run the resolution engine non-fatally to produce an
       *      intent_resolutions record with a fine-grained decision + reason
       *
       * Stripe event → settlement_event mapping:
       *   event_type  = 'webhook_received'
       *   protocol    = 'stripe'
       *   external_ref = session.id (cs_...)
       *   payload     = normalized StripeObservation
       */
      case 'checkout.session.completed': {
        const session = event.data.object as any;
        const sessionId = session.id as string;

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

        // ── Phase 10: settlement event ingestion ──────────────────────────
        // Step 1: emit settlement event (fire-and-forget — non-blocking)
        const stripeObs: StripeObservation = {
          stripeEventType: 'checkout.session.completed',
          externalId: sessionId,
          customerId: (session.customer as string | null) ?? null,
          connectedAccountId: (session.account as string | null) ?? null,
          amountTotal: session.amount_total ?? null,
          currency: session.currency ?? null,
          status: 'succeeded',
          metadata: (session.metadata as Record<string, unknown>) ?? {},
        };

        // Look up payment intent ID before ingesting so opts.intentId is correct
        const paymentIntentId = await getPaymentIntentId(intent.id);

        ingestStripeProof(stripeObs, {
          ...(paymentIntentId ? { intentId: paymentIntentId } : {}),
        });

        // Step 2: run resolution engine (best-effort — failure must not
        // disturb the already-acknowledged Stripe webhook response)
        if (paymentIntentId) {
          setImmediate(() => {
            (async () => {
              try {
                const expectedUsdc = await getIntentAmount(paymentIntentId);
                // amount_total is in cents; convert to dollars for comparison
                const observedUsdc =
                  stripeObs.amountTotal !== null ? stripeObs.amountTotal / 100 : null;

                const proof = normalizeStripeObservation(stripeObs);

                const engineParams: RunEngineParams = {
                  intentId: paymentIntentId,
                  proof,
                  expectedAmountUsdc: expectedUsdc ?? observedUsdc ?? 0,
                  merchantWallet: null, // not applicable for Stripe
                  verificationToken: null, // Stripe uses session ID matching, not memo
                  resolvedBy: 'stripe_webhook',
                };

                const result = await runResolutionEngine(engineParams);

                logger.info('Stripe webhook: resolution engine result', {
                  sessionId,
                  paymentIntentId,
                  decision: result.evaluation.decision,
                  reasonCode: result.evaluation.reasonCode,
                  resolutionStatus: result.evaluation.resolutionStatus,
                  wasAlreadyResolved: result.wasAlreadyResolved,
                });
              } catch (engineErr: unknown) {
                logger.warn('Stripe webhook: resolution engine failed (non-fatal)', {
                  sessionId,
                  paymentIntentId,
                  error: engineErr instanceof Error ? engineErr.message : String(engineErr),
                });
              }
            })();
          });
        }

        break;
      }

      /**
       * CASE 2: Payment Intent Succeeded
       *
       * Phase 10: emit a settlement event via ingestStripeProof().
       *
       * NOTE: The resolution engine is intentionally NOT called here.
       * `checkout.session.completed` is the only event that can reliably
       * link a Stripe session to a payment_intent row in our DB, so resolution
       * runs exclusively there. This event only updates the `intents` table
       * directly and records the settlement event for audit trail purposes.
       *
       * Stripe event → settlement_event mapping:
       *   event_type  = 'webhook_received'
       *   protocol    = 'stripe'
       *   external_ref = paymentIntent.id (pi_...)
       */
      case 'payment_intent.succeeded': {
        const paymentIntent = event.data.object as any;
        const paymentIntentId = paymentIntent.id as string;

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

        // ── Phase 10: fire-and-forget settlement event ────────────────────
        ingestStripeProof({
          stripeEventType: 'payment_intent.succeeded',
          externalId: paymentIntentId,
          customerId: (paymentIntent.customer as string | null) ?? null,
          connectedAccountId: (paymentIntent.on_behalf_of as string | null) ?? null,
          amountTotal: paymentIntent.amount ?? null,
          currency: paymentIntent.currency ?? null,
          status: 'succeeded',
          metadata: (paymentIntent.metadata as Record<string, unknown>) ?? {},
        });

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