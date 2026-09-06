/**
 * Public Builder plan checkout — GET/POST /api/billing/plans/builder
 *
 * Uses the existing Stripe price price_1U9CNjPXcf9g8qGxzygstusB.
 * collection.available is true only when STRIPE_SECRET_KEY is set.
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import {
  BUILDER_STRIPE_PRICE_ID,
  builderCheckoutUnavailableBody,
  builderCollectionStatus,
} from '../lib/builderCheckout';

const router = new Hono<{ Bindings: Env; Variables: Variables }>();

async function createBuilderCheckoutSession(env: Env): Promise<{ url: string; id: string }> {
  const frontendUrl = (env.FRONTEND_URL || env.API_BASE_URL || 'https://agentpay.so').replace(/\/$/, '');
  const successUrl = env.STRIPE_SUCCESS_URL || `${frontendUrl}/start?builder=success`;
  const cancelUrl = env.STRIPE_CANCEL_URL || `${frontendUrl}/start?builder=cancelled`;

  const body = new URLSearchParams({
    mode: 'subscription',
    'line_items[0][price]': BUILDER_STRIPE_PRICE_ID,
    'line_items[0][quantity]': '1',
    billing_address_collection: 'auto',
    payment_method_collection: 'always',
    success_url: successUrl,
    cancel_url: cancelUrl,
    'metadata[plan]': 'builder',
    'metadata[product]': 'agentpay_builder',
  });

  const stripeResponse = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  const text = await stripeResponse.text();
  if (!stripeResponse.ok) {
    throw new Error(`STRIPE_BUILDER_CHECKOUT_FAILED:${text.slice(0, 400)}`);
  }
  const checkout = JSON.parse(text) as { id?: string; url?: string };
  if (!checkout.url || !checkout.id) {
    throw new Error('STRIPE_BUILDER_CHECKOUT_MISSING_URL');
  }
  return { url: checkout.url, id: checkout.id };
}

router.get('/', (c) => {
  return c.json({
    plan: 'builder',
    monthlyUsd: 39,
    fundedActionFeeBps: 75,
    collection: builderCollectionStatus(c.env.STRIPE_SECRET_KEY),
    checkout: '/api/billing/plans/builder',
    note: Boolean(c.env.STRIPE_SECRET_KEY)
      ? 'POST this path to start Stripe Checkout. collection.available is true.'
      : 'Blocked on STRIPE_SECRET_KEY. Price price_1U9CNjPXcf9g8qGxzygstusB is ready once the secret is set.',
  });
});

async function startBuilderCheckout(c: { env: Env; json: (body: unknown, status?: 201 | 502 | 503, headers?: Record<string, string>) => Response; redirect: (url: string, status?: 302) => Response }, redirect: boolean) {
  if (!c.env.STRIPE_SECRET_KEY) {
    return c.json(builderCheckoutUnavailableBody(c.env.STRIPE_SECRET_KEY), 503);
  }

  try {
    const session = await createBuilderCheckoutSession(c.env);
    if (redirect) {
      return c.redirect(session.url, 302);
    }
    return c.json({
      success: true,
      plan: 'builder',
      checkoutUrl: session.url,
      checkoutSessionId: session.id,
      collection: builderCollectionStatus(c.env.STRIPE_SECRET_KEY),
    }, 201);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error('[billing/plans/builder] Stripe error:', reason);
    return c.json({
      error: 'STRIPE_CHECKOUT_FAILED',
      message: 'Stripe rejected Builder checkout. Confirm STRIPE_SECRET_KEY can create sessions for price_1U9CNjPXcf9g8qGxzygstusB.',
      collection: builderCollectionStatus(c.env.STRIPE_SECRET_KEY),
    }, 502);
  }
}

router.post('/', async (c) => startBuilderCheckout(c, false));
router.get('/checkout', async (c) => startBuilderCheckout(c, true));

export { router as billingPlansRouter };
