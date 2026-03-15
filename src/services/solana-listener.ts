import { query } from '../db/index.js';
import { logger } from '../logger.js';
import { verifyPaymentRecipient } from '../security/payment-verification.js';
import * as webhooksService from './webhooks.js';
import type { WebhookPayload } from './webhooks.js';
import prisma from '../lib/prisma.js';
import { ingestSolanaProof } from '../settlement/settlementEventIngestion.js';
import {
  runResolutionEngine,
  type RunEngineParams,
} from '../settlement/intentResolutionEngine.js';
import { normalizeSolanaObservation } from '../settlement/settlementEventIngestion.js';
import { emitSettlementEvent } from '../settlement/settlementEventService.js';

const LISTENER_POLL_INTERVAL_MS = parseInt(process.env.LISTENER_POLL_INTERVAL_MS || '30000', 10);

interface PendingTx {
  id: string;
  merchantId: string;
  paymentId: string;
  amountUsdc: number;
  recipientAddress: string;
  transactionHash: string;
  webhookUrl: string | null;
}

/**
 * Extended intent row — includes fields needed by the Phase 9 settlement path:
 *   verificationToken  — compared to on-chain memo when requireMemoMatch=true
 *   externalRef        — first-class tx_hash column (falls back to metadata->>'tx_hash')
 */
interface PendingIntent {
  intentId: string;
  merchantId: string;
  amountUsdc: number;
  recipientAddress: string;
  txHash: string;
  verificationToken: string | null;
  externalRef: string | null;
  metadata: Record<string, unknown> | null;
  webhookUrl: string | null;
}

let listenerInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Marks expired pending transactions as 'expired'.
 * Runs on every poll to keep the database clean.
 */
async function expireStaleTransactions(): Promise<void> {
  await query(
    `UPDATE transactions SET status = 'expired', updated_at = NOW()
     WHERE status = 'pending' AND expires_at <= NOW()`
  );
}

/**
 * Fetches pending transactions that already have a transaction_hash set.
 * These are payments that have been submitted to the blockchain and are
 * waiting for confirmation.
 */
async function fetchPendingWithHash(): Promise<PendingTx[]> {
  const result = await query(
    `SELECT t.id, t.merchant_id AS "merchantId", t.payment_id AS "paymentId",
            t.amount_usdc AS "amountUsdc", t.recipient_address AS "recipientAddress",
            t.transaction_hash AS "transactionHash", m.webhook_url AS "webhookUrl"
     FROM transactions t
     JOIN merchants m ON t.merchant_id = m.id
     WHERE t.status = 'pending'
       AND t.transaction_hash IS NOT NULL
       AND t.expires_at > NOW()
     ORDER BY t.created_at ASC
     LIMIT 50`
  );
  return result.rows as PendingTx[];
}

/**
 * Fetches pending payment_intents that have had a tx_hash submitted via the
 * verify endpoint and stored in metadata OR in the first-class external_ref
 * column.  Phase 9: also selects verification_token and external_ref so the
 * resolution engine can perform memo matching without a second DB round-trip.
 */
async function fetchPendingIntentsWithHash(): Promise<PendingIntent[]> {
  const result = await query(
    `SELECT
       pi.id                              AS "intentId",
       pi.merchant_id                     AS "merchantId",
       pi.amount                          AS "amountUsdc",
       m.wallet_address                   AS "recipientAddress",
       COALESCE(pi.external_ref,
                pi.metadata->>'tx_hash')  AS "txHash",
       pi.verification_token              AS "verificationToken",
       pi.external_ref                    AS "externalRef",
       pi.metadata                        AS "metadata",
       m.webhook_url                      AS "webhookUrl"
     FROM payment_intents pi
     JOIN merchants m ON pi.merchant_id = m.id
     WHERE pi.status = 'pending'
       AND (
         pi.external_ref IS NOT NULL
         OR pi.metadata->>'tx_hash' IS NOT NULL
       )
       AND pi.expires_at > NOW()
     ORDER BY pi.created_at ASC
     LIMIT 50`
  );
  return result.rows as PendingIntent[];
}

/**
 * Checks a single pending transaction against the Solana blockchain.
 * If the payment is confirmed on-chain, updates the DB and fires a webhook.
 */
