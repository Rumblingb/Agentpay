/**
 * Intent Resolution Service (Phase 3)
 *
 * Writes and reads IntentResolution records in the intent_resolutions table.
 * An IntentResolution is the terminal record for a payment intent — written
 * exactly once by whichever subsystem closes the intent (Solana listener,
 * Stripe webhook handler, AP2 confirm path, or an admin).
 *
 * Design decisions:
 *   - resolveIntent() is idempotent: if a resolution already exists for the
 *     given intentId it returns the existing record without re-writing.
 *     This mirrors the duplicate-proof guard in solana-listener.ts.
 *   - Both resolveIntent() and getResolution() surface an
 *     IntentResolutionRecord — the stable public shape for API responses.
 *   - The service does NOT update payment_intents.status — that remains the
 *     responsibility of each protocol-specific handler (Solana listener,
 *     Stripe webhook, etc.) so as not to create hidden coupling.
 *
 * @module settlement/intentResolutionService
 */

import crypto from 'crypto';
import prisma from '../lib/prisma.js';
import { logger } from '../logger.js';
import type {
  IntentResolutionRecord,
  ResolveIntentParams,
  ResolutionStatus,
  ResolutionDecision,
  ReasonCode,
  ResolvedBy,
  SettlementProtocol,
} from './types.js';
import { assertIntentResolutionRecord } from './types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toRecord(row: {
  id: string;
  intentId: string;
  settlementIdentityId: string | null;
  protocol: string;
  resolvedBy: string;
  resolutionStatus: string;
  decisionCode?: string | null;
  reasonCode?: string | null;
  confidenceScore?: unknown;
  externalRef: string | null;
  confirmationDepth: number | null;
  payerRef: string | null;
  resolvedAt: Date;
  metadata: unknown;
  createdAt: Date;
}): IntentResolutionRecord {
  const record: IntentResolutionRecord = {
    id: row.id,
    intentId: row.intentId,
    settlementIdentityId: row.settlementIdentityId,
    protocol: row.protocol as SettlementProtocol,
    resolvedBy: row.resolvedBy as ResolvedBy,
    resolutionStatus: row.resolutionStatus as ResolutionStatus,
    decisionCode: (row.decisionCode as ResolutionDecision | null | undefined) ?? null,
    reasonCode: (row.reasonCode as ReasonCode | null | undefined) ?? null,
    confidenceScore: row.confidenceScore != null ? Number(row.confidenceScore) : null,
    externalRef: row.externalRef,
    confirmationDepth: row.confirmationDepth,
    payerRef: row.payerRef,
    resolvedAt: row.resolvedAt.toISOString(),
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    createdAt: row.createdAt.toISOString(),
  };
  assertIntentResolutionRecord(record);
  return record;
}

// ---------------------------------------------------------------------------
// Service functions
// ---------------------------------------------------------------------------

/**
 * Write a terminal resolution record for a payment intent.
 *
 * Idempotent: if a resolution already exists for the given intentId the
 * existing record is returned and no second write is attempted.
 * Uses the Prisma P2002 unique-violation code to detect the race condition,
 * consistent with solana-listener.ts processIntent().
 *
 * @throws If the DB write fails for a reason other than a duplicate key.
 */
export async function resolveIntent(
  params: ResolveIntentParams,
): Promise<IntentResolutionRecord> {
  const {
    intentId,
    protocol,
    resolvedBy,
    resolutionStatus,
    settlementIdentityId,
    externalRef,
    confirmationDepth,
    payerRef,
    decisionCode,
    reasonCode,
    confidenceScore,
    metadata,
  } = params;

  try {
    const row = await prisma.intentResolution.create({
      data: {
        id: crypto.randomUUID(),
        intentId,
        protocol,
        resolvedBy,
        resolutionStatus,
        settlementIdentityId: settlementIdentityId ?? null,
        externalRef: externalRef ?? null,
        confirmationDepth: confirmationDepth ?? null,
        payerRef: payerRef ?? null,
        // Phase 6 engine fields (nullable for backwards compatibility)
        ...(decisionCode !== undefined ? { decisionCode } : {}),
        ...(reasonCode !== undefined ? { reasonCode } : {}),
        ...(confidenceScore !== undefined ? { confidenceScore } : {}),
        resolvedAt: new Date(),
        metadata: (metadata ?? {}) as object,
      },
    });

    logger.info('[IntentResolution] written', {
      id: row.id,
      intentId,
      protocol,
      resolvedBy,
      resolutionStatus,
    });

    return toRecord(row);
  } catch (err: unknown) {
    // P2002 = unique constraint violation on intent_id — already resolved by a
    // concurrent worker (Solana listener race, duplicate Stripe webhook, etc.)
    if ((err as { code?: string })?.code === 'P2002') {
      logger.debug('[IntentResolution] already resolved (idempotent return)', { intentId });
      const existing = await prisma.intentResolution.findUnique({
        where: { intentId },
      });
      if (existing) return toRecord(existing);
    }
    throw err;
  }
}

/**
 * Retrieve the resolution record for a given intent.
 * Returns null if no resolution has been written yet.
 */
export async function getResolution(
  intentId: string,
): Promise<IntentResolutionRecord | null> {
  const row = await prisma.intentResolution.findUnique({
    where: { intentId },
  });
  return row ? toRecord(row) : null;
}

/**
 * Returns true if an intent has been fully resolved (any terminal status).
 * Thin convenience wrapper used by the Solana listener guard.
 */
export async function isResolved(intentId: string): Promise<boolean> {
  const count = await prisma.intentResolution.count({ where: { intentId } });
  return count > 0;
}

/**
 * List the most recent resolutions across all intents, optionally filtered
 * by resolutionStatus.  Useful for admin dashboards and reconciliation.
 *
 * @param filter  - Optional status filter
 * @param limit   - Max results (default 50, max 200)
 */
export async function listRecentResolutions(opts?: {
  resolutionStatus?: ResolutionStatus;
  limit?: number;
}): Promise<IntentResolutionRecord[]> {
  const cap = Math.min(200, Math.max(1, opts?.limit ?? 50));
  const rows = await prisma.intentResolution.findMany({
    where: opts?.resolutionStatus ? { resolutionStatus: opts.resolutionStatus } : undefined,
    orderBy: { resolvedAt: 'desc' },
    take: cap,
  });
  return rows.map(toRecord);
}
