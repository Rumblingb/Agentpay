/**
 * Trust Event Service — canonical catalog of trust-relevant event categories.
 *
 * This module is the single source of truth for which events feed AgentRank
 * and by how much.  Every call that affects trust should go through
 * `recordTrustEvent` so the graph receives consistent, documented signals.
 *
 * Event categories and their score deltas:
 *
 *   Category                  Delta   Direction   Description
 *   ─────────────────────     ─────   ─────────   ───────────────────────────
 *   service_execution          +10    positive    Job/task completed
 *   successful_interaction     +5     positive    Payment or escrow cleared
 *   failed_interaction         -5     negative    Payment or escrow failed
 *   dispute_filed              -5     negative    Dispute opened against agent
 *   dispute_resolved_guilty    -15    negative    Dispute resolved, agent found liable
 *   dispute_resolved_innocent  +5     positive    Dispute resolved, agent cleared
 *   identity_verified          +10    positive    Successful identity verification
 *   oracle_query               0      neutral     Reputation oracle queried (no change)
 *
 * Constraints:
 *  - Deltas are intentionally conservative to avoid inflating scores.
 *  - We NEVER invent deltas for events that have no honest backing signal.
 *  - oracle_query is listed for completeness; it does not adjust the score.
 *
 * @module services/trustEventService
 */

import { adjustScore } from '../../packages/agentpay-core/trust/agentrankService.js';
import { emitEvent } from './events.js';
import { logger } from '../logger.js';
import prisma from '../lib/prisma.js';
import crypto from 'crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * All trust-relevant event categories recognised by the system.
 * Add new categories here; wire them to a delta in TRUST_EVENT_DELTAS below.
 */
export type TrustEventCategory =
  | 'service_execution'
  | 'successful_interaction'
  | 'failed_interaction'
  | 'dispute_filed'
  | 'dispute_resolved_guilty'
  | 'dispute_resolved_innocent'
  | 'identity_verified'
  | 'oracle_query';

export interface TrustEventMeta {
  /** Score delta applied by this event. 0 = no change (neutral observation). */
  delta: number;
  /** Human-readable description of why this event matters to the trust graph. */
  description: string;
}

// ---------------------------------------------------------------------------
// Catalog — single source of truth for trust event deltas
// ---------------------------------------------------------------------------

export const TRUST_EVENT_CATALOG: Record<TrustEventCategory, TrustEventMeta> = {
  service_execution: {
    delta: 10,
    description: 'Agent completed a job/task — delivery proof recorded in the graph.',
  },
  successful_interaction: {
    delta: 5,
    description: 'Payment or escrow cleared successfully — payment reliability signal.',
  },
  failed_interaction: {
    delta: -5,
    description: 'Payment or escrow failed — negative reliability signal.',
  },
  dispute_filed: {
    delta: -5,
    description: 'A dispute was opened against this agent — pending outcome.',
  },
  dispute_resolved_guilty: {
    delta: -15,
    description: 'Dispute resolved: agent was found liable — accountability penalty.',
  },
  dispute_resolved_innocent: {
    delta: 5,
    description: 'Dispute resolved: agent was cleared — trust restored.',
  },
  identity_verified: {
    delta: 10,
    description: 'Agent identity was cryptographically verified — stake anchored.',
  },
  oracle_query: {
    delta: 0,
    description: 'Reputation oracle was queried — neutral observation, no score change.',
  },
};

// ---------------------------------------------------------------------------
// Core function
// ---------------------------------------------------------------------------

/**
 * Record a trust-relevant event for an agent and update their AgentRank score.
 *
 * Returns the updated score + grade, or null if the DB is unavailable.
 * Events with delta=0 are logged but do not call adjustScore.
 *
 * @param agentId       - ID of the agent whose trust record is updated
 * @param category      - One of the recognised TrustEventCategory values
 * @param details       - Optional human-readable context (appended to the history entry)
 * @param counterpartyId - Optional counterparty agent involved in the event
 * @param extraMetadata  - Optional extra fields to store in the event metadata
 */
export async function recordTrustEvent(
  agentId: string,
  category: TrustEventCategory,
  details?: string,
  counterpartyId?: string,
  extraMetadata?: Record<string, unknown>,
): Promise<{ score: number; grade: string } | null> {
  const meta = TRUST_EVENT_CATALOG[category];

  // Map TrustEventCategory to the canonical EventType used in the webhook layer
  const eventTypeMap: Record<TrustEventCategory, string> = {
    identity_verified: 'agent.verified',
    service_execution: 'service.completed',
    successful_interaction: 'interaction.recorded',
    failed_interaction: 'interaction.recorded',
    dispute_filed: 'dispute.filed',
    dispute_resolved_guilty: 'dispute.resolved',
    dispute_resolved_innocent: 'dispute.resolved',
    oracle_query: 'trust.score_updated',
  };
  const eventType = eventTypeMap[category] ?? 'trust.score_updated';

  // Persist the event to the canonical trust_events store (fire-and-forget; never
  // block the score update on a DB write to the events table).
  const eventRecord = {
    id: crypto.randomUUID(),
    eventType,
    agentId,
    counterpartyId: counterpartyId ?? null,
    delta: meta.delta,
    metadata: {
      category,
      description: meta.description,
      ...(details ? { details } : {}),
      ...(extraMetadata ?? {}),
    },
  };

  prisma.trustEvent
    .create({ data: eventRecord })
    .catch((err: any) => {
      const isTableMissing =
        err?.code === 'P2021' ||
        (typeof err?.message === 'string' && err.message.includes('does not exist'));
      if (!isTableMissing) {
        logger.warn({ err: err?.message, agentId, category }, '[TrustEvent] failed to persist trust event');
      }
    });

  if (meta.delta === 0) {
    // Neutral observation — log for auditability but skip the score update
    logger.info('Trust event observed (neutral)', { agentId, category, description: meta.description });
    return null;
  }

  return adjustScore(agentId, meta.delta, category, details ?? meta.description).then(async (result) => {
    if (result) {
      // Fan-out to webhook subscribers — fire-and-forget; never block the trust update
      emitEvent('trust.score_updated', {
        agentId,
        category,
        delta: meta.delta,
        score: result.score,
        grade: result.grade,
        description: meta.description,
      }).catch((err) => logger.warn({ err: (err as Error).message, agentId, category }, '[TrustEvent] trust.score_updated webhook delivery failed'));
    }
    return result;
  });
}

