/**
 * Settlement Event Ingestion Service — Workers-safe (Phase 5)
 *
 * Accepts raw protocol-specific payment proof observations and normalizes them
 * into a standard NormalizedProof shape, then persists a settlement_events
 * record using the per-request postgres.js connection.
 *
 * Supported protocols in Phase 5:
 *   - Solana on-chain tx observations  (via solana-listener or /verify endpoint)
 *   - Stripe webhook event observations (checkout.session.completed,
 *                                         payment_intent.succeeded)
 *
 * Designed for future extension — add a new *Observation type and
 * normalize*() function for each new protocol:
 *   - x402: add X402Observation + normalizeX402Observation()
 *   - AP2:  add Ap2Observation  + normalizeAp2Observation()
 *
 * Architecture:
 *   - Normalization functions are pure (no DB, no side effects).
 *   - persistNormalizedProof() is best-effort: errors are logged and null is
 *     returned; the function never throws.
 *   - The `sql` connection is provided by the caller to reuse the per-request
 *     connection already open in route handlers.
 *
 * How current Solana and Stripe paths should call this service:
 *
 *   Solana listener (apps/api-edge, future integration):
 *     import { normalizeSolanaObservation, persistNormalizedProof }
 *       from '../lib/settlementEventIngestion';
 *     const proof = normalizeSolanaObservation({
 *       txHash, sender, recipient, amountUsdc, memo,
 *       confirmationDepth, confirmed,
 *     });
 *     await persistNormalizedProof(sql, proof, { intentId, settlementIdentityId });
 *
 *   Stripe webhook (apps/api-edge/src/routes/stripeWebhooks.ts, future):
 *     import { normalizeStripeObservation, persistNormalizedProof }
 *       from '../lib/settlementEventIngestion';
 *     const proof = normalizeStripeObservation({
 *       stripeEventType: event.type,
 *       externalId: session.id,
 *       customerId: session.customer as string | null,
 *       connectedAccountId: null,
 *       amountTotal: session.amount_total,
 *       currency: session.currency,
 *       status: 'succeeded',
 *       metadata: session.metadata ?? {},
 *     });
 *     await persistNormalizedProof(sql, proof, { intentId: intent.id });
 *
 * @module lib/settlementEventIngestion
 */

import type { Sql } from './db';
import type { SettlementProtocol } from './settlement';

// ---------------------------------------------------------------------------
// NormalizedProof — the canonical settlement event payload shape
// ---------------------------------------------------------------------------

/** Observed lifecycle status of a proof at the time of ingestion. */
export type ObservedStatus = 'pending' | 'confirmed' | 'failed';

/**
 * Normalized representation of a settlement payment proof.
 *
 * Produced by normalizeSolanaObservation() and normalizeStripeObservation().
 * Stored in the settlement_events.payload JSONB column alongside raw protocol
 * data, so downstream consumers only need to read the normalized fields.
 *
 * Monetary units are protocol-native:
 *   - Solana: USDC human-readable float (e.g. 12.50 = $12.50)
 *   - Stripe: integer cents (as returned by the Stripe API, e.g. 1250 = $12.50)
 *
 * Null fields are explicitly present (never omitted) so consumers can tell the
 * difference between "this field is not applicable" and "data was not received".
 */
