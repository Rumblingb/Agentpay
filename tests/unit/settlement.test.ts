/**
 * Unit tests for the Phase 3 settlement domain types and pure helper functions.
 *
 * Tests cover:
 *   - toSettlementProtocol() validation helper
 *   - defaultProofType() mapping
 *   - assertSettlementIdentityRecord() runtime assertion
 *   - assertIntentResolutionRecord() runtime assertion
 *   - All enum constant arrays (completeness + no duplicates)
 *
 * No DB or Prisma access — these are pure-function tests.
 * Consistent with tests/unit/feeService.test.ts style.
 */

import {
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
  toSettlementProtocol,
  defaultProofType,
  assertSettlementIdentityRecord,
  assertIntentResolutionRecord,
  type SettlementIdentityRecord,
  type IntentResolutionRecord,
} from '../../src/settlement/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeIdentityRecord(overrides: Partial<SettlementIdentityRecord> = {}): SettlementIdentityRecord {
  return {
    id: 'id-1',
    intentId: 'intent-uuid',
    protocol: 'solana',
    externalRef: null,
    status: 'pending',
    settledAt: null,
    metadata: {},
    isPrimary: false,
    priority: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeResolutionRecord(overrides: Partial<IntentResolutionRecord> = {}): IntentResolutionRecord {
  return {
    id: 'res-id-1',
    intentId: 'intent-uuid',
    settlementIdentityId: null,
    protocol: 'solana',
    resolvedBy: 'solana_listener',
    resolutionStatus: 'confirmed',
    decisionCode: null,
    reasonCode: null,
    confidenceScore: null,
    confidencePct: null,
    details: null,
    externalRef: null,
    confirmationDepth: 3,
    payerRef: null,
    resolvedAt: new Date().toISOString(),
    metadata: {},
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Enum constant arrays
// ---------------------------------------------------------------------------

describe('settlement enum constants', () => {
  it('SETTLEMENT_PROTOCOLS contains all 6 protocols', () => {
    expect(SETTLEMENT_PROTOCOLS).toHaveLength(6);
    expect(SETTLEMENT_PROTOCOLS).toContain('solana');
    expect(SETTLEMENT_PROTOCOLS).toContain('stripe');
    expect(SETTLEMENT_PROTOCOLS).toContain('ap2');
    expect(SETTLEMENT_PROTOCOLS).toContain('x402');
    expect(SETTLEMENT_PROTOCOLS).toContain('acp');
    expect(SETTLEMENT_PROTOCOLS).toContain('agent');
  });

  it('SETTLEMENT_PROTOCOLS has no duplicates', () => {
    expect(new Set(SETTLEMENT_PROTOCOLS).size).toBe(SETTLEMENT_PROTOCOLS.length);
  });

  it('MATCH_STRATEGIES contains all 3 strategies', () => {
    expect(MATCH_STRATEGIES).toHaveLength(3);
    expect(MATCH_STRATEGIES).toContain('by_recipient');
    expect(MATCH_STRATEGIES).toContain('by_memo');
    expect(MATCH_STRATEGIES).toContain('by_external_ref');
  });

  it('SETTLEMENT_IDENTITY_STATUSES contains all 4 statuses', () => {
    expect(SETTLEMENT_IDENTITY_STATUSES).toHaveLength(4);
    expect(SETTLEMENT_IDENTITY_STATUSES).toContain('pending');
    expect(SETTLEMENT_IDENTITY_STATUSES).toContain('confirmed');
    expect(SETTLEMENT_IDENTITY_STATUSES).toContain('failed');
    expect(SETTLEMENT_IDENTITY_STATUSES).toContain('expired');
  });

  it('SETTLEMENT_EVENT_TYPES contains all 6 event types', () => {
    expect(SETTLEMENT_EVENT_TYPES).toHaveLength(6);
    expect(SETTLEMENT_EVENT_TYPES).toContain('hash_submitted');
    expect(SETTLEMENT_EVENT_TYPES).toContain('on_chain_confirmed');
    expect(SETTLEMENT_EVENT_TYPES).toContain('webhook_received');
    expect(SETTLEMENT_EVENT_TYPES).toContain('resolution_failed');
    expect(SETTLEMENT_EVENT_TYPES).toContain('expired');
    expect(SETTLEMENT_EVENT_TYPES).toContain('policy_mismatch');
  });

  it('RESOLUTION_STATUSES contains all 4 statuses', () => {
    expect(RESOLUTION_STATUSES).toHaveLength(4);
    expect(RESOLUTION_STATUSES).toContain('confirmed');
    expect(RESOLUTION_STATUSES).toContain('failed');
    expect(RESOLUTION_STATUSES).toContain('disputed');
    expect(RESOLUTION_STATUSES).toContain('expired');
  });

  it('RESOLVED_BY_VALUES contains all 4 values', () => {
    expect(RESOLVED_BY_VALUES).toHaveLength(4);
    expect(RESOLVED_BY_VALUES).toContain('solana_listener');
    expect(RESOLVED_BY_VALUES).toContain('stripe_webhook');
    expect(RESOLVED_BY_VALUES).toContain('ap2_confirm');
    expect(RESOLVED_BY_VALUES).toContain('manual');
  });

  it('PROOF_TYPES contains all 6 types', () => {
    expect(PROOF_TYPES).toHaveLength(6);
    expect(PROOF_TYPES).toContain('solana_tx_hash');
    expect(PROOF_TYPES).toContain('stripe_session_id');
    expect(PROOF_TYPES).toContain('stripe_pi_id');
    expect(PROOF_TYPES).toContain('ap2_token');
    expect(PROOF_TYPES).toContain('acp_message_id');
    expect(PROOF_TYPES).toContain('escrow_id');
  });

  it('IDENTITY_MODES contains all 4 modes', () => {
    expect(IDENTITY_MODES).toHaveLength(4);
    expect(IDENTITY_MODES).toContain('none');
    expect(IDENTITY_MODES).toContain('kya_required');
    expect(IDENTITY_MODES).toContain('pin_required');
    expect(IDENTITY_MODES).toContain('credential');
  });

  it('AMOUNT_MODES contains all 3 modes', () => {
    expect(AMOUNT_MODES).toHaveLength(3);
    expect(AMOUNT_MODES).toContain('exact');
    expect(AMOUNT_MODES).toContain('at_least');
    expect(AMOUNT_MODES).toContain('any');
  });

  it('FEE_SOURCE_POLICIES contains all 4 policies', () => {
    expect(FEE_SOURCE_POLICIES).toHaveLength(4);
    expect(FEE_SOURCE_POLICIES).toContain('payer');
    expect(FEE_SOURCE_POLICIES).toContain('merchant');
    expect(FEE_SOURCE_POLICIES).toContain('split');
    expect(FEE_SOURCE_POLICIES).toContain('waived');
  });
});

// ---------------------------------------------------------------------------
// toSettlementProtocol()
// ---------------------------------------------------------------------------

describe('toSettlementProtocol()', () => {
  it('returns the protocol string for each valid value', () => {
    for (const p of SETTLEMENT_PROTOCOLS) {
      expect(toSettlementProtocol(p)).toBe(p);
    }
  });

  it('returns null for an unrecognised string', () => {
    expect(toSettlementProtocol('bitcoin')).toBeNull();
    expect(toSettlementProtocol('')).toBeNull();
    expect(toSettlementProtocol('SOLANA')).toBeNull(); // case-sensitive
  });

  it('returns null for non-string values', () => {
    expect(toSettlementProtocol(42)).toBeNull();
    expect(toSettlementProtocol(null)).toBeNull();
    expect(toSettlementProtocol(undefined)).toBeNull();
    expect(toSettlementProtocol({})).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// defaultProofType()
// ---------------------------------------------------------------------------

describe('defaultProofType()', () => {
  it('maps solana → solana_tx_hash', () => {
    expect(defaultProofType('solana')).toBe('solana_tx_hash');
  });

  it('maps stripe → stripe_session_id', () => {
    expect(defaultProofType('stripe')).toBe('stripe_session_id');
  });

  it('maps ap2 → ap2_token', () => {
    expect(defaultProofType('ap2')).toBe('ap2_token');
  });

  it('maps x402 → ap2_token (shares the AP2 verification token pattern)', () => {
    expect(defaultProofType('x402')).toBe('ap2_token');
  });

  it('maps acp → acp_message_id', () => {
    expect(defaultProofType('acp')).toBe('acp_message_id');
  });

  it('maps agent → escrow_id', () => {
    expect(defaultProofType('agent')).toBe('escrow_id');
  });

  it('every protocol maps to a value in PROOF_TYPES', () => {
    for (const protocol of SETTLEMENT_PROTOCOLS) {
      const pt = defaultProofType(protocol);
      expect(PROOF_TYPES).toContain(pt);
    }
  });
});

// ---------------------------------------------------------------------------
// assertSettlementIdentityRecord()
// ---------------------------------------------------------------------------

describe('assertSettlementIdentityRecord()', () => {
  it('passes for a valid record', () => {
    expect(() => assertSettlementIdentityRecord(makeIdentityRecord())).not.toThrow();
  });

  it('passes for all valid status values', () => {
    for (const status of SETTLEMENT_IDENTITY_STATUSES) {
      expect(() => assertSettlementIdentityRecord(makeIdentityRecord({ status }))).not.toThrow();
    }
  });

  it('passes for all valid protocol values', () => {
    for (const protocol of SETTLEMENT_PROTOCOLS) {
      expect(() => assertSettlementIdentityRecord(makeIdentityRecord({ protocol }))).not.toThrow();
    }
  });

  it('throws for null input', () => {
    expect(() => assertSettlementIdentityRecord(null)).toThrow(TypeError);
  });

  it('throws when id is missing', () => {
    expect(() => assertSettlementIdentityRecord(makeIdentityRecord({ id: '' }))).toThrow(TypeError);
  });

  it('throws when intentId is missing', () => {
    expect(() => assertSettlementIdentityRecord(makeIdentityRecord({ intentId: '' }))).toThrow(TypeError);
  });

  it('throws for an invalid protocol', () => {
    expect(() =>
      assertSettlementIdentityRecord(makeIdentityRecord({ protocol: 'bitcoin' as any }))
    ).toThrow(TypeError);
  });

  it('throws for an invalid status', () => {
    expect(() =>
      assertSettlementIdentityRecord(makeIdentityRecord({ status: 'processing' as any }))
    ).toThrow(TypeError);
  });
});

// ---------------------------------------------------------------------------
// assertIntentResolutionRecord()
// ---------------------------------------------------------------------------

describe('assertIntentResolutionRecord()', () => {
  it('passes for a valid record', () => {
    expect(() => assertIntentResolutionRecord(makeResolutionRecord())).not.toThrow();
  });

  it('passes for all valid resolutionStatus values', () => {
    for (const resolutionStatus of RESOLUTION_STATUSES) {
      expect(() =>
        assertIntentResolutionRecord(makeResolutionRecord({ resolutionStatus }))
      ).not.toThrow();
    }
  });

  it('passes for all valid resolvedBy values', () => {
    for (const resolvedBy of RESOLVED_BY_VALUES) {
      expect(() =>
        assertIntentResolutionRecord(makeResolutionRecord({ resolvedBy }))
      ).not.toThrow();
    }
  });

  it('passes for all valid protocol values', () => {
    for (const protocol of SETTLEMENT_PROTOCOLS) {
      expect(() =>
        assertIntentResolutionRecord(makeResolutionRecord({ protocol }))
      ).not.toThrow();
    }
  });

  it('throws for null input', () => {
    expect(() => assertIntentResolutionRecord(null)).toThrow(TypeError);
  });

  it('throws when id is missing', () => {
    expect(() => assertIntentResolutionRecord(makeResolutionRecord({ id: '' }))).toThrow(TypeError);
  });

  it('throws when intentId is missing', () => {
    expect(() =>
      assertIntentResolutionRecord(makeResolutionRecord({ intentId: '' }))
    ).toThrow(TypeError);
  });

  it('throws for an invalid protocol', () => {
    expect(() =>
      assertIntentResolutionRecord(makeResolutionRecord({ protocol: 'eth' as any }))
    ).toThrow(TypeError);
  });

  it('throws for an invalid resolutionStatus', () => {
    expect(() =>
      assertIntentResolutionRecord(makeResolutionRecord({ resolutionStatus: 'pending' as any }))
    ).toThrow(TypeError);
  });

  it('throws for an invalid resolvedBy', () => {
    expect(() =>
      assertIntentResolutionRecord(makeResolutionRecord({ resolvedBy: 'cron' as any }))
    ).toThrow(TypeError);
  });
});

// ---------------------------------------------------------------------------
// Phase 035 refinement fields
// ---------------------------------------------------------------------------

describe('SettlementIdentityRecord — Phase 035 fields', () => {
  it('isPrimary defaults to false', () => {
    const record = makeIdentityRecord();
    expect(record.isPrimary).toBe(false);
  });

  it('priority defaults to 0', () => {
    const record = makeIdentityRecord();
    expect(record.priority).toBe(0);
  });

  it('isPrimary=true passes assertSettlementIdentityRecord', () => {
    expect(() =>
      assertSettlementIdentityRecord(makeIdentityRecord({ isPrimary: true, priority: 10 }))
    ).not.toThrow();
  });

  it('custom priority passes assertSettlementIdentityRecord', () => {
    expect(() =>
      assertSettlementIdentityRecord(makeIdentityRecord({ priority: 99 }))
    ).not.toThrow();
  });
});

describe('IntentResolutionRecord — Phase 035 fields', () => {
  it('confidencePct defaults to null', () => {
    const record = makeResolutionRecord();
    expect(record.confidencePct).toBeNull();
  });

  it('details defaults to null', () => {
    const record = makeResolutionRecord();
    expect(record.details).toBeNull();
  });

  it('confidencePct 0-100 passes assertIntentResolutionRecord', () => {
    expect(() =>
      assertIntentResolutionRecord(makeResolutionRecord({ confidencePct: 87 }))
    ).not.toThrow();
  });

  it('details object passes assertIntentResolutionRecord', () => {
    expect(() =>
      assertIntentResolutionRecord(
        makeResolutionRecord({ details: { amountDelta: -0.5, reason: 'underpaid' } })
      )
    ).not.toThrow();
  });

  it('confidencePct=100 passes assertIntentResolutionRecord', () => {
    expect(() =>
      assertIntentResolutionRecord(makeResolutionRecord({ confidencePct: 100 }))
    ).not.toThrow();
  });

  it('confidencePct=0 passes assertIntentResolutionRecord', () => {
    expect(() =>
      assertIntentResolutionRecord(makeResolutionRecord({ confidencePct: 0 }))
    ).not.toThrow();
  });
});
