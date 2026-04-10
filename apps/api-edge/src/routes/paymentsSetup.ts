/**
 * Payment method setup routes — /api/payments/*
 *
 * Handles Stripe Setup Intents and saved payment method storage.
 * These are the prerequisite for off-session charges (CRM recurring billing,
 * agent-initiated payments above auto-approve threshold).
 *
 * Endpoints:
 *   POST /api/payments/setup-intent            — create Stripe Setup Intent
 *   POST /api/payments/confirm-setup           — store pm after client completes setup
 *   GET  /api/payments/methods/:principalId    — list saved payment methods
 *   DELETE /api/payments/methods/:methodId     — remove a payment method
 *
 * Auth:
 *   - first-party Ace app via x-bro-key
 *   - merchant API key via authenticateApiKey
 *
 * Flow:
 *   1. Client calls POST /setup-intent → gets clientSecret
 *   2. Client renders Stripe payment sheet (Stripe React Native / Stripe.js)
 *   3. On sheet success, Stripe SDK returns paymentMethodId
 *   4. Client calls POST /confirm-setup with paymentMethodId
 *   5. This route attaches the method to the principal's Stripe customer
 *      and stores a row in principal_payment_methods
 *
 * ─── DB migration required ──────────────────────────────────────────────────
 *
 * Run once against your Supabase Direct connection (port 5432):
 *
 * CREATE TABLE IF NOT EXISTS principal_payment_methods (
 *   id                  uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
 *   principal_id        text    NOT NULL,
 *   stripe_pm_id        text    NOT NULL UNIQUE,
 *   stripe_customer_id  text,
 *   last4               text,
 *   brand               text,
 *   is_default          boolean NOT NULL DEFAULT false,
 *   created_at          timestamptz NOT NULL DEFAULT now()
 * );
 *
 * CREATE INDEX IF NOT EXISTS principal_payment_methods_principal_idx
 *   ON principal_payment_methods (principal_id);
 * ────────────────────────────────────────────────────────────────────────────
 */

import { Hono } from 'hono';
import Stripe from 'stripe';
import type { Env, Variables } from '../types';
import { authenticateApiKey } from '../middleware/auth';
import { createDb } from '../lib/db';
import {
  createStripeClient,
  stripeCustomerIdFromRef,
  verifySucceededSetupIntent,
} from '../lib/stripeSetupIntents';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PaymentMethodRow {
  id: string;
  principal_id: string;
  stripe_pm_id: string;
  stripe_customer_id: string | null;
  last4: string | null;
  brand: string | null;
  is_default: boolean;
  created_at: Date;
}

/**
 * Finds or creates a Stripe Customer for the given principal.
 * Stores the customer ID in a well-known metadata field so subsequent
 * calls don't create duplicates.
 */