export interface NormalizedProof {
  /** Settlement protocol rail. */
  protocol: SettlementProtocol;
  /** Proof-type discriminator — used for routing to the correct verifier. */
  proofType:
    | 'solana_tx_hash'
    | 'stripe_session_id'
    | 'stripe_pi_id'
    | 'ap2_token'       // Reserved — not used in Phase 5
    | 'acp_message_id'  // Reserved — not used in Phase 5
    | 'escrow_id';      // Reserved — not used in Phase 5
  /** Primary proof identifier (Solana tx hash, Stripe session ID, etc.). */
  externalRef: string;
  /** Sender: Solana payer wallet address or Stripe customer ID (cus_…). */
  sender: string | null;
  /** Recipient: Solana merchant wallet address or Stripe connected account (acct_…). */
  recipient: string | null;
  /** Gross amount in protocol-native units (USDC float or Stripe cents). */
  grossAmount: number | null;
  /** Net amount after platform fees — null if not yet calculated at ingestion. */
  netAmount: number | null;
  /** Fee amount (platform + network) — null if not yet calculated at ingestion. */
  feeAmount: number | null;
  /** Memo or reference: Solana Pay memo field or Stripe metadata.reference. */
  memo: string | null;
  /** Payment lifecycle status as observed at ingestion time. */
  observedStatus: ObservedStatus;
  /** Complete raw protocol-specific data for audit and replay purposes. */
  rawPayload: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// SolanaObservation — raw Solana tx observation input
// ---------------------------------------------------------------------------

/**
 * Raw Solana transaction observation as received by the Solana listener
 * or the /verify endpoint.
 *
 * Pass all available RPC fields to maximise auditability. Optional fields
 * (slot, blockTime) are included in rawPayload when present.
 */
export interface SolanaObservation {
  /** On-chain transaction signature (base-58 encoded). */
  txHash: string;
  /** Payer wallet address. Null when the RPC hasn't returned it yet. */
  sender: string | null;
  /** Merchant wallet address (SPL token recipient). */
  recipient: string;
  /** Amount transferred in USDC (human-readable float, e.g. 10.5 = $10.50). */
  amountUsdc: number;
  /** Solana Pay memo field — should equal payment_intents.verification_token. */
  memo: string | null;
  /** Number of on-chain confirmations observed at this point. */
  confirmationDepth: number;
  /** True when confirmationDepth >= the matching policy's required depth. */
  confirmed: boolean;
  /** Solana slot number (for deduplication and ordering). */
  slot?: number;
  /** Unix timestamp of the block in seconds (from RPC getTransaction). */
  blockTime?: number | null;
}

// ---------------------------------------------------------------------------
// StripeObservation — raw Stripe event observation input
// ---------------------------------------------------------------------------

/**
 * Raw Stripe webhook event observation.
 *
 * The caller maps Stripe's event.data.object fields to this shape.
 * Only the two payment-completion events handled by stripeWebhooks.ts are
 * supported in Phase 5; extend stripeEventType for new event types.
 */
export interface StripeObservation {
  /** Stripe event type (discriminator for proofType mapping). */
  stripeEventType: 'checkout.session.completed' | 'payment_intent.succeeded';
  /** Stripe session ID (cs_…) or payment intent ID (pi_…). */
  externalId: string;
  /** Stripe customer ID (cus_…), if available on the event object. */
  customerId: string | null;
  /** Stripe Connect account ID (acct_…), if a Connect merchant. */
  connectedAccountId: string | null;
  /** Payment amount in smallest currency unit (cents for USD). */
  amountTotal: number | null;
  /** ISO-4217 currency code lowercase (e.g. 'usd'). */
  currency: string | null;
  /** Observed payment status at webhook delivery time. */
  status: 'succeeded' | 'pending' | 'canceled';
  /** Stripe metadata key-value pairs on the event object. */
  metadata: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Normalization — pure functions, no I/O, easy to unit-test
// ---------------------------------------------------------------------------

/**
 * Convert a raw SolanaObservation into a canonical NormalizedProof.
 *
 * Pure function — no DB access, no side effects.
 *
 * @example
 * const proof = normalizeSolanaObservation({
 *   txHash: '5UXkL...abc',
 *   sender: 'PayerWallet111111111111111111111111111111111',
 *   recipient: 'MerchWallet111111111111111111111111111111111',
 *   amountUsdc: 12.5,
 *   memo: 'APV_1700000000000_deadbeef',
 *   confirmationDepth: 32,
 *   confirmed: true,
 * });
 * // proof.protocol    === 'solana'
 * // proof.proofType   === 'solana_tx_hash'
 * // proof.externalRef === '5UXkL...abc'
 * // proof.grossAmount === 12.5
 */
export function normalizeSolanaObservation(obs: SolanaObservation): NormalizedProof {
  return {
    protocol: 'solana',
    proofType: 'solana_tx_hash',
    externalRef: obs.txHash,
    sender: obs.sender,
    recipient: obs.recipient,
    grossAmount: obs.amountUsdc,
    netAmount: null,   // Not calculated at ingestion time
    feeAmount: null,   // Not calculated at ingestion time
    memo: obs.memo,
    observedStatus: obs.confirmed ? 'confirmed' : 'pending',
    rawPayload: {
      txHash: obs.txHash,
      sender: obs.sender,
      recipient: obs.recipient,
      amountUsdc: obs.amountUsdc,
      memo: obs.memo,
      confirmationDepth: obs.confirmationDepth,
      confirmed: obs.confirmed,
      ...(obs.slot !== undefined ? { slot: obs.slot } : {}),
      ...(obs.blockTime !== undefined ? { blockTime: obs.blockTime } : {}),
    },
  };
}

/**
 * Convert a raw StripeObservation into a canonical NormalizedProof.
 *
 * Pure function — no DB access, no side effects.
 *
 * The proofType is inferred from the event type:
 *   checkout.session.completed → stripe_session_id
 *   payment_intent.succeeded   → stripe_pi_id
 *
 * @example
 * const proof = normalizeStripeObservation({
 *   stripeEventType: 'checkout.session.completed',
 *   externalId: 'cs_test_abc123',
 *   customerId: 'cus_xyz',
 *   connectedAccountId: 'acct_abc',
 *   amountTotal: 1250,
 *   currency: 'usd',
 *   status: 'succeeded',
 *   metadata: { reference: 'order-42' },
 * });
 * // proof.protocol    === 'stripe'
 * // proof.proofType   === 'stripe_session_id'
 * // proof.grossAmount === 1250  (cents)
 * // proof.memo        === 'order-42'
 */
export function normalizeStripeObservation(obs: StripeObservation): NormalizedProof {
  const proofType =
    obs.stripeEventType === 'checkout.session.completed' ? 'stripe_session_id' : 'stripe_pi_id';

  const observedStatus: ObservedStatus =
    obs.status === 'succeeded' ? 'confirmed'
    : obs.status === 'canceled' ? 'failed'
    : 'pending';

  return {
    protocol: 'stripe',
    proofType,
    externalRef: obs.externalId,
    sender: obs.customerId,
    recipient: obs.connectedAccountId,
    grossAmount: obs.amountTotal,
    netAmount: null,   // Not calculated at ingestion time
    feeAmount: null,   // Not calculated at ingestion time
    memo: (obs.metadata?.reference as string | undefined) ?? null,
    observedStatus,
    rawPayload: {
      stripeEventType: obs.stripeEventType,
      externalId: obs.externalId,
      customerId: obs.customerId,
      connectedAccountId: obs.connectedAccountId,
      amountTotal: obs.amountTotal,
      currency: obs.currency,
      status: obs.status,
      metadata: obs.metadata,
    },
  };
}

// ---------------------------------------------------------------------------
// Persistence — Workers-safe SQL writer
// ---------------------------------------------------------------------------

/** Optional context that links the ingested event to existing DB records. */
export interface PersistNormalizedProofOpts {
  /** FK to settlement_identities.id — links to the identity created at intent time. */
  settlementIdentityId?: string;
  /** FK to payment_intents.id — denormalised for fast per-intent event queries. */
  intentId?: string;
}

/** Returned by persistNormalizedProof on a successful DB write. */
export interface PersistedEventRef {
  eventId: string;
}

/**
 * Write a NormalizedProof to the settlement_events table.
 *
 * Best-effort: errors are caught and logged. The function returns null on
 * failure and never throws, so callers do not need to guard against it.
 *
 * The settlement_events.event_type is derived from the proof's
 * protocol + observedStatus combination:
 *   solana  + confirmed → 'on_chain_confirmed'
 *   stripe  + confirmed → 'webhook_received'
 *   any     + pending   → 'hash_submitted'
 *   any     + failed    → 'resolution_failed'
 *
 * Normalized fields are inlined at the top level of the payload JSONB,
 * with the complete raw protocol data stored under the 'raw' key.
 *
 * @param sql   Per-request postgres.js connection (from createDb()).
 * @param proof Normalized proof produced by normalizeSolana/StripeObservation().
 * @param opts  Optional FK context for linking to existing records.
 */
export async function persistNormalizedProof(
  sql: Sql,
  proof: NormalizedProof,
  opts?: PersistNormalizedProofOpts,
): Promise<PersistedEventRef | null> {
  const eventId = crypto.randomUUID();
  const eventType = deriveEventType(proof);
  const settlementIdentityId = opts?.settlementIdentityId ?? null;
  const intentId = opts?.intentId ?? null;
  const payloadBlob = buildPayloadBlob(proof);

  try {
    await sql`
      INSERT INTO settlement_events
        (id, settlement_identity_id, intent_id, event_type, protocol,
         external_ref, payload, created_at)
      VALUES
        (${eventId},
         ${settlementIdentityId},
         ${intentId},
         ${eventType},
         ${proof.protocol},
         ${proof.externalRef},
         ${JSON.stringify(payloadBlob)}::jsonb,
         NOW())
    `;
    return { eventId };
  } catch (err: unknown) {
    const isTableMissing =
      err instanceof Error &&
      (err.message.includes('does not exist') || err.message.includes('relation'));
    if (!isTableMissing) {
      console.warn('[settlementEventIngestion] persistNormalizedProof failed', {
        eventId,
        protocol: proof.protocol,
        externalRef: proof.externalRef,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return null;
  }
}

// ---------------------------------------------------------------------------
// Internal helpers (not exported)
// ---------------------------------------------------------------------------

/**
 * Map a NormalizedProof's protocol + observedStatus to a SettlementEventType
 * string for the settlement_events.event_type column.
 */
function deriveEventType(proof: NormalizedProof): string {
  if (proof.observedStatus === 'failed') return 'resolution_failed';
  if (proof.observedStatus === 'confirmed') {
    return proof.protocol === 'solana' ? 'on_chain_confirmed' : 'webhook_received';
  }
  // pending
  return 'hash_submitted';
}

/**
 * Build the JSONB blob for settlement_events.payload.
 *
 * Normalized fields are promoted to the top level for queryability;
 * the full raw protocol payload is nested under the 'raw' key.
 */
function buildPayloadBlob(proof: NormalizedProof): Record<string, unknown> {
  return {
    proofType: proof.proofType,
    sender: proof.sender,
    recipient: proof.recipient,
    grossAmount: proof.grossAmount,
    netAmount: proof.netAmount,
    feeAmount: proof.feeAmount,
    memo: proof.memo,
    observedStatus: proof.observedStatus,
    raw: proof.rawPayload,
  };
}
