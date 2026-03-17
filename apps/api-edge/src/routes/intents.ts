/**
 * Payment intent routes — /api/intents/*
 *
 * Ports src/routes/intents.ts to Hono/Workers.
 *
 * Changes from Express:
 *   - No Prisma (Node.js-specific) — raw SQL via postgres.js
 *   - No Joi (depends on Node.js internals) — inline validation
 *   - Hono c.get('merchant') instead of req.merchant
 *   - generateVerificationToken via Web Crypto (randomHex) instead of crypto module
 *
 * Preserved:
 *   - All route paths and HTTP methods
 *   - Exact response shapes (intentId, verificationToken, etc.)
 *   - 403 vs 404 ownership logic
 *   - Solana Pay URI format
 *
 * Deferred:
 *   - POST /api/intents/fiat — requires Stripe SDK integration (Phase 10)
 *   - Agent ownership check in POST /api/intents (assertAgentOwnership)
 *     deferred because agents table is not migrated yet; validation is skipped
 *     for the first beta pass
 */

import { Hono, type Context } from 'hono';
import Stripe from 'stripe';
import type { Env, Variables } from '../types';
import { authenticateApiKey } from '../middleware/auth';
import { createDb } from '../lib/db';
import { toSettlementProtocol } from '../lib/settlement';
import {
  insertSettlementIdentity,
  resolveMatchingPolicy,
} from '../lib/settlementDb';

const router = new Hono<{ Bindings: Env; Variables: Variables }>();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Mirrors intentService.generateVerificationToken() exactly. */
function generateVerificationToken(): string {
  return `APV_${Date.now()}_${randomHex(8)}`;
}

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}

// ---------------------------------------------------------------------------
// GET /api/intents/activity
// Auth required. Returns last 20 transactions for activity feed.
// MUST be declared BEFORE /:intentId/status to avoid the wildcard swallowing it.
// ---------------------------------------------------------------------------

router.get('/activity', authenticateApiKey, async (c) => {
  const merchant = c.get('merchant');
  const sql = createDb(c.env);
  try {
    const rows = await sql<
      Array<{
        id: string;
        amountUsdc: number;
        recipientAddress: string;
        status: string;
        metadata: Record<string, unknown> | null;
        createdAt: Date;
      }>
    >`
      SELECT id,
             amount_usdc        AS "amountUsdc",
             recipient_address  AS "recipientAddress",
             status,
             metadata,
             created_at         AS "createdAt"
      FROM transactions
      WHERE merchant_id = ${merchant.id}
      ORDER BY created_at DESC
      LIMIT 20
    `;

    const activity = rows.map((r) => {
      const meta = (r.metadata as Record<string, unknown>) ?? {};
      return {
        id: r.id,
        amount: Number(r.amountUsdc),
        currency: 'USDC',
        recipientAddress: r.recipientAddress,
        sourceAgent: (meta['source_agent'] as string) ?? 'Autonomous Agent',
        destinationService: (meta['destination_service'] as string) ?? null,
        status: r.status,
        createdAt: r.createdAt?.toISOString() ?? null,
      };
    });

    return c.json({ success: true, activity });
  } catch (err: unknown) {
    console.error('[intents] activity error:', err instanceof Error ? err.message : err);
    return c.json({ error: 'Failed to fetch activity feed' }, 500);
  } finally {
    sql.end().catch(() => {});
  }
});

// ---------------------------------------------------------------------------
// GET /api/intents
// Auth required. Lists payment intents for the authenticated merchant.
// ---------------------------------------------------------------------------

