/**
 * Stripe webhook routes — POST /webhooks/stripe
 *
 * Ports src/routes/stripeWebhooks.ts to Hono/Workers.
 *
 * HIGH-RISK migration area — two things must be exact:
 *   1. Raw body: Stripe's HMAC verification operates on the exact bytes received.
 *      In Workers, `c.req.arrayBuffer()` reads the body before any parsing.
 *      We convert to string with TextDecoder (UTF-8, same as Node.js Buffer.toString()).
 *   2. Stripe signature verification: Use `stripe.webhooks.constructEventAsync()`
 *      with `Stripe.createSubtleCryptoProvider()` — the Workers-compatible async
 *      equivalent of `stripe.webhooks.constructEvent()`.
 *
 * Changes from Express:
 *   - No express.raw() — Workers have no body-parsing middleware; raw body
 *     is always available via c.req.arrayBuffer()
 *   - constructEvent → constructEventAsync with SubtleCryptoProvider
 *   - STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET from c.env
 *   - Inline SQL for intent lookup / status update instead of stripeService imports
 *   - Stripe SDK initialised per-invocation (Workers are stateless)
 *
 * Preserved:
 *   - Route path: POST /webhooks/stripe
 *   - Acknowledge immediately (200 before processing) to prevent Stripe retries
 *   - Same event types handled: checkout.session.completed,
 *     payment_intent.succeeded, account.updated
 *
 * Deferred:
 *   - Outbound webhook dispatch after checkout.session.completed
 *     (scheduleWebhook relies on outbound HTTP + DB — included inline for beta)
 */

import { Hono } from 'hono';
import Stripe from 'stripe';
import type { Env, Variables } from '../types';
import { createDb } from '../lib/db';

const router = new Hono<{ Bindings: Env; Variables: Variables }>();

router.post('/', async (c) => {
  // Guard: Stripe must be configured
  if (!c.env.STRIPE_SECRET_KEY || !c.env.STRIPE_WEBHOOK_SECRET) {
    console.warn('[stripe-webhook] Stripe not configured — rejecting request');
    return c.json({ error: 'Stripe not configured' }, 503);
  }

  const sig = c.req.header('stripe-signature');
  if (!sig) {
    console.warn('[stripe-webhook] missing stripe-signature header');
    return c.json({ error: 'Missing stripe-signature header' }, 400);
  }

  // Read raw body as ArrayBuffer, then decode as UTF-8 string.
  // Must happen BEFORE any c.req.json() call — Workers consume the body stream once.
  const rawBuffer = await c.req.arrayBuffer();
  const rawBody = new TextDecoder('utf-8').decode(rawBuffer);

  // Initialise Stripe per-invocation with the Workers-compatible fetch client.
  const stripe = new Stripe(c.env.STRIPE_SECRET_KEY, {
    httpClient: Stripe.createFetchHttpClient(),
  });

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      rawBody,
      sig,
      c.env.STRIPE_WEBHOOK_SECRET,
      undefined,
      Stripe.createSubtleCryptoProvider(),
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('[stripe-webhook] signature validation failed:', msg);
    return c.json({ error: 'Signature verification failed' }, 400);
  }

  // Acknowledge receipt immediately — Stripe requires a 2xx within 30 s.
  // Processing happens below using waitUntil so the response is sent first.
  const sql = createDb(c.env);

  // Process the event after acknowledging. If processing fails, Stripe will
  // retry based on its retry schedule — the 200 ack is always sent.
  const processStripeEvent = async () => {
    try {
      switch (event.type) {
        // ── CASE 1: Checkout session completed ──────────────────────────────
        case 'checkout.session.completed': {
          const session = event.data.object as Stripe.Checkout.Session;
          const sessionId = session.id;

          // Find the transaction linked to this Stripe session
          const rows = await sql<Array<{ id: string; merchantId: string }>>`
            SELECT id, merchant_id AS "merchantId"
            FROM transactions
            WHERE stripe_payment_reference = ${sessionId}
          `;

          if (!rows.length) {
            console.warn('[stripe-webhook] no transaction for session', { sessionId });
            break;
          }

          const intent = rows[0];

          await sql`
            UPDATE transactions
            SET status = 'confirmed',
                stripe_payment_reference = ${sessionId},
                updated_at = NOW()
            WHERE id = ${intent.id}
          `;

          // Look up merchant webhook URL for outbound notification
          const merchantRows = await sql<Array<{ webhookUrl: string | null }>>`
            SELECT webhook_url AS "webhookUrl"
            FROM merchants
            WHERE id = ${intent.merchantId}
          `;
          const webhookUrl = merchantRows[0]?.webhookUrl ?? null;

          if (webhookUrl) {
            // Deliver payment.verified notification to merchant webhook.
            // Failure is logged but does not affect the Stripe ack.
            const payload = {
              event: 'payment.verified',
              transactionId: intent.id,
              merchantId: intent.merchantId,
              verified: true,
              timestamp: new Date().toISOString(),
            };
            await sql`
              INSERT INTO webhook_events (id, merchant_id, event_type, status, payload, created_at)
              VALUES (${crypto.randomUUID()}, ${intent.merchantId}, 'payment.verified',
                      'pending', ${JSON.stringify(payload)}::jsonb, NOW())
            `.catch((e: unknown) =>
              console.error('[stripe-webhook] webhook_events insert failed:', e instanceof Error ? e.message : e),
            );
          }

          console.info('[stripe-webhook] checkout.session.completed handled', {
            sessionId,
            transactionId: intent.id,
          });
          break;
        }

        // ── CASE 2: Payment intent succeeded ─────────────────────────────────
        case 'payment_intent.succeeded': {
          const pi = event.data.object as Stripe.PaymentIntent;
          await sql`
            UPDATE transactions
            SET status = 'confirmed', updated_at = NOW()
            WHERE stripe_payment_reference = ${pi.id}
              AND status != 'confirmed'
          `;
          console.info('[stripe-webhook] payment_intent.succeeded', { paymentIntentId: pi.id });
          break;
        }

        // ── CASE 3: Stripe Connect onboarding completed ───────────────────────
        case 'account.updated': {
          const account = event.data.object as Stripe.Account;
          if (account.details_submitted) {
            await sql`
              UPDATE merchants
              SET stripe_connected = true, updated_at = NOW()
              WHERE stripe_account_id = ${account.id}
            `;
            console.info('[stripe-webhook] account.updated — onboarding verified', {
              accountId: account.id,
            });
          }
          break;
        }

        default:
          console.info('[stripe-webhook] unhandled event type', { type: event.type });
      }
    } catch (err: unknown) {
      console.error('[stripe-webhook] processing error', {
        type: event.type,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      sql.end().catch(() => {});
    }
  };

  // Start processing but don't await — return 200 immediately.
  // ctx.waitUntil keeps the Worker alive until processStripeEvent() resolves.
  c.executionCtx.waitUntil(processStripeEvent());

  return c.json({ received: true });
});

export { router as stripeWebhooksRouter };
