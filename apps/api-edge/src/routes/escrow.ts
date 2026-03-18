/**
 * Solana On-Chain Escrow — /api/escrow/*
 *
 * Provides trustless USDC escrow for A2A transactions on Solana.
 * The platform acts as an off-chain coordinator; settlement is verified
 * on-chain via the Solana listener DO.
 *
 * Flow:
 *   1. POST /api/escrow/create   — payer deposits USDC to escrow address
 *   2. POST /api/escrow/release  — payer (or arbiter) releases funds to payee
 *   3. POST /api/escrow/refund   — payer cancels and recovers funds (if not released)
 *   4. GET  /api/escrow/:escrowId — check escrow state
 *
 * Escrow address: funds go to the platform treasury wallet, which acts as
 * the escrow custodian. A dedicated escrow program is Phase 3.
 *
 * Until a native Solana escrow program is deployed, this uses the platform
 * treasury as a multi-sig custodian with DB-tracked release conditions.
 * The memo field encodes the escrowId so the Solana listener can match
 * incoming transfers to escrow records.
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { createDb } from '../lib/db';
import { hmacSign } from '../lib/hmac';

const router = new Hono<{ Bindings: Env; Variables: Variables }>();

const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
// Platform fee on escrow: 1% (100 bps) — taken at release
const ESCROW_FEE_BPS = 100;

function randomId() { return crypto.randomUUID(); }

// ---------------------------------------------------------------------------
// GET /api/escrow/schema
// ---------------------------------------------------------------------------

router.get('/schema', (c) =>
  c.json({
    protocol: 'AgentPayEscrow',
    version: '1.0',
    description: 'Trustless USDC escrow for A2A transactions on Solana',
    custodian: 'Platform treasury (multi-sig). Native escrow program: Phase 3.',
    flow: ['POST /create → deposit USDC → POST /release (or /refund)'],
    endpoints: {
      create:  { method: 'POST', path: '/api/escrow/create',  description: 'Open escrow' },
      release: { method: 'POST', path: '/api/escrow/release', description: 'Release funds to payee' },
      refund:  { method: 'POST', path: '/api/escrow/refund',  description: 'Refund to payer' },
      status:  { method: 'GET',  path: '/api/escrow/:id',     description: 'Escrow state' },
    },
    feeBps: ESCROW_FEE_BPS,
    usdcMint: USDC_MINT,
  }),
);

// ---------------------------------------------------------------------------
// POST /api/escrow/create — open a new escrow
//
// Body: { payerAgentId, payeeAddress, amountUsdc, taskDescription, ttlHours? }
// Returns: escrowId, depositAddress, solanaPayUri, expiresAt
// ---------------------------------------------------------------------------

router.post('/create', async (c) => {
  let body: Record<string, unknown> = {};
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }

  const { payerAgentId, payeeAddress, amountUsdc, taskDescription, ttlHours = 72 } = body as Record<string, string | number>;

  if (!payerAgentId || typeof payerAgentId !== 'string') return c.json({ error: 'payerAgentId required' }, 400);
  if (!payeeAddress || typeof payeeAddress !== 'string' || payeeAddress.length < 32) {
    return c.json({ error: 'payeeAddress must be a valid Solana address' }, 400);
  }
  if (typeof amountUsdc !== 'number' || amountUsdc <= 0 || amountUsdc > 100_000) {
    return c.json({ error: 'amountUsdc must be a positive number ≤ 100,000' }, 400);
  }
  if (!taskDescription || typeof taskDescription !== 'string') return c.json({ error: 'taskDescription required' }, 400);

  const treasuryWallet = c.env.PLATFORM_TREASURY_WALLET;
  if (!treasuryWallet) return c.json({ error: 'Escrow not configured — PLATFORM_TREASURY_WALLET missing' }, 503);

  const escrowId = `esc_${randomId().replace(/-/g, '').slice(0, 16)}`;
  const expiresAt = new Date(Date.now() + Number(ttlHours) * 3_600_000).toISOString();
  const feeUsdc = (amountUsdc * ESCROW_FEE_BPS) / 10_000;
  const netPayeeUsdc = amountUsdc - feeUsdc;

  // Solana Pay URI — payer sends USDC to treasury with escrowId memo
  const solanaPayUri = `solana:${treasuryWallet}?amount=${amountUsdc}&spl-token=${USDC_MINT}&memo=${encodeURIComponent(escrowId)}`;

  const sql = createDb(c.env);
  try {
    await sql`
      INSERT INTO payment_intents
        (id, merchant_id, agent_id, amount, currency, status, verification_token, expires_at, metadata)
      VALUES
        (${escrowId},
         NULL,
         ${payerAgentId},
         ${amountUsdc},
         ${'USDC'},
         ${'escrow_pending'},
         ${escrowId},
         ${expiresAt}::timestamptz,
         ${JSON.stringify({
           protocol: 'escrow_v1',
           payerAgentId,
           payeeAddress,
           taskDescription,
           feeUsdc,
           netPayeeUsdc,
           feeBps: ESCROW_FEE_BPS,
           depositAddress: treasuryWallet,
         })}::jsonb)
    `;

    return c.json({
      success: true,
      escrowId,
      status: 'escrow_pending',
      depositAddress: treasuryWallet,
      amountUsdc,
      feeUsdc,
      netPayeeUsdc,
      payeeAddress,
      taskDescription,
      expiresAt,
      solanaPayUri,
      instructions: [
        `Send exactly ${amountUsdc} USDC to ${treasuryWallet}`,
        `Include memo: ${escrowId}`,
        'The Solana listener will confirm deposit automatically within ~30 seconds',
        'Call POST /api/escrow/release when task is complete',
      ],
      _schema: 'EscrowCreate/1.0',
    }, 201);
  } finally {
    await sql.end().catch(() => {});
  }
});

// ---------------------------------------------------------------------------
// POST /api/escrow/release — payer releases funds to payee
//
// Body: { escrowId, payerAgentId, payerAgentKey }
// ---------------------------------------------------------------------------

router.post('/release', async (c) => {
  let body: Record<string, unknown> = {};
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }

  const { escrowId, payerAgentId, payerAgentKey } = body as Record<string, string>;
  if (!escrowId || !payerAgentId || !payerAgentKey) {
    return c.json({ error: 'escrowId, payerAgentId, payerAgentKey required' }, 400);
  }

  const sql = createDb(c.env);
  try {
    // Verify agent key
    const keyHash = await sha256(payerAgentKey);
    const agentRows = await sql<any[]>`
      SELECT metadata FROM agent_identities WHERE agent_id = ${payerAgentId} LIMIT 1
    `.catch(() => []);
    if (!agentRows.length || agentRows[0].metadata?.agentKeyHash !== keyHash) {
      return c.json({ error: 'INVALID_AGENT_KEY' }, 401);
    }

    // Fetch escrow record
    const rows = await sql<any[]>`
      SELECT id, status, amount, metadata FROM payment_intents
      WHERE id = ${escrowId} AND agent_id = ${payerAgentId}
        AND metadata->>'protocol' = 'escrow_v1'
      LIMIT 1
    `.catch(() => []);

    if (!rows.length) return c.json({ error: 'ESCROW_NOT_FOUND', escrowId }, 404);
    const escrow = rows[0];

    if (escrow.status === 'escrow_pending') {
      return c.json({ error: 'DEPOSIT_NOT_CONFIRMED', message: 'Deposit not yet confirmed on-chain. Wait for Solana listener confirmation.' }, 409);
    }
    if (escrow.status !== 'escrow_funded') {
      return c.json({ error: `Cannot release: status is '${escrow.status}'` }, 409);
    }

    const meta = escrow.metadata ?? {};
    const completedAt = new Date().toISOString();
    const releaseRef = `rel_${randomId().replace(/-/g, '').slice(0, 12)}`;

    await sql`
      UPDATE payment_intents
      SET status = 'completed',
          metadata = ${JSON.stringify({ ...meta, releaseRef, completedAt, releasedBy: payerAgentId })}::jsonb
      WHERE id = ${escrowId}
    `;

    // Sign the release receipt
    const receiptPayload = { escrowId, payeeAddress: meta.payeeAddress, netPayeeUsdc: meta.netPayeeUsdc, releaseRef, completedAt };
    const signature = await hmacSign(JSON.stringify(receiptPayload), c.env.AGENTPAY_SIGNING_SECRET);

    return c.json({
      success: true,
      escrowId,
      status: 'completed',
      releaseRef,
      payeeAddress: meta.payeeAddress,
      netPayeeUsdc: meta.netPayeeUsdc,
      feeUsdc: meta.feeUsdc,
      completedAt,
      receipt: { ...receiptPayload, signature },
      _note: 'Payout to payee will be processed by the platform treasury within one business day. Automated on-chain release: Phase 3.',
      _schema: 'EscrowRelease/1.0',
    });
  } finally {
    await sql.end().catch(() => {});
  }
});

// ---------------------------------------------------------------------------
// POST /api/escrow/refund — cancel escrow and refund payer
// ---------------------------------------------------------------------------

router.post('/refund', async (c) => {
  let body: Record<string, unknown> = {};
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }

  const { escrowId, payerAgentId, payerAgentKey } = body as Record<string, string>;
  if (!escrowId || !payerAgentId || !payerAgentKey) {
    return c.json({ error: 'escrowId, payerAgentId, payerAgentKey required' }, 400);
  }

  const sql = createDb(c.env);
  try {
    const keyHash = await sha256(payerAgentKey);
    const agentRows = await sql<any[]>`
      SELECT metadata FROM agent_identities WHERE agent_id = ${payerAgentId} LIMIT 1
    `.catch(() => []);
    if (!agentRows.length || agentRows[0].metadata?.agentKeyHash !== keyHash) {
      return c.json({ error: 'INVALID_AGENT_KEY' }, 401);
    }

    const rows = await sql<any[]>`
      SELECT id, status, amount, metadata, expires_at FROM payment_intents
      WHERE id = ${escrowId} AND agent_id = ${payerAgentId}
        AND metadata->>'protocol' = 'escrow_v1'
      LIMIT 1
    `.catch(() => []);

    if (!rows.length) return c.json({ error: 'ESCROW_NOT_FOUND', escrowId }, 404);
    const escrow = rows[0];

    if (escrow.status === 'completed') {
      return c.json({ error: 'ALREADY_RELEASED', message: 'Escrow already released to payee — cannot refund.' }, 409);
    }
    if (escrow.status === 'refunded') {
      return c.json({ error: 'ALREADY_REFUNDED' }, 409);
    }

    const meta = escrow.metadata ?? {};
    const refundedAt = new Date().toISOString();

    await sql`
      UPDATE payment_intents
      SET status = 'refunded',
          metadata = ${JSON.stringify({ ...meta, refundedAt, refundedBy: payerAgentId })}::jsonb
      WHERE id = ${escrowId}
    `;

    return c.json({
      success: true,
      escrowId,
      status: 'refunded',
      amountUsdc: Number(escrow.amount),
      refundedAt,
      _note: 'Refund will be processed to the original payer wallet within one business day. Automated on-chain refund: Phase 3.',
      _schema: 'EscrowRefund/1.0',
    });
  } finally {
    await sql.end().catch(() => {});
  }
});

// ---------------------------------------------------------------------------
// GET /api/escrow/:escrowId — escrow state
// ---------------------------------------------------------------------------

router.get('/:escrowId', async (c) => {
  const { escrowId } = c.req.param();
  if (!escrowId || !/^esc_[a-f0-9]{16}$/.test(escrowId)) {
    return c.json({ error: 'Invalid escrowId format' }, 400);
  }

  const sql = createDb(c.env);
  try {
    const rows = await sql<any[]>`
      SELECT id, status, amount, metadata, created_at, expires_at
      FROM payment_intents
      WHERE id = ${escrowId} AND metadata->>'protocol' = 'escrow_v1'
      LIMIT 1
    `.catch(() => []);

    if (!rows.length) return c.json({ error: 'ESCROW_NOT_FOUND', escrowId }, 404);
    const r = rows[0];
    const meta = r.metadata ?? {};

    return c.json({
      success: true,
      escrowId: r.id,
      status: r.status,
      amountUsdc: Number(r.amount),
      feeUsdc: meta.feeUsdc ?? null,
      netPayeeUsdc: meta.netPayeeUsdc ?? null,
      payerAgentId: meta.payerAgentId ?? null,
      payeeAddress: meta.payeeAddress ?? null,
      taskDescription: meta.taskDescription ?? null,
      depositAddress: meta.depositAddress ?? null,
      createdAt: r.created_at,
      expiresAt: r.expires_at,
      completedAt: meta.completedAt ?? null,
      refundedAt: meta.refundedAt ?? null,
      releaseRef: meta.releaseRef ?? null,
      _schema: 'EscrowStatus/1.0',
    });
  } finally {
    await sql.end().catch(() => {});
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function sha256(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export { router as escrowRouter };
