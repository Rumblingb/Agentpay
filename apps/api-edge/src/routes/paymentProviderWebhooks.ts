import { Hono } from 'hono';
import Stripe from 'stripe';

import type { Env, Variables } from '../types';
import { createDb, type Sql } from '../lib/db';
import type { PaymentProvider, PaymentState } from '../lib/paymentProviders';

const router = new Hono<{ Bindings: Env; Variables: Variables }>();
const AIRWALLEX_REPLAY_WINDOW_MS = 5 * 60 * 1000;
const encoder = new TextEncoder();

type ProviderTransition = Extract<PaymentState, 'succeeded' | 'failed' | 'cancelled'>;

export function classifyStripeProviderEvent(event: Stripe.Event): ProviderTransition | null {
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    return session.payment_status === 'paid' ? 'succeeded' : null;
  }
  if (event.type === 'checkout.session.async_payment_succeeded') return 'succeeded';
  if (event.type === 'checkout.session.async_payment_failed') return 'failed';
  if (event.type === 'checkout.session.expired') return 'cancelled';
  return null;
}

export function classifyAirwallexProviderEvent(event: {
  name?: string;
  data?: { object?: { status?: string } };
}): ProviderTransition | null {
  const name = event.name ?? '';
  const status = event.data?.object?.status ?? '';
  if (name === 'payment_intent.succeeded' || status === 'SUCCEEDED') return 'succeeded';
  if (name === 'payment_intent.cancelled' || status === 'CANCELLED') return 'cancelled';
  if (name === 'payment_intent.failed' || status === 'FAILED') return 'failed';
  return null;
}

export async function verifyAirwallexProviderSignature(
  timestamp: string,
  rawBody: string,
  signatureHex: string,
  secret: string,
): Promise<boolean> {
  if (!/^[0-9a-f]{64}$/i.test(signatureHex)) return false;
  const signature = new Uint8Array(
    signatureHex.match(/.{2}/g)!.map((pair) => Number.parseInt(pair, 16)),
  );
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  return crypto.subtle.verify(
    'HMAC',
    key,
    signature,
    encoder.encode(`${timestamp}${rawBody}`),
  );
}

async function applyProviderTransition(
  env: Env,
  input: {
    provider: PaymentProvider;
    providerReference: string;
    providerEventId: string;
    eventType: string;
    transition: ProviderTransition;
  },
) {
  const sql = createDb(env);
  try {
    return await sql.begin(async (transaction) => {
      const tx = transaction as unknown as Sql;
      const payments = await tx<Array<{
        id: string;
        merchantId: string;
        correlationId: string;
        state: string;
        amountMinor: string;
        currency: string;
      }>>`
        SELECT
          id,
          merchant_id AS "merchantId",
          idempotency_key AS "correlationId",
          state,
          amount_minor::text AS "amountMinor",
          currency
        FROM provider_payment_requests
        WHERE provider = ${input.provider}
          AND provider_reference = ${input.providerReference}
        FOR UPDATE
      `;
      if (!payments.length) return { handled: false, reason: 'payment_not_found' as const };

      const payment = payments[0];
      const events = await tx<Array<{ sequenceId: string }>>`
        INSERT INTO provider_payment_events (
          payment_request_id,
          merchant_id,
          provider,
          event_type,
          correlation_id,
          provider_event_id,
          state,
          amount_minor,
          currency
        ) VALUES (
          ${payment.id},
          ${payment.merchantId},
          ${input.provider},
          ${input.eventType},
          ${payment.correlationId},
          ${input.providerEventId},
          ${input.transition},
          ${payment.amountMinor},
          ${payment.currency}
        )
        ON CONFLICT (provider, provider_event_id) DO NOTHING
        RETURNING sequence_id::text AS "sequenceId"
      `;
      if (!events.length) return { handled: false, reason: 'duplicate' as const };

      const terminal = ['succeeded', 'failed', 'cancelled'].includes(payment.state);
      if (terminal && payment.state !== input.transition) {
        return { handled: false, reason: 'terminal_state_preserved' as const };
      }

      await tx`
        UPDATE provider_payment_requests
        SET
          state = ${input.transition},
          response_payload = COALESCE(response_payload, '{}'::jsonb)
            || jsonb_build_object('state', ${input.transition}),
          updated_at = now()
        WHERE id = ${payment.id}
      `;
      return { handled: true, state: input.transition };
    });
  } finally {
    sql.end().catch(() => {});
  }
}

router.post('/stripe', async (c) => {
  if (!c.env.STRIPE_SECRET_KEY || !c.env.STRIPE_PROVIDER_WEBHOOK_SECRET) {
    return c.json({ error: 'Webhook not configured' }, 503);
  }
  const signature = c.req.header('stripe-signature');
  if (!signature) return c.json({ error: 'Missing stripe-signature header' }, 400);

  const rawBody = new TextDecoder().decode(await c.req.arrayBuffer());
  const stripe = new Stripe(c.env.STRIPE_SECRET_KEY, {
    httpClient: Stripe.createFetchHttpClient(),
  });
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      rawBody,
      signature,
      c.env.STRIPE_PROVIDER_WEBHOOK_SECRET,
      undefined,
      Stripe.createSubtleCryptoProvider(),
    );
  } catch {
    return c.json({ error: 'Signature verification failed' }, 400);
  }

  const transition = classifyStripeProviderEvent(event);
  if (!transition) return c.json({ received: true, handled: false });
  const session = event.data.object as Stripe.Checkout.Session;
  try {
    const outcome = await applyProviderTransition(c.env, {
      provider: 'stripe',
      providerReference: session.id,
      providerEventId: event.id,
      eventType: event.type,
      transition,
    });
    return c.json({ received: true, ...outcome });
  } catch {
    return c.json({ error: 'Failed to persist provider event' }, 500);
  }
});

router.post('/airwallex', async (c) => {
  const secret = c.env.AIRWALLEX_PROVIDER_WEBHOOK_SECRET;
  if (!secret) return c.json({ error: 'Webhook not configured' }, 503);
  const timestamp = c.req.header('x-timestamp');
  const signature = c.req.header('x-signature');
  if (!timestamp || !signature) {
    return c.json({ error: 'x-timestamp and x-signature are required' }, 400);
  }
  const timestampMs = Number(timestamp);
  if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > AIRWALLEX_REPLAY_WINDOW_MS) {
    return c.json({ error: 'Webhook timestamp outside replay window' }, 400);
  }

  const rawBody = await c.req.text();
  if (!await verifyAirwallexProviderSignature(timestamp, rawBody, signature, secret)) {
    return c.json({ error: 'Signature verification failed' }, 400);
  }

  let event: {
    id?: string;
    name?: string;
    data?: { object?: { id?: string; status?: string } };
  };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }
  const providerReference = event.data?.object?.id;
  const transition = classifyAirwallexProviderEvent(event);
  if (!event.id || event.id.length > 255 || !providerReference || !transition) {
    return c.json({ received: true, handled: false });
  }

  try {
    const outcome = await applyProviderTransition(c.env, {
      provider: 'airwallex',
      providerReference,
      providerEventId: event.id,
      eventType: event.name ?? 'unknown',
      transition,
    });
    return c.json({ received: true, ...outcome });
  } catch {
    return c.json({ error: 'Failed to persist provider event' }, 500);
  }
});

export { router as paymentProviderWebhooksRouter };
