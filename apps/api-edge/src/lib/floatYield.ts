/**
 * Float / Yield Accrual Layer
 *
 * When funds sit in AgentPay escrow (dispute hold, marketplace escrow, AP2
 * pending_confirmation), the platform earns yield on the float.
 *
 * Phase 1 (now): accounting-only — records float obligation into
 *   `float_yield_accruals` table so we can measure the opportunity precisely.
 *
 * Phase 2 (next): deploy float into USDC yield vaults (e.g. Kamino, Drift,
 *   or T-bill-backed stables) and sweep daily profits to treasury.
 *
 * Yield math:
 *   daily_rate  = annual_rate / 365
 *   accrued_usd = principal_usdc * daily_rate * hold_days
 *
 * At $1M/day float @ 5% APY:
 *   daily yield = $1,000,000 * (0.05/365) = ~$137/day = ~$50K/year
 * At $100M/day float:
 *   daily yield = ~$13,700/day = ~$5M/year
 */

import type { Sql } from './db';

/** Target annualized yield rate (5% — conservative T-bill equivalent). */
export const FLOAT_ANNUAL_YIELD_RATE = 0.05;

/** Minimum escrow hold time (hours) before we bother recording accrual. */
const MIN_HOLD_HOURS = 1;

export interface FloatAccrualParams {
  intentId:        string;
  principalUsdc:   number;
  holdStartedAt:   Date;
  holdEndedAt?:    Date;   // if undefined, accrual is still open
  source:          'marketplace_escrow' | 'dispute_hold' | 'ap2_pending' | 'intent_pending';
}

/**
 * Record float yield accrual for a held intent.
 * Best-effort — never throws, never blocks the payment flow.
 *
 * Called when:
 *   - A marketplace job is hired (escrow starts)
 *   - A dispute hold is placed
 *   - An AP2 request moves to pending_confirmation
 *   - A payment intent settles (hold ends)
 */
export async function recordFloatAccrual(
  sql: Sql,
  params: FloatAccrualParams,
): Promise<void> {
  const { intentId, principalUsdc, holdStartedAt, holdEndedAt, source } = params;

  const endTime   = holdEndedAt ?? new Date();
  const holdMs    = endTime.getTime() - holdStartedAt.getTime();
  const holdHours = holdMs / (1000 * 60 * 60);

  if (holdHours < MIN_HOLD_HOURS) return; // not worth recording

  const holdDays      = holdHours / 24;
  const dailyRate     = FLOAT_ANNUAL_YIELD_RATE / 365;
  const accruedYield  = parseFloat((principalUsdc * dailyRate * holdDays).toFixed(6));
  const status        = holdEndedAt ? 'settled' : 'accruing';

  try {
    await sql`
      INSERT INTO float_yield_accruals
        (intent_id, source, principal_usdc, annual_yield_rate,
         hold_started_at, hold_ended_at, hold_hours,
         accrued_yield_usdc, status, created_at)
      VALUES
        (${intentId}, ${source}, ${principalUsdc}, ${FLOAT_ANNUAL_YIELD_RATE},
         ${holdStartedAt.toISOString()}::timestamptz,
         ${holdEndedAt ? holdEndedAt.toISOString() : null}::timestamptz,
         ${holdHours}, ${accruedYield}, ${status}, NOW())
      ON CONFLICT (intent_id) DO UPDATE
        SET hold_ended_at      = EXCLUDED.hold_ended_at,
            hold_hours         = EXCLUDED.hold_hours,
            accrued_yield_usdc = EXCLUDED.accrued_yield_usdc,
            status             = EXCLUDED.status
    `;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    // Table may not exist yet — silently skip (migration pending)
    if (!msg.includes('does not exist') && !msg.includes('relation')) {
      console.warn('[floatYield] recordFloatAccrual failed', { intentId, error: msg });
    }
  }
}

/**
 * Summarise total float yield accrued (for dashboard / treasury reporting).
 * Returns { totalPrincipalUsdc, totalAccruedYieldUsdc, openPositions, settledPositions }
 */
export async function getFloatYieldSummary(sql: Sql): Promise<{
  totalPrincipalUsdc:   number;
  totalAccruedYieldUsdc: number;
  openPositions:        number;
  settledPositions:     number;
  projectedAnnualUsdc:  number;
}> {
  try {
    const rows = await sql<any[]>`
      SELECT
        SUM(principal_usdc)                                  AS total_principal,
        SUM(accrued_yield_usdc)                              AS total_accrued,
        COUNT(*) FILTER (WHERE status = 'accruing')          AS open_count,
        COUNT(*) FILTER (WHERE status = 'settled')           AS settled_count,
        SUM(principal_usdc) FILTER (WHERE status='accruing') AS open_principal
      FROM float_yield_accruals
    `.catch(() => []);

    const r = rows[0] ?? {};
    const openPrincipal = Number(r.open_principal ?? 0);
    return {
      totalPrincipalUsdc:    Number(r.total_principal   ?? 0),
      totalAccruedYieldUsdc: Number(r.total_accrued     ?? 0),
      openPositions:         Number(r.open_count        ?? 0),
      settledPositions:      Number(r.settled_count     ?? 0),
      projectedAnnualUsdc:   parseFloat((openPrincipal * FLOAT_ANNUAL_YIELD_RATE).toFixed(2)),
    };
  } catch {
    return { totalPrincipalUsdc: 0, totalAccruedYieldUsdc: 0, openPositions: 0, settledPositions: 0, projectedAnnualUsdc: 0 };
  }
}