router.get('/', authenticateApiKey, async (c) => {
  const merchant = c.get('merchant');
  const sql = createDb(c.env);
  try {
    const rows = await sql<
      Array<{
        id: string;
        amount: number;
        currency: string;
        status: string;
        protocol: string | null;
        agentId: string | null;
        verificationToken: string;
        expiresAt: Date;
        metadata: unknown;
        createdAt: Date;
        updatedAt: Date;
      }>
    >`
      SELECT id, amount, currency, status, protocol,
             agent_id           AS "agentId",
             verification_token AS "verificationToken",
             expires_at         AS "expiresAt",
             metadata,
             created_at         AS "createdAt",
             updated_at         AS "updatedAt"
      FROM payment_intents
      WHERE merchant_id = ${merchant.id}
      ORDER BY created_at DESC
      LIMIT 100
    `;

    return c.json({
      success: true,
      intents: rows.map((i) => ({
        intentId: i.id,
        amount: Number(i.amount),
        currency: i.currency,
        status: i.status,
        protocol: i.protocol ?? null,
        agentId: i.agentId ?? null,
        verificationToken: i.verificationToken,
        expiresAt: i.expiresAt instanceof Date ? i.expiresAt.toISOString() : i.expiresAt,
        metadata: i.metadata,
        createdAt: i.createdAt instanceof Date ? i.createdAt.toISOString() : null,
        updatedAt: i.updatedAt instanceof Date ? i.updatedAt.toISOString() : null,
      })),
    });
  } catch (err: unknown) {
    console.error('[intents] list error:', err instanceof Error ? err.message : err);
    return c.json({ error: 'Failed to fetch payment intents' }, 500);
  } finally {
    sql.end().catch(() => {});
  }
});

// ---------------------------------------------------------------------------
// POST /api/intents
// Auth required. Creates a new payment intent.
// Mirrors intentService.createIntent() + intentController.createIntent().
// ---------------------------------------------------------------------------

router.post('/', authenticateApiKey, async (c) => {
  const merchant = c.get('merchant');
  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const { amount, currency, agentId, protocol, metadata, purpose } = body as Record<string, unknown>;

  // Validation — mirrors createIntentSchema (Joi)
  if (typeof amount !== 'number' || amount <= 0) {
    return c.json({ error: 'Validation error', details: ['"amount" must be a positive number'] }, 400);
  }
  if (currency !== 'USDC') {
    return c.json({ error: 'Validation error', details: ['"currency" must be USDC'] }, 400);
  }
  if (agentId !== undefined && !isUuid(agentId as string)) {
    return c.json({ error: 'Validation error', details: ['"agentId" must be a valid UUID'] }, 400);
  }
  const validProtocols = ['solana', 'x402', 'ap2', 'acp'];
  if (protocol !== undefined && !validProtocols.includes(protocol as string)) {
    return c.json({ error: 'Validation error', details: [`"protocol" must be one of: ${validProtocols.join(', ')}`] }, 400);
  }
  if (purpose !== undefined && (typeof purpose !== 'string' || purpose.length > 500)) {
    return c.json({ error: 'Validation error', details: ['"purpose" must be a string with max 500 characters'] }, 400);
  }
  const resolvedPurpose = typeof purpose === 'string' ? purpose.trim() : undefined;

  const intentMetadata: Record<string, unknown> = {
    ...((metadata as Record<string, unknown>) ?? {}),
    ...(resolvedPurpose ? { purpose: resolvedPurpose } : {}),
  };

  const sql = createDb(c.env);
  try {
    // Look up merchant wallet address for Solana Pay URI
    const merchantRows = await sql<Array<{ walletAddress: string }>>`
      SELECT wallet_address AS "walletAddress"
      FROM merchants
      WHERE id = ${merchant.id}
    `;

    if (!merchantRows.length) {
      return c.json({ error: 'Merchant not found' }, 404);
    }

    const walletAddress = merchantRows[0].walletAddress;
    const intentId = crypto.randomUUID();
    const verificationToken = generateVerificationToken();
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes

    await sql`
      INSERT INTO payment_intents
        (id, merchant_id, agent_id, amount, currency, status, protocol,
         verification_token, expires_at, metadata, created_at, updated_at)
      VALUES
        (${intentId}, ${merchant.id},
         ${(agentId as string | undefined) ?? null},
         ${amount as number}, ${currency as string}, 'pending',
         ${(protocol as string | undefined) ?? null},
         ${verificationToken}, ${expiresAt},
         ${Object.keys(intentMetadata).length ? JSON.stringify(intentMetadata) : null}::jsonb,
         NOW(), NOW())
    `;

    const solanaPayUri = `solana:${walletAddress}?amount=${amount}&spl-token=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&memo=${encodeURIComponent(verificationToken)}`;

    // ── Phase 4: settlement identity + matching policy ─────────────────────
    // Both calls are best-effort: errors are caught internally and return
    // null / hard-coded defaults. A settlement failure must not fail intent
    // creation — the response just omits the `settlement` field.
    const settlementProtocol = toSettlementProtocol(protocol as string | undefined) ?? 'solana';
    const [settlementIdentity, matchingPolicy] = await Promise.all([
      insertSettlementIdentity(sql, {
        intentId,
        protocol: settlementProtocol,
        policySnapshot: { verificationToken, protocol: settlementProtocol },
      }),
      resolveMatchingPolicy(sql, settlementProtocol),
    ]);

    const settlement = settlementIdentity
      ? {
          settlementIdentityId: settlementIdentity.id,
          protocol: matchingPolicy.protocol,
          matchStrategy: matchingPolicy.matchStrategy,
          requireMemoMatch: matchingPolicy.requireMemoMatch,
          confirmationDepth: matchingPolicy.confirmationDepth,
          ttlSeconds: matchingPolicy.ttlSeconds,
          identityMode: matchingPolicy.identityMode,
          amountMode: matchingPolicy.amountMode,
          allowedProofSource: matchingPolicy.allowedProofSource,
          feeSourcePolicy: matchingPolicy.feeSourcePolicy,
          status: 'pending' as const,
        }
      : undefined;

    console.info('[intents] created', { intentId, merchantId: merchant.id });

    return c.json(
      {
        success: true,
        intentId,
        verificationToken,
        expiresAt: expiresAt.toISOString(),
        ...(resolvedPurpose ? { purpose: resolvedPurpose } : {}),
        instructions: {
          recipientAddress: walletAddress,
          memo: verificationToken,
          solanaPayUri,
        },
        ...(settlement !== undefined ? { settlement } : {}),
      },
      201,
    );
  } catch (err: unknown) {
    console.error('[intents] create error:', err instanceof Error ? err.message : err);
    return c.json({ error: 'Failed to create payment intent' }, 500);
  } finally {
    sql.end().catch(() => {});
  }
});

