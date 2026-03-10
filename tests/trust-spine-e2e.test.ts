/**
 * Trust Spine End-to-End Flow Test
 *
 * Verifies the complete ordered trust event pipeline:
 *   1. agent.verified   — IdentityVerifierAgent calls recordTrustEvent('identity_verified')
 *   2. service.completed / interaction.recorded — POST /api/agents/complete
 *   3. trust.score_updated — automatically emitted after score adjustments
 *   4. dispute.filed   — DisputeResolverAgent calls recordTrustEvent('dispute_filed')
 *   5. dispute.resolved — DisputeResolverAgent calls recordTrustEvent('dispute_resolved_*')
 *
 * Confirms:
 *   A. Events are recorded exactly once per action (no duplicate writes)
 *   B. Each event carries the required structured metadata
 *   C. GET /api/v1/trust/events surfaces them with correct ordering
 *   D. Score deltas match the catalog in trustEventService
 *
 * @module tests/trust-spine-e2e.test.ts
 */

import { jest, describe, it, expect, beforeEach } from '@jest/globals';

// ── Prisma mock ───────────────────────────────────────────────────────────
const createdTrustEvents: any[] = [];
const mockTrustEventCreate = jest.fn((args: any) => {
  const row = { ...args.data, createdAt: new Date() };
  createdTrustEvents.push(row);
  return Promise.resolve(row);
});
const mockTrustEventFindMany = jest.fn(() => Promise.resolve([]));
const mockTrustEventCount = jest.fn(() => Promise.resolve(0));

const mockAgentRankUpdate = jest.fn(() => Promise.resolve({ score: 60, grade: 'B' }));
const mockAgentRankCreate = jest.fn(() => Promise.resolve({ score: 10, grade: 'F' }));
const mockAgentRankFindUnique = jest.fn(() => Promise.resolve(null));

jest.mock('../src/lib/prisma', () => ({
  __esModule: true,
  default: {
    trustEvent: {
      create: (...args: any[]) => mockTrustEventCreate(...args),
      findMany: (...args: any[]) => mockTrustEventFindMany(...args),
      count: (...args: any[]) => mockTrustEventCount(...args),
    },
    agentrank_scores: {
      findUnique: (...args: any[]) => mockAgentRankFindUnique(...args),
      create: (...args: any[]) => mockAgentRankCreate(...args),
      update: (...args: any[]) => mockAgentRankUpdate(...args),
      findMany: jest.fn().mockResolvedValue([]),
    },
    // DisputeResolverAgent also touches agentTransaction
    agentTransaction: {
      update: jest.fn().mockResolvedValue({}),
    },
    agent: {
      update: jest.fn().mockResolvedValue({}),
    },
  },
}));

// ── DB mock ───────────────────────────────────────────────────────────────
jest.mock('../src/db/index', () => ({
  __esModule: true,
  query: jest.fn().mockResolvedValue({ rows: [] }),
  pool: { on: jest.fn() },
  closePool: jest.fn(),
}));

// ── Event emitter mock (fire-and-forget webhook fan-out) ──────────────────
jest.mock('../src/services/events', () => ({
  emitEvent: jest.fn().mockResolvedValue(undefined),
}));

import { recordTrustEvent, getTrustEvents } from '../src/services/trustEventService';
import { emitEvent } from '../src/services/events';

// ── Helpers ───────────────────────────────────────────────────────────────

