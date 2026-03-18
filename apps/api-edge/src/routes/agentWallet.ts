/**
 * Hosted Agent Wallet — /api/v1/agents/:agentId/wallet
 *
 * Custodial USDC balance per agentId. Removes the private-key requirement
 * for agents operating in mobile or serverless environments.
 *
 * The platform holds USDC on behalf of agents in a pooled treasury.
 * Each agent has a ledger balance tracked in the agent_wallets table.
 *
 * Endpoints:
 *   GET    /api/v1/agents/:agentId/wallet           — balance + recent txs
 *   POST   /api/v1/agents/:agentId/wallet/deposit   — record inbound deposit (after on-chain confirm)
 *   POST   /api/v1/agents/:agentId/wallet/spend     — debit balance for a payment
 *   POST   /api/v1/agents/:agentId/wallet/withdraw  — queue withdrawal to an on-chain address
 *
 * Auth: agentKey required in X-Agent-Key header for all mutating operations.
 *
 * Schema: agent_wallets table
 *   agent_id TEXT PRIMARY KEY
 *   balance_usdc NUMERIC(20,6) DEFAULT 0
 *   reserved_usdc NUMERIC(20,6) DEFAULT 0   — locked for pending withdrawals
 *   updated_at TIMESTAMPTZ
 *   metadata JSONB
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { createDb } from '../lib/db';

const router = new Hono<{ Bindings: Env; Variables: Variables }>();

const MIN_DEPOSIT  = 0.01;
const MAX_WITHDRAW = 100_000;

// ─── helpers ────────────────────────────────────────────────────────────────

async function sha256(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function verifyAgentKey(
  sql: ReturnType<typeof createDb>,
  agentId: string,
  agentKey: string,
): Promise<boolean> {
  const keyHash = await sha256(agentKey);
  const rows = await sql<any[]>`
    SELECT metadata FROM agent_identities
    WHERE agent_id = ${agentId} LIMIT 1
  `.catch(() => []);
  return rows.length > 0 && rows[0].metadata?.agentKeyHash === keyHash;
}

/** Upsert the wallet row (idempotent — safe to call on first access). */
async function ensureWallet(sql: ReturnType<typeof createDb>, agentId: string) {
  await sql`
    INSERT INTO agent_wallets (agent_id, balance_usdc, reserved_usdc, updated_at)
    VALUES (${agentId}, 0, 0, NOW())
    ON CONFLICT (agent_id) DO NOTHING
  `.catch(() => {});
}

// ---------------------------------------------------------------------------
// GET /api/v1/agents/:agentId/wallet
// ---------------------------------------------------------------------------

router.get('/', async (c) => {
  const agentId = c.req.param('agentId');

  const sql = createDb(c.env);
  try {
    await ensureWallet(sql, agentId);

    const [walletRows, txRows] = await Promise.all([
      sql<any[]>`
        SELECT balance_usdc, reserved_usdc, updated_at
        FROM agent_wallets WHERE agent_id = ${agentId} LIMIT 1
      `.catch(() => []),
      sql<any[]>`
        SELECT id, amount, currency, status, metadata, created_at
        FROM payment_intents
        WHERE agent_id = ${agentId}
          AND status IN ('completed', 'confirmed', 'refunded', 'wallet_spend', 'wallet_deposit')
        ORDER BY created_at DESC
        LIMIT 20
      `.catch(() => []),
    ]);

    const w = walletRows[0] ?? { balance_usdc: 0, reserved_usdc: 0, updated_at: null };
    const available = Math.max(0, Number(w.balance_usdc) - Number(w.reserved_usdc));

    return c.json({
      success: true,
      agentId,
      wallet: {
        balanceUsdc:   Number(w.balance_usdc),
        reservedUsdc:  Number(w.reserved_usdc),
        availableUsdc: available,
        updatedAt:     w.updated_at,
      },
      depositAddress: c.env.PLATFORM_TREASURY_WALLET ?? null,
      depositMemo:    `wallet:${agentId}`,
      recentActivity: txRows.map(r => ({
        intentId:  r.id,
        type:      r.metadata?.walletTxType ?? r.status,
        amountUsdc: Number(r.amount),
        status:    r.status,
        createdAt: r.created_at,
      })),
      _schema: 'AgentWallet/1.0',
    });
  } finally {
    await sql.end().catch(() => {});
  }
});

// ---------------------------------------------------------------------------
// POST /api/v1/agents/:agentId/wallet/deposit
//
// Called after the platform treasury confirms receipt of USDC with memo "wallet:<agentId>".
// In production this is called by the Solana listener DO when it sees a matching memo.
// Agents can also call this directly with a confirmed txHash.
//
// Body: { agentKey, amountUsdc, txHash }
// ---------------------------------------------------------------------------

