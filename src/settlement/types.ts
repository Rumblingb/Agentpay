/**
 * Settlement Identity Layer — Domain Types & Constants (Phase 3)
 *
 * Single source of truth for every type, enum, and constant used by the
 * settlement identity, event, and resolution services.  No runtime
 * dependencies — pure TypeScript declarations and plain-object constants.
 *
 * Mirrors the Prisma models added in Phase 2 (prisma/schema.prisma):
 *   SettlementIdentity  → SettlementIdentityRow / SettlementIdentityRecord
 *   MatchingPolicy      → MatchingPolicyRow / MatchingPolicyRecord
 *   SettlementEvent     → SettlementEventRow / SettlementEventRecord
 *   IntentResolution    → IntentResolutionRow / IntentResolutionRecord
 *
 * Naming convention (consistent with existing services in this repo):
 *   *Row    — raw shape returned by a DB query (all fields present)
 *   *Record — stable public API shape (safe to serialise to callers)
 *   *Params — input parameters for a service creation call
 *
 * @module settlement/types
 */

// ---------------------------------------------------------------------------
// Enums / union types
// ---------------------------------------------------------------------------

/**
 * Every settlement protocol rail supported by AgentPay.
 * Extends SupportedPaymentProtocol (src/services/protocolRouter.ts) with
 * 'stripe' and 'agent' which are required for the hybrid settlement model.
 *
 * Intentionally a plain union (not a TypeScript enum) so tree-shaking works
 * and values are usable in runtime switch statements without an import.
 */
export type SettlementProtocol =
  | 'solana'   // Solana Pay on-chain USDC transfer
  | 'stripe'   // Stripe Checkout / Connect fiat payment
  | 'ap2'      // Agent Payment Protocol v2 (internal)
  | 'x402'     // HTTP 402 paywall gate
  | 'acp'      // Agent Communication Protocol
  | 'agent';   // Agent-to-agent network (escrow-backed)

/**
 * Runtime constant listing all valid SettlementProtocol values.
 * Use for runtime validation where a type guard alone is insufficient.
 */
export const SETTLEMENT_PROTOCOLS: readonly SettlementProtocol[] = [
  'solana',
  'stripe',
  'ap2',
  'x402',
  'acp',
  'agent',
] as const;

/** Narrow an unknown string to SettlementProtocol, returning null if invalid. */
export function toSettlementProtocol(s: unknown): SettlementProtocol | null {
  if (typeof s === 'string' && (SETTLEMENT_PROTOCOLS as readonly string[]).includes(s)) {
    return s as SettlementProtocol;
  }
  return null;
}

// ---------------------------------------------------------------------------

/**
 * How the resolver matches payment evidence to an intent.
 *
 * by_recipient   — SPL-token transfer destination must match the merchant wallet
 * by_memo        — Solana Pay memo field must equal payment_intents.verification_token
 * by_external_ref — externalRef stored on the intent or settlement_identity must
 *                   match the incoming proof identifier (Stripe session ID, AP2 token…)
 */
export type MatchStrategy = 'by_recipient' | 'by_memo' | 'by_external_ref';

export const MATCH_STRATEGIES: readonly MatchStrategy[] = [
  'by_recipient',
  'by_memo',
  'by_external_ref',
] as const;

// ---------------------------------------------------------------------------

/**
 * Lifecycle status of a SettlementIdentity record.
 * Transitions: pending → confirmed | failed | expired
 */
export type SettlementIdentityStatus = 'pending' | 'confirmed' | 'failed' | 'expired';

export const SETTLEMENT_IDENTITY_STATUSES: readonly SettlementIdentityStatus[] = [
  'pending',
  'confirmed',
  'failed',
  'expired',
] as const;

// ---------------------------------------------------------------------------

/**
 * Lifecycle step that produced a SettlementEvent record.
 *
 * hash_submitted      — agent POSTed a tx hash to /:intentId/verify
 * on_chain_confirmed  — Solana listener confirmed the tx on-chain
 * webhook_received    — Stripe (or external) webhook triggered a status update
 * resolution_failed   — resolution engine failed after exhausting retries
 * expired             — intent TTL elapsed before proof was confirmed
 * policy_mismatch     — submitted proof did not satisfy the active MatchingPolicy
 */
export type SettlementEventType =
  | 'hash_submitted'
  | 'on_chain_confirmed'
  | 'webhook_received'
  | 'resolution_failed'
  | 'expired'
  | 'policy_mismatch';

export const SETTLEMENT_EVENT_TYPES: readonly SettlementEventType[] = [
  'hash_submitted',
  'on_chain_confirmed',
  'webhook_received',
  'resolution_failed',
  'expired',
  'policy_mismatch',
] as const;

// ---------------------------------------------------------------------------

/**
 * Final outcome written to intent_resolutions once the engine closes an intent.
 *
 * confirmed — on-chain / webhook proof accepted; intent fulfilled
 * failed    — proof rejected (e.g. wrong recipient, RPC unavailable after retries)
 * disputed  — contested by payer or merchant; routed to DisputeResolverAgent
 * expired   — intent TTL elapsed with no accepted proof
 */
