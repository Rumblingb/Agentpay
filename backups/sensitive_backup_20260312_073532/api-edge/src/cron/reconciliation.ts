/**
 * Reconciliation cron handler for Workers.
 *
 * Original: src/services/reconciliationDaemon.ts + reconciliationService.ts
 * Original interval: every 15 minutes
 *
 * This Workers port implements the two pure-SQL anomaly checks that do NOT
 * require Solana RPC calls:
 *   1. STALE_PENDING — payment intents still pending > 60 min → mark expired
 *   2. DOUBLE_CREDIT — same transaction hash credited multiple times → log alert
 *
 * Deferred checks (require Helius RPC or Prisma-specific models):
 *   - UNMATCHED_ONCHAIN — needs Solana RPC (Helius fetch — migrateable later)
 *   - ESCROW_TIMEOUT    — needs agent_escrow table (Prisma model; migrate later)
 *   - AGENT_TX_ORPHAN   — needs AgentTransaction Prisma model (migrate later)
 *
 * Uses postgres.js (createDb) instead of Prisma + query().
 * Logs anomaly counts to Workers tail log (visible in `wrangler tail`).
 */

import type { Env } from '../types';
import { createDb } from '../lib/db';

/** Payment intents older than this (minutes) without a tx hash are STALE. */
const STALE_PENDING_TTL_MIN = 60;

/**
 * Runs the SQL-based reconciliation checks.
 * Called by the scheduled handler every 15 minutes.
 */
export async function runReconciliation(env: Env): Promise<void> {
  const runId = crypto.randomUUID();
  const startedAt = Date.now();
  console.info('[cron/reconciliation] run started', { runId });

  const sql = createDb(env);
  let anomaliesFound = 0;

  try {
    // ── CHECK 1: STALE_PENDING ───────────────────────────────────────────────
    // Mark payment intents that have been 'pending' for > 60 minutes as 'expired'.
    // Mirrors reconciliationService.ts detectStalePending() but uses raw SQL.
    const cutoff = new Date(Date.now() - STALE_PENDING_TTL_MIN * 60 * 1000);

    const staleResult = await sql`
      UPDATE payment_intents
      SET status     = 'expired',
          updated_at = NOW()
      WHERE status     = 'pending'
        AND expires_at < ${cutoff}
      RETURNING id
    `;

    if (staleResult.length > 0) {
      anomaliesFound += staleResult.length;
      console.warn('[cron/reconciliation] STALE_PENDING anomalies found', {
        count: staleResult.length,
        anomalyType: 'STALE_PENDING',
        severity: 'medium',
        runId,
      });
    }

    // ── CHECK 2: DOUBLE_CREDIT ───────────────────────────────────────────────
    // Detect transaction hashes that appear more than once in confirmed rows.
    // Logs a warning but does NOT modify data (debit correction is a manual step).
    const doubleRows = await sql<Array<{ transactionHash: string; count: number }>>`
      SELECT transaction_hash AS "transactionHash",
             COUNT(*)         AS count
      FROM transactions
      WHERE status           = 'confirmed'
        AND transaction_hash IS NOT NULL
      GROUP BY transaction_hash
      HAVING COUNT(*) > 1
    `;

    if (doubleRows.length > 0) {
      anomaliesFound += doubleRows.length;
      for (const row of doubleRows) {
        console.error('[cron/reconciliation] DOUBLE_CREDIT anomaly detected', {
          transactionHash: row.transactionHash,
          count: Number(row.count),
          anomalyType: 'DOUBLE_CREDIT',
          severity: 'critical',
          runId,
        });
      }
    }

    // ── DEFERRED CHECKS ──────────────────────────────────────────────────────
    // UNMATCHED_ONCHAIN: requires Helius RPC fetch — TODO in Phase 13+
    // ESCROW_TIMEOUT:    requires agent_escrow table / Prisma model — TODO
    // AGENT_TX_ORPHAN:   requires AgentTransaction model — TODO

    const durationMs = Date.now() - startedAt;
    console.info('[cron/reconciliation] run complete', {
      runId,
      durationMs,
      anomaliesFound,
    });
  } catch (err: unknown) {
    console.error('[cron/reconciliation] run failed', {
      runId,
      error: err instanceof Error ? err.message : String(err),
    });
  } finally {
    sql.end().catch(() => {});
  }
}
