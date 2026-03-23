/**
 * Hosted Agent Wallet - /api/v1/agents/:agentId/wallet
 *
 * Custodial USDC balance per agentId. Removes the private-key requirement
 * for agents operating in mobile or serverless environments.
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { createDb, parseJsonb } from '../lib/db';

const router = new Hono<{ Bindings: Env; Variables: Variables }>();

const MIN_DEPOSIT = 0.01;
const MAX_WITHDRAW = 100_000;

interface IdentityRow {
  metadata: unknown;
}

interface WalletRow {
  balance_usdc: number | string;
  reserved_usdc: number | string;
  updated_at: string | null;
}

interface WalletIntentRow {
  id: string;
  amount: number | string;
  status: string;
  metadata: unknown;
  created_at: string;
}

interface WalletMetadata {
  agentKeyHash?: string;
  walletTxType?: string;
}

async function attempt<T>(run: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await run();
  } catch {
    return fallback;
  }
}

async function sha256(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function verifyAgentKey(
  sql: ReturnType<typeof createDb>,
  agentId: string,
  agentKey: string,
): Promise<boolean> {
  const keyHash = await sha256(agentKey);
  const rows = await attempt(
    () => sql<IdentityRow[]>`
      SELECT metadata FROM agent_identities
      WHERE agent_id = ${agentId} LIMIT 1
    `,
    [] as IdentityRow[],
  );
  const metadata = parseJsonb<WalletMetadata>(rows[0]?.metadata, {});
  return rows.length > 0 && metadata.agentKeyHash === keyHash;
}

async function ensureWallet(sql: ReturnType<typeof createDb>, agentId: string): Promise<void> {
  try {
    await sql`
      INSERT INTO agent_wallets (agent_id, balance_usdc, reserved_usdc, updated_at)
      VALUES (${agentId}, 0, 0, NOW())
      ON CONFLICT (agent_id) DO NOTHING
    `;
  } catch {}
}

router.get('/', async (c) => {
  const agentId = c.req.param('agentId');
  if (!agentId) return c.json({ error: 'agentId required' }, 400);

  const sql = createDb(c.env);
  try {
    await ensureWallet(sql, agentId);

    const [walletRows, txRows] = await Promise.all([
      attempt(
        () => sql<WalletRow[]>`
          SELECT balance_usdc, reserved_usdc, updated_at
          FROM agent_wallets WHERE agent_id = ${agentId} LIMIT 1
        `,
        [] as WalletRow[],
      ),
      attempt(
        () => sql<WalletIntentRow[]>`
          SELECT id, amount, status, metadata, created_at
          FROM payment_intents
          WHERE agent_id = ${agentId}
            AND status IN ('completed', 'confirmed', 'refunded', 'wallet_spend', 'wallet_deposit')
          ORDER BY created_at DESC
          LIMIT 20
        `,
        [] as WalletIntentRow[],
      ),
    ]);

    const wallet = walletRows[0] ?? { balance_usdc: 0, reserved_usdc: 0, updated_at: null };
    const availableUsdc = Math.max(
      0,
      Number(wallet.balance_usdc) - Number(wallet.reserved_usdc),
    );

    return c.json({
      success: true,
      agentId,
      wallet: {
        balanceUsdc: Number(wallet.balance_usdc),
        reservedUsdc: Number(wallet.reserved_usdc),
        availableUsdc,
        updatedAt: wallet.updated_at,
      },
      depositAddress: c.env.PLATFORM_TREASURY_WALLET ?? null,
      depositMemo: `wallet:${agentId}`,
      recentActivity: txRows.map((row) => {
        const metadata = parseJsonb<WalletMetadata>(row.metadata, {});
        return {
          intentId: row.id,
          type: metadata.walletTxType ?? row.status,
          amountUsdc: Number(row.amount),
          status: row.status,
          createdAt: row.created_at,
        };
      }),
      _schema: 'AgentWallet/1.0',
    });
  } finally {
    await sql.end().catch(() => {});
  }
});

router.post('/deposit', async (c) => {
  const agentId = c.req.param('agentId');
  if (!agentId) return c.json({ error: 'agentId required' }, 400);

  let body: Record<string, unknown> = {};
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

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

    if (txHash) {
      const dup = await attempt(
        () => sql<Array<{ id: string }>>`
          SELECT id FROM payment_intents
          WHERE agent_id = ${agentId}
            AND metadata->>'walletTxHash' = ${String(txHash)}
            AND metadata->>'walletTxType' = 'deposit'
          LIMIT 1
        `,
        [] as Array<{ id: string }>,
      );
      if (dup.length > 0) {
        return c.json({ error: 'ALREADY_CREDITED', txHash }, 409);
      }
    }

    const depositId = `wdep_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;

    try {
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
      `;
    } catch {}

    await sql`
      UPDATE agent_wallets
      SET balance_usdc = balance_usdc + ${amountUsdc},
          updated_at = NOW()
      WHERE agent_id = ${agentId}
    `;

    const rows = await attempt(
      () => sql<WalletRow[]>`
        SELECT balance_usdc, reserved_usdc, updated_at
        FROM agent_wallets WHERE agent_id = ${agentId} LIMIT 1
      `,
      [] as WalletRow[],
    );

    return c.json(
      {
        success: true,
        depositId,
        agentId,
        creditedUsdc: amountUsdc,
        newBalanceUsdc: Number(rows[0]?.balance_usdc ?? amountUsdc),
        txHash: txHash ?? null,
        _schema: 'WalletDeposit/1.0',
      },
      201,
    );
  } finally {
    await sql.end().catch(() => {});
  }
});

router.post('/spend', async (c) => {
  const agentId = c.req.param('agentId');
  if (!agentId) return c.json({ error: 'agentId required' }, 400);

  let body: Record<string, unknown> = {};
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

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

    const rows = await attempt(
      () => sql<WalletRow[]>`
        SELECT balance_usdc, reserved_usdc, updated_at
        FROM agent_wallets WHERE agent_id = ${agentId} LIMIT 1
      `,
      [] as WalletRow[],
    );

    if (rows.length === 0) return c.json({ error: 'WALLET_NOT_FOUND' }, 404);

    const balance = Number(rows[0].balance_usdc);
    const reserved = Number(rows[0].reserved_usdc);
    const available = balance - reserved;

    if (amountUsdc > available) {
      return c.json(
        {
          error: 'INSUFFICIENT_BALANCE',
          availableUsdc: available,
          requestedUsdc: amountUsdc,
          message: `Insufficient balance. Available: ${available} USDC, requested: ${amountUsdc} USDC.`,
        },
        402,
      );
    }

    const spendId = `wspd_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;

    try {
      await sql`
        INSERT INTO payment_intents
          (id, merchant_id, agent_id, amount, currency, status, verification_token, expires_at, metadata)
        VALUES
          (${spendId}, NULL, ${agentId}, ${amountUsdc}, ${'USDC'}, ${'wallet_spend'},
           ${spendId}, NOW() + INTERVAL '10 years',
           ${JSON.stringify({
             walletTxType: 'spend',
             description,
             recipientAgentId: recipientAgentId ?? null,
             spentByAgentId: agentId,
           })}::jsonb)
      `;
    } catch {}

    await sql`
      UPDATE agent_wallets
      SET balance_usdc = balance_usdc - ${amountUsdc},
          updated_at = NOW()
      WHERE agent_id = ${agentId}
    `;

    const newRows = await attempt(
      () => sql<WalletRow[]>`
        SELECT balance_usdc, reserved_usdc, updated_at
        FROM agent_wallets WHERE agent_id = ${agentId} LIMIT 1
      `,
      [] as WalletRow[],
    );

    return c.json({
      success: true,
      spendId,
      agentId,
      debitedUsdc: amountUsdc,
      newBalanceUsdc: Number(newRows[0]?.balance_usdc ?? 0),
      recipientAgentId: recipientAgentId ?? null,
      description,
      _schema: 'WalletSpend/1.0',
    });
  } finally {
    await sql.end().catch(() => {});
  }
});

router.post('/withdraw', async (c) => {
  const agentId = c.req.param('agentId');
  if (!agentId) return c.json({ error: 'agentId required' }, 400);

  let body: Record<string, unknown> = {};
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  const { agentKey, amountUsdc, destinationAddress } = body as Record<string, string | number>;

  if (!agentKey || typeof agentKey !== 'string') return c.json({ error: 'agentKey required' }, 400);
  if (typeof amountUsdc !== 'number' || amountUsdc <= 0 || amountUsdc > MAX_WITHDRAW) {
    return c.json({ error: `amountUsdc must be between 0 and ${MAX_WITHDRAW}` }, 400);
  }
  if (
    !destinationAddress ||
    typeof destinationAddress !== 'string' ||
    destinationAddress.length < 32
  ) {
    return c.json({ error: 'destinationAddress must be a valid Solana or EVM address' }, 400);
  }

  const sql = createDb(c.env);
  try {
    if (!(await verifyAgentKey(sql, agentId, agentKey))) {
      return c.json({ error: 'INVALID_AGENT_KEY' }, 401);
    }

    await ensureWallet(sql, agentId);

    const rows = await attempt(
      () => sql<WalletRow[]>`
        SELECT balance_usdc, reserved_usdc, updated_at
        FROM agent_wallets WHERE agent_id = ${agentId} LIMIT 1
      `,
      [] as WalletRow[],
    );

    if (rows.length === 0) return c.json({ error: 'WALLET_NOT_FOUND' }, 404);

    const available = Number(rows[0].balance_usdc) - Number(rows[0].reserved_usdc);
    if (amountUsdc > available) {
      return c.json(
        {
          error: 'INSUFFICIENT_BALANCE',
          availableUsdc: available,
          requestedUsdc: amountUsdc,
        },
        402,
      );
    }

    const withdrawalId = `wwth_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;

    try {
      await sql`
        INSERT INTO payment_intents
          (id, merchant_id, agent_id, amount, currency, status, verification_token, expires_at, metadata)
        VALUES
          (${withdrawalId}, NULL, ${agentId}, ${amountUsdc}, ${'USDC'}, ${'withdrawal_queued'},
           ${withdrawalId}, NOW() + INTERVAL '10 years',
           ${JSON.stringify({
             walletTxType: 'withdrawal',
             destinationAddress,
             queuedAt: new Date().toISOString(),
           })}::jsonb)
      `;
    } catch {}

    await sql`
      UPDATE agent_wallets
      SET reserved_usdc = reserved_usdc + ${amountUsdc},
          updated_at = NOW()
      WHERE agent_id = ${agentId}
    `;

    return c.json(
      {
        success: true,
        withdrawalId,
        agentId,
        amountUsdc,
        destinationAddress,
        status: 'withdrawal_queued',
        _note:
          'Withdrawal will be processed to the destination address within one business day. Automated on-chain withdrawal: Phase 3.',
        _schema: 'WalletWithdrawal/1.0',
      },
      201,
    );
  } finally {
    await sql.end().catch(() => {});
  }
});

export { router as agentWalletRouter };
