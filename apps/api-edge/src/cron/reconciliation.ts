/**
 * Reconciliation cron handler — runs every 15 minutes on Cloudflare Workers.
 *
 * Checks (all SQL-based, no Solana RPC required):
 *
 *   1. STALE_PENDING      — mark payment intents expired after TTL
 *   2. DOUBLE_CREDIT      — detect same tx hash credited more than once
 *   3. FEE_LEDGER_SYNC    — create missing fee_ledger_entries for confirmed intents
 *   4. FEE_LEDGER_PROCESS — transition 'processing' entries and log for treasury action
 *   5. FEE_LEDGER_TERMINAL — alert on entries that have hit max retry attempts
 *
 * Deferred (require Solana RPC / Prisma models — Phase 13+):
 *   - UNMATCHED_ONCHAIN — needs Helius RPC fetch
 *   - ESCROW_TIMEOUT    — needs agent_escrow migration
 *   - AGENT_TX_ORPHAN   — needs AgentTransaction migration
 */

import type { Env } from '../types';
import { createDb } from '../lib/db';
import { hmacSign } from '../lib/hmac';
import {
  createFeeLedgerEntry,
  markFeeLedgerProcessing,
  markFeeLedgerFailed,
  DEFAULT_FEE_BPS,
  MAX_FEE_TRANSFER_ATTEMPTS,
} from '../lib/feeLedger';

/** Payment intents pending longer than this without a tx hash are STALE. */
const STALE_PENDING_TTL_MIN = 60;

/** Fee entries sitting in 'processing' longer than this need investigation. */
const FEE_PROCESSING_WARN_HOURS = 2;

