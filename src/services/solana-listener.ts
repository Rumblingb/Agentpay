import { query } from '../db/index.js';
import { logger } from '../logger.js';
import { verifyPaymentRecipient } from '../security/payment-verification.js';
import * as webhooksService from './webhooks.js';
import type { WebhookPayload } from './webhooks.js';
import prisma from '../lib/prisma.js';

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

interface PendingIntent {
  intentId: string;
  merchantId: string;
  amountUsdc: number;
  recipientAddress: string;
  txHash: string;
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
 * verify endpoint and stored in metadata.  These are intent-based payments
 * that have not yet had a transactions row created.
 */
async function fetchPendingIntentsWithHash(): Promise<PendingIntent[]> {
  const result = await query(
    `SELECT
       pi.id          AS "intentId",
       pi.merchant_id AS "merchantId",
       pi.amount      AS "amountUsdc",
       m.wallet_address AS "recipientAddress",
       pi.metadata->>'tx_hash' AS "txHash",
       pi.metadata    AS "metadata",
       m.webhook_url  AS "webhookUrl"
     FROM payment_intents pi
     JOIN merchants m ON pi.merchant_id = m.id
     WHERE pi.status = 'pending'
       AND pi.metadata->>'tx_hash' IS NOT NULL
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
    webhooksService
      .scheduleWebhook(tx.webhookUrl, payload, tx.merchantId, tx.id)
      .catch((err) => logger.error('Listener: webhook scheduling error', { err }));
  }
}

/**
 * Processes a pending payment_intent that has had a tx_hash submitted.
 *
 * When the transaction is confirmed on-chain this function:
 *   1. Updates payment_intent.status → 'completed'
 *   2. Creates a durable transactions row with status='released'
 *
 * Both writes are wrapped in a prisma.$transaction to guarantee atomicity.
 */
async function processIntent(intent: PendingIntent): Promise<void> {
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

  // Strip the tx_hash sentinel so a re-check doesn't double-process.
  // We update status to 'completed' and write a clean metadata snapshot.
  const { tx_hash: _removed, ...cleanMeta } = (intent.metadata ?? {}) as Record<string, unknown>;

  try {
    // Atomic: update the intent AND create the transactions row together.
    await prisma.$transaction([
      prisma.paymentIntent.updateMany({
        where: { id: intent.intentId, status: 'pending' },
        data: {
          status: 'completed',
          metadata: { ...cleanMeta, tx_hash: intent.txHash },
        },
      }),
      prisma.transactions.create({
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
      }),
    ]);
  } catch (err: any) {
    // P2002 = unique_violation on payment_id — already processed by concurrent poll or trigger
    if (err?.code === 'P2002') {
      logger.debug('Listener: intent transactions row already exists, skipping', {
        intentId: intent.intentId,
      });
      return;
    }
    throw err;
  }

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
    webhooksService
      .scheduleWebhook(intent.webhookUrl, payload, intent.merchantId, intent.intentId)
      .catch((err) => logger.error('Listener: intent webhook scheduling error', { err }));
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