export type ResolutionStatus = 'confirmed' | 'failed' | 'disputed' | 'expired';

export const RESOLUTION_STATUSES: readonly ResolutionStatus[] = [
  'confirmed',
  'failed',
  'disputed',
  'expired',
] as const;

// ---------------------------------------------------------------------------

/**
 * Which subsystem wrote an IntentResolution record.
 *
 * solana_listener  — background polling loop confirmed on-chain
 * stripe_webhook   — Stripe webhook handler confirmed payment
 * ap2_confirm      — AP2 confirm endpoint closed the intent internally
 * manual           — operator or admin closed the intent via admin API
 */
export type ResolvedBy = 'solana_listener' | 'stripe_webhook' | 'ap2_confirm' | 'manual';

export const RESOLVED_BY_VALUES: readonly ResolvedBy[] = [
  'solana_listener',
  'stripe_webhook',
  'ap2_confirm',
  'manual',
] as const;

// ---------------------------------------------------------------------------

/**
 * Describes what kind of external proof is being presented.
 *
 * solana_tx_hash    — Solana transaction signature (base58, 88 chars)
 * stripe_session_id — Stripe Checkout Session ID (cs_*)
 * stripe_pi_id      — Stripe PaymentIntent ID (pi_*)
 * ap2_token         — AP2 verificationToken (APV_<ts>_<hex>)
 * acp_message_id    — ACP message identifier
 * escrow_id         — Agent-network escrow record ID
 */
export type ProofType =
  | 'solana_tx_hash'
  | 'stripe_session_id'
  | 'stripe_pi_id'
  | 'ap2_token'
  | 'acp_message_id'
  | 'escrow_id';

export const PROOF_TYPES: readonly ProofType[] = [
  'solana_tx_hash',
  'stripe_session_id',
  'stripe_pi_id',
  'ap2_token',
  'acp_message_id',
  'escrow_id',
] as const;

/** Returns the canonical ProofType for a given SettlementProtocol. */
export function defaultProofType(protocol: SettlementProtocol): ProofType {
  switch (protocol) {
    case 'solana': return 'solana_tx_hash';
    case 'stripe': return 'stripe_session_id';
    case 'ap2':    return 'ap2_token';
    case 'x402':   return 'ap2_token'; // x402 reuses the AP2 token pattern
    case 'acp':    return 'acp_message_id';
    case 'agent':  return 'escrow_id';
  }
}

// ---------------------------------------------------------------------------

/**
 * Whether agent identity is verified before creating a SettlementIdentity.
 *
 * none          — no identity check (anonymous / API-key-only flows)
 * kya_required  — agent must have a KYA record (agent_identities table)
 * pin_required  — agent must supply a valid PIN in the request
 * credential    — agent must present a VerificationCredential (issued by IdentityVerifierAgent)
 */
export type IdentityMode = 'none' | 'kya_required' | 'pin_required' | 'credential';

export const IDENTITY_MODES: readonly IdentityMode[] = [
  'none',
  'kya_required',
  'pin_required',
  'credential',
] as const;

// ---------------------------------------------------------------------------

/**
 * How the settlement amount is specified.
 *
 * exact      — payer must send the exact intent amount (default)
 * at_least   — payer must send >= intent amount (partial overpay accepted)
 * any        — any positive amount is accepted (donations, open-ended fees)
 */
export type AmountMode = 'exact' | 'at_least' | 'any';

export const AMOUNT_MODES: readonly AmountMode[] = [
  'exact',
  'at_least',
  'any',
] as const;

// ---------------------------------------------------------------------------

/**
 * Who bears the platform fee for a settlement.
 *
 * payer     — fee deducted from the amount sent by the payer
 * merchant  — fee deducted from the merchant's net payout
 * split     — fee split equally between payer and merchant
 * waived    — no platform fee (e.g. internal agent-to-agent job below threshold)
 */
export type FeeSourcePolicy = 'payer' | 'merchant' | 'split' | 'waived';

export const FEE_SOURCE_POLICIES: readonly FeeSourcePolicy[] = [
  'payer',
  'merchant',
  'split',
  'waived',
] as const;

// ---------------------------------------------------------------------------
// Domain record types
// ---------------------------------------------------------------------------

/**
 * SettlementIdentity domain record.
 * Mirrors the settlement_identities DB table (Phase 2 schema).
 * All date fields are ISO-8601 strings at the service boundary.
 */
export interface SettlementIdentityRecord {
  id: string;
  intentId: string;
  protocol: SettlementProtocol;
  externalRef: string | null;
  status: SettlementIdentityStatus;
  settledAt: string | null;     // ISO-8601 or null
  metadata: Record<string, unknown>;
  createdAt: string;            // ISO-8601
  updatedAt: string;            // ISO-8601
}

/**
 * Parameters for creating a new SettlementIdentity.
 */