export async function runReconciliation(env: Env): Promise<void> {
  const runId = crypto.randomUUID();
  const startedAt = Date.now();
  console.info('[cron/reconciliation] run started', { runId });

  const sql = createDb(env);
  let anomaliesFound = 0;

  try {
    // ── CHECK 1: STALE_PENDING ───────────────────────────────────────────────
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
      console.warn('[cron/reconciliation] STALE_PENDING', {
        count: staleResult.length,
        anomalyType: 'STALE_PENDING',
        severity: 'medium',
        runId,
      });
    }

    // ── CHECK 2: DOUBLE_CREDIT ───────────────────────────────────────────────
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
        console.error('[cron/reconciliation] DOUBLE_CREDIT', {
          transactionHash: row.transactionHash,
          count: Number(row.count),
          anomalyType: 'DOUBLE_CREDIT',
          severity: 'critical',
          runId,
          action: 'MANUAL_REVIEW_REQUIRED',
        });
      }
    }

    // ── CHECK 3: FEE_LEDGER_SYNC ─────────────────────────────────────────────
    // Find confirmed payment intents that have no fee_ledger_entries row yet.
    // This can happen if the intent was confirmed before the fee ledger existed,
    // or if createFeeLedgerEntry failed silently at intent creation time.
    const treasuryWallet = env.PLATFORM_TREASURY_WALLET;
    if (treasuryWallet) {
      const feeBps = env.PLATFORM_FEE_BPS ? parseInt(env.PLATFORM_FEE_BPS, 10) : DEFAULT_FEE_BPS;
      const safeBps = isNaN(feeBps) ? DEFAULT_FEE_BPS : feeBps;

      type UntrackedRow = { intentId: string; amount: number; verificationToken: string; walletAddress: string };
      const untracked: UntrackedRow[] = await sql<UntrackedRow[]>`
        SELECT pi.id            AS "intentId",
               pi.amount,
               pi.verification_token AS "verificationToken",
               m.wallet_address AS "walletAddress"
        FROM payment_intents pi
        JOIN merchants m ON m.id = pi.merchant_id
        WHERE pi.status IN ('confirmed', 'released')
          AND NOT EXISTS (
            SELECT 1 FROM fee_ledger_entries fle
            WHERE fle.intent_id = pi.id
          )
        LIMIT 50
      `.catch(() => [] as UntrackedRow[]);

      for (const row of untracked) {
        await createFeeLedgerEntry(sql, {
          intentId: row.intentId,
          grossAmount: Number(row.amount),
          feeBps: safeBps,
          treasuryDestination: treasuryWallet,
          recipientDestination: row.walletAddress,
          settlementReference: row.verificationToken,
        });
        console.info('[cron/reconciliation] FEE_LEDGER_SYNC created entry', {
          intentId: row.intentId,
          runId,
        });
      }

      if (untracked.length > 0) {
        anomaliesFound += untracked.length;
        console.warn('[cron/reconciliation] FEE_LEDGER_SYNC', {
          count: untracked.length,
          anomalyType: 'FEE_LEDGER_SYNC',
          severity: 'medium',
          runId,
        });
      }
    }

    // ── CHECK 4: FEE_LEDGER_PROCESS ──────────────────────────────────────────
    // Find 'pending' fee ledger entries whose intent is now confirmed.
    // Transition them to 'processing' and log for the treasury transfer step.
    //
    // Actual on-chain fee transfer requires the platform signing key.
    // When PLATFORM_SIGNING_KEY is present, the transfer would execute here.
    // Until then, 'processing' entries are logged for human/automated follow-up.
    type PendingFeeRow = { id: string; intentId: string; platformFeeAmount: number; grossAmount: number; treasuryDestination: string; recipientDestination: string; settlementReference: string | null; intentResolutionId: string | null };
    const pendingFees: PendingFeeRow[] = await sql<PendingFeeRow[]>`
      SELECT fle.id,
             fle.intent_id             AS "intentId",
             fle.platform_fee_amount   AS "platformFeeAmount",
             fle.gross_amount          AS "grossAmount",
             fle.treasury_destination  AS "treasuryDestination",
             fle.recipient_destination AS "recipientDestination",
             fle.settlement_reference  AS "settlementReference",
             ir.id                     AS "intentResolutionId"
      FROM fee_ledger_entries fle
      JOIN payment_intents pi  ON pi.id  = fle.intent_id
      LEFT JOIN intent_resolutions ir ON ir.intent_id = fle.intent_id
      WHERE fle.status       = 'pending'
        AND pi.status IN ('confirmed', 'released')
      LIMIT 20
    `.catch(() => [] as PendingFeeRow[]);

    for (const fee of pendingFees) {
      await markFeeLedgerProcessing(sql, fee.intentId, fee.intentResolutionId ?? undefined);
      console.info('[cron/reconciliation] FEE_LEDGER_PROCESS fee ready for collection', {
        intentId: fee.intentId,
        platformFeeAmount: Number(fee.platformFeeAmount),
        grossAmount: Number(fee.grossAmount),
        treasuryDestination: fee.treasuryDestination,
        settlementReference: fee.settlementReference,
        runId,
        action: 'TREASURY_TRANSFER_PENDING',
      });

      // ── Split payment distribution logging ──────────────────────────────
      // If the intent has a `splits` metadata field, calculate each
      // recipient's share of the net amount and log obligations.
      // Actual on-chain transfers require the platform signing key.
      await logSplitDistribution(sql, fee.intentId, Number(fee.platformFeeAmount), Number(fee.grossAmount), runId).catch(
        (err) => console.warn('[cron/reconciliation] split distribution log failed', { intentId: fee.intentId, error: err instanceof Error ? err.message : String(err) }),
      );

      // Update AgentRank score for the agent on this intent (best-effort)
      await updateAgentRankOnSettlement(sql, fee.intentId, Number(fee.grossAmount)).catch(
        (err) =>
          console.warn('[cron/reconciliation] agentrank update failed', {
            intentId: fee.intentId,
            error: err instanceof Error ? err.message : String(err),
          }),
      );

      // Fire payment_verified webhook to the merchant (best-effort, non-blocking)
      await deliverPaymentVerifiedWebhook(env, sql, fee.intentId, fee.settlementReference).catch(
        (err) =>
          console.warn('[cron/reconciliation] webhook delivery failed', {
            intentId: fee.intentId,
            error: err instanceof Error ? err.message : String(err),
          }),
      );
    }

    // ── CHECK 5: STALE_PROCESSING — warn on fee entries stuck in processing ──
    const staleProcessingCutoff = new Date(
      Date.now() - FEE_PROCESSING_WARN_HOURS * 60 * 60 * 1000,
    );
    type StaleProcessingRow = { id: string; intentId: string; attemptCount: number };
    const staleProcessing: StaleProcessingRow[] = await sql<StaleProcessingRow[]>`
      SELECT id,
             intent_id     AS "intentId",
             attempt_count AS "attemptCount"
      FROM fee_ledger_entries
      WHERE status            = 'processing'
        AND last_attempted_at < ${staleProcessingCutoff}
      LIMIT 20
    `.catch(() => [] as StaleProcessingRow[]);

    if (staleProcessing.length > 0) {
      anomaliesFound += staleProcessing.length;
      for (const entry of staleProcessing) {
        const willTerminate = Number(entry.attemptCount) + 1 >= MAX_FEE_TRANSFER_ATTEMPTS;
        console.error('[cron/reconciliation] FEE_TRANSFER_STUCK', {
          id: entry.id,
          intentId: entry.intentId,
          attemptCount: Number(entry.attemptCount),
          willTerminate,
          anomalyType: 'FEE_TRANSFER_STUCK',
          severity: 'high',
          runId,
          action: willTerminate ? 'MANUAL_INTERVENTION_REQUIRED' : 'WILL_RETRY',
        });

        // Increment attempt count; terminal if max reached
        await markFeeLedgerFailed(
          sql,
          entry.intentId,
          'processing_timeout: no transfer signature after 2h',
        );
      }
    }

    // ── CHECK 6: TERMINAL ENTRIES — alert and stop ────────────────────────────
    type TerminalEntryRow = { id: string; intentId: string; failureReason: string | null };
    const terminalEntries: TerminalEntryRow[] = await sql<TerminalEntryRow[]>`
      SELECT id,
             intent_id      AS "intentId",
             failure_reason AS "failureReason"
      FROM fee_ledger_entries
      WHERE status = 'terminal'
        AND settled_at IS NULL
      LIMIT 20
    `.catch(() => [] as TerminalEntryRow[]);

    if (terminalEntries.length > 0) {
      anomaliesFound += terminalEntries.length;
      for (const entry of terminalEntries) {
        console.error('[cron/reconciliation] FEE_TERMINAL', {
          id: entry.id,
          intentId: entry.intentId,
          failureReason: entry.failureReason,
          anomalyType: 'FEE_TERMINAL',
          severity: 'critical',
          runId,
          action: 'MANUAL_INTERVENTION_REQUIRED — fee_ledger_entries row is terminal',
        });
      }
    }

    // ── CHECK 7: MERCHANT_ANOMALY — detect unusual payment patterns ───────────
    // Thresholds (conservative — flag rather than block):
    //   a) High failure rate: >10 failed/expired intents for one merchant in 1 hour
    //   b) High velocity: >50 intents (any status) for one merchant in 1 hour
    //   c) Large single payment: any intent with amount > 10,000 USDC in last hour
    const anomalyWindow = new Date(Date.now() - 60 * 60 * 1000); // last 1 hour

    // (a) High failure rate per merchant
    type HighFailureRow = { merchantId: string; failCount: number };
    const highFailure: HighFailureRow[] = await sql<HighFailureRow[]>`
      SELECT merchant_id AS "merchantId",
             COUNT(*)    AS "failCount"
      FROM payment_intents
      WHERE status IN ('failed', 'expired', 'rejected')
        AND created_at >= ${anomalyWindow}
      GROUP BY merchant_id
      HAVING COUNT(*) > 10
    `.catch(() => [] as HighFailureRow[]);

    for (const row of highFailure) {
      anomaliesFound += 1;
      console.error('[cron/reconciliation] ANOMALY_HIGH_FAILURE_RATE', {
        merchantId: row.merchantId,
        failCount: Number(row.failCount),
        windowMinutes: 60,
        anomalyType: 'HIGH_FAILURE_RATE',
        severity: 'high',
        runId,
        action: 'REVIEW_MERCHANT_ACCOUNT',
      });
    }

    // (b) High velocity per merchant
    type HighVelocityRow = { merchantId: string; intentCount: number };
    const highVelocity: HighVelocityRow[] = await sql<HighVelocityRow[]>`
      SELECT merchant_id AS "merchantId",
             COUNT(*)    AS "intentCount"
      FROM payment_intents
      WHERE created_at >= ${anomalyWindow}
      GROUP BY merchant_id
      HAVING COUNT(*) > 50
    `.catch(() => [] as HighVelocityRow[]);

    for (const row of highVelocity) {
      anomaliesFound += 1;
      console.warn('[cron/reconciliation] ANOMALY_HIGH_VELOCITY', {
        merchantId: row.merchantId,
        intentCount: Number(row.intentCount),
        windowMinutes: 60,
        anomalyType: 'HIGH_VELOCITY',
        severity: 'medium',
        runId,
        action: 'REVIEW_RATE_LIMIT_SETTINGS',
      });
    }

    // (c) Large single payment (>$10k USDC)
    const LARGE_PAYMENT_THRESHOLD = 10000;
    type LargePaymentRow = { intentId: string; merchantId: string; amount: number };
    const largePayments: LargePaymentRow[] = await sql<LargePaymentRow[]>`
      SELECT id          AS "intentId",
             merchant_id AS "merchantId",
             amount
      FROM payment_intents
      WHERE amount > ${LARGE_PAYMENT_THRESHOLD}
        AND created_at >= ${anomalyWindow}
    `.catch(() => [] as LargePaymentRow[]);

    for (const row of largePayments) {
      anomaliesFound += 1;
      console.warn('[cron/reconciliation] ANOMALY_LARGE_PAYMENT', {
        intentId: row.intentId,
        merchantId: row.merchantId,
        amount: Number(row.amount),
        thresholdUsdc: LARGE_PAYMENT_THRESHOLD,
        anomalyType: 'LARGE_PAYMENT',
        severity: 'medium',
        runId,
        action: 'VERIFY_MERCHANT_APPROVAL_FOR_LARGE_AMOUNTS',
      });
    }

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

