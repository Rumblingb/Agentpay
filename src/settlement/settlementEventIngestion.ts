/**
 * Settlement Event Ingestion Service — Express/Node.js backend (Phase 5)
 *
 * Accepts raw protocol-specific payment proof observations and normalizes them
 * into a standard NormalizedProof shape, then persists a settlement_events
 * record using the Prisma-backed emitSettlementEvent() from Phase 3.
 *
 * For the Workers (Cloudflare) backend use
 * apps/api-edge/src/lib/settlementEventIngestion.ts instead.
 *
 * Supported protocols in Phase 5:
 *   - Solana on-chain tx observations  (ingestSolanaProof)
 *   - Stripe webhook event observations (ingestStripeProof)
 *
 * Designed for future extension:
 *   - x402: add X402Observation + normalizeX402Observation() + ingestX402Proof()
 *   - AP2:  add Ap2Observation  + normalizeAp2Observation()  + ingestAp2Proof()
 *
 * How current paths should call this service (additive — does not yet replace
 * existing handlers; call alongside the current update/webhook code):
 *
 *   Solana listener (src/services/solana-listener.ts):
 *     import { ingestSolanaProof } from '../settlement/settlementEventIngestion.js';
 *     // After the transactions table UPDATE:
 *     ingestSolanaProof({
 *       txHash: tx.transactionHash,
 *       sender: verification.payer ?? null,
 *       recipient: tx.recipientAddress,
 *       amountUsdc: tx.amountUsdc,
 *       memo: null,
 *       confirmationDepth: verification.confirmationDepth ?? 0,
 *       confirmed: true,
 *     }, { intentId: tx.paymentId });
 *
 *   Stripe webhook (src/routes/stripeWebhooks.ts):
 *     import { ingestStripeProof } from '../settlement/settlementEventIngestion.js';
 *     // After markIntentVerified() in checkout.session.completed:
 *     ingestStripeProof({
 *       stripeEventType: 'checkout.session.completed',
 *       externalId: sessionId,
 *       customerId: session.customer as string | null,
 *       connectedAccountId: null,
 *       amountTotal: session.amount_total ?? null,
 *       currency: session.currency ?? null,
 *       status: 'succeeded',
 *       metadata: (session.metadata as Record<string, unknown>) ?? {},
 *     }, { intentId: intent.id });
 *
 * @module settlement/settlementEventIngestion
 */

import { emitSettlementEvent } from './settlementEventService';

// ---------------------------------------------------------------------------
// Types — identical shapes to apps/api-edge/src/lib/settlementEventIngestion.ts
// (kept in sync by convention; update both files when adding new protocols)
// ---------------------------------------------------------------------------

/** Observed lifecycle status of a proof at the time of ingestion. */
export type ObservedStatus = 'pending' | 'confirmed' | 'failed';

/**
 * Normalized representation of a settlement payment proof.
 * Stored in settlement_events.payload JSONB.
 */
export interface NormalizedProof {
  protocol: 'solana' | 'stripe' | 'ap2' | 'x402' | 'acp' | 'agent';
  proofType:
    | 'solana_tx_hash'
    | 'stripe_session_id'
    | 'stripe_pi_id'
    | 'ap2_token'
    | 'acp_message_id'
    | 'escrow_id';
  externalRef: string;
  sender: string | null;
  recipient: string | null;
  grossAmount: number | null;
  netAmount: number | null;
  feeAmount: number | null;
  memo: string | null;
  observedStatus: ObservedStatus;
  rawPayload: Record<string, unknown>;
}

/**
 * Raw Solana transaction observation.
 * Maps to the fields available in processTransaction() / processIntent().
 */
export interface SolanaObservation {
  txHash: string;
  sender: string | null;
  recipient: string;
  amountUsdc: number;
  memo: string | null;
  confirmationDepth: number;
  confirmed: boolean;
  slot?: number;
  blockTime?: number | null;
}

/**
 * Raw Stripe webhook event observation.
 * Maps to the fields available in the checkout.session.completed and
 * payment_intent.succeeded event handlers.
 */
export interface StripeObservation {
  stripeEventType: 'checkout.session.completed' | 'payment_intent.succeeded';
  externalId: string;
  customerId: string | null;
  connectedAccountId: string | null;
  amountTotal: number | null;
  currency: string | null;
  status: 'succeeded' | 'pending' | 'canceled';
  metadata: Record<string, unknown>;
}

/** Optional FK context linking an ingested event to existing DB records. */
export interface IngestProofOpts {
  settlementIdentityId?: string;
  intentId?: string;
}

// ---------------------------------------------------------------------------
// Normalization — pure functions, identical to Workers version
// ---------------------------------------------------------------------------

/**
 * Convert a SolanaObservation into a NormalizedProof.
 * Pure — no DB access, no side effects.
 */
export function normalizeSolanaObservation(obs: SolanaObservation): NormalizedProof {
  return {
    protocol: 'solana',
    proofType: 'solana_tx_hash',
    externalRef: obs.txHash,
    sender: obs.sender,
    recipient: obs.recipient,
    grossAmount: obs.amountUsdc,
    netAmount: null,
    feeAmount: null,
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
 * Convert a StripeObservation into a NormalizedProof.
 * Pure — no DB access, no side effects.
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
    netAmount: null,
    feeAmount: null,
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
// Internal helpers
// ---------------------------------------------------------------------------

function deriveEventType(
  proof: NormalizedProof,
): 'on_chain_confirmed' | 'webhook_received' | 'hash_submitted' | 'resolution_failed' {
  if (proof.observedStatus === 'failed') return 'resolution_failed';
  if (proof.observedStatus === 'confirmed') {
    return proof.protocol === 'solana' ? 'on_chain_confirmed' : 'webhook_received';
  }
  return 'hash_submitted';
}

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

// ---------------------------------------------------------------------------
// Persistence — Express/Node.js (Prisma-backed via emitSettlementEvent)
// ---------------------------------------------------------------------------

/**
 * Normalize a SolanaObservation and emit a settlement event.
 *
 * Returns the generated event ID immediately (fire-and-forget DB write via
 * emitSettlementEvent). The caller does NOT need to await this.
 *
 * @param obs   Raw Solana tx observation from the listener or /verify endpoint.
 * @param opts  Optional FK context (intentId, settlementIdentityId).
 */
export function ingestSolanaProof(obs: SolanaObservation, opts?: IngestProofOpts): string {
  const proof = normalizeSolanaObservation(obs);
  return emitSettlementEvent({
    eventType: deriveEventType(proof),
    protocol: 'solana',
    settlementIdentityId: opts?.settlementIdentityId,
    intentId: opts?.intentId,
    externalRef: proof.externalRef,
    payload: buildPayloadBlob(proof),
  });
}

/**
 * Normalize a StripeObservation and emit a settlement event.
 *
 * Returns the generated event ID immediately (fire-and-forget DB write via
 * emitSettlementEvent). The caller does NOT need to await this.
 *
 * @param obs   Raw Stripe event observation from the webhook handler.
 * @param opts  Optional FK context (intentId, settlementIdentityId).
 */
export function ingestStripeProof(obs: StripeObservation, opts?: IngestProofOpts): string {
  const proof = normalizeStripeObservation(obs);
  return emitSettlementEvent({
    eventType: deriveEventType(proof),
    protocol: 'stripe',
    settlementIdentityId: opts?.settlementIdentityId,
    intentId: opts?.intentId,
    externalRef: proof.externalRef,
    payload: buildPayloadBlob(proof),
  });
}
