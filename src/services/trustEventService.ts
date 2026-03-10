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

import { adjustScore } from './agentrankService.js';
import { logger } from '../logger.js';

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
 * @param agentId  - ID of the agent whose trust record is updated
 * @param category - One of the recognised TrustEventCategory values
 * @param details  - Optional human-readable context (appended to the history entry)
 */
export async function recordTrustEvent(
  agentId: string,
  category: TrustEventCategory,
  details?: string,
): Promise<{ score: number; grade: string } | null> {
  const meta = TRUST_EVENT_CATALOG[category];

  if (meta.delta === 0) {
    // Neutral observation — log for auditability but skip the DB write
    logger.info('Trust event observed (neutral)', { agentId, category, description: meta.description });
    return null;
  }

  return adjustScore(agentId, meta.delta, category, details ?? meta.description);
}