// ---------------------------------------------------------------------------
// Split payment distribution — log per-recipient obligations (best-effort)
// ---------------------------------------------------------------------------

/**
 * If a payment intent has a `splits` metadata field, calculate each
 * recipient's USDC amount from the net (post-fee) amount and log
 * a SPLIT_DISTRIBUTION_PENDING entry for each.
 *
 * Format of metadata.splits:
 *   [{ address: string, bps: number }]  — bps values must sum to 10000
 *
 * The log entries carry all information needed for the treasury signing
 * service to execute the on-chain transfers once a signing key is available.
 */
async function logSplitDistribution(
  sql: ReturnType<typeof createDb>,
  intentId: string,
  platformFeeAmount: number,
  grossAmount: number,
  runId: string,
): Promise<void> {
  const rows = await sql<Array<{ metadata: Record<string, unknown> | null }>>`
    SELECT metadata FROM payment_intents WHERE id = ${intentId}::uuid LIMIT 1
  `.catch(() => []);

  const metadata = rows[0]?.metadata;
  if (!metadata) return;

  const splits = metadata['splits'];
  if (!Array.isArray(splits) || splits.length === 0) return;

  const netAmount = grossAmount - platformFeeAmount;

  for (const split of splits) {
    if (!split || typeof split !== 'object') continue;
    const s = split as { address?: string; bps?: number };
    if (typeof s.address !== 'string' || typeof s.bps !== 'number') continue;

    const recipientAmount = parseFloat(((netAmount * s.bps) / 10000).toFixed(6));
    console.info('[cron/reconciliation] SPLIT_DISTRIBUTION_PENDING', {
      intentId,
      recipientAddress: s.address,
      bps: s.bps,
      recipientAmountUsdc: recipientAmount,
      netAmountUsdc: netAmount,
      grossAmountUsdc: grossAmount,
      runId,
      action: 'TREASURY_SPLIT_TRANSFER_PENDING',
    });
  }
}

