/**
 * Fee Ledger — outbox helpers for platform fee collection.
 *
 * Every confirmed payment intent should have exactly one fee_ledger_entries row.
 * This module provides:
 *
 *   createFeeLedgerEntry   — called at intent creation (status = 'pending')
 *   markFeeLedgerProcessing — called when payment is confirmed on-chain
 *   markFeeLedgerComplete  — called when treasury fee transfer succeeds
 *   markFeeLedgerFailed    — called when fee transfer fails (retryable)
 *   markFeeLedgerTerminal  — called when max retries exceeded (needs human)
 *
 * All functions are best-effort: they catch and log errors so that a fee
 * ledger write failure never surfaces to the payer or blocks the payment flow.
 *
 * Fee calculation:
 *   platform_fee = gross * (platform_fee_bps / 10_000)
 *   net_recipient = gross - platform_fee
 *
 * The rail_fee (Solana network cost in USD-equivalent) is tracked for
 * reporting but is not deducted from the USDC amounts.
 */

import type { Sql } from './db';

/** Default platform fee in basis points (50 bps = 0.5%). Override with env. */
export const DEFAULT_FEE_BPS = 50;

/** After this many failed attempts the entry moves to 'terminal'. */
export const MAX_FEE_TRANSFER_ATTEMPTS = 5;

export interface CreateFeeLedgerParams {
  intentId: string;
  grossAmount: number;
  feeBps?: number;             // defaults to DEFAULT_FEE_BPS
  treasuryDestination: string; // platform treasury wallet address
  recipientDestination: string;// merchant wallet address
  settlementReference?: string;// verification token / memo
}

export interface FeeLedgerRow {
  id: string;
  intentId: string;
  grossAmount: number;
  platformFeeAmount: number;
  netRecipientAmount: number;
  treasuryDestination: string;
  recipientDestination: string;
  settlementReference: string | null;
  status: string;
  attemptCount: number;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// createFeeLedgerEntry
// ---------------------------------------------------------------------------

/**
 * Insert a fee_ledger_entries row for a newly-created payment intent.
 * Called during intent creation so the fee obligation is recorded atomically
 * with the intent — even before the payer sends any funds.
 *
 * Returns the row ID on success, null on failure.
 * Never throws.
 */
export async function createFeeLedgerEntry(
  sql: Sql,
  params: CreateFeeLedgerParams,
): Promise<string | null> {
  const {
    intentId,
    grossAmount,
    feeBps = DEFAULT_FEE_BPS,
    treasuryDestination,
    recipientDestination,
    settlementReference,
  } = params;

  const platformFeeAmount = parseFloat(
    ((grossAmount * feeBps) / 10_000).toFixed(6),
  );
  const netRecipientAmount = parseFloat(
    (grossAmount - platformFeeAmount).toFixed(6),
  );

  try {
    const rows = await sql<Array<{ id: string }>>`
      INSERT INTO fee_ledger_entries
        (intent_id, gross_amount, platform_fee_amount, rail_fee_amount,
         net_recipient_amount, treasury_destination, recipient_destination,
         settlement_reference, status, created_at)
      VALUES
        (${intentId}::uuid, ${grossAmount}, ${platformFeeAmount}, 0,
         ${netRecipientAmount}, ${treasuryDestination}, ${recipientDestination},
         ${settlementReference ?? null}, 'pending', NOW())
      ON CONFLICT (intent_id) DO NOTHING
      RETURNING id
    `;
    return rows[0]?.id ?? null;
  } catch (err: unknown) {
    // Table may not yet exist in older deployments — don't crash intent creation.
    const msg = err instanceof Error ? err.message : String(err);
    const isMissing = msg.includes('does not exist') || msg.includes('relation');
    if (!isMissing) {
      console.warn('[feeLedger] createFeeLedgerEntry failed', { intentId, error: msg });
    }
    return null;
  }
}

// ---------------------------------------------------------------------------
// markFeeLedgerProcessing
// ---------------------------------------------------------------------------

/**
 * Transition a 'pending' fee ledger entry to 'processing' once the on-chain
 * payment has been confirmed. Called by the reconciler when it detects a
 * confirmed settlement_event for this intent.
 */
export async function markFeeLedgerProcessing(
  sql: Sql,
  intentId: string,
  intentResolutionId?: string,
): Promise<void> {
  try {
    await sql`
      UPDATE fee_ledger_entries
      SET status                = 'processing',
          intent_resolution_id  = ${intentResolutionId ?? null},
          last_attempted_at     = NOW()
      WHERE intent_id = ${intentId}::uuid
        AND status    = 'pending'
    `;
  } catch (err: unknown) {
    console.warn('[feeLedger] markFeeLedgerProcessing failed', {
      intentId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ---------------------------------------------------------------------------
// markFeeLedgerComplete
// ---------------------------------------------------------------------------

/**
 * Mark a fee ledger entry complete after the treasury fee transfer has been
 * broadcast and confirmed on-chain. Sets fee_transfer_signature + settled_at.
 */
export async function markFeeLedgerComplete(
  sql: Sql,
  intentId: string,
  feeTransferSignature: string,
): Promise<void> {
  try {
    await sql`
      UPDATE fee_ledger_entries
      SET status                 = 'complete',
          fee_transfer_signature = ${feeTransferSignature},
          settled_at             = NOW(),
          last_attempted_at      = NOW()
      WHERE intent_id = ${intentId}::uuid
        AND status IN ('pending', 'processing', 'failed')
    `;
  } catch (err: unknown) {
    console.warn('[feeLedger] markFeeLedgerComplete failed', {
      intentId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ---------------------------------------------------------------------------
// markFeeLedgerFailed
// ---------------------------------------------------------------------------

/**
 * Record a failed fee transfer attempt. Increments attempt_count.
 * If attempt_count reaches MAX_FEE_TRANSFER_ATTEMPTS, transitions to 'terminal'.
 */
export async function markFeeLedgerFailed(
  sql: Sql,
  intentId: string,
  reason: string,
): Promise<void> {
  try {
    await sql`
      UPDATE fee_ledger_entries
      SET status            = CASE
                                WHEN attempt_count + 1 >= ${MAX_FEE_TRANSFER_ATTEMPTS}
                                THEN 'terminal'
                                ELSE 'failed'
                              END,
          failure_reason    = ${reason},
          attempt_count     = attempt_count + 1,
          last_attempted_at = NOW()
      WHERE intent_id = ${intentId}::uuid
        AND status IN ('pending', 'processing', 'failed')
    `;
  } catch (err: unknown) {
    console.warn('[feeLedger] markFeeLedgerFailed failed', {
      intentId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
