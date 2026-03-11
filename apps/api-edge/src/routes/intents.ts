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
import type { Env, Variables } from '../types';
import { authenticateApiKey } from '../middleware/auth';
import { createDb } from '../lib/db';

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

  const { amount, currency, agentId, protocol, metadata } = body as Record<string, unknown>;

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
         ${metadata ? JSON.stringify(metadata) : null}::jsonb,
         NOW(), NOW())
    `;

    const solanaPayUri = `solana:${walletAddress}?amount=${amount}&spl-token=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&memo=${encodeURIComponent(verificationToken)}`;

    console.info('[intents] created', { intentId, merchantId: merchant.id });

    return c.json(
      {
        success: true,
        intentId,
        verificationToken,
        expiresAt: expiresAt.toISOString(),
        instructions: {
          recipientAddress: walletAddress,
          memo: verificationToken,
          solanaPayUri,
        },
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
// DEFERRED — requires Stripe SDK + Stripe Connect account lookup.
// Will be implemented in Phase 10 alongside the Stripe webhook routes.
// ---------------------------------------------------------------------------

router.post('/fiat', authenticateApiKey, (c) =>
  c.json(
    {
      error: 'NOT_YET_MIGRATED',
      message: 'Fiat intents are not yet available on the Workers backend. Use the Render backend.',
    },
    501,
  ),
);

export { router as intentsRouter };
