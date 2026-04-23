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
import { sha256Hex } from '../lib/approvalSessions';
import { upsertAuthorityProfile } from '../lib/authorityProfiles';
import { resumeCapabilityExecutionAttempt } from '../lib/capabilityExecutionAttempts';

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
  contact_email?: string | null;
  contact_name?: string | null;
  is_default: boolean;
  created_at: Date;
}

/**
 * Finds or creates a Stripe Customer for the given principal.
 * Stores the customer ID in a well-known metadata field so subsequent
 * calls don't create duplicates.
 */
async function ensureStripeCustomer(
  stripe: Stripe,
  sql: ReturnType<typeof import('../lib/db').createDb>,
  principalId: string,
  contact?: { email?: string; name?: string },
): Promise<string> {
  // Check if we already have a customer for this principal
  const existing = await sql<Array<{ stripe_customer_id: string }>>`
    SELECT stripe_customer_id
    FROM principal_payment_methods
    WHERE principal_id = ${principalId}
      AND stripe_customer_id IS NOT NULL
    LIMIT 1
  `;

  if (existing.length && existing[0].stripe_customer_id) {
    const customerId = existing[0].stripe_customer_id;
    if (contact?.email || contact?.name) {
      await stripe.customers.update(customerId, {
        ...(contact.email ? { email: contact.email } : {}),
        ...(contact.name ? { name: contact.name } : {}),
      }).catch(() => {});
    }
    return customerId;
  }

  // Create a new Stripe Customer
  const customer = await stripe.customers.create({
    ...(contact?.email ? { email: contact.email } : {}),
    ...(contact?.name ? { name: contact.name } : {}),
    metadata: { agentpay_principal_id: principalId },
  });

  return customer.id;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const router = new Hono<{ Bindings: Env; Variables: Variables }>();

router.use('*', async (c, next) => {
  const adminKey = c.req.header('x-admin-key') ?? c.req.header('X-Admin-Key');
  const merchantId = c.req.header('x-merchant-id') ?? c.req.header('X-Merchant-Id');
  if (adminKey && merchantId && c.env.ADMIN_SECRET_KEY && adminKey === c.env.ADMIN_SECRET_KEY) {
    const sql = createDb(c.env);
    try {
      const rows = await sql<Array<{
        id: string;
        name: string;
        email: string;
        wallet_address: string | null;
        webhook_url: string | null;
        parent_merchant_id: string | null;
      }>>`
        SELECT id, name, email, wallet_address, webhook_url, parent_merchant_id
        FROM merchants
        WHERE id = ${merchantId}::uuid
          AND is_active = true
        LIMIT 1
      `;
      const merchant = rows[0];
      if (!merchant) {
        return c.json({ error: 'Merchant not found for internal request' }, 404);
      }
      c.set('merchant', {
        id: merchant.id,
        name: merchant.name,
        email: merchant.email,
        walletAddress: merchant.wallet_address,
        webhookUrl: merchant.webhook_url ?? null,
        parentMerchantId: merchant.parent_merchant_id ?? null,
      });
      c.set('mcpAudience', 'internal');
      await next();
      return;
    } finally {
      await sql.end().catch(() => {});
    }
  }

  return authenticateApiKey(c, next);
});

function appendHostedActionParams(baseUrl: string, params: Record<string, string>): string {
  const url = new URL(baseUrl);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

function maskEmail(email: string | null | undefined): string | null {
  if (!email || !email.includes('@')) return null;
  const [localPart, domain] = email.split('@');
  const prefix = localPart.slice(0, Math.min(3, localPart.length));
  return `${prefix}***@${domain ?? '***'}`;
}

async function getActivePrincipalMandate(
  sql: ReturnType<typeof createDb>,
  principalId: string,
): Promise<{ id: string; stripe_pm_id: string; stripe_customer_id: string | null; max_amount_pence: number | null } | null> {
  const mandates = await sql<Array<{ id: string; stripe_pm_id: string; stripe_customer_id: string | null; max_amount_pence: number | null }>>`
    SELECT id, stripe_pm_id, stripe_customer_id, max_amount_pence
    FROM principal_mandates
    WHERE principal_id = ${principalId}
      AND revoked_at IS NULL
      AND (expires_at IS NULL OR expires_at > now())
    ORDER BY created_at DESC
    LIMIT 1
  `.catch(() => []);

  return mandates[0] ?? null;
}

async function resolveStripeCustomerEmail(
  stripe: Stripe,
  customerId: string | null | undefined,
): Promise<string | null> {
  if (!customerId) return null;
  try {
    const customer = await stripe.customers.retrieve(customerId);
    if (typeof customer === 'object' && 'deleted' in customer && customer.deleted) {
      return null;
    }
    return typeof customer.email === 'string' ? customer.email : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// POST /funding-request — create a host-native human funding action
// ---------------------------------------------------------------------------

router.post('/authority-bootstrap', async (c) => {
  let body: {
    principalId?: unknown;
    operatorId?: unknown;
    preferredFundingRail?: unknown;
    contactEmail?: unknown;
    contactName?: unknown;
    autonomyPolicy?: unknown;
    limits?: unknown;
    metadata?: unknown;
  };

  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const principalId = typeof body.principalId === 'string' && body.principalId.trim()
    ? body.principalId.trim()
    : null;
  if (!principalId) {
    return c.json({ error: 'principalId is required' }, 400);
  }

  const merchant = c.get('merchant');
  const sql = createDb(c.env);
  try {
    const paymentMethodRows = await sql<Array<{ stripe_pm_id: string; stripe_customer_id: string | null }>>`
      SELECT stripe_pm_id, stripe_customer_id
      FROM principal_payment_methods
      WHERE principal_id = ${principalId}
      ORDER BY is_default DESC, created_at DESC
      LIMIT 1
    `;
    const savedPaymentMethod = paymentMethodRows[0] ?? null;
    const mandate = await getActivePrincipalMandate(sql, principalId);

    const profile = await upsertAuthorityProfile(c.env, {
      merchantId: merchant.id,
      principalId,
      operatorId: typeof body.operatorId === 'string' ? body.operatorId.trim() : null,
      walletStatus: savedPaymentMethod ? 'ready' : 'missing',
      preferredFundingRail: typeof body.preferredFundingRail === 'string' ? body.preferredFundingRail.trim() : null,
      defaultPaymentMethodType: savedPaymentMethod ? 'card' : null,
      defaultPaymentReference: savedPaymentMethod?.stripe_pm_id ?? null,
      contactEmail: typeof body.contactEmail === 'string' ? body.contactEmail.trim() : null,
      contactName: typeof body.contactName === 'string' ? body.contactName.trim() : null,
      autonomyPolicy: typeof body.autonomyPolicy === 'object' && body.autonomyPolicy && !Array.isArray(body.autonomyPolicy)
        ? body.autonomyPolicy as Record<string, unknown>
        : {},
      limits: typeof body.limits === 'object' && body.limits && !Array.isArray(body.limits)
        ? body.limits as Record<string, unknown>
        : {},
      metadata: {
        source: 'payments_authority_bootstrap',
        hasMandate: Boolean(mandate),
        ...(typeof body.metadata === 'object' && body.metadata && !Array.isArray(body.metadata)
          ? body.metadata as Record<string, unknown>
          : {}),
      },
    });

    return c.json({
      status: savedPaymentMethod ? 'ready' : 'funding_setup_required',
      authorityProfile: profile,
      funding: {
        savedPaymentMethod: savedPaymentMethod ? {
          stripePaymentMethodId: savedPaymentMethod.stripe_pm_id,
          stripeCustomerId: savedPaymentMethod.stripe_customer_id,
        } : null,
        mandate: mandate ? {
          mandateId: mandate.id,
          maxAmountPence: mandate.max_amount_pence,
        } : null,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[paymentsSetup] POST /authority-bootstrap:', msg);
    return c.json({ error: 'Failed to bootstrap authority profile' }, 500);
  } finally {
    await sql.end().catch(() => {});
  }
});

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
    principalId?: unknown;
    capabilityExecutionAttemptId?: unknown;
    authorityProfileId?: unknown;
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
  const capabilityExecutionAttemptId = typeof body.capabilityExecutionAttemptId === 'string' && body.capabilityExecutionAttemptId.trim()
    ? body.capabilityExecutionAttemptId.trim()
    : null;
  const authorityProfileId = typeof body.authorityProfileId === 'string' && body.authorityProfileId.trim()
    ? body.authorityProfileId.trim()
    : null;

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
        customerEmail: typeof body.customerEmail === 'string' ? body.customerEmail : null,
        capabilityExecutionAttemptId,
        authorityProfileId,
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
          capabilityExecutionAttemptId: capabilityExecutionAttemptId ?? undefined,
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
          capabilityExecutionAttemptId,
          authorityProfileId,
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
            capabilityExecutionAttemptId,
            authorityProfileId,
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
      // Ensure Stripe customer so the card is saved after checkout
      let stripeCustomerId: string | undefined;
      const normalizedPrincipalId = typeof body.principalId === 'string' && body.principalId.trim()
        ? body.principalId.trim()
        : undefined;
      if (normalizedPrincipalId && c.env.STRIPE_SECRET_KEY) {
        const stripe = createStripeClient(c.env);
        const custSql = createDb(c.env);
        try {
          stripeCustomerId = await ensureStripeCustomer(stripe, custSql, normalizedPrincipalId, {
            email: typeof body.customerEmail === 'string' ? body.customerEmail : undefined,
            name: typeof body.customerName === 'string' ? body.customerName : undefined,
          });
        } catch (custErr: unknown) {
          console.warn('[paymentsSetup] funding-request: could not ensure Stripe customer:', custErr instanceof Error ? custErr.message : String(custErr));
        } finally {
          custSql.end().catch(() => {});
        }
      }

      const checkout = await createHostedCardCheckout(c.env, {
        amount: normalizedAmount,
        currency: fundingCurrency,
        description: body.description.trim(),
        successUrl,
        cancelUrl,
        customerEmail: typeof body.customerEmail === 'string' ? body.customerEmail : undefined,
        customerId: stripeCustomerId,
        principalId: normalizedPrincipalId,
        metadata: {
          requestId,
          source: 'agentpay_hosted_mcp',
          actionSessionId: actionSession.session.sessionId,
          currency: fundingCurrency,
          capabilityExecutionAttemptId: capabilityExecutionAttemptId ?? undefined,
          authorityProfileId: authorityProfileId ?? undefined,
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
          customerEmail: typeof body.customerEmail === 'string' ? body.customerEmail : null,
          capabilityExecutionAttemptId,
          authorityProfileId,
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
            capabilityExecutionAttemptId,
            authorityProfileId,
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
        capabilityExecutionAttemptId,
        authorityProfileId,
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

  let body: { principalId?: unknown; currency?: unknown; customerEmail?: unknown; customerName?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const { principalId, currency, customerEmail, customerName } = body;
  if (typeof principalId !== 'string' || !principalId.trim()) {
    return c.json({ error: 'principalId is required' }, 400);
  }

  const stripe = createStripeClient(c.env);
  const sql = createDb(c.env);
  try {
    const customerId = await ensureStripeCustomer(stripe, sql, principalId.trim(), {
      email: typeof customerEmail === 'string' ? customerEmail.trim() : undefined,
      name: typeof customerName === 'string' ? customerName.trim() : undefined,
    });

    const setupIntent = await stripe.setupIntents.create({
      customer: customerId,
      usage: 'off_session',
      metadata: {
        agentpay_principal_id: principalId.trim(),
        ...(typeof customerEmail === 'string' && customerEmail.trim() ? { agentpay_contact_email: customerEmail.trim() } : {}),
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

  let body: {
    principalId?: unknown;
    setupIntentId?: unknown;
    paymentMethodId?: unknown;
    setDefault?: unknown;
    customerEmail?: unknown;
    customerName?: unknown;
    end_user_email?: unknown;
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const { principalId, setupIntentId, paymentMethodId, setDefault, customerEmail, customerName, end_user_email } = body;
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
    const resolvedContactEmail =
      typeof end_user_email === 'string' && end_user_email.trim()
        ? end_user_email.trim()
        : (typeof customerEmail === 'string' && customerEmail.trim() ? customerEmail.trim() : null);
    const resolvedContactName = typeof customerName === 'string' && customerName.trim() ? customerName.trim() : null;

    const expectedCustomerId = await ensureStripeCustomer(stripe, sql, principalId.trim(), {
      email: resolvedContactEmail ?? undefined,
      name: resolvedContactName ?? undefined,
    });
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
        contact_email,
        contact_name,
        is_default
      ) VALUES (
        ${principalId.trim()},
        ${verifiedSetupIntent.paymentMethodId},
        ${customerId},
        ${last4},
        ${brand},
        ${resolvedContactEmail},
        ${resolvedContactName},
        ${makeDefault}
      )
      ON CONFLICT (stripe_pm_id) DO UPDATE
        SET principal_id = ${principalId.trim()},
            stripe_customer_id = ${customerId},
            last4 = ${last4},
            brand = ${brand},
            contact_email = COALESCE(${resolvedContactEmail}, principal_payment_methods.contact_email),
            contact_name  = COALESCE(${resolvedContactName},  principal_payment_methods.contact_name),
            is_default = ${makeDefault}
      RETURNING id, is_default
    `;

    return c.json({
      paymentMethodId: verifiedSetupIntent.paymentMethodId,
      setupIntentId: setupIntentId.trim(),
      last4,
      brand,
      contactEmailMasked: maskEmail(resolvedContactEmail),
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
// GET /methods/me — List saved payment methods for the current API key holder
// ---------------------------------------------------------------------------

router.get('/methods/me', async (c) => {
  const principalId = c.get('merchant').id;
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
        contactEmailMasked: maskEmail(r.contact_email),
        contactName: r.contact_name,
        isDefault: r.is_default,
        createdAt: r.created_at,
      })),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[paymentsSetup] GET /methods/me: DB error:', msg);
    return c.json({ error: 'Failed to fetch payment methods' }, 500);
  } finally {
    await sql.end();
  }
});

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
        contactEmailMasked: maskEmail(r.contact_email),
        contactName: r.contact_name,
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

// ---------------------------------------------------------------------------
// POST /charge-saved — OTP-gated off-session charge on a saved card
//
// Replaces the full Stripe checkout flow for principals with a saved card.
// The only human touchpoint is a 6-digit code delivered to their email.
// ---------------------------------------------------------------------------

router.post('/charge-saved', async (c) => {
  if (!c.env.STRIPE_SECRET_KEY) {
    return c.json({ error: 'Stripe not configured' }, 503);
  }
  const merchant = c.get('merchant');
  let body: {
    principalId?: unknown;
    amount?: unknown;
    currency?: unknown;
    description?: unknown;
    end_user_email?: unknown;
    capabilityExecutionAttemptId?: unknown;
    authorityProfileId?: unknown;
  };
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON body' }, 400); }

  const principalId = typeof body.principalId === 'string' && body.principalId.trim()
    ? body.principalId.trim()
    : merchant.id;
  const amount = typeof body.amount === 'number' && body.amount > 0 ? body.amount : null;
  const rawCurrency = typeof body.currency === 'string' ? body.currency.trim().toUpperCase() : '';
  const currency = /^[A-Z]{3}$/.test(rawCurrency) ? rawCurrency : null;
  const description = typeof body.description === 'string' && body.description.trim()
    ? body.description.trim()
    : null;
  const endUserEmail = typeof body.end_user_email === 'string' && body.end_user_email.includes('@')
    ? body.end_user_email.trim()
    : null;
  const capabilityExecutionAttemptId = typeof body.capabilityExecutionAttemptId === 'string' && body.capabilityExecutionAttemptId.trim()
    ? body.capabilityExecutionAttemptId.trim()
    : null;
  const authorityProfileId = typeof body.authorityProfileId === 'string' && body.authorityProfileId.trim()
    ? body.authorityProfileId.trim()
    : null;

  if (!amount) return c.json({ error: 'amount must be a positive number' }, 400);
  if (!currency) return c.json({ error: 'currency must be a 3-letter ISO code' }, 400);
  if (!description) return c.json({ error: 'description is required' }, 400);

  // Per-transaction ceiling — protects users from agent overreach without mandate approval.
  // INR is higher-denomination; all other currencies cap at 500 units.
  const ceilAmount = currency === 'INR' ? 5000 : 500;

  const sql = createDb(c.env);
  try {
    const amountSmallestUnit = Math.max(Math.round(amount * 100), 50);
    const activeMandate = await getActivePrincipalMandate(sql, principalId);
    if (activeMandate?.max_amount_pence && amountSmallestUnit > activeMandate.max_amount_pence) {
      return c.json({
        error: 'amount_exceeds_mandate_limit',
        limitPence: activeMandate.max_amount_pence,
        currency,
        mandateId: activeMandate.id,
        _instruction: 'This charge exceeds the active mandate limit. Use an explicit funding step or raise the mandate ceiling before retrying.',
      }, 402);
    }
    if (!activeMandate && amount > ceilAmount) {
      return c.json({
        error: 'amount_exceeds_auto_charge_limit',
        limit: ceilAmount,
        currency,
        _instruction: `Off-session charges are capped at ${ceilAmount} ${currency} without an approved mandate. Use ace_request_booking_payment for this amount so the user can authorise it explicitly.`,
      }, 402);
    }

    const pmRows = await sql<Array<{ stripe_pm_id: string; stripe_customer_id: string | null; last4: string | null; brand: string | null; contact_email: string | null }>>`
      SELECT stripe_pm_id, stripe_customer_id, last4, brand, contact_email
      FROM principal_payment_methods
      WHERE principal_id = ${principalId}
      ORDER BY is_default DESC, created_at DESC
      LIMIT 1
    `;

    if (!pmRows.length) {
      return c.json({
        error: 'no_saved_payment_method',
        principalId,
        _instruction: 'No saved card found. Use ace_request_booking_payment to collect first payment — the card will be saved automatically.',
      }, 404);
    }

    const pm = pmRows[0];
    const stripe = createStripeClient(c.env);
    // Use cached contact_email first (no Stripe API call); fall back to live Stripe lookup.
    const cachedEmail = pm.contact_email ?? null;
    const recipientEmail = endUserEmail
      ?? cachedEmail
      ?? await resolveStripeCustomerEmail(stripe, pm.stripe_customer_id)
      ?? merchant.email;
    const maskedEmail = maskEmail(recipientEmail);
    const otpCode = String(Math.floor(100000 + crypto.getRandomValues(new Uint32Array(1))[0] % 900000));
    const otpHash = await sha256Hex(otpCode);
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    const sessionId = `chg_${crypto.randomUUID().replace(/-/g, '')}`;

    await sql`
      INSERT INTO hosted_action_sessions
        (id, merchant_id, action_type, entity_type, entity_id, title, summary,
         status, display_payload_json, result_payload_json, metadata_json, expires_at)
      VALUES (
        ${sessionId},
        ${merchant.id},
        ${'confirmation_required'},
        ${'charge_otp'},
        ${sessionId},
        ${'Confirm payment'},
        ${description},
        ${'pending'},
        ${JSON.stringify({ kind: 'otp_charge', amount, currency, description })}::jsonb,
        ${JSON.stringify({
          otp_hash: otpHash,
          attempt_count: 0,
          stripe_pm_id: pm.stripe_pm_id,
          stripe_customer_id: pm.stripe_customer_id,
          amount_smallest_unit: amountSmallestUnit,
          currency: currency.toLowerCase(),
          description,
          principalId,
          otp_recipient_email: recipientEmail,
          mandate_id: activeMandate?.id ?? null,
        })}::jsonb,
        ${JSON.stringify({
          source: 'charge_saved',
          merchantId: merchant.id,
          otpRecipientEmail: recipientEmail,
          mandateId: activeMandate?.id ?? null,
          capabilityExecutionAttemptId,
          authorityProfileId,
        })}::jsonb,
        ${expiresAt.toISOString()}::timestamptz
      )
    `;

    if (c.env.RESEND_API_KEY && recipientEmail) {
      const currencySymbols: Record<string, string> = { GBP: '£', USD: '$', EUR: '€', INR: '₹' };
      const symbol = currencySymbols[currency] ?? currency;
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${c.env.RESEND_API_KEY}` },
        body: JSON.stringify({
          from: 'AgentPay <notifications@agentpay.so>',
          to: [recipientEmail],
          subject: `Confirm ${symbol}${amount} payment`,
          html: `<!doctype html><html><body style="margin:0;padding:32px;background:#f8fafc;font-family:system-ui,sans-serif;color:#0f172a;">
            <div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:32px;">
              <h1 style="margin:0 0 8px;font-size:24px;letter-spacing:-0.5px;">Confirm payment</h1>
              <p style="margin:0 0 16px;color:#475569;line-height:1.6;">Your agent wants to charge your saved ${pm.brand ?? 'card'} ending ${pm.last4 ?? '••••'}:</p>
              <div style="background:#f1f5f9;border-radius:12px;padding:20px;margin-bottom:24px;">
                <p style="margin:0;font-size:22px;font-weight:700;">${symbol}${amount} ${currency}</p>
                <p style="margin:4px 0 0;color:#475569;font-size:15px;">${description}</p>
              </div>
              <p style="margin:0 0 12px;color:#475569;font-size:14px;">Enter this code in your agent terminal to approve:</p>
              <div style="background:#0f172a;border-radius:12px;padding:20px;text-align:center;margin-bottom:24px;">
                <span style="font-size:44px;font-weight:700;letter-spacing:10px;color:#fff;font-family:monospace;">${otpCode}</span>
              </div>
              <p style="margin:0;font-size:13px;color:#64748b;">Expires in 5 minutes. If you did not initiate this, ignore — no charge will be made.</p>
            </div>
          </body></html>`,
        }),
      }).catch(() => {});
    }

    return c.json({
      status: 'confirmation_required',
      session_id: sessionId,
      last4: pm.last4,
      brand: pm.brand,
      amount,
      currency,
      description,
      otp_sent_to: maskedEmail,
      mandate_id: activeMandate?.id ?? null,
      expires_at: expiresAt.toISOString(),
      nextAction: {
        type: 'confirmation_required',
        sessionId,
        title: 'Confirm payment from your saved card',
        summary: description,
        amount: {
          value: amount,
          currency,
        },
        displayPayload: {
          kind: 'otp_charge',
          last4: pm.last4,
          brand: pm.brand,
        },
      },
      actionSession: {
        sessionId,
        status: 'pending',
        statusUrl: new URL(`/api/actions/${sessionId}`, c.env.API_BASE_URL).toString(),
        expiresAt: expiresAt.toISOString(),
      },
      _instruction: `A 6-digit code was sent to ${maskedEmail ?? 'your registered email'}. Ask the user to enter it in the terminal, then call ace_confirm_saved_charge with session_id and the code.`,
    }, 201);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[paymentsSetup] POST /charge-saved:', msg);
    return c.json({ error: 'Failed to create charge session' }, 500);
  } finally {
    await sql.end();
  }
});

// ---------------------------------------------------------------------------
// POST /charge-saved/:sessionId/confirm — verify OTP, fire off-session charge
// ---------------------------------------------------------------------------

router.post('/charge-saved/:sessionId/confirm', async (c) => {
  if (!c.env.STRIPE_SECRET_KEY) {
    return c.json({ error: 'Stripe not configured' }, 503);
  }
  const merchant = c.get('merchant');
  const sessionId = c.req.param('sessionId');
  let body: { otp?: unknown };
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON body' }, 400); }

  const otp = typeof body.otp === 'string' ? body.otp.trim() : null;
  if (!otp || !/^\d{6}$/.test(otp)) {
    return c.json({ error: 'otp must be a 6-digit code' }, 400);
  }

  const sql = createDb(c.env);
  try {
    type SessionRow = {
      id: string;
      merchant_id: string;
      status: string;
      result_payload_json: unknown;
      metadata_json: unknown;
      expires_at: Date;
    };
    const rows = await sql<SessionRow[]>`
      SELECT id, merchant_id, status, result_payload_json, metadata_json, expires_at
      FROM hosted_action_sessions
      WHERE id = ${sessionId}
        AND entity_type = 'charge_otp'
      LIMIT 1
    `;
    const session = rows[0];
    if (!session || session.merchant_id !== merchant.id) {
      return c.json({ error: 'Session not found' }, 404);
    }
    if (session.status !== 'pending') {
      return c.json({ error: 'Session already used or expired' }, 410);
    }
    if (new Date(session.expires_at).getTime() < Date.now()) {
      return c.json({ error: 'Session expired' }, 410);
    }

    const payload = (session.result_payload_json ?? {}) as Record<string, unknown>;
    const metadata = (session.metadata_json ?? {}) as Record<string, unknown>;
    const storedHash = typeof payload.otp_hash === 'string' ? payload.otp_hash : null;
    const attemptCount = typeof payload.attempt_count === 'number' ? payload.attempt_count : 0;
    const stripePmId = typeof payload.stripe_pm_id === 'string' ? payload.stripe_pm_id : null;
    const stripeCustomerId = typeof payload.stripe_customer_id === 'string' ? payload.stripe_customer_id : null;
    const amountSmallestUnit = typeof payload.amount_smallest_unit === 'number' ? payload.amount_smallest_unit : null;
    const chargeCurrency = typeof payload.currency === 'string' ? payload.currency : null;
    const chargeDescription = typeof payload.description === 'string' ? payload.description : undefined;
    const principalId = typeof payload.principalId === 'string' ? payload.principalId : null;
    const mandateId = typeof payload.mandate_id === 'string' ? payload.mandate_id : null;
    const capabilityExecutionAttemptId = typeof metadata.capabilityExecutionAttemptId === 'string'
      ? metadata.capabilityExecutionAttemptId
      : null;

    if (attemptCount >= 3) {
      await sql`UPDATE hosted_action_sessions SET status = 'failed', updated_at = NOW() WHERE id = ${sessionId}`;
      return c.json({ error: 'Too many attempts' }, 429);
    }

    const submittedHash = await sha256Hex(otp);
    if (!storedHash || submittedHash !== storedHash) {
      await sql`
        UPDATE hosted_action_sessions
        SET result_payload_json = result_payload_json || ${JSON.stringify({ attempt_count: attemptCount + 1 })}::jsonb,
            updated_at = NOW()
        WHERE id = ${sessionId}
      `;
      return c.json({ error: 'Invalid code', attempts_remaining: 3 - (attemptCount + 1) }, 401);
    }

    if (!stripePmId || !amountSmallestUnit || !chargeCurrency) {
      return c.json({ error: 'Session data incomplete' }, 500);
    }
    if (principalId) {
      const activeMandate = await getActivePrincipalMandate(sql, principalId);
      if (mandateId && (!activeMandate || activeMandate.id !== mandateId)) {
        return c.json({ error: 'Mandate is no longer active for this charge session' }, 409);
      }
      if (activeMandate?.max_amount_pence && amountSmallestUnit > activeMandate.max_amount_pence) {
        return c.json({
          error: 'amount_exceeds_mandate_limit',
          limitPence: activeMandate.max_amount_pence,
          mandateId: activeMandate.id,
        }, 402);
      }
    }

    const stripe = createStripeClient(c.env);
    let paymentIntent: Stripe.PaymentIntent;
    try {
      paymentIntent = await stripe.paymentIntents.create({
        amount: amountSmallestUnit,
        currency: chargeCurrency,
        payment_method: stripePmId,
        ...(stripeCustomerId ? { customer: stripeCustomerId } : {}),
        confirm: true,
        off_session: true,
        description: chargeDescription,
        metadata: {
          agentpay_session_id: sessionId,
          agentpay_merchant_id: merchant.id,
        },
      });
    } catch (stripeErr) {
      const stripeMsg = stripeErr instanceof Error ? stripeErr.message : String(stripeErr);
      await sql`
        UPDATE hosted_action_sessions
        SET status = 'failed',
            result_payload_json = result_payload_json || ${JSON.stringify({ stripe_error: stripeMsg })}::jsonb,
            updated_at = NOW()
        WHERE id = ${sessionId}
      `;
      return c.json({ error: 'Payment failed', detail: stripeMsg }, 402);
    }

    await sql`
      UPDATE hosted_action_sessions
      SET status = 'completed',
          result_payload_json = result_payload_json || ${JSON.stringify({ payment_intent_id: paymentIntent.id, stripe_status: paymentIntent.status })}::jsonb,
          completed_at = NOW(),
          updated_at = NOW()
      WHERE id = ${sessionId}
    `;

    if (paymentIntent.status === 'requires_action') {
      const nextAction = paymentIntent.next_action as unknown as Record<string, unknown> | null;
      const redirectUrl = nextAction?.type === 'redirect_to_url'
        ? (nextAction.redirect_to_url as Record<string, unknown> | undefined)?.url ?? null
        : null;
      return c.json({
        charged: false,
        requires_action: true,
        action_url: redirectUrl,
        payment_intent_id: paymentIntent.id,
        _instruction: 'Card requires 3D Secure. Share the action_url with the user to complete authentication.',
      }, 202);
    }

    // Receipt email — fire-and-forget, never blocks the response
    const grossAmount = amountSmallestUnit / 100;
    const receiptEmail = payload.otp_recipient_email as string | undefined;
    if (c.env.RESEND_API_KEY && receiptEmail) {
      const currencySymbols: Record<string, string> = { GBP: '£', USD: '$', EUR: '€', INR: '₹' };
      const sym = currencySymbols[chargeCurrency.toUpperCase()] ?? chargeCurrency.toUpperCase();
      void fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${c.env.RESEND_API_KEY}` },
        body: JSON.stringify({
          from: 'AgentPay <notifications@agentpay.so>',
          to: [receiptEmail],
          subject: `Payment confirmed — ${sym}${grossAmount} ${chargeCurrency.toUpperCase()}`,
          html: `<!doctype html><html><body style="margin:0;padding:32px;background:#f8fafc;font-family:system-ui,sans-serif;color:#0f172a;">
            <div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:32px;">
              <h1 style="margin:0 0 8px;font-size:22px;font-weight:800;letter-spacing:-0.5px;">Payment confirmed</h1>
              <p style="margin:0 0 20px;color:#475569;line-height:1.6;">Your agent completed this payment successfully.</p>
              <div style="background:#f1f5f9;border-radius:12px;padding:20px;margin-bottom:24px;">
                <p style="margin:0;font-size:26px;font-weight:800;">${sym}${grossAmount} ${chargeCurrency.toUpperCase()}</p>
                <p style="margin:6px 0 0;color:#475569;font-size:15px;">${chargeDescription ?? 'Agent payment'}</p>
              </div>
              <p style="margin:0;font-size:13px;color:#64748b;">Reference: <code style="font-family:monospace;background:#f1f5f9;padding:2px 6px;border-radius:4px;">${paymentIntent.id}</code></p>
            </div>
          </body></html>`,
        }),
      }).catch(() => {});
    }

    // Record revenue signal — 0.75% platform fee on every confirmed charge
    const platformFeeBps = 75;
    const platformFeeAmount = parseFloat(((grossAmount * platformFeeBps) / 10_000).toFixed(4));
    void recordProductSignalEvent(c.env, {
      merchantId: merchant.id,
      audience: 'generic',
      authType: 'api_key',
      surface: 'payments',
      signalType: 'charge_confirmed',
      status: 'completed',
      requestId: sessionId,
      entityType: 'charge_otp',
      entityId: sessionId,
      metadata: {
        payment_intent_id: paymentIntent.id,
        gross_amount: grossAmount,
        currency: chargeCurrency.toUpperCase(),
        platform_fee_bps: platformFeeBps,
        platform_fee_amount: platformFeeAmount,
        principal_id: principalId ?? null,
        mandate_id: mandateId ?? null,
        stripe_status: paymentIntent.status,
      },
    });

    const resumeResult = capabilityExecutionAttemptId
      ? await resumeCapabilityExecutionAttempt(c.env, capabilityExecutionAttemptId).catch((resumeErr) => {
          console.error('[paymentsSetup] capability execution resume failed:', resumeErr instanceof Error ? resumeErr.message : String(resumeErr));
          return null;
        })
      : null;

    return c.json({
      charged: true,
      payment_intent_id: paymentIntent.id,
      amount: grossAmount,
      currency: chargeCurrency.toUpperCase(),
      description: chargeDescription ?? null,
      stripe_status: paymentIntent.status,
      resumed_execution: resumeResult ? {
        attemptId: resumeResult.attempt?.id ?? capabilityExecutionAttemptId,
        status: resumeResult.attempt?.status ?? null,
        result: resumeResult.executionResult,
      } : null,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[paymentsSetup] POST /charge-saved/:sessionId/confirm:', msg);
    return c.json({ error: 'Failed to process charge' }, 500);
  } finally {
    await sql.end();
  }
});

export { router as paymentsSetupRouter };