async function processTransaction(tx: PendingTx): Promise<void> {
  // Cross-check that the transaction's stored recipient still matches the
  // merchant's current wallet address, guarding against transaction replay
  // attacks where a hash is re-submitted against a different merchant record.
  const merchant = await prisma.merchant.findUnique({
    where: { id: tx.merchantId },
    select: { walletAddress: true },
  });

  if (!merchant || tx.recipientAddress !== merchant.walletAddress) {
    logger.warn('Listener: transaction destination mismatch — skipping', {
      id: tx.id,
      storedRecipient: tx.recipientAddress,
      currentWallet: merchant?.walletAddress ?? 'not found',
    });
    throw new Error('Transaction destination mismatch');
  }

  const verification = await verifyPaymentRecipient(tx.transactionHash, tx.recipientAddress);

  if (!verification.valid) {
    logger.debug('Listener: transaction not yet valid on-chain', {
      id: tx.id,
      reason: verification.error,
    });
    return;
  }

  if (!verification.verified) {
    logger.debug('Listener: awaiting more confirmations', {
      id: tx.id,
      depth: verification.confirmationDepth,
    });
    return;
  }

  // Atomically update only if still pending (guards against duplicate processing)
  const updated = await query(
    `UPDATE transactions
     SET status = 'confirmed', payer_address = $1, confirmation_depth = $2, updated_at = NOW()
     WHERE id = $3 AND status = 'pending'
     RETURNING id`,
    [verification.payer ?? null, verification.confirmationDepth ?? 0, tx.id]
  );

  if (!updated.rowCount) {
    return; // Already updated by a concurrent poll or manual verify
  }

  logger.info('Listener: payment confirmed', {
    transactionId: tx.id,
    payer: verification.payer,
    confirmationDepth: verification.confirmationDepth,
  });

  // Also mark the linked payment intent as completed (best-effort)
  prisma.paymentIntent
    .updateMany({
      where: { id: tx.paymentId },
      data: { status: 'completed' },
    })
    .catch((err: any) =>
      logger.debug('Listener: could not update payment_intents status', {
        paymentId: tx.paymentId,
        error: err?.message,
      }),
    );

  // Fire webhook asynchronously — non-blocking
  if (tx.webhookUrl) {
    const payload: WebhookPayload = {
      event: 'payment.confirmed',
      transactionId: tx.id,
      merchantId: tx.merchantId,
      paymentId: tx.paymentId,
      amountUsdc: tx.amountUsdc,
      recipientAddress: tx.recipientAddress,
      payerAddress: verification.payer,
      transactionHash: tx.transactionHash,
      verified: true,
      timestamp: new Date().toISOString(),
    };
    // Atomically mark the transaction's webhook_status to 'scheduled' only
    // if it was previously 'not_sent'. This prevents duplicate scheduling
    // when multiple workers/processes observe the same confirmed tx.
    try {
      const updated = await prisma.transactions.updateMany({
        where: { id: tx.id, webhook_status: 'not_sent' },
        data: { webhook_status: 'scheduled' },
      });
      if ((updated as any).count && (updated as any).count > 0) {
        webhooksService
          .scheduleWebhook(tx.webhookUrl, payload, tx.merchantId, tx.id)
          .catch((err) => logger.error('Listener: webhook scheduling error', { err }));
      } else {
        logger.debug('Listener: webhook already scheduled for transaction', { transactionId: tx.id });
      }
    } catch (err) {
      logger.error('Listener: failed to mark webhook_status on transaction', { err });
    }
  }
}

/**
 * Processes a pending payment_intent that has had a tx_hash submitted.
 *
 * Phase 9 settlement path (additive — existing Prisma $transaction unchanged):
 *
 *   1. On first observation (hash seen, not yet on-chain confirmed):
 *      emit a `hash_submitted` settlement event (fire-and-forget).
 *
 *   2. On confirmed on-chain tx:
 *      a. Persist normalized settlement event via ingestSolanaProof()
 *      b. Run the resolution engine (Phase 6) to produce an intent_resolutions
 *         record with a fine-grained decision + reason code.
 *      c. The engine's updateIntentStatus() call overwrites the intent status
 *         consistently (confirmed → `completed`; failed → `failed`).
 *      d. Legacy prisma.$transaction still runs for backward compatibility —
 *         see TODO in the legacy path block below.
 *
 * NOTE (double-truth): both the resolution engine and the legacy path write
 * intent state. The resolution engine is the authoritative source; the legacy
 * path is kept for beta stability. Remove the legacy branch once the engine
 * is confirmed stable in production.
 *
 * Resolution engine failures are non-fatal — logged at warn level.
 * The legacy path (prisma.$transaction) always runs regardless.
 *
 * Explicit reason codes surfaced when matching fails:
 *   - no_intent_found      — intent row missing (should not happen, guarded above)
 *   - recipient_mismatch   — on-chain recipient ≠ merchant wallet
 *   - amount_mismatch      — paid amount outside tolerance
 *   - memo_missing         — policy requires memo but none present
 */