router.post('/deposit', async (c) => {
  const agentId = c.req.param('agentId');
  let body: Record<string, unknown> = {};
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }

  const { agentKey, amountUsdc, txHash } = body as Record<string, string | number>;

  if (!agentKey || typeof agentKey !== 'string') return c.json({ error: 'agentKey required' }, 400);
  if (typeof amountUsdc !== 'number' || amountUsdc < MIN_DEPOSIT) {
    return c.json({ error: `amountUsdc must be >= ${MIN_DEPOSIT}` }, 400);
  }

  const sql = createDb(c.env);
  try {
    if (!(await verifyAgentKey(sql, agentId, agentKey))) {
      return c.json({ error: 'INVALID_AGENT_KEY' }, 401);
    }

    await ensureWallet(sql, agentId);

    // Idempotency — if this txHash already credited, skip
    if (txHash) {
      const dup = await sql<any[]>`
        SELECT id FROM payment_intents
        WHERE agent_id = ${agentId}
          AND metadata->>'walletTxHash' = ${String(txHash)}
          AND metadata->>'walletTxType' = 'deposit'
        LIMIT 1
      `.catch(() => []);
      if (dup.length) {
        return c.json({ error: 'ALREADY_CREDITED', txHash }, 409);
      }
    }

    const depositId = `wdep_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;

    // Record the deposit intent
    await sql`
      INSERT INTO payment_intents
        (id, merchant_id, agent_id, amount, currency, status, verification_token, expires_at, metadata)
      VALUES
        (${depositId}, NULL, ${agentId}, ${amountUsdc}, ${'USDC'}, ${'wallet_deposit'},
         ${depositId}, NOW() + INTERVAL '10 years',
         ${JSON.stringify({
           walletTxType: 'deposit',
           walletTxHash: txHash ?? null,
           creditedToAgentId: agentId,
         })}::jsonb)
    `.catch(() => {});

    // Credit the wallet balance
    await sql`
      UPDATE agent_wallets
      SET balance_usdc = balance_usdc + ${amountUsdc},
          updated_at = NOW()
      WHERE agent_id = ${agentId}
    `;

    const rows = await sql<any[]>`
      SELECT balance_usdc, reserved_usdc FROM agent_wallets WHERE agent_id = ${agentId} LIMIT 1
    `.catch(() => []);

    const newBalance = Number(rows[0]?.balance_usdc ?? amountUsdc);

    return c.json({
      success: true,
      depositId,
      agentId,
      creditedUsdc: amountUsdc,
      newBalanceUsdc: newBalance,
      txHash: txHash ?? null,
      _schema: 'WalletDeposit/1.0',
    }, 201);
  } finally {
    await sql.end().catch(() => {});
  }
});

// ---------------------------------------------------------------------------
// POST /api/v1/agents/:agentId/wallet/spend
//
// Debit the agent's wallet balance for a payment (A2A hire, escrow, etc.).
// Returns a spendId that can be referenced in payment intents.
//
// Body: { agentKey, amountUsdc, description, recipientAgentId? }
// ---------------------------------------------------------------------------

router.post('/spend', async (c) => {
  const agentId = c.req.param('agentId');
  let body: Record<string, unknown> = {};
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }

  const { agentKey, amountUsdc, description, recipientAgentId } = body as Record<string, string | number>;

  if (!agentKey || typeof agentKey !== 'string') return c.json({ error: 'agentKey required' }, 400);
  if (typeof amountUsdc !== 'number' || amountUsdc <= 0) {
    return c.json({ error: 'amountUsdc must be a positive number' }, 400);
  }
  if (!description || typeof description !== 'string') {
    return c.json({ error: 'description required' }, 400);
  }

  const sql = createDb(c.env);
  try {
    if (!(await verifyAgentKey(sql, agentId, agentKey))) {
      return c.json({ error: 'INVALID_AGENT_KEY' }, 401);
    }

    await ensureWallet(sql, agentId);

    const rows = await sql<any[]>`
      SELECT balance_usdc, reserved_usdc FROM agent_wallets WHERE agent_id = ${agentId} LIMIT 1
    `.catch(() => []);

    if (!rows.length) return c.json({ error: 'WALLET_NOT_FOUND' }, 404);

    const balance   = Number(rows[0].balance_usdc);
    const reserved  = Number(rows[0].reserved_usdc);
    const available = balance - reserved;

    if (amountUsdc > available) {
      return c.json({
        error: 'INSUFFICIENT_BALANCE',
        availableUsdc: available,
        requestedUsdc: amountUsdc,
        message: `Insufficient balance. Available: ${available} USDC, requested: ${amountUsdc} USDC.`,
      }, 402);
    }

    const spendId = `wspd_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;

    await sql`
      INSERT INTO payment_intents
        (id, merchant_id, agent_id, amount, currency, status, verification_token, expires_at, metadata)
      VALUES
        (${spendId}, NULL, ${agentId}, ${amountUsdc}, ${'USDC'}, ${'wallet_spend'},
         ${spendId}, NOW() + INTERVAL '10 years',
         ${JSON.stringify({
           walletTxType:     'spend',
           description,
           recipientAgentId: recipientAgentId ?? null,
           spentByAgentId:   agentId,
         })}::jsonb)
    `.catch(() => {});

    // Debit the balance
    await sql`
      UPDATE agent_wallets
      SET balance_usdc = balance_usdc - ${amountUsdc},
          updated_at = NOW()
      WHERE agent_id = ${agentId}
    `;

    const newRows = await sql<any[]>`
      SELECT balance_usdc FROM agent_wallets WHERE agent_id = ${agentId} LIMIT 1
    `.catch(() => []);

    return c.json({
      success: true,
      spendId,
      agentId,
      debitedUsdc:    amountUsdc,
      newBalanceUsdc: Number(newRows[0]?.balance_usdc ?? 0),
      recipientAgentId: recipientAgentId ?? null,
      description,
      _schema: 'WalletSpend/1.0',
    });
  } finally {
    await sql.end().catch(() => {});
  }
});

