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
 * Auth: all routes require a valid merchant API key (authenticateApiKey).
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
import { createHostedCardCheckout, createHostedUpiPayment, selectFiatProvider } from '../lib/fiatPayments';
import { isMcpAccessToken } from '../lib/mcpAccessTokens';
import { recordProductSignalEvent } from '../lib/productSignals';
import {
  createStripeClient,
  stripeCustomerIdFromRef,
  verifySucceededSetupIntent,
} from '../lib/stripeSetupIntents';
import {
  createHostedActionSession,
  isSafeHostedActionResumeUrl,
  syncHostedActionSession,
} from '../lib/hostedActionSessions';

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

router.use('*', authenticateApiKey);

function appendHostedActionParams(baseUrl: string, params: Record<string, string>): string {
  const url = new URL(baseUrl);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

// ---------------------------------------------------------------------------
// POST /funding-request — create a host-native human funding action
// ---------------------------------------------------------------------------

router.post('/funding-request', async (c) => {
  const presentedToken = c.req.header('authorization') ?? c.req.header('x-api-key') ?? '';
  const normalizedToken = presentedToken.startsWith('Bearer ') ? presentedToken.slice(7) : presentedToken;
  const audience = c.get('mcpAudience') ?? 'generic';
  const authType = isMcpAccessToken(normalizedToken) ? 'mcp_token' : 'api_key';
  let body: {
    rail?: unknown;
    amount?: unknown;
    currency?: unknown;
    amountInr?: unknown;
    description?: unknown;
    requestId?: unknown;
    customerName?: unknown;
    customerPhone?: unknown;
    customerEmail?: unknown;
    resumeUrl?: unknown;
  };

  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const rail = body.rail === undefined
    ? (typeof body.amountInr === 'number'
        ? 'upi'
        : (c.env.STRIPE_SECRET_KEY ? 'card' : (selectFiatProvider(c.env, 'upi_link') === 'razorpay' ? 'upi' : null)))
    : body.rail;
  if (rail !== 'upi' && rail !== 'card') {
    return c.json({ error: 'Only the upi and card funding rails are currently supported' }, 400);
  }
  if (!rail) {
    return c.json({ error: 'No hosted funding rail is configured on this deployment' }, 503);
  }

  const normalizedCurrency = typeof body.currency === 'string' ? body.currency.trim().toUpperCase() : null;
  const normalizedAmount = typeof body.amount === 'number'
    ? body.amount
    : (typeof body.amountInr === 'number' ? body.amountInr : null);

  if (typeof normalizedAmount !== 'number' || normalizedAmount <= 0) {
    return c.json({ error: 'amount must be a positive number' }, 400);
  }
  if (typeof body.description !== 'string' || !body.description.trim()) {
    return c.json({ error: 'description is required' }, 400);
  }
  if (typeof body.resumeUrl === 'string' && !isSafeHostedActionResumeUrl(body.resumeUrl)) {
    return c.json({ error: 'resumeUrl must be a valid https URL or localhost URL' }, 400);
  }
  if (rail === 'upi' && selectFiatProvider(c.env, 'upi_link') !== 'razorpay') {
    return c.json({ error: 'Hosted UPI funding is not configured on this deployment' }, 503);
  }
  if (rail === 'card' && !c.env.STRIPE_SECRET_KEY) {
    return c.json({ error: 'Hosted card funding is not configured on this deployment' }, 503);
  }
  if (rail === 'upi' && normalizedCurrency && normalizedCurrency !== 'INR') {
    return c.json({ error: 'UPI funding currently requires currency INR' }, 400);
  }
  const fundingCurrency = rail === 'upi' ? 'INR' : (normalizedCurrency ?? 'GBP');
  if (!/^[A-Z]{3}$/.test(fundingCurrency)) {
    return c.json({ error: 'currency must be a 3-letter ISO code' }, 400);
  }

  const requestId = typeof body.requestId === 'string' && body.requestId.trim()
    ? body.requestId.trim()
    : `fundreq_${crypto.randomUUID()}`;

  try {
    const actionSession = await createHostedActionSession(c.env, {
      merchant: c.get('merchant'),
      actionType: 'funding_required',
      entityType: 'funding_request',
      entityId: requestId,
      title: rail === 'upi' ? 'Complete payment with any UPI app' : 'Complete payment securely with card',
      summary: body.description.trim(),
      audience,
      authType,
      resumeUrl: typeof body.resumeUrl === 'string' ? body.resumeUrl : null,
      displayPayload: {
        kind: rail === 'upi' ? 'upi_qr' : 'stripe_checkout',
        rail: rail === 'upi' ? 'upi_link' : 'card_checkout',
      },
      metadata: {
        rail: rail === 'upi' ? 'upi_link' : 'card_checkout',
        requestId,
        currency: fundingCurrency,
      },
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    });

    let provider: 'razorpay' | 'stripe';
    let responseDisplayPayload: Record<string, unknown>;
    let signalRail: string;
    let hydratedActionSession;

    if (rail === 'upi') {
      const upi = await createHostedUpiPayment(c.env, {
        amountInr: normalizedAmount,
        description: body.description.trim(),
        receipt: requestId,
        referenceId: requestId,
        callbackUrl: actionSession.publicResumeUrl,
        customerName: typeof body.customerName === 'string' ? body.customerName : undefined,
        customerPhone: typeof body.customerPhone === 'string' ? body.customerPhone : undefined,
        customerEmail: typeof body.customerEmail === 'string' ? body.customerEmail : undefined,
        notes: {
          requestId,
          source: 'agentpay_hosted_mcp',
          actionSessionId: actionSession.session.sessionId,
        },
      });

      if (!upi) {
        await syncHostedActionSession(c.env, {
          sessionId: actionSession.session.sessionId,
          status: 'failed',
          resultPayload: {
            provider: 'razorpay',
            failureReason: 'payment_link_creation_failed',
          },
          metadata: {
            provider: 'razorpay',
            failedAt: new Date().toISOString(),
          },
        }).catch((syncErr) => {
          console.warn('[paymentsSetup] funding-request: failed to mark action session as failed:', syncErr instanceof Error ? syncErr.message : String(syncErr));
        });
        return c.json({ error: 'Failed to create hosted UPI funding request' }, 502);
      }

      provider = upi.provider;
      signalRail = 'upi_link';
      responseDisplayPayload = {
        kind: 'upi_qr',
        paymentLinkId: upi.paymentLinkId,
        shortUrl: upi.shortUrl,
        deepLink: upi.upiQrString,
        qrText: upi.upiQrString,
        actionSessionId: actionSession.session.sessionId,
        actionStatusUrl: actionSession.statusUrl,
        actionResumeUrl: actionSession.publicResumeUrl,
      };
      hydratedActionSession = await syncHostedActionSession(c.env, {
        sessionId: actionSession.session.sessionId,
        displayPayload: {
          kind: 'upi_qr',
          rail: 'upi_link',
          paymentLinkId: upi.paymentLinkId,
          shortUrl: upi.shortUrl,
          deepLink: upi.upiQrString,
          qrText: upi.upiQrString,
        },
        metadata: {
          rail: 'upi_link',
          provider: upi.provider,
          requestId,
          paymentLinkId: upi.paymentLinkId,
          shortUrl: upi.shortUrl,
        },
      }).catch((syncErr) => {
        console.warn('[paymentsSetup] funding-request: failed to hydrate action session:', syncErr instanceof Error ? syncErr.message : String(syncErr));
        return {
          ...actionSession.session,
          displayPayload: {
            ...actionSession.session.displayPayload,
            kind: 'upi_qr',
            rail: 'upi_link',
            paymentLinkId: upi.paymentLinkId,
            shortUrl: upi.shortUrl,
            deepLink: upi.upiQrString,
            qrText: upi.upiQrString,
          },
          metadata: {
            ...actionSession.session.metadata,
            rail: 'upi_link',
            provider: upi.provider,
            requestId,
            paymentLinkId: upi.paymentLinkId,
            shortUrl: upi.shortUrl,
          },
        };
      });
    } else {
      const successUrl = appendHostedActionParams(actionSession.publicResumeUrl, {
        status: 'completed',
        stripe_checkout_status: 'completed',
        stripe_checkout_session_id: '{CHECKOUT_SESSION_ID}',
      });
      const cancelUrl = appendHostedActionParams(actionSession.publicResumeUrl, {
        status: 'failed',
        stripe_checkout_status: 'cancelled',
      });
      const checkout = await createHostedCardCheckout(c.env, {
        amount: normalizedAmount,
        currency: fundingCurrency,
        description: body.description.trim(),
        successUrl,
        cancelUrl,
        customerEmail: typeof body.customerEmail === 'string' ? body.customerEmail : undefined,
        metadata: {
          requestId,
          source: 'agentpay_hosted_mcp',
          actionSessionId: actionSession.session.sessionId,
          currency: fundingCurrency,
        },
      }).catch(async (err) => {
        await syncHostedActionSession(c.env, {
          sessionId: actionSession.session.sessionId,
          status: 'failed',
          resultPayload: {
            provider: 'stripe',
            failureReason: 'checkout_session_creation_failed',
          },
          metadata: {
            provider: 'stripe',
            failedAt: new Date().toISOString(),
          },
        }).catch(() => {});
        throw err;
      });

      if (!checkout) {
        return c.json({ error: 'Failed to create hosted card funding request' }, 502);
      }

      provider = checkout.provider;
      signalRail = 'card_checkout';
      responseDisplayPayload = {
        kind: 'stripe_checkout',
        checkoutUrl: checkout.checkoutUrl,
        checkoutSessionId: checkout.checkoutSessionId,
        actionSessionId: actionSession.session.sessionId,
        actionStatusUrl: actionSession.statusUrl,
        actionResumeUrl: actionSession.publicResumeUrl,
      };
      hydratedActionSession = await syncHostedActionSession(c.env, {
        sessionId: actionSession.session.sessionId,
        displayPayload: {
          kind: 'stripe_checkout',
          rail: 'card_checkout',
          checkoutUrl: checkout.checkoutUrl,
          checkoutSessionId: checkout.checkoutSessionId,
        },
        metadata: {
          rail: 'card_checkout',
          provider: checkout.provider,
          requestId,
          checkoutSessionId: checkout.checkoutSessionId,
          currency: fundingCurrency,
        },
      }).catch((syncErr) => {
        console.warn('[paymentsSetup] funding-request: failed to hydrate card action session:', syncErr instanceof Error ? syncErr.message : String(syncErr));
        return {
          ...actionSession.session,
          displayPayload: {
            ...actionSession.session.displayPayload,
            kind: 'stripe_checkout',
            rail: 'card_checkout',
            checkoutUrl: checkout.checkoutUrl,
            checkoutSessionId: checkout.checkoutSessionId,
          },
          metadata: {
            ...actionSession.session.metadata,
            rail: 'card_checkout',
            provider: checkout.provider,
            requestId,
            checkoutSessionId: checkout.checkoutSessionId,
            currency: fundingCurrency,
          },
        };
      });
    }

    void recordProductSignalEvent(c.env, {
      merchantId: c.get('merchant').id,
      audience,
      authType,
      surface: 'payments',
      signalType: 'funding_request_created',
      status: 'requires_human_funding',
      requestId,
      entityType: 'funding_request',
      entityId: requestId,
      metadata: {
        rail: signalRail,
        provider,
        amount: normalizedAmount,
        currency: fundingCurrency,
        nextActionType: 'funding_required',
      },
    });

    return c.json({
      requestId,
      status: 'requires_human_funding',
      provider,
      rail,
      nextAction: {
        type: 'funding_required',
        sessionId: hydratedActionSession.sessionId,
        title: rail === 'upi' ? 'Complete payment with any UPI app' : 'Complete payment securely with card',
        summary: body.description.trim(),
        expiresAt: hydratedActionSession.expiresAt.toISOString(),
        amount: {
          value: normalizedAmount,
          currency: fundingCurrency,
        },
        displayPayload: responseDisplayPayload,
      },
      actionSession: {
        sessionId: hydratedActionSession.sessionId,
        status: hydratedActionSession.status,
        statusUrl: actionSession.statusUrl,
        resumeUrl: actionSession.publicResumeUrl,
        expiresAt: hydratedActionSession.expiresAt.toISOString(),
      },
    }, 201);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[paymentsSetup] POST /funding-request: error:', msg);
    return c.json({ error: 'Failed to create funding request' }, 500);
  }
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