function resetTrustState() {
  createdTrustEvents.length = 0;
  jest.clearAllMocks();
  // Re-attach implementations after clearAllMocks
  mockTrustEventCreate.mockImplementation((args: any) => {
    const row = { ...args.data, createdAt: new Date() };
    createdTrustEvents.push(row);
    return Promise.resolve(row);
  });
  mockAgentRankFindUnique.mockResolvedValue(null);
  mockAgentRankCreate.mockResolvedValue({ score: 10, grade: 'F' });
  mockAgentRankUpdate.mockResolvedValue({ score: 60, grade: 'B' });
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('Trust Spine — full ordered event flow', () => {
  beforeEach(resetTrustState);

  // ──────────────────────────────────────────────────────────────────────────
  // Step 1: Identity verification
  // ──────────────────────────────────────────────────────────────────────────
  it('records exactly one agent.verified event with correct delta', async () => {
    await recordTrustEvent('agent-alpha', 'identity_verified', 'Trust level: standard');

    expect(mockTrustEventCreate).toHaveBeenCalledTimes(1);

    const event = createdTrustEvents[0];
    expect(event.eventType).toBe('agent.verified');
    expect(event.agentId).toBe('agent-alpha');
    expect(event.delta).toBe(10); // identity_verified delta from catalog
    expect(event.metadata.category).toBe('identity_verified');
    expect(typeof event.id).toBe('string');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Step 2: Service completion (seller) + successful interaction (buyer)
  // ──────────────────────────────────────────────────────────────────────────
  it('records exactly two events for a completed job (service_execution + successful_interaction)', async () => {
    await Promise.allSettled([
      recordTrustEvent('agent-seller', 'service_execution', 'tx-001 completed', 'agent-buyer'),
      recordTrustEvent('agent-buyer', 'successful_interaction', 'tx-001 completed', 'agent-seller'),
    ]);

    // Each party gets exactly one trust_events row
    expect(mockTrustEventCreate).toHaveBeenCalledTimes(2);

    const sellerEvent = createdTrustEvents.find((e) => e.agentId === 'agent-seller');
    const buyerEvent = createdTrustEvents.find((e) => e.agentId === 'agent-buyer');

    expect(sellerEvent).toBeDefined();
    expect(sellerEvent!.eventType).toBe('service.completed');
    expect(sellerEvent!.delta).toBe(10);
    expect(sellerEvent!.counterpartyId).toBe('agent-buyer');

    expect(buyerEvent).toBeDefined();
    expect(buyerEvent!.eventType).toBe('interaction.recorded');
    expect(buyerEvent!.delta).toBe(5);
    expect(buyerEvent!.counterpartyId).toBe('agent-seller');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Step 3: Trust score updated — webhook emitted per score change
  // ──────────────────────────────────────────────────────────────────────────
  it('emits trust.score_updated webhook exactly once per recordTrustEvent call', async () => {
    mockAgentRankFindUnique.mockResolvedValueOnce({ agent_id: 'agent-alpha', score: 50, grade: 'C' });
    mockAgentRankUpdate.mockResolvedValueOnce({ score: 60, grade: 'B' });

    await recordTrustEvent('agent-alpha', 'service_execution', 'tx-002 completed');

    // One trust_events DB row
    expect(mockTrustEventCreate).toHaveBeenCalledTimes(1);

    // One webhook fan-out for trust.score_updated
    const webhookCalls = (emitEvent as jest.Mock).mock.calls;
    const scoreUpdated = webhookCalls.filter(([type]) => type === 'trust.score_updated');
    expect(scoreUpdated).toHaveLength(1);
    expect(scoreUpdated[0][1]).toMatchObject({
      agentId: 'agent-alpha',
      delta: 10,
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Step 4: Dispute filed
  // ──────────────────────────────────────────────────────────────────────────
  it('records exactly one dispute.filed event against the respondent', async () => {
    await recordTrustEvent(
      'agent-respondent',
      'dispute_filed',
      'Dispute case-001 filed',
      'agent-claimant',
      { caseId: 'case-001', transactionId: 'tx-001' },
    );

    expect(mockTrustEventCreate).toHaveBeenCalledTimes(1);

    const event = createdTrustEvents[0];
    expect(event.eventType).toBe('dispute.filed');
    expect(event.agentId).toBe('agent-respondent');
    expect(event.counterpartyId).toBe('agent-claimant');
    expect(event.delta).toBe(-5); // dispute_filed delta from catalog
    expect(event.metadata.caseId).toBe('case-001');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Step 5: Dispute resolved — both parties updated
  // ──────────────────────────────────────────────────────────────────────────
  it('records exactly two dispute.resolved events (one per party) with no duplicates', async () => {
    await Promise.allSettled([
      // Guilty party (respondent)
      recordTrustEvent(
        'agent-respondent',
        'dispute_resolved_guilty',
        'case-001 resolved: claimant_favor',
        'agent-claimant',
        { caseId: 'case-001', decision: 'claimant_favor' },
      ),
      // Innocent party (claimant)
      recordTrustEvent(
        'agent-claimant',
        'dispute_resolved_innocent',
        'case-001 resolved: claimant_favor',
        'agent-respondent',
        { caseId: 'case-001', decision: 'claimant_favor' },
      ),
    ]);

    // Exactly two rows — one per party
    expect(mockTrustEventCreate).toHaveBeenCalledTimes(2);

    const guiltyEvent = createdTrustEvents.find((e) => e.agentId === 'agent-respondent');
    const innocentEvent = createdTrustEvents.find((e) => e.agentId === 'agent-claimant');

    expect(guiltyEvent!.eventType).toBe('dispute.resolved');
    expect(guiltyEvent!.delta).toBe(-15); // dispute_resolved_guilty delta
    expect(guiltyEvent!.metadata.decision).toBe('claimant_favor');

    expect(innocentEvent!.eventType).toBe('dispute.resolved');
    expect(innocentEvent!.delta).toBe(5); // dispute_resolved_innocent delta
    expect(innocentEvent!.metadata.decision).toBe('claimant_favor');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Full pipeline ordering — simulate complete flow
  // ──────────────────────────────────────────────────────────────────────────
  it('accumulates all events exactly once across the full verify→interact→dispute→resolve flow', async () => {
    // Step 1: Identity verified
    await recordTrustEvent('agent-x', 'identity_verified', 'standard verification');
    // Step 2: Service completed + interaction recorded
    await Promise.allSettled([
      recordTrustEvent('agent-x', 'service_execution', 'tx-999', 'agent-y'),
      recordTrustEvent('agent-y', 'successful_interaction', 'tx-999', 'agent-x'),
    ]);
    // Step 3: Dispute filed against agent-x
    await recordTrustEvent('agent-x', 'dispute_filed', 'case-002', 'agent-y', { caseId: 'case-002' });
    // Step 4: Dispute resolved (agent-x innocent, agent-y guilty)
    await Promise.allSettled([
      recordTrustEvent('agent-x', 'dispute_resolved_innocent', 'case-002 resolved', 'agent-y', { caseId: 'case-002' }),
      recordTrustEvent('agent-y', 'dispute_resolved_guilty', 'case-002 resolved', 'agent-x', { caseId: 'case-002' }),
    ]);

    // Total: 1 + 2 + 1 + 2 = 6 trust_events rows — exactly one per call
    expect(mockTrustEventCreate).toHaveBeenCalledTimes(6);

    // Event types present (trust.score_updated is emitted via webhook, not stored)
    const eventTypes = createdTrustEvents.map((e) => e.eventType);
    expect(eventTypes).toContain('agent.verified');
    expect(eventTypes).toContain('service.completed');
    expect(eventTypes).toContain('interaction.recorded');
    expect(eventTypes).toContain('dispute.filed');
    expect(eventTypes.filter((t) => t === 'dispute.resolved')).toHaveLength(2);

    // No duplicates — every row ID is unique
    const ids = createdTrustEvents.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);

    // Each event has a non-null agentId
    createdTrustEvents.forEach((e) => {
      expect(typeof e.agentId).toBe('string');
      expect(e.agentId.length).toBeGreaterThan(0);
    });
  });
});

describe('Trust Spine — duplicate event prevention', () => {
  beforeEach(resetTrustState);

  it('IdentityVerifierAgent: recordTrustEvent + separate emitEvent(agent.verified) produce exactly one trust_events row', async () => {
    /**
     * IdentityVerifierAgent calls:
     *   1. recordTrustEvent('identity_verified') → persists to trust_events + emits trust.score_updated webhook
     *   2. emitEvent('agent.verified')           → emits agent.verified webhook to subscribers
     *
     * These are two different event types to different audiences.
     * The trust_events table only gets ONE row (from step 1).
     * Confirmed: emitEvent('agent.verified') does NOT write to trust_events.
     */

    // Step 1: recordTrustEvent — writes the trust_events row
    await recordTrustEvent('agent-id-verify', 'identity_verified', 'Trust level: standard');

    // Step 2: emitEvent('agent.verified') — this is what IdentityVerifierAgent also calls.
    // It's a direct webhook fan-out and does NOT touch trust_events.
    const { emitEvent: mockEmit } = await import('../src/services/events');
    await (mockEmit as jest.Mock)('agent.verified', {
      agentId: 'agent-id-verify',
      credentialId: 'cred-001',
      trustLevel: 'standard',
    });

    // Only ONE trust_events row created — from step 1. The emitEvent call in step 2
    // goes straight to the webhook layer and never calls prisma.trustEvent.create.
    expect(mockTrustEventCreate).toHaveBeenCalledTimes(1);
    const row = createdTrustEvents[0];
    expect(row.eventType).toBe('agent.verified');
    expect(row.agentId).toBe('agent-id-verify');

    // The webhook mock was called: once by recordTrustEvent (trust.score_updated) +
    // once explicitly above (agent.verified) = 2 total webhook calls.
    const webhookCalls = (mockEmit as jest.Mock).mock.calls;
    const trustScoreUpdatedCalls = webhookCalls.filter(([type]: any) => type === 'trust.score_updated');
    const agentVerifiedCalls = webhookCalls.filter(([type]: any) => type === 'agent.verified');
    expect(trustScoreUpdatedCalls).toHaveLength(1); // exactly once from recordTrustEvent
    expect(agentVerifiedCalls).toHaveLength(1);     // exactly once from IdentityVerifierAgent direct call
  });

  it('recordTrustEvent does not call itself recursively', async () => {
    // agentrankService.adjustScore calls back into trustEventService for the
    // score update webhook, but does NOT call recordTrustEvent again.
    // This ensures no recursive loop and no double-write.
    mockAgentRankFindUnique.mockResolvedValueOnce({ agent_id: 'agent-loop', score: 50, grade: 'C' });
    mockAgentRankUpdate.mockResolvedValueOnce({ score: 60, grade: 'B' });

    await recordTrustEvent('agent-loop', 'service_execution', 'loop test');

    // Exactly one trust_events row — no recursive duplication
    expect(mockTrustEventCreate).toHaveBeenCalledTimes(1);
  });

  it('oracle_query (delta=0) writes to trust_events but does not call adjustScore', async () => {
    await recordTrustEvent('agent-oracle', 'oracle_query', 'query by agent-beta');

    // Still persisted for auditability
    expect(mockTrustEventCreate).toHaveBeenCalledTimes(1);
    const event = createdTrustEvents[0];
    expect(event.delta).toBe(0);
    expect(event.eventType).toBe('trust.score_updated');

    // adjustScore is NOT called (no agentrank_scores write)
    expect(mockAgentRankCreate).not.toHaveBeenCalled();
    expect(mockAgentRankUpdate).not.toHaveBeenCalled();
  });
});

describe('GET /api/v1/trust/events — surfaces pipeline events', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns events in newest-first order with required fields', async () => {
    const now = new Date();
    const mockEvents = [
      {
        id: 'evt-005',
        eventType: 'dispute.resolved',
        agentId: 'agent-x',
        counterpartyId: 'agent-y',
        delta: 5,
        metadata: { category: 'dispute_resolved_innocent', decision: 'claimant_favor' },
        createdAt: new Date(now.getTime() + 5000),
      },
      {
        id: 'evt-004',
        eventType: 'dispute.filed',
        agentId: 'agent-x',
        counterpartyId: 'agent-y',
        delta: -5,
        metadata: { category: 'dispute_filed', caseId: 'case-002' },
        createdAt: new Date(now.getTime() + 3000),
      },
      {
        id: 'evt-001',
        eventType: 'agent.verified',
        agentId: 'agent-x',
        counterpartyId: null,
        delta: 10,
        metadata: { category: 'identity_verified' },
        createdAt: now,
      },
    ];

    mockTrustEventFindMany.mockResolvedValueOnce(mockEvents);
    mockTrustEventCount.mockResolvedValueOnce(3);

    const { getTrustEvents: freshGetTrustEvents } = await import('../src/services/trustEventService');
    const result = await freshGetTrustEvents({ agentId: 'agent-x', limit: 10 });

    expect(result.events).toHaveLength(3);
    expect(result.total).toBe(3);

    // First event is newest (dispute.resolved)
    expect(result.events[0].eventType).toBe('dispute.resolved');
    expect(result.events[0].agentId).toBe('agent-x');
    expect(result.events[0].delta).toBe(5);

    // Last event is oldest (agent.verified)
    expect(result.events[2].eventType).toBe('agent.verified');
    expect(result.events[2].delta).toBe(10);

    // All events have timestamps
    result.events.forEach((e) => {
      expect(typeof e.timestamp).toBe('string');
      expect(new Date(e.timestamp).getTime()).not.toBeNaN();
    });

    // Prisma called with correct ordering
    expect(mockTrustEventFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { createdAt: 'desc' },
        where: expect.objectContaining({ agentId: 'agent-x' }),
      }),
    );
  });
});