// ---------------------------------------------------------------------------
// GET /api/intents/:intentId/status
// Auth required. Returns intent status with 403/404 ownership logic.
// ---------------------------------------------------------------------------

router.get('/:intentId/status', authenticateApiKey, async (c) => {
  const merchant = c.get('merchant');
  const { intentId } = c.req.param();

  if (!isUuid(intentId)) {
    return c.json({ error: 'Invalid intent ID' }, 400);
  }

  const sql = createDb(c.env);
  try {
    const rows = await sql<
      Array<{
        id: string;
        merchantId: string;
        status: string;
        amount: number;
        currency: string;
        expiresAt: Date;
        verificationToken: string;
      }>
    >`
      SELECT id, merchant_id AS "merchantId", status, amount, currency,
             expires_at AS "expiresAt", verification_token AS "verificationToken"
      FROM payment_intents
      WHERE id = ${intentId}
    `;

    if (!rows.length) {
      return c.json({ error: 'Payment intent not found' }, 404);
    }

    const intent = rows[0];
    if (intent.merchantId !== merchant.id) {
      console.warn('[security] unauthorized intent access', { intentId, merchant: merchant.id });
      return c.json({ error: 'Unauthorized access to this payment intent' }, 403);
    }

    return c.json({
      success: true,
      status: intent.status,
      amount: Number(intent.amount),
      currency: intent.currency,
      expiresAt: intent.expiresAt instanceof Date ? intent.expiresAt.toISOString() : intent.expiresAt,
    });
  } catch (err: unknown) {
    console.error('[intents] status error:', err instanceof Error ? err.message : err);
    return c.json({ error: 'Failed to fetch payment intent status' }, 500);
  } finally {
    sql.end().catch(() => {});
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/intents/:intentId/agent
// Auth required. Attaches an agent to an existing intent.
// ---------------------------------------------------------------------------

router.patch('/:intentId/agent', authenticateApiKey, async (c) => {
  const merchant = c.get('merchant');
  const { intentId } = c.req.param();

  if (!isUuid(intentId)) {
    return c.json({ error: 'Invalid intent ID' }, 400);
  }

  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const { agentId } = body;
  if (!agentId || !isUuid(agentId as string)) {
    return c.json({ error: 'Validation error', details: ['agentId must be a valid UUID'] }, 400);
  }

  const sql = createDb(c.env);
  try {
    const rows = await sql<Array<{ merchantId: string }>>`
      SELECT merchant_id AS "merchantId"
      FROM payment_intents
      WHERE id = ${intentId}
    `;

    if (!rows.length) {
      return c.json({ error: 'Payment intent not found' }, 404);
    }
    if (rows[0].merchantId !== merchant.id) {
      return c.json({ error: 'Unauthorized access to this payment intent' }, 403);
    }

    const updated = await sql<
      Array<{
        id: string;
        amount: number;
        currency: string;
        status: string;
        protocol: string | null;
        agentId: string | null;
        expiresAt: Date;
        createdAt: Date;
        updatedAt: Date;
      }>
    >`
      UPDATE payment_intents
      SET agent_id   = ${agentId as string},
          updated_at = NOW()
      WHERE id = ${intentId}
      RETURNING id, amount, currency, status, protocol,
                agent_id AS "agentId", expires_at AS "expiresAt",
                created_at AS "createdAt", updated_at AS "updatedAt"
    `;

    const u = updated[0];
    console.info('[intents] agent attached', { intentId, agentId, merchantId: merchant.id });

    return c.json({
      success: true,
      intent: {
        intentId: u.id,
        amount: Number(u.amount),
        currency: u.currency,
        status: u.status,
        protocol: u.protocol ?? null,
        agentId: u.agentId ?? null,
        expiresAt: u.expiresAt instanceof Date ? u.expiresAt.toISOString() : u.expiresAt,
        createdAt: u.createdAt instanceof Date ? u.createdAt.toISOString() : null,
        updatedAt: u.updatedAt instanceof Date ? u.updatedAt.toISOString() : null,
      },
    });
  } catch (err: unknown) {
    console.error('[intents] attach agent error:', err instanceof Error ? err.message : err);
    return c.json({ error: 'Failed to attach agent to intent' }, 500);
  } finally {
    sql.end().catch(() => {});
  }
});

// ---------------------------------------------------------------------------
// POST /api/intents/fiat
// Auth required. Creates a Stripe Checkout Session for fiat card payments.
//
// Body: { amount, agentId?, purpose? }
//   amount  — payment amount in USD (e.g. 10.00 = $10.00)
//   agentId — optional agent UUID
//   purpose — optional payment description shown to payer (max 500 chars)
//
// Requires:
//   - STRIPE_SECRET_KEY env var
//   - Merchant must have stripe_connected_account_id set
//
// Returns: { intentId, checkoutUrl, sessionId, expiresAt }
// ---------------------------------------------------------------------------

router.post('/fiat', authenticateApiKey, async (c) => {
  if (!c.env.STRIPE_SECRET_KEY) {
    return c.json({ error: 'Stripe is not configured on this server' }, 503);
  }

  const merchant = c.get('merchant');
  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const { amount, agentId, purpose } = body;

  if (typeof amount !== 'number' || amount <= 0) {
    return c.json({ error: 'Validation error', details: ['"amount" must be a positive number (USD)'] }, 400);
  }
  if (agentId !== undefined && !isUuid(agentId as string)) {
    return c.json({ error: 'Validation error', details: ['"agentId" must be a valid UUID'] }, 400);
  }
  if (purpose !== undefined && (typeof purpose !== 'string' || purpose.length > 500)) {
    return c.json({ error: 'Validation error', details: ['"purpose" must be a string with max 500 characters'] }, 400);
  }
  const resolvedPurpose = typeof purpose === 'string' ? purpose.trim() : undefined;

  const sql = createDb(c.env);
  try {
    // Fetch merchant's Stripe Connect account ID
    const merchantRows = await sql<Array<{
      stripeConnectedAccountId: string | null;
      walletAddress: string;
    }>>`
      SELECT stripe_connected_account_id AS "stripeConnectedAccountId",
             wallet_address              AS "walletAddress"
      FROM merchants
      WHERE id = ${merchant.id} AND is_active = true
      LIMIT 1
    `;

    if (!merchantRows.length) {
      return c.json({ error: 'Merchant not found' }, 404);
    }

    const { stripeConnectedAccountId, walletAddress } = merchantRows[0];
    if (!stripeConnectedAccountId) {
      return c.json({
        error: 'STRIPE_NOT_CONNECTED',
        message: 'This merchant account does not have a Stripe Connect account linked. Contact support to enable fiat payments.',
      }, 400);
    }

    // Create payment intent record first so we have an intentId for Stripe metadata
    const intentId = crypto.randomUUID();
    const verificationToken = generateVerificationToken();
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes
    const intentMetadata: Record<string, unknown> = {
      ...(agentId ? { agentId } : {}),
      ...(resolvedPurpose ? { purpose: resolvedPurpose } : {}),
      stripeFlow: true,
    };

    await sql`
      INSERT INTO payment_intents
        (id, merchant_id, agent_id, amount, currency, status, protocol,
         verification_token, expires_at, metadata, created_at, updated_at)
      VALUES
        (${intentId}, ${merchant.id},
         ${(agentId as string | undefined) ?? null},
         ${amount as number}, 'USD', 'pending', 'stripe',
         ${verificationToken}, ${expiresAt},
         ${JSON.stringify(intentMetadata)}::jsonb,
         NOW(), NOW())
    `;

    // Create Stripe Checkout Session via Connect
    const stripe = new Stripe(c.env.STRIPE_SECRET_KEY, {
      httpClient: Stripe.createFetchHttpClient(),
    });

    const lineItemName = resolvedPurpose
      ? `AgentPay: ${resolvedPurpose.slice(0, 100)}`
      : 'AgentPay Payment';

    const frontendUrl = c.env.FRONTEND_URL || 'https://apay-delta.vercel.app';
    const session = await stripe.checkout.sessions.create(
      {
        payment_method_types: ['card'],
        line_items: [
          {
            price_data: {
              currency: 'usd',
              product_data: { name: lineItemName },
              unit_amount: Math.round(amount * 100), // cents
            },
            quantity: 1,
          },
        ],
        mode: 'payment',
        success_url: `${frontendUrl}/payment/success?intentId=${intentId}&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${frontendUrl}/payment/cancel?intentId=${intentId}`,
        metadata: {
          intentId,
          agentId: (agentId as string | undefined) ?? '',
          purpose: resolvedPurpose ?? '',
          merchantId: merchant.id,
        },
      },
      { stripeAccount: stripeConnectedAccountId },
    );

    console.info('[intents/fiat] Stripe checkout session created', {
      intentId,
      sessionId: session.id,
      merchantId: merchant.id,
      amount,
    });

    return c.json(
      {
        success: true,
        intentId,
        checkoutUrl: session.url,
        sessionId: session.id,
        expiresAt: expiresAt.toISOString(),
        ...(resolvedPurpose ? { purpose: resolvedPurpose } : {}),
      },
      201,
    );
  } catch (err: unknown) {
    // Surface Stripe-specific errors with a clean message
    if (err instanceof Stripe.errors.StripeError) {
      console.error('[intents/fiat] Stripe error:', err.message, { code: err.code, type: err.type });
      return c.json({ error: 'Stripe error', message: err.message }, 502);
    }
    console.error('[intents/fiat] error:', err instanceof Error ? err.message : err);
    return c.json({ error: 'Failed to create fiat payment intent' }, 500);
  } finally {
    sql.end().catch(() => {});
  }
});

export { router as intentsRouter };
