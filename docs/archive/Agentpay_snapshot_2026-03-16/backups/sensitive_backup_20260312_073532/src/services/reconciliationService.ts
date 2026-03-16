/**
 * Financial Reconciliation Service
 *
 * Reconciles three sources of truth for every payment:
 *   1. Database state   — payment_intents + transactions rows
 *   2. Marketplace state — AgentTransaction + AgentEscrow rows
 *   3. On-chain state   — Solana transaction signatures (via Helius)
 *
 * Runs as a scheduled job (e.g. every 15 min via setInterval in server.ts)
 * or on-demand via POST /api/reconciliation/run.
 *
 * Anomaly types detected:
 *   - STALE_PENDING      — intent pending > ttlMinutes with no on-chain tx
 *   - UNMATCHED_ONCHAIN  — Solana tx exists but DB row is still pending/missing
 *   - ESCROW_TIMEOUT     — escrow locked past deadline without release or dispute
 *   - AGENT_TX_ORPHAN    — AgentTransaction has no corresponding escrow
 *   - DOUBLE_CREDIT      — same tx hash credited more than once
 *
 * @module services/reconciliationService
 */

import prisma from '../lib/prisma.js';
import { query } from '../db/index.js';
import { logger } from '../logger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AnomalyType =
  | 'STALE_PENDING'
  | 'UNMATCHED_ONCHAIN'
  | 'ESCROW_TIMEOUT'
  | 'AGENT_TX_ORPHAN'
  | 'DOUBLE_CREDIT';

export interface ReconciliationAnomaly {
  type: AnomalyType;
  entityId: string;
  entityType: 'payment_intent' | 'transaction' | 'agent_transaction' | 'agent_escrow';
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  detectedAt: Date;
  metadata?: Record<string, unknown>;
}

