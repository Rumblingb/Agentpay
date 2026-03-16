/**
 * Settlement Database Helpers — Workers-safe SQL helpers (Phase 4)
 *
 * Provides three building blocks for intent creation:
 *
 *   insertSettlementIdentity   — inserts one row into settlement_identities
 *   lookupActiveMatchingPolicy — queries the active row for a protocol
 *   resolveMatchingPolicy      — DB lookup with a hard-coded fallback
 *
 * All functions are best-effort: they catch errors and return null / a
 * hard-coded default so that a settlement bookkeeping failure never causes
 * intent creation to fail.
 *
 * Design:
 *   - No Node.js-specific imports — all imports are `import type` (erased at
 *     build time) so the file is safe for both the Workers runtime and Jest.
 *   - The `sql` connection is provided by the caller so each function can
 *     reuse the same per-request connection already open in the route handler.
 *
 * @module lib/settlementDb
 */

import type { Sql } from './db';
import type { SettlementProtocol, MatchStrategy } from './settlement';

// ---------------------------------------------------------------------------
// Extended matching policy
// ---------------------------------------------------------------------------

/**
 * Matching policy record enriched with Phase 4 config-derived fields.
 * The base fields mirror matching_policies columns; the extended fields are
 * read from the `config` JSONB column and promoted to top-level for easy
 * response serialisation.
 */
export interface ExtendedMatchingPolicy {
  id: string;
  protocol: SettlementProtocol;
  matchStrategy: MatchStrategy;
  /** When true the Solana Pay memo MUST equal payment_intents.verification_token. */
  requireMemoMatch: boolean;
  /** Minimum on-chain confirmations before marking a Solana payment confirmed. */
  confirmationDepth: number;
  /** Seconds from intent creation until auto-expiry. */
  ttlSeconds: number;
  isActive: boolean;
  /** Raw config JSONB column. */
  config: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  // ── Phase 4 extended fields (derived from config JSONB) ─────────────────
  /** Where settlement proof may originate. */
  allowedProofSource: 'onchain' | 'webhook' | 'oracle';
  /** Agent identity requirement at intent-creation time. */
  identityMode: 'none' | 'kya_required' | 'pin_required' | 'credential';
  /** Whether the payer must send the exact gross amount. */
  amountMode: 'exact' | 'at_least' | 'any';
  /** Who bears the platform fee. */
  feeSourcePolicy: 'payer' | 'merchant' | 'split' | 'waived';
}

// ---------------------------------------------------------------------------
// Phase 4 Solana-beta hard-coded defaults
//
// Used when the matching_policies table has no active Solana row, or when
// the DB is unreachable during intent creation.
//
// Values implement the Phase 4 Solana beta specification:
//   - direct wallet-to-wallet (non-custodial)
//   - recipient address identifies the merchant (by_recipient strategy)
//   - Solana Pay memo must equal the verificationToken
//   - only on-chain proofs accepted
//   - payer bears the platform fee
// ---------------------------------------------------------------------------

export const SOLANA_BETA_DEFAULT_POLICY: Readonly<ExtendedMatchingPolicy> = Object.freeze({
  id: '',
  protocol: 'solana' as SettlementProtocol,
  matchStrategy: 'by_recipient' as MatchStrategy,
  requireMemoMatch: true,   // memo MUST equal verificationToken
  confirmationDepth: 2,
  ttlSeconds: 1800,         // 30 min — matches the intent expiry TTL
  isActive: true,
  config: {
    token: 'USDC',
    network: 'mainnet-beta',
    allowedProofSource: 'onchain',
    identityMode: 'none',
    amountMode: 'exact',
    feeSourcePolicy: 'payer',
  },
  createdAt: '',
  updatedAt: '',
  allowedProofSource: 'onchain',
  identityMode: 'none',
  amountMode: 'exact',
  feeSourcePolicy: 'payer',
});

/**
 * Hard-coded fallback for any protocol (only Solana has a full Phase 4 spec).
 */
function hardCodedDefault(protocol: SettlementProtocol): ExtendedMatchingPolicy {
  if (protocol === 'solana') return { ...SOLANA_BETA_DEFAULT_POLICY };
  return {
    id: '',
    protocol,
    matchStrategy: 'by_external_ref',
    requireMemoMatch: false,
    confirmationDepth: 0,
    ttlSeconds: 1800,
    isActive: true,
    config: {},
    createdAt: '',
    updatedAt: '',
    allowedProofSource: 'webhook',
    identityMode: 'none',
    amountMode: 'exact',
    feeSourcePolicy: 'payer',
  };
}

// ---------------------------------------------------------------------------
// lookupActiveMatchingPolicy
// ---------------------------------------------------------------------------

/**
 * Query the matching_policies table for the active row for a given protocol.
 *
 * Returns null when:
 *   - the table does not exist (migration not yet applied)
 *   - no active row exists for the protocol
 *   - the DB is unreachable
 *
 * Never throws.
 */
