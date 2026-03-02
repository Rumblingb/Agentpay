/**
 * In-memory mock for src/db/index
 *
 * Provides a lightweight SQL-like store so integration tests can exercise
 * the full Express app without a real PostgreSQL database.
 *
 * Supports the SQL patterns used by AgentPay services:
 *  - INSERT … RETURNING *
 *  - SELECT … WHERE
 *  - UPDATE … WHERE
 *  - DELETE FROM / TRUNCATE
 *  - Aggregate functions (COUNT, SUM, COALESCE)
 */

import { randomUUID } from 'crypto';

// ── In-memory tables ───────────────────────────────────────────────────────

const tables: Record<string, Record<string, unknown>[]> = {};

function getTable(name: string): Record<string, unknown>[] {
  if (!tables[name]) tables[name] = [];
  return tables[name];
}

export function resetAll(): void {
  for (const key of Object.keys(tables)) {
    tables[key] = [];
  }
}

// ── Unique constraint tracking ─────────────────────────────────────────────

const uniqueConstraints: Record<string, Set<string>> = {};

function trackUnique(table: string, column: string, value: unknown): void {
  const key = `${table}:${column}`;
  if (!uniqueConstraints[key]) uniqueConstraints[key] = new Set();
  const strVal = String(value);
  if (uniqueConstraints[key].has(strVal)) {
    const err: any = new Error(`duplicate key value violates unique constraint`);
    err.code = '23505';
    throw err;
  }
  uniqueConstraints[key].add(strVal);
}

function resetUniqueConstraints(): void {
  for (const key of Object.keys(uniqueConstraints)) {
    uniqueConstraints[key] = new Set();
  }
}

// ── Mini SQL parser ────────────────────────────────────────────────────────

/**
 * The mock query function. It pattern-matches against common SQL shapes
 * used by the AgentPay services.
 */
