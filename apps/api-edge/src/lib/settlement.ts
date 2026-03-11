/**
 * Settlement Identity Layer — Workers-compatible shared types (Phase 3)
 *
 * This file is the Cloudflare Workers / Hono equivalent of
 * src/settlement/types.ts.  It contains only TypeScript type declarations
 * and plain-object constants — zero Node.js dependencies — so it is safe
 * to import in any Workers route or lib file.
 *
 * Kept in sync with src/settlement/types.ts by convention.
 * When adding a new protocol or status value, update BOTH files.
 *
 * @module lib/settlement
 */

// ---------------------------------------------------------------------------
// Enums / union types  (mirrored from src/settlement/types.ts)
// ---------------------------------------------------------------------------

export type SettlementProtocol =
  | 'solana'
  | 'stripe'
  | 'ap2'
  | 'x402'
  | 'acp'
  | 'agent';

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

export type MatchStrategy = 'by_recipient' | 'by_memo' | 'by_external_ref';

export const MATCH_STRATEGIES: readonly MatchStrategy[] = [
  'by_recipient',
  'by_memo',
  'by_external_ref',
] as const;

// ---------------------------------------------------------------------------

export type SettlementIdentityStatus = 'pending' | 'confirmed' | 'failed' | 'expired';

export const SETTLEMENT_IDENTITY_STATUSES: readonly SettlementIdentityStatus[] = [
  'pending',
  'confirmed',
  'failed',
  'expired',
] as const;

// ---------------------------------------------------------------------------

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

export type ResolutionStatus = 'confirmed' | 'failed' | 'disputed' | 'expired';

export const RESOLUTION_STATUSES: readonly ResolutionStatus[] = [
  'confirmed',
  'failed',
  'disputed',
  'expired',
] as const;

// ---------------------------------------------------------------------------

export type ResolvedBy = 'solana_listener' | 'stripe_webhook' | 'ap2_confirm' | 'manual';

export const RESOLVED_BY_VALUES: readonly ResolvedBy[] = [
  'solana_listener',
  'stripe_webhook',
  'ap2_confirm',
  'manual',
] as const;

// ---------------------------------------------------------------------------

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
    case 'x402':   return 'ap2_token';
    case 'acp':    return 'acp_message_id';
    case 'agent':  return 'escrow_id';
  }
}

// ---------------------------------------------------------------------------

export type IdentityMode = 'none' | 'kya_required' | 'pin_required' | 'credential';

export const IDENTITY_MODES: readonly IdentityMode[] = [
  'none',
  'kya_required',
  'pin_required',
  'credential',
] as const;

// ---------------------------------------------------------------------------

export type AmountMode = 'exact' | 'at_least' | 'any';

export const AMOUNT_MODES: readonly AmountMode[] = [
  'exact',
  'at_least',
  'any',
] as const;

// ---------------------------------------------------------------------------

export type FeeSourcePolicy = 'payer' | 'merchant' | 'split' | 'waived';

export const FEE_SOURCE_POLICIES: readonly FeeSourcePolicy[] = [
  'payer',
  'merchant',
  'split',
  'waived',
] as const;

// ---------------------------------------------------------------------------
// Domain record types  (mirrored from src/settlement/types.ts)
// ---------------------------------------------------------------------------

export interface SettlementIdentityRecord {
  id: string;
  intentId: string;
  protocol: SettlementProtocol;
  externalRef: string | null;
  status: SettlementIdentityStatus;
  settledAt: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSettlementIdentityParams {
  intentId: string;
  protocol: SettlementProtocol;
  externalRef?: string;
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------

export interface MatchingPolicyRecord {
  id: string;
  protocol: SettlementProtocol;
  matchStrategy: MatchStrategy;
  requireMemoMatch: boolean;
  confirmationDepth: number;
  ttlSeconds: number;
  isActive: boolean;
  config: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------

export interface SettlementEventRecord {
  id: string;
  settlementIdentityId: string | null;
  intentId: string | null;
  eventType: SettlementEventType;
  protocol: SettlementProtocol;
  externalRef: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface EmitSettlementEventParams {
  eventType: SettlementEventType;
  protocol: SettlementProtocol;
  settlementIdentityId?: string;
  intentId?: string;
  externalRef?: string;
  payload?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------

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
  resolvedAt: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface ResolveIntentParams {
  intentId: string;
  protocol: SettlementProtocol;
  resolvedBy: ResolvedBy;
  resolutionStatus: ResolutionStatus;
  settlementIdentityId?: string;
  externalRef?: string;
  confirmationDepth?: number;
  payerRef?: string;
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Runtime assertions (Workers-safe — no Node.js APIs)
// ---------------------------------------------------------------------------

export function assertSettlementIdentityRecord(
  r: unknown,
): asserts r is SettlementIdentityRecord {
  if (typeof r !== 'object' || r === null)
    throw new TypeError('[Settlement] SettlementIdentityRecord is not an object');
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

export function assertIntentResolutionRecord(
  r: unknown,
): asserts r is IntentResolutionRecord {
  if (typeof r !== 'object' || r === null)
    throw new TypeError('[Settlement] IntentResolutionRecord is not an object');
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