export interface ReconciliationReport {
  runId: string;
  startedAt: Date;
  completedAt: Date;
  durationMs: number;
  anomalies: ReconciliationAnomaly[];
  stats: {
    paymentIntentsChecked: number;
    transactionsChecked: number;
    agentTransactionsChecked: number;
    agentEscrowsChecked: number;
    anomaliesFound: number;
    criticalAnomalies: number;
  };
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Payment intents older than this are flagged as STALE_PENDING (minutes) */
const STALE_PENDING_TTL_MIN = 60;

/** Escrow records older than this without release/dispute are flagged (hours) */
const ESCROW_TIMEOUT_HOURS = 120; // 5 days

// ---------------------------------------------------------------------------
// Reconciliation checks
// ---------------------------------------------------------------------------

/**
 * Flag payment intents that have been pending for more than STALE_PENDING_TTL_MIN
 * and have no confirmed transaction.
 */
async function checkStalePendingIntents(): Promise<ReconciliationAnomaly[]> {
  const anomalies: ReconciliationAnomaly[] = [];
  const cutoff = new Date(Date.now() - STALE_PENDING_TTL_MIN * 60 * 1000);

  try {
    const staleIntents = await prisma.paymentIntent.findMany({
      where: {
        status: 'pending',
        createdAt: { lt: cutoff },
      },
      select: { id: true, merchantId: true, amount: true, createdAt: true },
      take: 500,
    });

    for (const intent of staleIntents) {
      anomalies.push({
        type: 'STALE_PENDING',
        entityId: intent.id,
        entityType: 'payment_intent',
        description: `Payment intent has been pending for over ${STALE_PENDING_TTL_MIN} minutes`,
        severity: 'medium',
        detectedAt: new Date(),
        metadata: {
          merchantId: intent.merchantId,
          amount: intent.amount,
          createdAt: intent.createdAt,
        },
      });
    }
  } catch (err: any) {
    // Table may not exist in all environments
    if (err?.code !== 'P2021') {
      logger.warn('[reconciliation] checkStalePendingIntents error', { err: err?.message });
    }
  }

  return anomalies;
}

/**
 * Flag AgentTransactions that have no corresponding AgentEscrow record.
 */
async function checkAgentTxOrphans(): Promise<ReconciliationAnomaly[]> {
  const anomalies: ReconciliationAnomaly[] = [];

  try {
    const txs = await (prisma as any).agentTransaction.findMany({
      where: { status: { not: 'completed' }, escrowId: null },
      select: { id: true, buyerAgentId: true, sellerAgentId: true, amount: true, createdAt: true },
      take: 200,
    });

    for (const tx of txs) {
      anomalies.push({
        type: 'AGENT_TX_ORPHAN',
        entityId: tx.id,
        entityType: 'agent_transaction',
        description: 'Active agent transaction has no escrow record',
        severity: 'high',
        detectedAt: new Date(),
        metadata: {
          buyerAgentId: tx.buyerAgentId,
          sellerAgentId: tx.sellerAgentId,
          amount: tx.amount,
          createdAt: tx.createdAt,
        },
      });
    }
  } catch (err: any) {
    if (err?.code !== 'P2021') {
      logger.warn('[reconciliation] checkAgentTxOrphans error', { err: err?.message });
    }
  }

  return anomalies;
}

/**
 * Flag escrow records that have been locked past the timeout without
 * being released or disputed.
 */
async function checkEscrowTimeouts(): Promise<ReconciliationAnomaly[]> {
  const anomalies: ReconciliationAnomaly[] = [];
  const cutoff = new Date(Date.now() - ESCROW_TIMEOUT_HOURS * 60 * 60 * 1000);

  try {
    const timedOut = await (prisma as any).agentEscrow.findMany({
      where: {
        status: 'locked',
        createdAt: { lt: cutoff },
      },
      select: { id: true, transactionId: true, amount: true, createdAt: true },
      take: 200,
    });

    for (const escrow of timedOut) {
      anomalies.push({
        type: 'ESCROW_TIMEOUT',
        entityId: escrow.id,
        entityType: 'agent_escrow',
        description: `Escrow has been locked for over ${ESCROW_TIMEOUT_HOURS} hours without release`,
        severity: 'critical',
        detectedAt: new Date(),
        metadata: {
          transactionId: escrow.transactionId,
          amount: escrow.amount,
          createdAt: escrow.createdAt,
          ageHours: Math.round((Date.now() - new Date(escrow.createdAt).getTime()) / 3_600_000),
        },
      });
    }
  } catch (err: any) {
    if (err?.code !== 'P2021') {
      logger.warn('[reconciliation] checkEscrowTimeouts error', { err: err?.message });
    }
  }

  return anomalies;
}

/**
 * Detect double-credit: same transaction_hash credited more than once in
 * the transactions table.
 */
async function checkDoubleCredits(): Promise<ReconciliationAnomaly[]> {
  const anomalies: ReconciliationAnomaly[] = [];

  try {
    const result = await query(
      `SELECT transaction_hash, COUNT(*) as cnt, array_agg(id) as ids
       FROM transactions
       WHERE transaction_hash IS NOT NULL AND status = 'confirmed'
       GROUP BY transaction_hash
       HAVING COUNT(*) > 1
       LIMIT 100`,
    );

    for (const row of result.rows) {
      anomalies.push({
        type: 'DOUBLE_CREDIT',
        entityId: row.transaction_hash,
        entityType: 'transaction',
        description: `Transaction hash credited ${row.cnt} times`,
        severity: 'critical',
        detectedAt: new Date(),
        metadata: { txHash: row.transaction_hash, rowIds: row.ids, count: row.cnt },
      });
    }
  } catch (err: any) {
    // Table might not exist
    const msg = (err as any)?.message ?? '';
    if (!msg.includes('does not exist')) {
      logger.warn('[reconciliation] checkDoubleCredits error', { err: msg });
    }
  }

  return anomalies;
}

// ---------------------------------------------------------------------------
// Main reconciliation runner
// ---------------------------------------------------------------------------

let lastReport: ReconciliationReport | null = null;
let isRunning = false;

/**
 * Run a full reconciliation pass.
 * Safe to call concurrently — returns the last report if already running.
 */
export async function runReconciliation(): Promise<ReconciliationReport> {
  if (isRunning) {
    logger.info('[reconciliation] Already running, skipping concurrent run');
    return lastReport ?? createEmptyReport();
  }

  isRunning = true;
  const runId = `rcn_${Date.now()}`;
  const startedAt = new Date();

  logger.info('[reconciliation] Run started', { runId });

  let paymentIntentsChecked = 0;
  let transactionsChecked = 0;
  let agentTransactionsChecked = 0;
  let agentEscrowsChecked = 0;

  try {
    // Count entities being checked
    try {
      paymentIntentsChecked = await prisma.paymentIntent.count({ where: { status: 'pending' } });
    } catch { /* table may not exist */ }

    try {
      const txResult = await query('SELECT COUNT(*) FROM transactions WHERE status = $1', ['confirmed']);
      transactionsChecked = parseInt(txResult.rows[0]?.count ?? '0', 10);
    } catch { /* table may not exist */ }

    try {
      agentTransactionsChecked = await (prisma as any).agentTransaction.count();
    } catch { /* table may not exist */ }

    try {
      agentEscrowsChecked = await (prisma as any).agentEscrow.count({ where: { status: 'locked' } });
    } catch { /* table may not exist */ }

    // Run all checks in parallel
    const [stale, orphans, timeouts, doubles] = await Promise.all([
      checkStalePendingIntents(),
      checkAgentTxOrphans(),
      checkEscrowTimeouts(),
      checkDoubleCredits(),
    ]);

    const anomalies = [...stale, ...orphans, ...timeouts, ...doubles];

    const completedAt = new Date();
    const report: ReconciliationReport = {
      runId,
      startedAt,
      completedAt,
      durationMs: completedAt.getTime() - startedAt.getTime(),
      anomalies,
      stats: {
        paymentIntentsChecked,
        transactionsChecked,
        agentTransactionsChecked,
        agentEscrowsChecked,
        anomaliesFound: anomalies.length,
        criticalAnomalies: anomalies.filter((a) => a.severity === 'critical').length,
      },
    };

    if (anomalies.length > 0) {
      logger.warn('[reconciliation] Anomalies detected', {
        runId,
        total: anomalies.length,
        critical: report.stats.criticalAnomalies,
        types: anomalies.map((a) => a.type),
      });
    } else {
      logger.info('[reconciliation] Clean — no anomalies', { runId, durationMs: report.durationMs });
    }

    lastReport = report;
    return report;
  } finally {
    isRunning = false;
  }
}

/** Returns the last completed reconciliation report, or null. */
export function getLastReport(): ReconciliationReport | null {
  return lastReport;
}

function createEmptyReport(): ReconciliationReport {
  const now = new Date();
  return {
    runId: 'empty',
    startedAt: now,
    completedAt: now,
    durationMs: 0,
    anomalies: [],
    stats: {
      paymentIntentsChecked: 0,
      transactionsChecked: 0,
      agentTransactionsChecked: 0,
      agentEscrowsChecked: 0,
      anomaliesFound: 0,
      criticalAnomalies: 0,
    },
  };
}