// ---------------------------------------------------------------------------
// Canonical event record shape — the stable public schema for trust events.
//
// Every field is REQUIRED (counterpartyId is always present but may be null).
// Consumers of /api/v1/trust/events MUST receive all of these fields.
// If this type changes, the API route and all consumers must be updated together.
// ---------------------------------------------------------------------------

/**
 * The stable, versioned schema for a trust event as returned by the API.
 *
 * Field mapping:
 *   id              — unique event identifier (cuid)
 *   eventType       — one of the canonical event type strings (agent.verified,
 *                     service.completed, interaction.recorded, dispute.filed,
 *                     dispute.resolved, trust.score_updated)
 *   agentId         — the agent whose trust record is affected
 *   counterpartyId  — the other party to the interaction (null for solo events)
 *   delta           — score change applied (+/−); 0 for neutral observations
 *   metadata        — structured context object (at minimum: { category, description })
 *   timestamp       — ISO-8601 UTC string; maps to createdAt in trust_events table
 */
export interface TrustEventRecord {
  id: string;
  eventType: string;
  agentId: string;
  counterpartyId: string | null;
  delta: number;
  metadata: Record<string, unknown>;
  timestamp: string;
}

/**
 * Runtime assertion that a raw DB record conforms to TrustEventRecord.
 * Throws if any required field is missing so schema drift is caught at
 * service boundaries rather than silently propagating to consumers.
 */
export function assertTrustEventRecord(r: unknown): asserts r is TrustEventRecord {
  if (typeof r !== 'object' || r === null) {
    throw new TypeError('[TrustEvent] event record is not an object');
  }
  const e = r as Record<string, unknown>;
  if (typeof e.id !== 'string' || e.id.length === 0)
    throw new TypeError('[TrustEvent] event.id is missing or empty');
  if (typeof e.eventType !== 'string' || e.eventType.length === 0)
    throw new TypeError('[TrustEvent] event.eventType is missing or empty');
  if (typeof e.agentId !== 'string' || e.agentId.length === 0)
    throw new TypeError('[TrustEvent] event.agentId is missing or empty');
  if (e.counterpartyId !== null && typeof e.counterpartyId !== 'string')
    throw new TypeError('[TrustEvent] event.counterpartyId must be a string or null');
  if (typeof e.delta !== 'number')
    throw new TypeError('[TrustEvent] event.delta must be a number');
  if (typeof e.metadata !== 'object' || e.metadata === null)
    throw new TypeError('[TrustEvent] event.metadata must be an object');
  if (typeof e.timestamp !== 'string' || e.timestamp.length === 0)
    throw new TypeError('[TrustEvent] event.timestamp is missing or empty');
}

/**
 * Query the trust_events table.
 *
 * Supports filtering by agentId and eventType, and pagination via limit/offset.
 * Returns events sorted by createdAt descending (newest first).
 */
export async function getTrustEvents(opts: {
  agentId?: string;
  eventType?: string;
  limit?: number;
  offset?: number;
}): Promise<{
  events: TrustEventRecord[];
  total: number;
}> {
  const limit = Math.min(100, Math.max(1, opts.limit ?? 50));
  const offset = Math.max(0, opts.offset ?? 0);

  const where: Record<string, unknown> = {};
  if (opts.agentId) where.agentId = opts.agentId;
  if (opts.eventType) where.eventType = opts.eventType;

  try {
    const [records, total] = await Promise.all([
      prisma.trustEvent.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.trustEvent.count({ where }),
    ]);

    return {
      events: records.map((r) => {
        const event: TrustEventRecord = {
          id: r.id,
          eventType: r.eventType,
          agentId: r.agentId,
          counterpartyId: r.counterpartyId,
          delta: r.delta,
          metadata: (r.metadata as Record<string, unknown>) ?? {},
          timestamp: r.createdAt.toISOString(),
        };
        // Asserts all required fields are present; throws if schema drifts.
        assertTrustEventRecord(event);
        return event;
      }),
      total,
    };
  } catch (err: any) {
    const isTableMissing =
      err?.code === 'P2021' ||
      (typeof err?.message === 'string' && err.message.includes('does not exist'));
    if (!isTableMissing) {
      logger.warn({ err: err?.message }, '[TrustEvent] getTrustEvents query failed');
    }
    return { events: [], total: 0 };
  }
}
