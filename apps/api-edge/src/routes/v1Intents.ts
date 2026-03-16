/**
 * Agent-facing payment-intent routes — /api/v1/payment-intents/*
 *
 * Ports src/routes/v1Intents.ts to Hono/Workers.
 *
 * Changes from Express:
 *   - No Joi — inline validation
 *   - No agentIdentityService.verifyPin (bcrypt — Node.js native C++ module)
 *     PIN-based requests return 422 with a clear message; PIN-less flow works.
 *   - No pino logger — console.info/warn/error
 *   - Inline SQL instead of service imports
 *
 * Preserved:
 *   - All route paths and HTTP methods
 *   - Exact response shapes
 *   - Solana Pay URI format
 *   - Intent expiry auto-update on status check
 *   - tx_hash queueing (metadata merge) for the Solana listener
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { createDb } from '../lib/db';
import { evaluatePolicy } from '../../../../src/policy/evaluatePolicy';
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

function generateVerificationToken(): string {
  return `APV_${Date.now()}_${randomHex(8)}`;
}

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}

// ---------------------------------------------------------------------------
// POST /api/v1/payment-intents
// Agent-initiated payment intent (no merchant API key required).
// ---------------------------------------------------------------------------

router.post('/', async (c) => {
  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const { merchantId, agentId, amount, currency, pin, metadata } = body as Record<string, unknown>;

  // Validation — mirrors createAgentIntentSchema (Joi)
  if (!merchantId || !isUuid(merchantId as string)) {
    return c.json({ error: 'Validation error', details: ['"merchantId" must be a valid UUID'] }, 400);
  }
  if (!agentId || typeof agentId !== 'string' || agentId.length < 1 || agentId.length > 255) {
    return c.json({ error: 'Validation error', details: ['"agentId" must be 1–255 characters'] }, 400);
  }
  if (typeof amount !== 'number' || amount <= 0) {
    return c.json({ error: 'Validation error', details: ['"amount" must be a positive number'] }, 400);
  }
  const resolvedCurrency = (currency as string | undefined)?.toUpperCase() ?? 'USDC';
  if (resolvedCurrency !== 'USDC') {
    return c.json({ error: 'Validation error', details: ['"currency" must be USDC'] }, 400);
  }

  // PIN verification uses bcrypt (Node.js native) — deferred in Workers beta.
  // Agents using PINs should continue using the Render backend until Phase 13.
  if (pin) {
    return c.json(
      {
        error: 'PIN_NOT_SUPPORTED',
        message:
          'PIN-based agent authentication is not yet available on the Workers backend. ' +
          'Use the Render backend or omit the PIN field.',
      },
      422,
    );
  }

  const sql = createDb(c.env);
  try {
    // Validate merchant exists and fetch wallet address + Stripe account
    const merchantRows = await sql<
      Array<{
        id: string;
        walletAddress: string;
        webhookUrl: string | null;
        stripeConnectedAccountId: string | null;
      }>
    >`
      SELECT id,
             wallet_address              AS "walletAddress",
             webhook_url                 AS "webhookUrl",
             stripe_connected_account_id AS "stripeConnectedAccountId"
      FROM merchants
      WHERE id = ${merchantId as string}
        AND is_active = true
    `;

    if (!merchantRows.length) {
      return c.json({ error: 'Merchant not found' }, 404);
    }

    const merchantRow = merchantRows[0];
    const intentMetadata = { ...((metadata as Record<string, unknown>) ?? {}), agentId };
    const intentId = crypto.randomUUID();
    const verificationToken = generateVerificationToken();
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes

    await sql`
      INSERT INTO payment_intents
        (id, merchant_id, agent_id, amount, currency, status,
         verification_token, expires_at, metadata, created_at, updated_at)
      VALUES
        (${intentId}, ${merchantId as string}, ${agentId as string},
         ${amount as number}, ${resolvedCurrency}, 'pending',
         ${verificationToken}, ${expiresAt},
         ${JSON.stringify(intentMetadata)}::jsonb,
         NOW(), NOW())
    `;

    // Evaluate policy before attempting settlement-related work.
    try {
      const evalRes = await evaluatePolicy(sql, merchantId as string, {
        amount: amount as number,
        recipientAddress: merchantRow.walletAddress,
        agentId: agentId as string,
      });

      if (evalRes.decision === 'REJECT') {
        await sql`UPDATE payment_intents SET status = 'rejected', updated_at = NOW() WHERE id = ${intentId}`;
        return c.json({ success: false, intentId, status: 'rejected', reason: evalRes.reason, policyVersion: evalRes.policyVersion, evaluatedAt: evalRes.evaluatedAt }, 403);
      }

      if (evalRes.decision === 'REQUIRES_APPROVAL') {
        await sql`UPDATE payment_intents SET status = 'requires_approval', updated_at = NOW() WHERE id = ${intentId}`;
        return c.json(
          {
            status: 'approval_required',
            reason: evalRes.reason,
            policyVersion: evalRes.policyVersion,
            evaluatedAt: evalRes.evaluatedAt,
            intentId,
          },
          202,
        );
      }
    } catch (err) {
      console.warn('[v1-intents] policy evaluation failed, continuing with intent creation', err);
    }

    const solanaPayUri = `solana:${merchantRow.walletAddress}?amount=${amount}&spl-token=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&memo=${encodeURIComponent(verificationToken)}`;

    const instructions: Record<string, unknown> = {
      crypto: {
        network: 'solana',
        token: 'USDC',
        recipientAddress: merchantRow.walletAddress,
        amount,
        memo: verificationToken,
        solanaPayUri,
      },
    };

    if (merchantRow.stripeConnectedAccountId) {
      instructions.fiat = {
        provider: 'stripe',
        note: 'Use POST /api/intents/fiat with merchant API key for Stripe checkout URL',
      };
    }

    // ── Phase 4: settlement identity + matching policy ─────────────────────
    // Agent-facing intents use Solana protocol (direct, non-custodial flow).
    // Both calls are best-effort: errors are caught internally and return
    // null / hard-coded defaults. A settlement failure must not fail intent
    // creation — the response just omits the `settlement` field.
    const [settlementIdentity, matchingPolicy] = await Promise.all([
      insertSettlementIdentity(sql, {
        intentId,
        protocol: 'solana',
        policySnapshot: { verificationToken, protocol: 'solana', agentId },
      }),
      resolveMatchingPolicy(sql, 'solana'),
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

    console.info('[v1-intents] agent intent created', { intentId, merchantId, agentId });

    return c.json(
      {
        success: true,
        intentId,
        verificationToken,
        expiresAt: expiresAt.toISOString(),
        instructions,
        ...(settlement !== undefined ? { settlement } : {}),
      },
      201,
    );
  } catch (err: unknown) {
    console.error('[v1-intents] create error:', err instanceof Error ? err.message : err);
    return c.json({ error: 'Failed to create payment intent' }, 500);
  } finally {
    sql.end().catch(() => {});
  }
});

// ---------------------------------------------------------------------------
// GET /api/v1/payment-intents/:intentId
// Public status check — no auth required.
// Auto-expires overdue pending intents.
// ---------------------------------------------------------------------------

router.get('/:intentId', async (c) => {
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
        amount: number;
        currency: string;
        status: string;
        verificationToken: string;
        expiresAt: Date;
        metadata: unknown;
      }>
    >`
      SELECT id,
             merchant_id        AS "merchantId",
             amount,
             currency,
             status,
             verification_token AS "verificationToken",
             expires_at         AS "expiresAt",
             metadata
      FROM payment_intents
      WHERE id = ${intentId}
    `;

    if (!rows.length) {
      return c.json({ error: 'Payment intent not found' }, 404);
    }

    const intent = rows[0];

    // Auto-expire overdue pending intents
    if (intent.status === 'pending' && new Date(intent.expiresAt) < new Date()) {
      await sql`
        UPDATE payment_intents
        SET status = 'expired', updated_at = NOW()
        WHERE id = ${intentId}
      `.catch(() => {}); // fire-and-forget — don't fail the GET if UPDATE fails
      intent.status = 'expired';
    }

    return c.json({
      success: true,
      intentId: intent.id,
      merchantId: intent.merchantId,
      amount: Number(intent.amount),
      currency: intent.currency,
      status: intent.status,
      verificationToken: intent.verificationToken,
      expiresAt: intent.expiresAt instanceof Date ? intent.expiresAt.toISOString() : intent.expiresAt,
      metadata: intent.metadata,
    });
  } catch (err: unknown) {
    console.error('[v1-intents] status error:', err instanceof Error ? err.message : err);
    return c.json({ error: 'Failed to fetch payment intent' }, 500);
  } finally {
    sql.end().catch(() => {});
  }
});

// ---------------------------------------------------------------------------
// POST /api/v1/payment-intents/:intentId/verify
// Queues a transaction hash for the Solana listener to verify on-chain.
// The listener (running on Render) picks this up on the next poll cycle.
// ---------------------------------------------------------------------------

router.post('/:intentId/verify', async (c) => {
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

  const { txHash } = body;

  // Mirrors verifyIntentSchema (Joi): base58-encoded 32–128 chars
  if (
    !txHash ||
    typeof txHash !== 'string' ||
    !/^[1-9A-HJ-NP-Za-km-z]{32,128}$/.test(txHash)
  ) {
    return c.json(
      {
        error: 'Validation error',
        details: ['"txHash" must be a valid base58-encoded transaction signature'],
      },
      400,
    );
  }

  const sql = createDb(c.env);
  try {
    const rows = await sql<
      Array<{ id: string; status: string; metadata: unknown; expiresAt: Date }>
    >`
      SELECT id, status, metadata, expires_at AS "expiresAt"
      FROM payment_intents
      WHERE id = ${intentId}
    `;

    if (!rows.length) {
      return c.json({ error: 'Payment intent not found' }, 404);
    }

    const intent = rows[0];

    if (intent.status !== 'pending') {
      return c.json({ error: 'Intent is not pending', status: intent.status }, 409);
    }

    if (new Date(intent.expiresAt) < new Date()) {
      await sql`
        UPDATE payment_intents SET status = 'expired', updated_at = NOW()
        WHERE id = ${intentId}
      `.catch(() => {});
      return c.json({ error: 'Payment intent has expired' }, 410);
    }

    // Merge tx_hash into metadata — the Solana listener will process it
    const existingMeta = (intent.metadata ?? {}) as Record<string, unknown>;
    const updatedMeta = { ...existingMeta, tx_hash: txHash };

    await sql`
      UPDATE payment_intents
      SET metadata   = ${JSON.stringify(updatedMeta)}::jsonb,
          updated_at = NOW()
      WHERE id = ${intentId}
        AND status = 'pending'
    `;

    console.info('[v1-intents] tx_hash queued', { intentId, txHash });

    return c.json({
      success: true,
      queued: true,
      intentId,
      txHash,
      message:
        'Transaction hash received. The listener will confirm on-chain within the next poll cycle.',
    });
  } catch (err: unknown) {
    console.error('[v1-intents] verify error:', err instanceof Error ? err.message : err);
    return c.json({ error: 'Failed to queue verification' }, 500);
  } finally {
    sql.end().catch(() => {});
  }
});

export { router as v1IntentsRouter };