// ---------------------------------------------------------------------------
// AgentRank update — increment score on successful settlement (best-effort)
// ---------------------------------------------------------------------------

/**
 * When a payment is confirmed, credit the agent's AgentRank score.
 * Uses a simple UPSERT: score += volume_delta where volume_delta is
 * proportional to the payment amount (capped at 10 points per tx).
 * Never throws — AgentRank is non-critical for payment flow.
 */
async function updateAgentRankOnSettlement(
  sql: ReturnType<typeof createDb>,
  intentId: string,
  grossAmount: number,
): Promise<void> {
  // Fetch the agent_id for this intent (may be null for anonymous agents)
  const rows = await sql<Array<{ agentId: string | null }>>`
    SELECT agent_id AS "agentId"
    FROM payment_intents
    WHERE id = ${intentId}::uuid
    LIMIT 1
  `.catch(() => [] as Array<{ agentId: string | null }>);

  const agentId = rows[0]?.agentId;
  if (!agentId) return; // anonymous agent — no rank to update

  // Score delta: 1 point per $1 USDC settled, max 10 per tx
  const delta = Math.min(Math.round(grossAmount), 10);

  await sql`
    INSERT INTO agentrank_scores (agent_id, score, payment_reliability, transaction_volume, updated_at)
    VALUES (
      ${agentId}::uuid,
      ${delta},
      100,
      ${grossAmount},
      NOW()
    )
    ON CONFLICT (agent_id) DO UPDATE SET
      score                = LEAST(agentrank_scores.score + ${delta}, 1000),
      payment_reliability  = LEAST(agentrank_scores.payment_reliability + 1, 100),
      transaction_volume   = agentrank_scores.transaction_volume + ${grossAmount},
      updated_at           = NOW()
  `;

  console.info('[cron/reconciliation] AgentRank updated', { agentId, intentId, delta });
}