async function processIntent(intent: PendingIntent): Promise<void> {
  // ── Phase 9 Step 1: emit hash_submitted event on first observation ────────
  // Fire-and-forget — does not block the on-chain check.
  emitSettlementEvent({
    eventType: 'hash_submitted',
    protocol: 'solana',
    intentId: intent.intentId,
    externalRef: intent.txHash,
    payload: {
      txHash: intent.txHash,
      merchantId: intent.merchantId,
      recipientAddress: intent.recipientAddress,
    },
  });

  // ── On-chain check (unchanged) ────────────────────────────────────────────
  const verification = await verifyPaymentRecipient(intent.txHash, intent.recipientAddress);

  if (!verification.valid) {
    logger.debug('Listener: intent tx not yet valid on-chain', {
      intentId: intent.intentId,
      reason: verification.error,
    });
    return;
  }

  if (!verification.verified) {
    logger.debug('Listener: intent awaiting more confirmations', {
      intentId: intent.intentId,
      depth: verification.confirmationDepth,
    });
    return;
  }

  // ── Phase 9 Step 2: ingest confirmed Solana observation ───────────────────
  // Attempt to claim this intent/txHash by creating the transactions row.
  // If the row already exists, assume another worker has processed it and
  // skip all side-effects (ingest, resolution engine, webhooks, revenue).
  try {
    await prisma.transactions.create({
      data: {
        merchant_id: intent.merchantId,
        payment_id: intent.intentId,
        amount_usdc: intent.amountUsdc,
        recipient_address: intent.recipientAddress,
        payer_address: verification.payer ?? null,
        transaction_hash: intent.txHash,
        status: 'released',
        webhook_status: 'not_sent',
        confirmation_depth: verification.confirmationDepth ?? 0,
        metadata: intent.metadata as object ?? undefined,
      },
    });
  } catch (err: any) {
    if (err?.code === 'P2002') {
      logger.debug('Listener: transactions row already exists, skipping processing', {
        intentId: intent.intentId,
        txHash: intent.txHash,
      });
      return;
    }
    throw err;
  }

  // Returns the settlement event ID; the underlying emitSettlementEvent write
  // is fire-and-forget so it does NOT block the remaining work below.
  ingestSolanaProof(
    {
      txHash: intent.txHash,
      sender: verification.payer ?? null,
      recipient: intent.recipientAddress,
      amountUsdc: Number(intent.amountUsdc),
      memo: null, // on-chain memo fetched by the engine if needed
      confirmationDepth: verification.confirmationDepth ?? 0,
      confirmed: true,
    },
    { intentId: intent.intentId },
  );

  // Run resolution engine (best-effort). Failures here should not revert the
  // claimed transactions row — the claim ensures single-apply semantics.
  try {
    const proof = normalizeSolanaObservation({
      txHash: intent.txHash,
      sender: verification.payer ?? null,
      recipient: intent.recipientAddress,
      amountUsdc: Number(intent.amountUsdc),
      memo: null,
      confirmationDepth: verification.confirmationDepth ?? 0,
      confirmed: true,
    });

    const engineParams: RunEngineParams = {
      intentId: intent.intentId,
      proof,
      expectedAmountUsdc: Number(intent.amountUsdc),
      merchantWallet: intent.recipientAddress,
      verificationToken: intent.verificationToken ?? null,
      resolvedBy: 'solana_listener',
    };

    const engineResult = await runResolutionEngine(engineParams);

    logger.info('Listener: resolution engine result', {
      intentId: intent.intentId,
      decision: engineResult.evaluation.decision,
      reasonCode: engineResult.evaluation.reasonCode,
      resolutionStatus: engineResult.evaluation.resolutionStatus,
      wasAlreadyResolved: engineResult.wasAlreadyResolved,
    });
  } catch (engineErr: unknown) {
    logger.warn('Listener: resolution engine failed (continuing)', {
      intentId: intent.intentId,
      error: engineErr instanceof Error ? engineErr.message : String(engineErr),
    });
  }

  // ── Legacy path ───────────────────────────────────────────────────────────
  // TODO: Remove this legacy prisma.$transaction branch once the resolution
  // engine is confirmed stable in production. The engine's updateIntentStatus()
  // call already writes the canonical intent state; this block exists only for
  // backward compatibility and to create the transactions row that older code
  // may still read. Tracked as double-truth risk: resolution engine is the
  // authoritative source of truth; legacy path is acceptable for beta only.
  //
  // Strip the tx_hash sentinel from cleanMeta so a re-check doesn't double-process.
  // We update status to 'completed' and write a clean metadata snapshot that
  // preserves the submitted hash for audit purposes.
  const { tx_hash: _txHash, ...cleanMeta } = (intent.metadata ?? {}) as Record<string, unknown>;

  // Update the intent status to completed and persist a clean metadata snapshot.
  // The transactions row has already been created above; this update is best-effort
  // and may be redundant if the resolution engine already updated the intent.
  await prisma.paymentIntent
    .updateMany({
      where: { id: intent.intentId, status: 'pending' },
      data: { status: 'completed', metadata: { ...cleanMeta, tx_hash: intent.txHash } },
    })
    .catch((err: any) =>
      logger.debug('Listener: could not update payment_intents status (post-claim)', {
        paymentId: intent.intentId,
        error: err?.message,
      }),
    );

  logger.info('Listener: intent payment released', {
    intentId: intent.intentId,
    merchantId: intent.merchantId,
    amountUsdc: intent.amountUsdc,
    confirmationDepth: verification.confirmationDepth,
  });

  // Fire webhook asynchronously — non-blocking
  if (intent.webhookUrl) {
    const payload: WebhookPayload = {
      event: 'payment.confirmed',
      transactionId: intent.intentId,
      merchantId: intent.merchantId,
      paymentId: intent.intentId,
      amountUsdc: intent.amountUsdc,
      recipientAddress: intent.recipientAddress,
      payerAddress: verification.payer,
      transactionHash: intent.txHash,
      verified: true,
      timestamp: new Date().toISOString(),
    };
    // Ensure we schedule the intent webhook at-most-once by atomically
    // transitioning the transactions row's webhook_status from 'not_sent'
    // to 'scheduled'. Only if the update affects a row do we enqueue delivery.
    try {
      const updated = await prisma.transactions.updateMany({
        where: { payment_id: intent.intentId, webhook_status: 'not_sent' },
        data: { webhook_status: 'scheduled' },
      });
      if ((updated as any).count && (updated as any).count > 0) {
        webhooksService
          .scheduleWebhook(intent.webhookUrl, payload, intent.merchantId, intent.intentId)
          .catch((err) => logger.error('Listener: intent webhook scheduling error', { err }));
      } else {
        logger.debug('Listener: webhook already scheduled for intent', { intentId: intent.intentId });
      }
    } catch (err) {
      logger.error('Listener: failed to mark webhook_status on intent transaction', { err });
    }
  }
}

