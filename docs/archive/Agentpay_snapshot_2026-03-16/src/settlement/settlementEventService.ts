/**
 * Settlement Event Service (Phase 3)
 *
 * Emits append-only SettlementEvent records to the settlement_events table.
 * Mirrors the pattern of trustEventService.ts:recordTrustEvent() — all writes
 * are best-effort; a failure never blocks the caller's settlement path.
 *
 * Design decisions:
 *   - emitSettlementEvent() is always fire-and-forget from the caller's
 *     perspective.  It returns the event ID so callers can log it, but
 *     it MUST NOT be awaited in hot paths (Solana listener, Stripe webhook).
 *   - The intentId field is denormalised for fast per-intent queries without
 *     requiring a join through settlement_identities.
 *   - Events with settlementIdentityId=null are valid (e.g. a hash_submitted
 *     event arrives before the SettlementIdentity row is created).
 *
 * @module settlement/settlementEventService
 */

import crypto from 'crypto';
import prisma from '../lib/prisma.js';
import { logger } from '../logger.js';
import type {
  EmitSettlementEventParams,
  SettlementEventRecord,
  SettlementEventType,
  SettlementProtocol,
} from './types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toRecord(row: {
  id: string;
  settlementIdentityId: string | null;
  intentId: string | null;
  eventType: string;
  protocol: string;
  externalRef: string | null;
  payload: unknown;
  proofSource?: string | null;
  rawProofSignature?: string | null;
  details?: unknown;
  observedAt?: Date | null;
  createdAt: Date;
}): SettlementEventRecord {
  return {
    id: row.id,
    settlementIdentityId: row.settlementIdentityId,
    intentId: row.intentId,
    eventType: row.eventType as SettlementEventType,
    protocol: row.protocol as SettlementProtocol,
    externalRef: row.externalRef,
    payload: (row.payload as Record<string, unknown>) ?? {},
    proofSource: row.proofSource ?? null,
    rawProofSignature: row.rawProofSignature ?? null,
    details: (row.details as Record<string, unknown> | null) ?? null,
    observedAt: row.observedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Service functions
// ---------------------------------------------------------------------------

/**
 * Emit a settlement lifecycle event.
 *
 * - Always best-effort: if the DB write fails the event is logged and the
 *   error is swallowed, consistent with how trustEventService.ts works.
 * - Returns the generated event ID (cuid) immediately, before the async
 *   write completes, so callers can include it in their own log lines.
 *
 * @example
 * // Fire-and-forget in a Solana listener confirmation path:
 * const eventId = emitSettlementEvent({
 *   eventType: 'on_chain_confirmed',
 *   protocol: 'solana',
 *   settlementIdentityId: identity.id,
 *   intentId: intent.id,
 *   externalRef: txHash,
 *   payload: { confirmationDepth, payer },
 * });
 * // Do NOT await this — proceed with the DB updates immediately.
 */
export function emitSettlementEvent(params: EmitSettlementEventParams): string {
  const id = crypto.randomUUID();

  const {
    eventType,
    protocol,
    settlementIdentityId,
    intentId,
    externalRef,
    payload,
    proofSource,
    rawProofSignature,
    details,
    observedAt,
  } = params;

  // Fire-and-forget — never block the caller
  prisma.settlementEvent
    .create({
      data: {
        id,
        eventType,
        protocol,
        settlementIdentityId: settlementIdentityId ?? null,
        intentId: intentId ?? null,
        externalRef: externalRef ?? null,
        payload: (payload ?? {}) as object,
        proofSource: proofSource ?? null,
        rawProofSignature: rawProofSignature ?? null,
        details: details ? (details as object) : undefined,
        observedAt: observedAt ?? null,
      },
    })
    .then(() => {
      logger.debug('[SettlementEvent] emitted', { id, eventType, protocol, intentId });
    })
    .catch((err: unknown) => {
      // Table might not exist yet on first deploy — swallow gracefully
      const isTableMissing =
        (err instanceof Error && err.message.includes('does not exist')) ||
        (err as { code?: string })?.code === 'P2021';
      if (!isTableMissing) {
        logger.warn('[SettlementEvent] emit failed', {
          id,
          eventType,
          protocol,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });

  return id;
}

/**
 * List settlement events for a given intent, newest first.
 * Useful for debugging and audit endpoints.
 *
 * @param intentId  - Filter to a specific intent
 * @param limit     - Max results (default 50, max 200)
 */
export async function listEventsByIntent(
  intentId: string,
  limit = 50,
): Promise<SettlementEventRecord[]> {
  const cap = Math.min(200, Math.max(1, limit));
  const rows = await prisma.settlementEvent.findMany({
    where: { intentId },
    orderBy: { createdAt: 'desc' },
    take: cap,
  });
  return rows.map(toRecord);
}

/**
 * List settlement events for a given SettlementIdentity, newest first.
 */
export async function listEventsByIdentity(
  settlementIdentityId: string,
  limit = 50,
): Promise<SettlementEventRecord[]> {
  const cap = Math.min(200, Math.max(1, limit));
  const rows = await prisma.settlementEvent.findMany({
    where: { settlementIdentityId },
    orderBy: { createdAt: 'desc' },
    take: cap,
  });
  return rows.map(toRecord);
}
