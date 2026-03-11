/**
 * Settlement Identity Service (Phase 3)
 *
 * Creates and reads SettlementIdentity records in the settlement_identities table.
 * A SettlementIdentity is the first record written when an intent enters the
 * settlement pipeline for a specific protocol rail.
 *
 * One SettlementIdentity per (intent, protocol) pair is the intended invariant,
 * but the service does not enforce uniqueness — the DB has no unique constraint
 * on (intent_id, protocol) to allow re-submission after a failure.  Callers
 * that need idempotency should query getByIntentAndProtocol() before calling
 * create().
 *
 * Dependencies:
 *   - prisma (src/lib/prisma.ts) — Prisma client with Phase 2 models
 *   - logger (src/logger.ts)
 *   - settlement/types.ts — shared domain types
 *
 * @module settlement/settlementIdentityService
 */

import prisma from '../lib/prisma.js';
import { logger } from '../logger.js';
import type {
  CreateSettlementIdentityParams,
  SettlementIdentityRecord,
  SettlementIdentityStatus,
  SettlementProtocol,
} from './types.js';
import { assertSettlementIdentityRecord } from './types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Maps a raw Prisma SettlementIdentity row to the stable domain record type.
 * All Date objects are converted to ISO-8601 strings at the service boundary.
 */
function toRecord(row: {
  id: string;
  intentId: string;
  protocol: string;
  externalRef: string | null;
  status: string;
  settledAt: Date | null;
  metadata: unknown;
  isPrimary: boolean;
  priority: number;
  createdAt: Date;
  updatedAt: Date;
}): SettlementIdentityRecord {
  const record: SettlementIdentityRecord = {
    id: row.id,
    intentId: row.intentId,
    protocol: row.protocol as SettlementProtocol,
    externalRef: row.externalRef,
    status: row.status as SettlementIdentityStatus,
    settledAt: row.settledAt?.toISOString() ?? null,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    isPrimary: row.isPrimary,
    priority: row.priority,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
  assertSettlementIdentityRecord(record);
  return record;
}

// ---------------------------------------------------------------------------
// Service functions
// ---------------------------------------------------------------------------

/**
 * Create a new SettlementIdentity for an intent + protocol pair.
 *
 * Does NOT check for an existing record — call getByIntentAndProtocol() first
 * if idempotent creation is needed.
 *
 * @throws If the Prisma insert fails (e.g. intentId FK violation).
 */
export async function createSettlementIdentity(
  params: CreateSettlementIdentityParams,
): Promise<SettlementIdentityRecord> {
  const { intentId, protocol, externalRef, metadata, isPrimary, priority } = params;

  const row = await prisma.settlementIdentity.create({
    data: {
      intentId,
      protocol,
      externalRef: externalRef ?? null,
      status: 'pending',
      metadata: (metadata ?? {}) as object,
      isPrimary: isPrimary ?? false,
      priority: priority ?? 0,
    },
  });

  logger.info('[SettlementIdentity] created', {
    id: row.id,
    intentId,
    protocol,
    externalRef: externalRef ?? null,
    isPrimary: row.isPrimary,
    priority: row.priority,
  });

  return toRecord(row);
}

/**
 * Retrieve a SettlementIdentity by its primary key.
 * Returns null if not found.
 */
export async function getSettlementIdentityById(
  id: string,
): Promise<SettlementIdentityRecord | null> {
  const row = await prisma.settlementIdentity.findUnique({ where: { id } });
  return row ? toRecord(row) : null;
}

/**
 * Retrieve the active (non-expired, non-failed) SettlementIdentity for an
 * intent + protocol pair.  Returns null if none exists.
 *
 * "Active" = status in ['pending', 'confirmed'].
 */
export async function getActiveByIntentAndProtocol(
  intentId: string,
  protocol: SettlementProtocol,
): Promise<SettlementIdentityRecord | null> {
  const row = await prisma.settlementIdentity.findFirst({
    where: {
      intentId,
      protocol,
      status: { in: ['pending', 'confirmed'] },
    },
    orderBy: { createdAt: 'desc' },
  });
  return row ? toRecord(row) : null;
}

/**
 * List all SettlementIdentity records for an intent (all protocols, all statuses).
 */
export async function listByIntent(intentId: string): Promise<SettlementIdentityRecord[]> {
  const rows = await prisma.settlementIdentity.findMany({
    where: { intentId },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map(toRecord);
}

/**
 * Update the status of a SettlementIdentity (and optionally set settledAt).
 * Uses an atomic conditional update so only a 'pending' record can be
 * transitioned to 'confirmed' or 'failed', preventing double-processing.
 *
 * Returns the updated record, or null if no matching 'pending' row was found
 * (meaning it was already processed by a concurrent worker).
 */
export async function transitionStatus(
  id: string,
  newStatus: Extract<SettlementIdentityStatus, 'confirmed' | 'failed' | 'expired'>,
  opts?: { externalRef?: string },
): Promise<SettlementIdentityRecord | null> {
  try {
    const row = await prisma.settlementIdentity.updateMany({
      where: { id, status: 'pending' },
      data: {
        status: newStatus,
        ...(newStatus === 'confirmed' ? { settledAt: new Date() } : {}),
        ...(opts?.externalRef !== undefined ? { externalRef: opts.externalRef } : {}),
        updatedAt: new Date(),
      },
    });

    if (row.count === 0) {
      // Already transitioned by a concurrent worker — safe no-op
      logger.debug('[SettlementIdentity] transition no-op (already processed)', { id, newStatus });
      return null;
    }

    const updated = await prisma.settlementIdentity.findUnique({ where: { id } });
    if (!updated) return null;

    logger.info('[SettlementIdentity] status transitioned', { id, newStatus });
    return toRecord(updated);
  } catch (err: unknown) {
    logger.error('[SettlementIdentity] transitionStatus failed', {
      id,
      newStatus,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
