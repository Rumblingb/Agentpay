/**
 * Settlement Identity Layer — public API (Phase 3)
 *
 * Re-exports all types, constants, and service functions from the settlement
 * sub-package.  Import from here rather than from individual files:
 *
 *   import {
 *     type SettlementProtocol,
 *     SETTLEMENT_PROTOCOLS,
 *     createSettlementIdentity,
 *     emitSettlementEvent,
 *     resolveIntent,
 *   } from '../settlement/index.js';
 *
 * @module settlement
 */

// ── Types & constants ──────────────────────────────────────────────────────
export type {
  // Enums
  SettlementProtocol,
  MatchStrategy,
  SettlementIdentityStatus,
  SettlementEventType,
  ResolutionStatus,
  ResolvedBy,
  ProofType,
  IdentityMode,
  AmountMode,
  FeeSourcePolicy,
  // Records (public API shapes)
  SettlementIdentityRecord,
  MatchingPolicyRecord,
  SettlementEventRecord,
  IntentResolutionRecord,
  // Params (service input shapes)
  CreateSettlementIdentityParams,
  EmitSettlementEventParams,
  ResolveIntentParams,
} from './types.js';

export {
  // Enum arrays for runtime validation
  SETTLEMENT_PROTOCOLS,
  MATCH_STRATEGIES,
  SETTLEMENT_IDENTITY_STATUSES,
  SETTLEMENT_EVENT_TYPES,
  RESOLUTION_STATUSES,
  RESOLVED_BY_VALUES,
  PROOF_TYPES,
  IDENTITY_MODES,
  AMOUNT_MODES,
  FEE_SOURCE_POLICIES,
  // Helpers
  toSettlementProtocol,
  defaultProofType,
  // Runtime assertions
  assertSettlementIdentityRecord,
  assertIntentResolutionRecord,
} from './types.js';

// ── Settlement Identity Service ────────────────────────────────────────────
export {
  createSettlementIdentity,
  getSettlementIdentityById,
  getActiveByIntentAndProtocol,
  listByIntent,
  transitionStatus,
} from './settlementIdentityService.js';

// ── Settlement Event Service ───────────────────────────────────────────────
export {
  emitSettlementEvent,
  listEventsByIntent,
  listEventsByIdentity,
} from './settlementEventService.js';

// ── Intent Resolution Service ──────────────────────────────────────────────
export {
  resolveIntent,
  getResolution,
  isResolved,
  listRecentResolutions,
} from './intentResolutionService.js';
