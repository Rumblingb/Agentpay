/**
 * Verification Lookup — Workers-safe SQL helpers (Phase 7)
 *
 * Provides a structured, settlement-aware lookup chain that replaces the
 * single `transactions` table query that the original verify route depended on.
 *
 * Lookup chain (executed in order, early-exit on first hit):
 *
 *   1. settlement_events     — query by external_ref (txHash / proofId)
 *   2. intent_resolutions    — query by intent_id from step 1
 *   3. payment_intents       — query by intent_id for merchant/agent context
 *   4. transactions          — legacy fallback when no settlement event exists
 *
 * All queries are best-effort: missing tables and DB errors return null
 * without throwing, so the verify route always returns a clean response.
 *
 * The pure `deriveVerification()` function converts raw DB rows into the
 * structured VerificationStatus response shape.  It has no I/O, is easy to
 * unit-test, and makes the status-derivation logic auditable.
 *
 * Status progression
 * ──────────────────
 *
 *   unseen    — proofId not found in settlement_events OR transactions
 *   observed  — settlement event found with hash_submitted (pending)
 *   matched   — settlement event found with on_chain_confirmed / webhook_received
 *               but no resolution record yet (engine not yet run)
 *   confirmed — intent_resolutions.resolution_status = 'confirmed'
 *               OR legacy transactions.status = 'confirmed'
 *   unmatched — intent_resolutions.resolution_status = 'failed'
 *               OR settlement event with policy_mismatch / resolution_failed
 *
 * @module lib/verificationLookup
 */

import type { Sql } from './db';

// ---------------------------------------------------------------------------
// Raw row types (returned directly from postgres.js tagged queries)
// ---------------------------------------------------------------------------

export interface SettlementEventRow {
  eventId: string;
  intentId: string | null;
  settlementIdentityId: string | null;
  eventType: string;
  protocol: string;
  payload: Record<string, unknown>;
  createdAt: Date;
}

export interface IntentResolutionRow {
  resolutionId: string;
  resolutionStatus: string;
  /** Phase 6 fine-grained decision — null for pre-Phase-6 rows. */
  decisionCode: string | null;
  /** Phase 6 reason code — null for pre-Phase-6 rows. */
  reasonCode: string | null;
  /** Phase 6 confidence score — null for pre-Phase-6 rows. */
  confidenceScore: unknown;
  resolvedAt: Date;
}

export interface PaymentIntentRow {
  intentId: string;
  merchantId: string;
  agentId: string | null;
  status: string;
  createdAt: Date;
}

export interface LegacyTransactionRow {
  id: string;
  merchantId: string;
  agentId: string | null;
  status: string;
  createdAt: Date;
}

// ---------------------------------------------------------------------------
// Aggregated lookup result
// ---------------------------------------------------------------------------

/**
 * Everything the verify route needs, gathered in one place.
 * All fields are nullable — the caller uses deriveVerification() to produce
 * the final structured response.
 */
export interface VerificationLookup {
  /** Normalized settlement event found by proofId. Null if not ingested yet. */
  event: SettlementEventRow | null;
  /**
   * Intent resolution written by the Phase 6 engine.
   * Null if the engine hasn't run yet, or if no event was found.
   */
  resolution: IntentResolutionRow | null;
  /** Payment intent row for merchant/agent context. */
  intent: PaymentIntentRow | null;
  /**
   * Legacy transactions row — only populated when no settlement event exists.
   * Supports consumers that verified before the Phase 5/6 pipeline was live.
   */
  transaction: LegacyTransactionRow | null;
}

// ---------------------------------------------------------------------------
// Derived response types
// ---------------------------------------------------------------------------

/**
 * Structured verification status, independent of which DB path surfaced it.
 *
 * unseen    — proofId not seen anywhere
 * observed  — settlement event ingested (hash_submitted) but not confirmed
 * matched   — on-chain / webhook confirmed but resolution engine not yet run
 * confirmed — terminal confirmed state (resolution or legacy tx)
 * unmatched — resolution engine rejected, or policy mismatch event seen
 */
export type VerificationStatus =
  | 'unseen'
  | 'observed'
  | 'matched'
  | 'confirmed'
  | 'unmatched';

/**
 * Structured output of deriveVerification().
 * All fields are safe to JSON-serialise directly.
 */
export interface DerivedVerification {
  /** true only when status === 'confirmed'. */
  verified: boolean;
  /** Structured status — richer than the boolean verified field. */
  status: VerificationStatus;
  /** Machine-readable reason from the resolution engine, when available. */
  reasonCode: string | null;
  /** Payment intent ID, or legacy transaction ID as fallback. */
  intentId: string | null;
  merchantId: string | null;
  agentId: string | null;
  /**
   * ISO-8601 timestamp of the settlement event.
   * Uses resolvedAt when a resolution exists; otherwise event createdAt
   * or legacy transaction createdAt.
   */
  settlementTimestamp: string | null;
}

