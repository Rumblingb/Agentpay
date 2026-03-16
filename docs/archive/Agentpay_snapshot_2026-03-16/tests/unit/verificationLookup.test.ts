/**
 * Unit tests for apps/api-edge/src/lib/verificationLookup.ts  (Phase 7)
 *
 * Covers:
 *   1. lookupByProofId() — orchestrated DB lookup
 *      a. Settlement event found with intent_id → fetches resolution + intent in parallel
 *      b. Settlement event found without intent_id → event only, no further queries
 *      c. No settlement event → falls back to transactions table
 *      d. Tables missing / DB errors → returns graceful nulls, never throws
 *   2. deriveVerification() — pure status derivation
 *      a. Resolution confirmed → verified=true, status='confirmed'
 *      b. Resolution failed → verified=false, status='unmatched', reasonCode set
 *      c. Event on_chain_confirmed, no resolution → status='matched'
 *      d. Event hash_submitted, no resolution → status='observed'
 *      e. Event policy_mismatch, no resolution → status='unmatched'
 *      f. Legacy tx confirmed → verified=true, status='confirmed'
 *      g. Legacy tx pending → verified=false, status='observed'
 *      h. Nothing found → unseen
 *      i. Resolution without linked intent (edge case)
 *      j. reasonCode preference: resolution.reasonCode > decisionCode
 *
 * No real DB — sql is mocked as a jest.fn() tagged-template mock.
 * Consistent with tests/unit/settlementDb.test.ts style.
 */

import {
  lookupByProofId,
  deriveVerification,
  type VerificationLookup,
  type SettlementEventRow,
  type IntentResolutionRow,
  type PaymentIntentRow,
  type LegacyTransactionRow,
} from '../../apps/api-edge/src/lib/verificationLookup';

// ---------------------------------------------------------------------------
// Helpers — mock sql tagged-template function
// ---------------------------------------------------------------------------

type SqlMock = jest.Mock & { end: jest.Mock };

/**
 * Creates a sql mock that resolves every tagged-template call to `result`.
 * Call .mockResolvedValueOnce() to set up per-call return values.
 */
function makeSqlMock(result: unknown[] = []): SqlMock {
  return Object.assign(jest.fn().mockResolvedValue(result), {
    end: jest.fn().mockResolvedValue(undefined),
  }) as SqlMock;
}

function makeSqlErrorMock(error: Error): SqlMock {
  return Object.assign(jest.fn().mockRejectedValue(error), {
    end: jest.fn().mockResolvedValue(undefined),
  }) as SqlMock;
}

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

const PROOF_ID   = '5UXkLabcdef1234567890abcdef1234567890abcdef12';
const INTENT_ID  = 'aaaaaaaa-0000-0000-0000-000000000001';
const MERCHANT_ID = 'bbbbbbbb-0000-0000-0000-000000000001';
const AGENT_ID   = 'cccccccc-0000-0000-0000-000000000001';
const RES_ID     = 'dddddddd-0000-0000-0000-000000000001';
const EVENT_ID   = 'eeeeeeee-0000-0000-0000-000000000001';

const NOW = new Date('2025-01-01T12:00:00.000Z');

function makeEventRow(overrides: Partial<SettlementEventRow> = {}): SettlementEventRow {
  return {
    eventId: EVENT_ID,
    intentId: INTENT_ID,
    settlementIdentityId: null,
    eventType: 'on_chain_confirmed',
    protocol: 'solana',
    payload: { proofType: 'solana_tx_hash', grossAmount: 10.0 },
    createdAt: NOW,
    ...overrides,
  };
}

function makeResolutionRow(overrides: Partial<IntentResolutionRow> = {}): IntentResolutionRow {
  return {
    resolutionId: RES_ID,
    resolutionStatus: 'confirmed',
    decisionCode: 'matched',
    reasonCode: 'exact_amount',
    confidenceScore: 1.0,
    resolvedAt: NOW,
    ...overrides,
  };
}

function makeIntentRow(overrides: Partial<PaymentIntentRow> = {}): PaymentIntentRow {
  return {
    intentId: INTENT_ID,
    merchantId: MERCHANT_ID,
    agentId: AGENT_ID,
    status: 'completed',
    createdAt: NOW,
    ...overrides,
  };
}