// ---------------------------------------------------------------------------
// Webhook delivery — fire payment_verified to merchant (best-effort)
// ---------------------------------------------------------------------------

/**
 * Look up the merchant webhook URL for a given intent and deliver a signed
 * payment_verified event via HTTP POST. Uses the same HMAC-SHA256 scheme as
 * the main webhook delivery worker so merchants can verify authenticity.
 *
 * Signature format: HMAC-SHA256(timestamp + "." + rawBody, WEBHOOK_SECRET)
 * Headers: X-AgentPay-Signature, X-AgentPay-Timestamp, X-AgentPay-Event
 */
async function deliverPaymentVerifiedWebhook(
  env: Env,
  sql: ReturnType<typeof createDb>,
  intentId: string,
  settlementReference: string | null,
): Promise<void> {
  // Fetch merchant webhook URL for this intent
  const rows = await sql<Array<{ webhookUrl: string | null; amount: number; currency: string }>>`
    SELECT m.webhook_url AS "webhookUrl",
           pi.amount,
           pi.currency
    FROM payment_intents pi
    JOIN merchants m ON m.id = pi.merchant_id
    WHERE pi.id = ${intentId}::uuid
    LIMIT 1
  `.catch(() => [] as Array<{ webhookUrl: string | null; amount: number; currency: string }>);

  if (!rows.length || !rows[0].webhookUrl) return;

  const { webhookUrl, amount, currency } = rows[0];

  const webhookSecret = env.WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.warn('[cron/reconciliation] WEBHOOK_SECRET not set — skipping delivery', { intentId });
    return;
  }

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const payload = JSON.stringify({
    type: 'payment_verified',
    intentId,
    amount: Number(amount),
    currency,
    settlementReference,
    verifiedAt: new Date().toISOString(),
  });

  const signedData = `${timestamp}.${payload}`;
  const signature = await hmacSign(signedData, webhookSecret);

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-AgentPay-Signature': signature,
      'X-AgentPay-Timestamp': timestamp,
      'X-AgentPay-Event': 'payment_verified',
      'User-Agent': 'AgentPay-Webhook/2.0',
    },
    body: payload,
    signal: AbortSignal.timeout(8000),
  });

  if (response.ok) {
    console.info('[cron/reconciliation] webhook delivered', { intentId, webhookUrl, status: response.status });
  } else {
    console.warn('[cron/reconciliation] webhook non-2xx', { intentId, webhookUrl, status: response.status });
  }
}
