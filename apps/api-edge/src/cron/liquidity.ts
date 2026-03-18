/**
 * Liquidity & balance monitoring cron — runs every 5 minutes.
 *
 * Responsibilities:
 *   1. LOW_BALANCE_USDC  — alert when hosted payer wallet USDC is below threshold
 *   2. LOW_BALANCE_SOL   — alert when hosted payer SOL (for tx fees) is critically low
 *   3. FEE_LEDGER_ALERT  — alert when critical/terminal fee ledger entries pile up
 *
 * The liquidity bot (market-maker) remains on Render until Durable Objects
 * are introduced. This cron handles the monitoring-only surface that is safe
 * for the stateless Workers runtime.
 *
 * Alerts are emitted as structured Workers log lines (visible in wrangler tail
 * and forwarded to any log drain attached to the Cloudflare account).
 */

import type { Env } from '../types';
import { createDb } from '../lib/db';

/** Default USDC threshold below which we emit a LOW_BALANCE alert. */
const DEFAULT_LOW_USDC_THRESHOLD = 5; // $5 USDC

export async function runLiquidityCron(env: Env): Promise<void> {
  const sql = createDb(env);
  try {
    // Keep-alive ping — prevents Supabase from pausing idle projects
    await sql`SELECT 1`.catch(() => {});
    await checkHostedPayerBalance(env, sql);
    await checkCriticalFeeLedger(sql);
  } catch (err: unknown) {
    console.error('[cron/liquidity] error', {
      error: err instanceof Error ? err.message : String(err),
    });
  } finally {
    sql.end().catch(() => {});
  }

  // ── Self-heal: kick the Solana listener DO if its alarm chain broke ───────
  // The DO maintains its own 30s alarm loop. If the loop breaks (deploy,
  // DO eviction, crash), this 5-min cron restarts it without needing manual
  // intervention. Idempotent — if alarm is already scheduled, DO ignores it.
  try {
    const doId = (env as any).SOLANA_LISTENER_DO?.idFromName?.('main');
    if (doId) {
      const stub = (env as any).SOLANA_LISTENER_DO.get(doId);
      await stub.fetch(new Request('https://do-internal/start', { method: 'POST' }));
    }
  } catch (err) {
    console.warn('[cron/liquidity] could not kick Solana listener DO:', err instanceof Error ? err.message : String(err));
  }
}

// ---------------------------------------------------------------------------
// Check 1: Hosted payer wallet balance
// ---------------------------------------------------------------------------

async function checkHostedPayerBalance(
  env: Env,
  sql: ReturnType<typeof createDb>,
): Promise<void> {
  const hostedPayerAgentId = env.HOSTED_PAYER_AGENT_ID;
  if (!hostedPayerAgentId) return; // not configured — skip

  const thresholdUsdc = env.LOW_BALANCE_ALERT_THRESHOLD_USDC
    ? parseFloat(env.LOW_BALANCE_ALERT_THRESHOLD_USDC)
    : DEFAULT_LOW_USDC_THRESHOLD;

  const rows = await sql<Array<{ balanceUsdc: number; publicKey: string }>>`
    SELECT balance_usdc AS "balanceUsdc",
           public_key   AS "publicKey"
    FROM agent_wallets
    WHERE agent_id  = ${hostedPayerAgentId}
      AND is_active = true
    LIMIT 1
  `.catch(() => [] as Array<{ balanceUsdc: number; publicKey: string }>);

  if (!rows.length) {
    console.warn('[cron/liquidity] hosted payer wallet not found in DB', {
      hostedPayerAgentId,
      action: 'CHECK_WALLET_SETUP',
    });
    return;
  }

  const { balanceUsdc, publicKey } = rows[0];
  const balance = Number(balanceUsdc);

  if (balance < thresholdUsdc) {
    console.error('[cron/liquidity] LOW_BALANCE_USDC', {
      alertType: 'LOW_BALANCE_USDC',
      severity: balance === 0 ? 'critical' : 'high',
      publicKey,
      balanceUsdc: balance,
      thresholdUsdc,
      action: 'FUND_HOSTED_PAYER_WALLET',
    });
  } else {
    console.info('[cron/liquidity] hosted payer balance OK', {
      balanceUsdc: balance,
      thresholdUsdc,
    });
  }
}

// ---------------------------------------------------------------------------
// Check 2: Critical + terminal fee ledger entries
// ---------------------------------------------------------------------------

async function checkCriticalFeeLedger(
  sql: ReturnType<typeof createDb>,
): Promise<void> {
  const counts = await sql<Array<{ status: string; count: number }>>`
    SELECT status, COUNT(*) AS count
    FROM fee_ledger_entries
    WHERE status IN ('failed', 'terminal', 'processing')
    GROUP BY status
  `.catch(() => [] as Array<{ status: string; count: number }>);

  if (!counts.length) return;

  for (const row of counts) {
    const count = Number(row.count);
    if (count === 0) continue;

    const severity = row.status === 'terminal' ? 'critical' : row.status === 'failed' ? 'high' : 'medium';
    const action =
      row.status === 'terminal'
        ? 'MANUAL_INTERVENTION_REQUIRED'
        : row.status === 'failed'
        ? 'CRON_WILL_RETRY — check SOLANA_RPC_URL and PLATFORM_TREASURY_WALLET'
        : 'PROCESSING — treasury transfer pending';

    console.error('[cron/liquidity] FEE_LEDGER_ALERT', {
      alertType: 'FEE_LEDGER_ALERT',
      severity,
      status: row.status,
      count,
      action,
    });
  }
}