// ---------------------------------------------------------------------------
// SQL helpers — best-effort, never throw
// ---------------------------------------------------------------------------

/**
 * Query settlement_events by external_ref (the proofId / txHash).
 * Returns the most recent matching event, or null if not found.
 */
async function querySettlementEvent(
  sql: Sql,
  proofId: string,
): Promise<SettlementEventRow | null> {
  try {
    const rows = await sql<
      Array<{
        eventId: string;
        intentId: string | null;
        settlementIdentityId: string | null;
        eventType: string;
        protocol: string;
        payload: Record<string, unknown>;
        createdAt: Date;
      }>
    >`
      SELECT id                      AS "eventId",
             intent_id               AS "intentId",
             settlement_identity_id  AS "settlementIdentityId",
             event_type              AS "eventType",
             protocol,
             payload,
             created_at              AS "createdAt"
      FROM   settlement_events
      WHERE  external_ref = ${proofId}
      ORDER  BY created_at DESC
      LIMIT  1
    `;
    return rows[0] ?? null;
  } catch (err: unknown) {
    const isTableMissing =
      err instanceof Error &&
      (err.message.includes('does not exist') || err.message.includes('relation'));
    if (!isTableMissing) {
      console.warn('[verificationLookup] querySettlementEvent failed', {
        proofId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return null;
  }
}

/**
 * Query intent_resolutions by intent_id.
 * Returns the resolution record, or null if not yet written.
 */
async function queryIntentResolution(
  sql: Sql,
  intentId: string,
): Promise<IntentResolutionRow | null> {
  try {
    const rows = await sql<
      Array<{
        resolutionId: string;
        resolutionStatus: string;
        decisionCode: string | null;
        reasonCode: string | null;
        confidenceScore: unknown;
        resolvedAt: Date;
      }>
    >`
      SELECT id                AS "resolutionId",
             resolution_status AS "resolutionStatus",
             decision_code     AS "decisionCode",
             reason_code       AS "reasonCode",
             confidence_score  AS "confidenceScore",
             resolved_at       AS "resolvedAt"
      FROM   intent_resolutions
      WHERE  intent_id = ${intentId}::uuid
      LIMIT  1
    `;
    return rows[0] ?? null;
  } catch (err: unknown) {
    const isTableMissing =
      err instanceof Error &&
      (err.message.includes('does not exist') || err.message.includes('relation'));
    if (!isTableMissing) {
      console.warn('[verificationLookup] queryIntentResolution failed', {
        intentId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return null;
  }
}

/**
 * Query payment_intents by ID for merchant/agent context.
 * Returns null if the intent is not found or on error.
 */
async function queryPaymentIntent(
  sql: Sql,
  intentId: string,
): Promise<PaymentIntentRow | null> {
  try {
    const rows = await sql<
      Array<{
        intentId: string;
        merchantId: string;
        agentId: string | null;
        status: string;
        createdAt: Date;
      }>
    >`
      SELECT id          AS "intentId",
             merchant_id AS "merchantId",
             agent_id    AS "agentId",
             status,
             created_at  AS "createdAt"
      FROM   payment_intents
      WHERE  id = ${intentId}::uuid
      LIMIT  1
    `;
    return rows[0] ?? null;
  } catch (err: unknown) {
    const isTableMissing =
      err instanceof Error &&
      (err.message.includes('does not exist') || err.message.includes('relation'));
    if (!isTableMissing) {
      console.warn('[verificationLookup] queryPaymentIntent failed', {
        intentId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return null;
  }
}

/**
 * Legacy fallback: query transactions by transaction_hash.
 * Used when no settlement event is found for the proofId.
 */
async function queryLegacyTransaction(
  sql: Sql,
  txHash: string,
): Promise<LegacyTransactionRow | null> {
  try {
    const rows = await sql<
      Array<{
        id: string;
        merchantId: string;
        agentId: string | null;
        status: string;
        createdAt: Date;
      }>
    >`
      SELECT id,
             merchant_id AS "merchantId",
             agent_id    AS "agentId",
             status,
             created_at  AS "createdAt"
      FROM   transactions
      WHERE  transaction_hash = ${txHash}
      LIMIT  1
    `;
    return rows[0] ?? null;
  } catch (err: unknown) {
    const isTableMissing =
      err instanceof Error &&
      (err.message.includes('does not exist') || err.message.includes('relation'));
    if (!isTableMissing) {
      console.warn('[verificationLookup] queryLegacyTransaction failed', {
        txHash,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public: orchestrated lookup
// ---------------------------------------------------------------------------

/**
 * Run the full verification lookup chain for a proofId (txHash or proof ID).
 *
 * Execution:
 *   1. Query settlement_events by external_ref
 *   2. If found with intent_id, query intent_resolutions + payment_intents in parallel
 *   3. If no settlement event, query transactions (legacy fallback)
 *
 * All queries are best-effort — errors are logged and return null so the
 * verify route always produces a clean response, never a generic 500.
 *
 * @param sql     Per-request postgres.js connection from createDb()
 * @param proofId txHash or other proof identifier (already validated by caller)
 */
export async function lookupByProofId(
  sql: Sql,
  proofId: string,
): Promise<VerificationLookup> {
  // Step 1: check settlement pipeline
  const event = await querySettlementEvent(sql, proofId);

  if (event !== null) {
    // Settlement event found — follow the settlement chain
    const intentId = event.intentId;

    if (intentId) {
      // Parallel fetch: resolution + payment intent details
      const [resolution, intent] = await Promise.all([
        queryIntentResolution(sql, intentId),
        queryPaymentIntent(sql, intentId),
      ]);
      return { event, resolution, intent, transaction: null };
    }

    // Event found but no intent_id linkage yet (e.g. premature hash submission)
    return { event, resolution: null, intent: null, transaction: null };
  }

  // Step 2: legacy fallback — transactions table
  const transaction = await queryLegacyTransaction(sql, proofId);
  return { event: null, resolution: null, intent: null, transaction };
}

// ---------------------------------------------------------------------------
// Public: pure status derivation
// ---------------------------------------------------------------------------

/**
 * Convert a VerificationLookup into a structured DerivedVerification.
 *
 * Pure function — no I/O, no side effects.  Exported for direct unit testing.
 *
 * Decision order:
 *   1. If a resolution record exists → use resolution_status + decision_code
 *   2. If a settlement event exists → derive status from event_type
 *   3. If a legacy transaction exists → derive from transactions.status
 *   4. Nothing found → unseen
 *
 * @param lookup  The aggregated DB lookup from lookupByProofId()
 */
export function deriveVerification(lookup: VerificationLookup): DerivedVerification {
  const { event, resolution, intent, transaction } = lookup;

  // ── 1. Resolution record exists ──────────────────────────────────────────
  if (resolution !== null) {
    const resolved = resolution.resolutionStatus === 'confirmed';
    const status: VerificationStatus = resolved ? 'confirmed' : 'unmatched';

    // For negative outcomes, prefer the fine-grained reasonCode (e.g. 'recipient_mismatch')
    // set by the Phase 6 engine.  Fall back to decisionCode (e.g. 'unmatched') only when
    // reasonCode is null — this covers pre-Phase-6 records that have no reasonCode.
    const reasonCode =
      resolution.reasonCode ??
      (resolution.resolutionStatus !== 'confirmed' ? resolution.decisionCode : null);

    const settlementTimestamp = toIso(resolution.resolvedAt);

    if (intent !== null) {
      return {
        verified: resolved,
        status,
        reasonCode,
        intentId: intent.intentId,
        merchantId: intent.merchantId,
        agentId: intent.agentId,
        settlementTimestamp,
      };
    }

    // Resolution without linked intent (edge case — event had no intent_id)
    return {
      verified: resolved,
      status,
      reasonCode,
      intentId: null,
      merchantId: null,
      agentId: null,
      settlementTimestamp,
    };
  }

  // ── 2. Settlement event exists but no resolution yet ─────────────────────
  if (event !== null) {
    const status = deriveStatusFromEventType(event.eventType);
    const intentId = intent?.intentId ?? null;

    return {
      verified: false,
      status,
      reasonCode: status === 'unmatched' ? event.eventType : null,
      intentId,
      merchantId: intent?.merchantId ?? null,
      agentId: intent?.agentId ?? null,
      settlementTimestamp: toIso(event.createdAt),
    };
  }

  // ── 3. Legacy transaction found ───────────────────────────────────────────
  if (transaction !== null) {
    const verified = transaction.status === 'confirmed';
    return {
      verified,
      status: verified ? 'confirmed' : 'observed',
      reasonCode: null,
      intentId: transaction.id,
      merchantId: transaction.merchantId,
      agentId: transaction.agentId,
      settlementTimestamp: toIso(transaction.createdAt),
    };
  }

  // ── 4. Nothing found ──────────────────────────────────────────────────────
  return {
    verified: false,
    status: 'unseen',
    reasonCode: null,
    intentId: null,
    merchantId: null,
    agentId: null,
    settlementTimestamp: null,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Map a settlement event_type to a VerificationStatus.
 *
 *   on_chain_confirmed / webhook_received  → matched  (confirmed on-chain/webhook)
 *   policy_mismatch / resolution_failed    → unmatched
 *   hash_submitted / expired / other       → observed
 */
function deriveStatusFromEventType(eventType: string): VerificationStatus {
  switch (eventType) {
    case 'on_chain_confirmed':
    case 'webhook_received':
      return 'matched';
    case 'policy_mismatch':
    case 'resolution_failed':
      return 'unmatched';
    default:
      // hash_submitted, expired, or any future event type
      return 'observed';
  }
}

/** Convert a Date or string to ISO-8601, or null on invalid input. */
function toIso(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  try {
    return new Date(value).toISOString();
  } catch {
    return null;
  }
}