// ---------------------------------------------------------------------------
// POST /api/v1/agents/:agentId/wallet/withdraw
//
// Queue a withdrawal to an on-chain address. Platform processes within 1 business day.
// Reserves the balance immediately so it can't be double-spent.
//
// Body: { agentKey, amountUsdc, destinationAddress }
// ---------------------------------------------------------------------------

router.post('/withdraw', async (c) => {
  const agentId = c.req.param('agentId');
  let body: Record<string, unknown> = {};
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }

  const { agentKey, amountUsdc, destinationAddress } = body as Record<string, string | number>;

  if (!agentKey || typeof agentKey !== 'string') return c.json({ error: 'agentKey required' }, 400);
  if (typeof amountUsdc !== 'number' || amountUsdc <= 0 || amountUsdc > MAX_WITHDRAW) {
    return c.json({ error: `amountUsdc must be between 0 and ${MAX_WITHDRAW}` }, 400);
  }
  if (!destinationAddress || typeof destinationAddress !== 'string' || destinationAddress.length < 32) {
    return c.json({ error: 'destinationAddress must be a valid Solana or EVM address' }, 400);
  }

  const sql = createDb(c.env);
  try {
    if (!(await verifyAgentKey(sql, agentId, agentKey))) {
      return c.json({ error: 'INVALID_AGENT_KEY' }, 401);
    }

    await ensureWallet(sql, agentId);

    const rows = await sql<any[]>`
      SELECT balance_usdc, reserved_usdc FROM agent_wallets WHERE agent_id = ${agentId} LIMIT 1
    `.catch(() => []);

    if (!rows.length) return c.json({ error: 'WALLET_NOT_FOUND' }, 404);

    const available = Number(rows[0].balance_usdc) - Number(rows[0].reserved_usdc);
    if (amountUsdc > available) {
      return c.json({
        error: 'INSUFFICIENT_BALANCE',
        availableUsdc: available,
        requestedUsdc: amountUsdc,
      }, 402);
    }

    const withdrawalId = `wwth_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;

    await sql`
      INSERT INTO payment_intents
        (id, merchant_id, agent_id, amount, currency, status, verification_token, expires_at, metadata)
      VALUES
        (${withdrawalId}, NULL, ${agentId}, ${amountUsdc}, ${'USDC'}, ${'withdrawal_queued'},
         ${withdrawalId}, NOW() + INTERVAL '10 years',
         ${JSON.stringify({
           walletTxType:       'withdrawal',
           destinationAddress,
           queuedAt:           new Date().toISOString(),
         })}::jsonb)
    `.catch(() => {});

    // Reserve funds immediately
    await sql`
      UPDATE agent_wallets
      SET reserved_usdc = reserved_usdc + ${amountUsdc},
          updated_at = NOW()
      WHERE agent_id = ${agentId}
    `;

    return c.json({
      success: true,
      withdrawalId,
      agentId,
      amountUsdc,
      destinationAddress,
      status: 'withdrawal_queued',
      _note: 'Withdrawal will be processed to the destination address within one business day. Automated on-chain withdrawal: Phase 3.',
      _schema: 'WalletWithdrawal/1.0',
    }, 201);
  } finally {
    await sql.end().catch(() => {});
  }
});

export { router as agentWalletRouter };