export interface CreateSettlementIdentityParams {
  intentId: string;
  protocol: SettlementProtocol;
  /** Optional proof reference — may be provided at creation or submitted later. */
  externalRef?: string;
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------

/**
 * MatchingPolicy domain record.
 * Mirrors the matching_policies DB table (Phase 2 schema).
 */
export interface MatchingPolicyRecord {
  id: string;
  protocol: SettlementProtocol;
  matchStrategy: MatchStrategy;
  requireMemoMatch: boolean;
  confirmationDepth: number;
  ttlSeconds: number;
  isActive: boolean;
  config: Record<string, unknown>;
  createdAt: string;   // ISO-8601
  updatedAt: string;   // ISO-8601
}

// ---------------------------------------------------------------------------

/**
 * SettlementEvent domain record.
 * Mirrors the settlement_events DB table (Phase 2 schema).
 */
export interface SettlementEventRecord {
  id: string;
  settlementIdentityId: string | null;
  intentId: string | null;
  eventType: SettlementEventType;
  protocol: SettlementProtocol;
  externalRef: string | null;
  payload: Record<string, unknown>;
  createdAt: string;   // ISO-8601
}

/**
 * Parameters for emitting a SettlementEvent.
 */
export interface EmitSettlementEventParams {
  eventType: SettlementEventType;
  protocol: SettlementProtocol;
  /** Provide at least one of settlementIdentityId or intentId. */
  settlementIdentityId?: string;
  intentId?: string;
  externalRef?: string;
  payload?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------

/**
 * IntentResolution domain record.
 * Mirrors the intent_resolutions DB table (Phase 2 schema).
 */
export interface IntentResolutionRecord {
  id: string;
  intentId: string;
  settlementIdentityId: string | null;
  protocol: SettlementProtocol;
  resolvedBy: ResolvedBy;
  resolutionStatus: ResolutionStatus;
  externalRef: string | null;
  confirmationDepth: number | null;
  payerRef: string | null;
  resolvedAt: string;   // ISO-8601
  metadata: Record<string, unknown>;
  createdAt: string;    // ISO-8601
}

/**
 * Parameters for writing an IntentResolution.
 */
export interface ResolveIntentParams {
  intentId: string;
  protocol: SettlementProtocol;
  resolvedBy: ResolvedBy;
  resolutionStatus: ResolutionStatus;
  /** FK to the SettlementIdentity that provided the winning proof (if any). */
  settlementIdentityId?: string;
  externalRef?: string;
  confirmationDepth?: number;
  /** Protocol-specific payer reference: Solana wallet or Stripe customer ID. */
  payerRef?: string;
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Runtime assertions
// ---------------------------------------------------------------------------

/**
 * Asserts that an unknown value conforms to SettlementIdentityRecord.
 * Throws TypeError if any required field is missing or has the wrong type.
 * Consistent with assertTrustEventRecord() in trustEventService.ts.
 */
export function assertSettlementIdentityRecord(
  r: unknown,
): asserts r is SettlementIdentityRecord {
  if (typeof r !== 'object' || r === null) {
    throw new TypeError('[Settlement] SettlementIdentityRecord is not an object');
  }
  const e = r as Record<string, unknown>;
  if (typeof e.id !== 'string' || e.id.length === 0)
    throw new TypeError('[Settlement] SettlementIdentityRecord.id is missing');
  if (typeof e.intentId !== 'string' || e.intentId.length === 0)
    throw new TypeError('[Settlement] SettlementIdentityRecord.intentId is missing');
  if (toSettlementProtocol(e.protocol) === null)
    throw new TypeError(`[Settlement] SettlementIdentityRecord.protocol "${String(e.protocol)}" is invalid`);
  if (!(SETTLEMENT_IDENTITY_STATUSES as readonly unknown[]).includes(e.status))
    throw new TypeError(`[Settlement] SettlementIdentityRecord.status "${String(e.status)}" is invalid`);
}

/**
 * Asserts that an unknown value conforms to IntentResolutionRecord.
 */
export function assertIntentResolutionRecord(
  r: unknown,
): asserts r is IntentResolutionRecord {
  if (typeof r !== 'object' || r === null) {
    throw new TypeError('[Settlement] IntentResolutionRecord is not an object');
  }
  const e = r as Record<string, unknown>;
  if (typeof e.id !== 'string' || e.id.length === 0)
    throw new TypeError('[Settlement] IntentResolutionRecord.id is missing');
  if (typeof e.intentId !== 'string' || e.intentId.length === 0)
    throw new TypeError('[Settlement] IntentResolutionRecord.intentId is missing');
  if (toSettlementProtocol(e.protocol) === null)
    throw new TypeError(`[Settlement] IntentResolutionRecord.protocol "${String(e.protocol)}" is invalid`);
  if (!(RESOLUTION_STATUSES as readonly unknown[]).includes(e.resolutionStatus))
    throw new TypeError(`[Settlement] IntentResolutionRecord.resolutionStatus "${String(e.resolutionStatus)}" is invalid`);
  if (!(RESOLVED_BY_VALUES as readonly unknown[]).includes(e.resolvedBy))
    throw new TypeError(`[Settlement] IntentResolutionRecord.resolvedBy "${String(e.resolvedBy)}" is invalid`);
}