export async function lookupActiveMatchingPolicy(
  sql: Sql,
  protocol: SettlementProtocol,
): Promise<ExtendedMatchingPolicy | null> {
  try {
    const rows = await sql<
      Array<{
        id: string;
        protocol: string;
        matchStrategy: string;
        requireMemoMatch: boolean;
        confirmationDepth: number;
        ttlSeconds: number;
        isActive: boolean;
        config: Record<string, unknown>;
        createdAt: Date;
        updatedAt: Date;
      }>
    >`
      SELECT id,
             protocol,
             match_strategy       AS "matchStrategy",
             require_memo_match   AS "requireMemoMatch",
             confirmation_depth   AS "confirmationDepth",
             ttl_seconds          AS "ttlSeconds",
             is_active            AS "isActive",
             config,
             created_at           AS "createdAt",
             updated_at           AS "updatedAt"
      FROM   matching_policies
      WHERE  protocol  = ${protocol}
        AND  is_active = true
      ORDER  BY created_at DESC
      LIMIT  1
    `;

    if (!rows.length) return null;

    const row = rows[0];
    const cfg = (row.config as Record<string, unknown>) ?? {};

    return {
      id: row.id,
      protocol: row.protocol as SettlementProtocol,
      matchStrategy: row.matchStrategy as MatchStrategy,
      requireMemoMatch: row.requireMemoMatch,
      confirmationDepth: row.confirmationDepth,
      ttlSeconds: row.ttlSeconds,
      isActive: row.isActive,
      config: cfg,
      createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
      updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : String(row.updatedAt),
      allowedProofSource:
        (cfg.allowedProofSource as 'onchain' | 'webhook' | 'oracle' | undefined) ?? 'onchain',
      identityMode:
        (cfg.identityMode as 'none' | 'kya_required' | 'pin_required' | 'credential' | undefined) ?? 'none',
      amountMode:
        (cfg.amountMode as 'exact' | 'at_least' | 'any' | undefined) ?? 'exact',
      feeSourcePolicy:
        (cfg.feeSourcePolicy as 'payer' | 'merchant' | 'split' | 'waived' | undefined) ?? 'payer',
    };
  } catch (err: unknown) {
    const isTableMissing =
      err instanceof Error &&
      (err.message.includes('does not exist') || err.message.includes('relation'));
    if (!isTableMissing) {
      console.warn('[settlementDb] lookupActiveMatchingPolicy failed', {
        protocol,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return null;
  }
}

// ---------------------------------------------------------------------------
// insertSettlementIdentity
// ---------------------------------------------------------------------------

export interface InsertSettlementIdentityParams {
  intentId: string;
  protocol: SettlementProtocol;
  /** Snapshot of the matching policy active at intent-creation time. */
  policySnapshot?: Record<string, unknown>;
}

export interface SettlementIdentityRow {
  id: string;
  intentId: string;
  protocol: string;
  status: 'pending';
  createdAt: string;
}

/**
 * Insert a settlement_identities row for a newly-created payment intent.
 *
 * Returns the inserted row, or null on failure (table missing, FK violation,
 * etc.). Never throws — a settlement write failure must not fail intent creation.
 */
export async function insertSettlementIdentity(
  sql: Sql,
  params: InsertSettlementIdentityParams,
): Promise<SettlementIdentityRow | null> {
  const { intentId, protocol, policySnapshot } = params;
  const id = crypto.randomUUID();
  const metadata = policySnapshot ?? {};

  try {
    const rows = await sql<Array<{ id: string; createdAt: Date }>>`
      INSERT INTO settlement_identities
        (id, intent_id, protocol, status, metadata, created_at, updated_at)
      VALUES
        (${id}::uuid, ${intentId}::uuid, ${protocol}, 'pending',
         ${JSON.stringify(metadata)}::jsonb,
         NOW(), NOW())
      RETURNING id, created_at AS "createdAt"
    `;

    const row = rows[0];
    if (!row) return null;

    return {
      id: row.id,
      intentId,
      protocol,
      status: 'pending',
      createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
    };
  } catch (err: unknown) {
    const isTableMissing =
      err instanceof Error &&
      (err.message.includes('does not exist') || err.message.includes('relation'));
    if (!isTableMissing) {
      console.warn('[settlementDb] insertSettlementIdentity failed', {
        intentId,
        protocol,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return null;
  }
}

// ---------------------------------------------------------------------------
// resolveMatchingPolicy
// ---------------------------------------------------------------------------

/**
 * Look up the active matching policy for a protocol, falling back to the
 * hard-coded default when the DB lookup returns nothing.
 *
 * Always returns a policy — never null — so intent creation can always
 * include settlement metadata in the response.
 */
export async function resolveMatchingPolicy(
  sql: Sql,
  protocol: SettlementProtocol,
): Promise<ExtendedMatchingPolicy> {
  const dbPolicy = await lookupActiveMatchingPolicy(sql, protocol);
  return dbPolicy ?? hardCodedDefault(protocol);
}