function makeTxRow(overrides: Partial<LegacyTransactionRow> = {}): LegacyTransactionRow {
  return {
    id: 'tx-uuid-001',
    merchantId: MERCHANT_ID,
    agentId: null,
    status: 'confirmed',
    createdAt: NOW,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. lookupByProofId()
// ---------------------------------------------------------------------------

describe('lookupByProofId() — settlement event found with intent_id', () => {
  it('returns event, resolution, and intent when all three exist', async () => {
    const sql = makeSqlMock();
    sql
      .mockResolvedValueOnce([makeEventRow()])       // settlement_events
      .mockResolvedValueOnce([makeResolutionRow()])  // intent_resolutions (parallel)
      .mockResolvedValueOnce([makeIntentRow()]);     // payment_intents (parallel)

    const result = await lookupByProofId(sql as any, PROOF_ID);

    expect(result.event).not.toBeNull();
    expect(result.resolution).not.toBeNull();
    expect(result.intent).not.toBeNull();
    expect(result.transaction).toBeNull();
    expect(result.event!.eventId).toBe(EVENT_ID);
    expect(result.resolution!.resolutionStatus).toBe('confirmed');
    expect(result.intent!.merchantId).toBe(MERCHANT_ID);
  });

  it('returns event + intent even when no resolution exists', async () => {
    const sql = makeSqlMock();
    sql
      .mockResolvedValueOnce([makeEventRow()])   // settlement_events
      .mockResolvedValueOnce([])                 // intent_resolutions — empty
      .mockResolvedValueOnce([makeIntentRow()]); // payment_intents

    const result = await lookupByProofId(sql as any, PROOF_ID);

    expect(result.event).not.toBeNull();
    expect(result.resolution).toBeNull();
    expect(result.intent).not.toBeNull();
    expect(result.transaction).toBeNull();
  });

  it('does NOT query transactions when settlement event is found', async () => {
    const sql = makeSqlMock();
    sql
      .mockResolvedValueOnce([makeEventRow()])
      .mockResolvedValueOnce([makeResolutionRow()])
      .mockResolvedValueOnce([makeIntentRow()]);

    await lookupByProofId(sql as any, PROOF_ID);

    // sql is called 3 times: event, resolution, intent (parallel)
    // transactions query should NOT be called
    expect(sql).toHaveBeenCalledTimes(3);
  });
});

describe('lookupByProofId() — settlement event found WITHOUT intent_id', () => {
  it('returns only the event when intent_id is null', async () => {
    const sql = makeSqlMock();
    sql.mockResolvedValueOnce([makeEventRow({ intentId: null })]);

    const result = await lookupByProofId(sql as any, PROOF_ID);

    expect(result.event).not.toBeNull();
    expect(result.resolution).toBeNull();
    expect(result.intent).toBeNull();
    expect(result.transaction).toBeNull();
    // Only 1 sql call — no further queries when intent_id is null
    expect(sql).toHaveBeenCalledTimes(1);
  });
});

describe('lookupByProofId() — no settlement event, legacy fallback', () => {
  it('returns transaction when no settlement event exists', async () => {
    const sql = makeSqlMock();
    sql
      .mockResolvedValueOnce([])           // settlement_events — empty
      .mockResolvedValueOnce([makeTxRow()]); // transactions

    const result = await lookupByProofId(sql as any, PROOF_ID);

    expect(result.event).toBeNull();
    expect(result.transaction).not.toBeNull();
    expect(result.transaction!.id).toBe('tx-uuid-001');
  });

  it('returns all-null when neither settlement event nor transaction exists', async () => {
    const sql = makeSqlMock();
    sql
      .mockResolvedValueOnce([])  // settlement_events
      .mockResolvedValueOnce([]); // transactions

    const result = await lookupByProofId(sql as any, PROOF_ID);

    expect(result.event).toBeNull();
    expect(result.resolution).toBeNull();
    expect(result.intent).toBeNull();
    expect(result.transaction).toBeNull();
  });
});

describe('lookupByProofId() — DB error handling (best-effort)', () => {
  it('returns all-null when settlement_events table is missing', async () => {
    const sql = makeSqlErrorMock(
      new Error('relation "settlement_events" does not exist'),
    );

    const result = await lookupByProofId(sql as any, PROOF_ID);

    expect(result.event).toBeNull();
    expect(result.transaction).toBeNull();
  });

  it('returns all-null on unexpected DB error', async () => {
    const sql = makeSqlErrorMock(new Error('connection reset by peer'));

    await expect(lookupByProofId(sql as any, PROOF_ID)).resolves.toMatchObject({
      event: null,
      resolution: null,
      intent: null,
      transaction: null,
    });
  });

  it('still returns event when only the resolution query fails', async () => {
    const sql = makeSqlMock();
    sql
      .mockResolvedValueOnce([makeEventRow()])      // settlement_events — ok
      .mockRejectedValueOnce(new Error('timeout'))  // intent_resolutions — fails
      .mockResolvedValueOnce([makeIntentRow()]);    // payment_intents — ok

    const result = await lookupByProofId(sql as any, PROOF_ID);

    expect(result.event).not.toBeNull();
    expect(result.resolution).toBeNull(); // failed gracefully
    expect(result.intent).not.toBeNull();
  });

  it('does not throw when all queries fail', async () => {
    const sql = makeSqlMock();
    sql
      .mockRejectedValueOnce(new Error('err1'))  // settlement_events
      .mockRejectedValueOnce(new Error('err2')); // transactions

    await expect(lookupByProofId(sql as any, PROOF_ID)).resolves.toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 2. deriveVerification() — pure function tests
// ---------------------------------------------------------------------------

function makeFullLookup(overrides: Partial<VerificationLookup> = {}): VerificationLookup {
  return {
    event:       makeEventRow(),
    resolution:  makeResolutionRow(),
    intent:      makeIntentRow(),
    transaction: null,
    ...overrides,
  };
}

describe('deriveVerification() — resolution confirmed', () => {
  it('returns verified=true and status=confirmed', () => {
    const result = deriveVerification(makeFullLookup());
    expect(result.verified).toBe(true);
    expect(result.status).toBe('confirmed');
  });

  it('returns reasonCode from resolution.reasonCode', () => {
    const result = deriveVerification(makeFullLookup({
      resolution: makeResolutionRow({ reasonCode: 'exact_amount' }),
    }));
    expect(result.reasonCode).toBe('exact_amount');
  });

  it('returns intentId from intent row', () => {
    const result = deriveVerification(makeFullLookup());
    expect(result.intentId).toBe(INTENT_ID);
    expect(result.merchantId).toBe(MERCHANT_ID);
    expect(result.agentId).toBe(AGENT_ID);
  });

  it('sets settlementTimestamp to resolution.resolvedAt ISO string', () => {
    const result = deriveVerification(makeFullLookup());
    expect(result.settlementTimestamp).toBe(NOW.toISOString());
  });
});

describe('deriveVerification() — resolution failed', () => {
  it('returns verified=false and status=unmatched', () => {
    const result = deriveVerification(makeFullLookup({
      resolution: makeResolutionRow({
        resolutionStatus: 'failed',
        decisionCode: 'unmatched',
        reasonCode: 'recipient_mismatch',
      }),
    }));
    expect(result.verified).toBe(false);
    expect(result.status).toBe('unmatched');
  });

  it('prefers reasonCode over decisionCode for unmatched', () => {
    const result = deriveVerification(makeFullLookup({
      resolution: makeResolutionRow({
        resolutionStatus: 'failed',
        decisionCode: 'underpaid',
        reasonCode: 'amount_mismatch',
      }),
    }));
    expect(result.reasonCode).toBe('amount_mismatch');
  });

  it('falls back to decisionCode when reasonCode is null', () => {
    const result = deriveVerification(makeFullLookup({
      resolution: makeResolutionRow({
        resolutionStatus: 'failed',
        decisionCode: 'unmatched',
        reasonCode: null,
      }),
    }));
    expect(result.reasonCode).toBe('unmatched');
  });

  it('returns reasonCode=null when both decisionCode and reasonCode are null', () => {
    const result = deriveVerification(makeFullLookup({
      resolution: makeResolutionRow({
        resolutionStatus: 'failed',
        decisionCode: null,
        reasonCode: null,
      }),
    }));
    expect(result.reasonCode).toBeNull();
  });
});

describe('deriveVerification() — event only, no resolution', () => {
  const noResolution = { resolution: null };

  it('on_chain_confirmed event → matched, verified=false', () => {
    const result = deriveVerification(makeFullLookup({
      ...noResolution,
      event: makeEventRow({ eventType: 'on_chain_confirmed' }),
    }));
    expect(result.status).toBe('matched');
    expect(result.verified).toBe(false);
    expect(result.reasonCode).toBeNull();
  });

  it('webhook_received event → matched, verified=false', () => {
    const result = deriveVerification(makeFullLookup({
      ...noResolution,
      event: makeEventRow({ eventType: 'webhook_received' }),
    }));
    expect(result.status).toBe('matched');
  });

  it('hash_submitted event → observed, verified=false', () => {
    const result = deriveVerification(makeFullLookup({
      ...noResolution,
      event: makeEventRow({ eventType: 'hash_submitted' }),
    }));
    expect(result.status).toBe('observed');
    expect(result.verified).toBe(false);
  });

  it('expired event → observed (default)', () => {
    const result = deriveVerification(makeFullLookup({
      ...noResolution,
      event: makeEventRow({ eventType: 'expired' }),
    }));
    expect(result.status).toBe('observed');
  });

  it('policy_mismatch event → unmatched, reasonCode=policy_mismatch', () => {
    const result = deriveVerification(makeFullLookup({
      ...noResolution,
      event: makeEventRow({ eventType: 'policy_mismatch' }),
    }));
    expect(result.status).toBe('unmatched');
    expect(result.reasonCode).toBe('policy_mismatch');
    expect(result.verified).toBe(false);
  });

  it('resolution_failed event → unmatched', () => {
    const result = deriveVerification(makeFullLookup({
      ...noResolution,
      event: makeEventRow({ eventType: 'resolution_failed' }),
    }));
    expect(result.status).toBe('unmatched');
  });

  it('sets settlementTimestamp from event.createdAt', () => {
    const result = deriveVerification(makeFullLookup({
      ...noResolution,
      event: makeEventRow({ createdAt: NOW }),
    }));
    expect(result.settlementTimestamp).toBe(NOW.toISOString());
  });

  it('returns intentId from intent row when event has no intent_id', () => {
    const result = deriveVerification(makeFullLookup({
      ...noResolution,
      event: makeEventRow({ intentId: null }),
      intent: makeIntentRow(),
    }));
    expect(result.intentId).toBe(INTENT_ID);
  });

  it('returns null intentId when event has no intent_id and no intent loaded', () => {
    const result = deriveVerification(makeFullLookup({
      ...noResolution,
      event: makeEventRow({ intentId: null }),
      intent: null,
    }));
    expect(result.intentId).toBeNull();
    expect(result.merchantId).toBeNull();
  });
});

describe('deriveVerification() — legacy transaction fallback', () => {
  const legacyLookup = (status: string): VerificationLookup => ({
    event: null, resolution: null, intent: null,
    transaction: makeTxRow({ status }),
  });

  it('confirmed tx → verified=true, status=confirmed', () => {
    const result = deriveVerification(legacyLookup('confirmed'));
    expect(result.verified).toBe(true);
    expect(result.status).toBe('confirmed');
    expect(result.reasonCode).toBeNull();
  });

  it('pending tx → verified=false, status=observed', () => {
    const result = deriveVerification(legacyLookup('pending'));
    expect(result.verified).toBe(false);
    expect(result.status).toBe('observed');
  });

  it('failed tx → verified=false, status=observed', () => {
    const result = deriveVerification(legacyLookup('failed'));
    expect(result.verified).toBe(false);
    expect(result.status).toBe('observed');
  });

  it('intentId is set from transaction.id (backward compat)', () => {
    const result = deriveVerification(legacyLookup('confirmed'));
    expect(result.intentId).toBe('tx-uuid-001');
    expect(result.merchantId).toBe(MERCHANT_ID);
  });

  it('agentId null when transaction has no agent', () => {
    const result = deriveVerification(legacyLookup('confirmed'));
    expect(result.agentId).toBeNull();
  });
});

describe('deriveVerification() — nothing found', () => {
  const emptyLookup: VerificationLookup = {
    event: null, resolution: null, intent: null, transaction: null,
  };

  it('returns unseen, verified=false, all nulls', () => {
    const result = deriveVerification(emptyLookup);
    expect(result.verified).toBe(false);
    expect(result.status).toBe('unseen');
    expect(result.reasonCode).toBeNull();
    expect(result.intentId).toBeNull();
    expect(result.merchantId).toBeNull();
    expect(result.agentId).toBeNull();
    expect(result.settlementTimestamp).toBeNull();
  });
});

describe('deriveVerification() — resolution without linked intent (edge case)', () => {
  it('still returns confirmed when intent row is missing', () => {
    const result = deriveVerification({
      event: makeEventRow(),
      resolution: makeResolutionRow(),
      intent: null,
      transaction: null,
    });
    expect(result.verified).toBe(true);
    expect(result.status).toBe('confirmed');
    expect(result.intentId).toBeNull();
    expect(result.merchantId).toBeNull();
  });
});

describe('deriveVerification() — resolution takes priority over event', () => {
  it('uses resolution status even when event says on_chain_confirmed', () => {
    // Both event and resolution present — resolution wins
    const result = deriveVerification({
      event: makeEventRow({ eventType: 'on_chain_confirmed' }),
      resolution: makeResolutionRow({ resolutionStatus: 'failed', decisionCode: 'underpaid' }),
      intent: makeIntentRow(),
      transaction: null,
    });
    // Resolution says failed → unmatched (not matched from event)
    expect(result.status).toBe('unmatched');
    expect(result.verified).toBe(false);
  });
});

describe('deriveVerification() — shape invariants', () => {
  const cases: Array<[string, VerificationLookup]> = [
    ['confirmed resolution', makeFullLookup()],
    ['failed resolution', makeFullLookup({ resolution: makeResolutionRow({ resolutionStatus: 'failed' }) })],
    ['on_chain event no resolution', makeFullLookup({ resolution: null })],
    ['legacy tx confirmed', { event: null, resolution: null, intent: null, transaction: makeTxRow() }],
    ['nothing found', { event: null, resolution: null, intent: null, transaction: null }],
  ];

  it.each(cases)('%s: verified matches status=confirmed', (_label, lookup) => {
    const result = deriveVerification(lookup);
    if (result.status === 'confirmed') {
      expect(result.verified).toBe(true);
    } else {
      expect(result.verified).toBe(false);
    }
  });
});