async function ensureStripeCustomer(stripe: Stripe, sql: ReturnType<typeof import('../lib/db').createDb>, principalId: string): Promise<string> {
  // Check if we already have a customer for this principal
  const existing = await sql<Array<{ stripe_customer_id: string }>>`
    SELECT stripe_customer_id
    FROM principal_payment_methods
    WHERE principal_id = ${principalId}
      AND stripe_customer_id IS NOT NULL
    LIMIT 1
  `;

  if (existing.length && existing[0].stripe_customer_id) {
    return existing[0].stripe_customer_id;
  }

  // Create a new Stripe Customer
  const customer = await stripe.customers.create({
    metadata: { agentpay_principal_id: principalId },
  });

  return customer.id;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const router = new Hono<{ Bindings: Env; Variables: Variables }>();

router.use('*', async (c, next) => {
  const broKey = c.req.header('x-bro-key') ?? '';
  if (c.env.BRO_CLIENT_KEY && broKey === c.env.BRO_CLIENT_KEY) {
    await next();
    return;
  }
  return authenticateApiKey(c, next);
});

// ---------------------------------------------------------------------------
// POST /setup-intent — Create a Stripe Setup Intent
// ---------------------------------------------------------------------------

router.post('/setup-intent', async (c) => {
  if (!c.env.STRIPE_SECRET_KEY) {
    return c.json({ error: 'Stripe not configured' }, 503);
  }

  let body: { principalId?: unknown; currency?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const { principalId, currency } = body;
  if (typeof principalId !== 'string' || !principalId.trim()) {
    return c.json({ error: 'principalId is required' }, 400);
  }

  const stripe = createStripeClient(c.env);
  const sql = createDb(c.env);
  try {
    const customerId = await ensureStripeCustomer(stripe, sql, principalId.trim());

    const setupIntent = await stripe.setupIntents.create({
      customer: customerId,
      usage: 'off_session',
      metadata: {
        agentpay_principal_id: principalId.trim(),
      },
      ...(typeof currency === 'string' && currency.trim().length === 3
        ? { payment_method_options: { card: { request_three_d_secure: 'automatic' } } }
        : {}),
    });

    return c.json({
      clientSecret: setupIntent.client_secret,
      setupIntentId: setupIntent.id,
      customerId,
    }, 201);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[paymentsSetup] POST /setup-intent: error:', msg);
    return c.json({ error: 'Failed to create setup intent' }, 500);
  } finally {
    await sql.end();
  }
});

// ---------------------------------------------------------------------------
// POST /confirm-setup — Store payment method after client completes setup
// ---------------------------------------------------------------------------

router.post('/confirm-setup', async (c) => {
  if (!c.env.STRIPE_SECRET_KEY) {
    return c.json({ error: 'Stripe not configured' }, 503);
  }

  let body: { principalId?: unknown; setupIntentId?: unknown; paymentMethodId?: unknown; setDefault?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const { principalId, setupIntentId, paymentMethodId, setDefault } = body;
  if (typeof principalId !== 'string' || !principalId.trim()) {
    return c.json({ error: 'principalId is required' }, 400);
  }
  if (typeof setupIntentId !== 'string' || !setupIntentId.trim()) {
    return c.json({ error: 'setupIntentId is required' }, 400);
  }
  if (typeof paymentMethodId !== 'string' || !paymentMethodId.trim()) {
    return c.json({ error: 'paymentMethodId is required' }, 400);
  }

  const stripe = createStripeClient(c.env);
  const sql = createDb(c.env);
  try {
    const expectedCustomerId = await ensureStripeCustomer(stripe, sql, principalId.trim());
    const verifiedSetupIntent = await verifySucceededSetupIntent(
      stripe,
      setupIntentId.trim(),
      paymentMethodId.trim(),
    );

    if (verifiedSetupIntent.customerId !== expectedCustomerId) {
      return c.json({ error: 'Setup intent does not belong to this principal' }, 403);
    }

    const pm = await stripe.paymentMethods.retrieve(verifiedSetupIntent.paymentMethodId);
    const customerId = stripeCustomerIdFromRef(pm.customer) ?? verifiedSetupIntent.customerId;

    // Attach to customer if not already attached
    if (!pm.customer) {
      await stripe.paymentMethods.attach(verifiedSetupIntent.paymentMethodId, {
        customer: customerId,
      });
    }

    const last4 = pm.card?.last4 ?? null;
    const brand = pm.card?.brand ?? null;
    const makeDefault = setDefault !== false; // default true for first card

    // If making default, clear existing defaults
    if (makeDefault) {
      await sql`
        UPDATE principal_payment_methods
        SET is_default = false
        WHERE principal_id = ${principalId.trim()}
          AND is_default = true
      `;
    }

    // Upsert the payment method
    const rows = await sql<Array<{ id: string; is_default: boolean }>>`
      INSERT INTO principal_payment_methods (
        principal_id,
        stripe_pm_id,
        stripe_customer_id,
        last4,
        brand,
        is_default
      ) VALUES (
        ${principalId.trim()},
        ${verifiedSetupIntent.paymentMethodId},
        ${customerId},
        ${last4},
        ${brand},
        ${makeDefault}
      )
      ON CONFLICT (stripe_pm_id) DO UPDATE
        SET principal_id = ${principalId.trim()},
            stripe_customer_id = ${customerId},
            last4 = ${last4},
            brand = ${brand},
            is_default = ${makeDefault}
      RETURNING id, is_default
    `;

    return c.json({
      paymentMethodId: verifiedSetupIntent.paymentMethodId,
      setupIntentId: setupIntentId.trim(),
      last4,
      brand,
      isDefault: rows[0]?.is_default ?? makeDefault,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === 'SETUP_INTENT_NOT_SUCCEEDED') {
      return c.json({ error: 'Setup intent has not completed successfully' }, 409);
    }
    if (
      msg === 'SETUP_INTENT_MISSING_CUSTOMER' ||
      msg === 'SETUP_INTENT_MISSING_PAYMENT_METHOD'
    ) {
      return c.json({ error: 'Setup intent is missing Stripe billing details' }, 422);
    }
    if (msg === 'SETUP_INTENT_PAYMENT_METHOD_MISMATCH') {
      return c.json({ error: 'Payment method does not match the completed setup intent' }, 409);
    }
    console.error('[paymentsSetup] POST /confirm-setup: error:', msg);
    return c.json({ error: 'Failed to confirm setup' }, 500);
  } finally {
    await sql.end();
  }
});

// ---------------------------------------------------------------------------
// GET /methods/:principalId — List saved payment methods
// ---------------------------------------------------------------------------

router.get('/methods/:principalId', async (c) => {
  const principalId = c.req.param('principalId');

  const sql = createDb(c.env);
  try {
    const rows = await sql<PaymentMethodRow[]>`
      SELECT *
      FROM principal_payment_methods
      WHERE principal_id = ${principalId}
      ORDER BY is_default DESC, created_at DESC
    `;

    return c.json({
      principalId,
      methods: rows.map((r) => ({
        id: r.id,
        paymentMethodId: r.stripe_pm_id,
        last4: r.last4,
        brand: r.brand,
        isDefault: r.is_default,
        createdAt: r.created_at,
      })),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[paymentsSetup] GET /methods/:principalId: DB error:', msg);
    return c.json({ error: 'Failed to fetch payment methods' }, 500);
  } finally {
    await sql.end();
  }
});

// ---------------------------------------------------------------------------
// DELETE /methods/:methodId — Remove a saved payment method
// ---------------------------------------------------------------------------

router.delete('/methods/:methodId', async (c) => {
  if (!c.env.STRIPE_SECRET_KEY) {
    return c.json({ error: 'Stripe not configured' }, 503);
  }

  const methodId = c.req.param('methodId');

  const sql = createDb(c.env);
  try {
    // Look up the Stripe PM ID
    const rows = await sql<Array<{ stripe_pm_id: string; principal_id: string }>>`
      SELECT stripe_pm_id, principal_id
      FROM principal_payment_methods
      WHERE id = ${methodId}
    `;

    if (!rows.length) {
      return c.json({ error: 'Payment method not found' }, 404);
    }

    const { stripe_pm_id } = rows[0];

    // Detach from Stripe
    const stripe = createStripeClient(c.env);
    await stripe.paymentMethods.detach(stripe_pm_id);

    // Remove from DB
    await sql`
      DELETE FROM principal_payment_methods
      WHERE id = ${methodId}
    `;

    return c.json({ deleted: true, methodId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[paymentsSetup] DELETE /methods/:methodId: error:', msg);
    return c.json({ error: 'Failed to remove payment method' }, 500);
  } finally {
    await sql.end();
  }
});

export { router as paymentsSetupRouter };