/**
 * One poll cycle: expire stale transactions, then check pending ones.
 */
async function poll(): Promise<void> {
  try {
    await expireStaleTransactions();

    const pending = await fetchPendingWithHash();
    if (pending.length > 0) {
      logger.debug(`Listener: checking ${pending.length} pending transaction(s)`);
    }

    for (const tx of pending) {
      await processTransaction(tx).catch((err) =>
        logger.error('Listener: error processing transaction', { id: tx.id, err })
      );
    }

    const pendingIntents = await fetchPendingIntentsWithHash();
    if (pendingIntents.length > 0) {
      logger.debug(`Listener: checking ${pendingIntents.length} pending intent(s) with tx_hash`);
    }

    for (const intent of pendingIntents) {
      await processIntent(intent).catch((err) =>
        logger.error('Listener: error processing intent', { intentId: intent.intentId, err })
      );
    }
  } catch (err) {
    logger.error('Listener: poll error', { err });
  }
}

/**
 * Starts the Solana blockchain listener.
 * Polls every LISTENER_POLL_INTERVAL_MS milliseconds (default: 30 s).
 * Safe to call multiple times — only one listener will run at a time.
 */
export function startSolanaListener(): void {
  if (listenerInterval) return;
  logger.info(`Solana listener started (poll interval: ${LISTENER_POLL_INTERVAL_MS}ms)`);
  poll(); // run immediately on startup
  listenerInterval = setInterval(poll, LISTENER_POLL_INTERVAL_MS);
}

/**
 * Stops the Solana blockchain listener.
 */
export function stopSolanaListener(): void {
  if (listenerInterval) {
    clearInterval(listenerInterval);
    listenerInterval = null;
    logger.info('Solana listener stopped');
  }
}

export default { startSolanaListener, stopSolanaListener };