export async function query(
  text: string,
  params?: unknown[]
): Promise<{ rows: Record<string, unknown>[]; rowCount: number }> {
  const sql = text.replace(/\s+/g, ' ').trim();
  const p = params ?? [];

  // ── TRUNCATE ─────────────────────────────────────────────────────────
  if (/^TRUNCATE/i.test(sql)) {
    const tableNames = sql
      .replace(/TRUNCATE\s+/i, '')
      .replace(/RESTART IDENTITY CASCADE/i, '')
      .split(',')
      .map((t) => t.trim().toLowerCase());
    for (const t of tableNames) {
      tables[t] = [];
    }
    resetUniqueConstraints();
    return { rows: [], rowCount: 0 };
  }

  // ── DELETE ───────────────────────────────────────────────────────────
  if (/^DELETE FROM/i.test(sql)) {
    const match = sql.match(/DELETE FROM\s+(\w+)/i);
    if (match) {
      const tableName = match[1].toLowerCase();
      tables[tableName] = [];
    }
    return { rows: [], rowCount: 0 };
  }

  // ── INSERT INTO merchants ────────────────────────────────────────────
  if (/^INSERT INTO merchants/i.test(sql)) {
    const row: Record<string, unknown> = {
      id: p[0],
      name: p[1],
      email: p[2],
      api_key_hash: p[3],
      apiKeyHash: p[3],
      api_key_salt: p[4],
      apiKeySalt: p[4],
      key_prefix: p[5],
      wallet_address: p[6],
      walletAddress: p[6],
      webhook_url: p[7],
      webhookUrl: p[7],
      is_active: p[8],
      created_at: new Date(),
      createdAt: new Date(),
    };
    // Check unique email constraint
    trackUnique('merchants', 'email', p[2]);
    getTable('merchants').push(row);
    return { rows: [row], rowCount: 1 };
  }

  // ── SELECT FROM merchants (auth lookup by key_prefix) ────────────────
  if (/SELECT .* FROM merchants WHERE key_prefix/i.test(sql)) {
    const prefix = p[0] as string;
    const rows = getTable('merchants').filter(
      (r) => r.key_prefix === prefix && r.is_active === true
    );
    return { rows, rowCount: rows.length };
  }

  // ── SELECT FROM merchants WHERE id ──────────────────────────────────
  if (/SELECT .* FROM merchants WHERE id/i.test(sql)) {
    const rows = getTable('merchants').filter((r) => r.id === p[0]);
    return { rows, rowCount: rows.length };
  }

  // ── UPDATE merchants (webhook_url) ──────────────────────────────────
  if (/UPDATE merchants/i.test(sql)) {
    let count = 0;
    for (const row of getTable('merchants')) {
      if (row.id === p[p.length - 1]) {
        // Merge updates generically
        count++;
      }
    }
    return { rows: [], rowCount: count };
  }

  // ── INSERT INTO transactions ────────────────────────────────────────
  if (/^INSERT INTO transactions/i.test(sql)) {
    const row: Record<string, unknown> = {
      id: p[0],
      merchant_id: p[1],
      merchantId: p[1],
      payment_id: p[2],
      paymentId: p[2],
      amount_usdc: p[3],
      amountUsdc: p[3],
      recipient_address: p[4],
      recipientAddress: p[4],
      status: p[5] ?? 'pending',
      confirmation_depth: p[6] ?? 0,
      confirmationDepth: p[6] ?? 0,
      required_depth: p[7] ?? 2,
      requiredDepth: p[7] ?? 2,
      expires_at: p[8],
      expiresAt: p[8],
      created_at: p[9] ?? new Date(),
      createdAt: p[9] ?? new Date(),
      payer_address: null,
      payerAddress: null,
      transaction_hash: null,
      transactionHash: null,
    };
    getTable('transactions').push(row);
    return { rows: [row], rowCount: 1 };
  }

  // ── SELECT FROM transactions WHERE id ───────────────────────────────
  if (/SELECT .* FROM transactions WHERE id/i.test(sql)) {
    const rows = getTable('transactions').filter((r) => r.id === p[0]);
    return { rows, rowCount: rows.length };
  }

  // ── SELECT FROM transactions WHERE merchant_id (list) ───────────────
  if (/SELECT .* FROM transactions WHERE merchant_id/i.test(sql)) {
    const rows = getTable('transactions').filter((r) => r.merchant_id === p[0]);
    return { rows, rowCount: rows.length };
  }

  // ── UPDATE transactions ─────────────────────────────────────────────
  if (/^UPDATE transactions/i.test(sql)) {
    const txId = p[p.length - 1] as string;
    let count = 0;
    for (const row of getTable('transactions')) {
      if (row.id === txId) {
        // Pattern 1: force-verify — SET status='confirmed', transaction_hash=$1 ... WHERE id=$2
        // Params: [hash, txId]
        if (/status\s*=\s*'confirmed'/i.test(sql)) {
          row.status = 'confirmed';
          row.transaction_hash = p[0];
          row.transactionHash = p[0];
          row.confirmation_depth = row.required_depth ?? 2;
          row.confirmationDepth = row.requiredDepth ?? 2;
        }
        // Pattern 2: parameterized status — SET status=$1 ...
        // Params: [status, ..., txId]
        else if (p[0]) {
          row.status = p[0];
          if (p.length >= 3) {
            row.transaction_hash = p[1];
            row.transactionHash = p[1];
          }
        }
        count++;
      }
    }
    return { rows: [], rowCount: count };
  }

  // ── SELECT (aggregate) FROM transactions — stats ────────────────────
  if (/SELECT COUNT\(\*\)/i.test(sql) && /FROM transactions/i.test(sql)) {
    const merchantId = p[0] as string;
    const txs = getTable('transactions').filter((r) => r.merchant_id === merchantId);
    const confirmedCount = txs.filter((r) => r.status === 'confirmed').length;
    const pendingCount = txs.filter((r) => r.status === 'pending').length;
    const failedCount = txs.filter((r) => r.status === 'failed').length;
    const totalConfirmedUsdc = txs
      .filter((r) => r.status === 'confirmed')
      .reduce((sum, r) => sum + Number(r.amount_usdc ?? 0), 0);

    return {
      rows: [
        {
          totalCount: String(txs.length),
          confirmedCount: String(confirmedCount),
          pendingCount: String(pendingCount),
          failedCount: String(failedCount),
          totalConfirmedUsdc: String(totalConfirmedUsdc),
        },
      ],
      rowCount: 1,
    };
  }

  // ── INSERT INTO webhook_events ──────────────────────────────────────
  if (/^INSERT INTO webhook_events/i.test(sql)) {
    const row: Record<string, unknown> = {
      id: randomUUID(),
      merchant_id: p[0],
      event_type: p[1],
      transaction_id: p[2],
      webhook_url: p[3],
      payload: p[4],
      status: 'pending',
      max_retries: p[5],
      created_at: new Date(),
    };
    getTable('webhook_events').push(row);
    return { rows: [row], rowCount: 1 };
  }

  // ── UPDATE webhook_events ───────────────────────────────────────────
  if (/^UPDATE webhook_events/i.test(sql)) {
    const eventId = p[p.length - 1] as string;
    let count = 0;
    for (const row of getTable('webhook_events')) {
      if (row.id === eventId) {
        // Update status to 'sent' if applicable
        if (/status\s*=/i.test(sql)) {
          row.status = p[0] ?? 'sent';
        }
        count++;
      }
    }
    return { rows: [], rowCount: count };
  }

  // ── SELECT FROM webhook_events ──────────────────────────────────────
  if (/SELECT .* FROM webhook_events/i.test(sql)) {
    const merchantId = p[0] as string;
    const rows = getTable('webhook_events').filter((r) => r.merchant_id === merchantId);
    // Apply status filter if present
    if (/status\s*=\s*'sent'/i.test(sql)) {
      return {
        rows: rows.filter((r) => r.status === 'sent'),
        rowCount: rows.filter((r) => r.status === 'sent').length,
      };
    }
    return { rows, rowCount: rows.length };
  }

  // ── INSERT INTO payment_audit_log ───────────────────────────────────
  if (/^INSERT INTO payment_audit_log/i.test(sql)) {
    const row: Record<string, unknown> = {
      id: randomUUID(),
      merchant_id: p[0],
      ip_address: p[1],
      transaction_signature: p[2],
      transaction_id: p[3],
      endpoint: p[4],
      method: p[5],
      succeeded: p[6],
      failure_reason: p[7],
      created_at: new Date(),
    };
    getTable('payment_audit_log').push(row);
    return { rows: [row], rowCount: 1 };
  }

  // ── INSERT INTO agent_reputation ────────────────────────────────────
  if (/^INSERT INTO agent_reputation/i.test(sql)) {
    const now = new Date();
    const row: Record<string, unknown> = {
      agent_id: p[0],
      total_payments: 1,
      success_rate: p[1],
      trust_score: p[2],
      dispute_rate: 0,
      last_payment_at: now,
      created_at: now,
      updated_at: now,
    };
    getTable('agent_reputation').push(row);
    return { rows: [row], rowCount: 1 };
  }

  // ── SELECT FROM agent_reputation ────────────────────────────────────
  if (/SELECT .* FROM agent_reputation WHERE agent_id/i.test(sql)) {
    const rows = getTable('agent_reputation').filter((r) => r.agent_id === p[0]);
    return { rows, rowCount: rows.length };
  }

  // ── UPDATE agent_reputation ─────────────────────────────────────────
  if (/^UPDATE agent_reputation/i.test(sql)) {
    const agentId = p[p.length - 1] as string;
    let count = 0;
    for (const row of getTable('agent_reputation')) {
      if (row.agent_id === agentId) {
        row.total_payments = p[0];
        row.success_rate = p[1];
        row.trust_score = p[2];
        row.last_payment_at = new Date();
        row.updated_at = new Date();
        count++;
      }
    }
    return { rows: [], rowCount: count };
  }

  // ── INSERT INTO rate_limit_counters ─────────────────────────────────
  if (/rate_limit_counters/i.test(sql)) {
    return { rows: [], rowCount: 0 };
  }

  // ── INSERT INTO payment_verifications ───────────────────────────────
  if (/payment_verifications/i.test(sql)) {
    return { rows: [], rowCount: 0 };
  }

  // ── INSERT INTO api_logs ────────────────────────────────────────────
  if (/api_logs/i.test(sql)) {
    return { rows: [], rowCount: 0 };
  }

  // ── INSERT INTO bots ────────────────────────────────────────────────
  if (/^INSERT INTO bots/i.test(sql)) {
    const row: Record<string, unknown> = {
      id: randomUUID(),
      platform_bot_id: p[0],
      handle: p[1],
      display_name: p[2],
      wallet_address: p[6],
    };
    // Check for duplicate handle
    const existing = getTable('bots').find((r) => r.handle === p[1]);
    if (existing) {
      const err: any = new Error('duplicate key value violates unique constraint');
      err.code = '23505';
      throw err;
    }
    getTable('bots').push(row);
    return { rows: [row], rowCount: 1 };
  }

  // ── SELECT FROM bots ────────────────────────────────────────────────
  if (/SELECT .* FROM bots/i.test(sql)) {
    return { rows: [], rowCount: 0 };
  }

  // ── Fallback: return empty result ───────────────────────────────────
  return { rows: [], rowCount: 0 };
}

export async function closePool(): Promise<void> {
  // no-op for in-memory mock
}

export async function getClient(): Promise<unknown> {
  return { query, release: () => {} };
}

export const pool = {
  query,
  connect: getClient,
  end: closePool,
  on: () => {},
};

export default { query, getClient, pool, closePool };
