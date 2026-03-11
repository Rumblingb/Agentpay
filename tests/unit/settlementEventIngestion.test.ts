/**
 * Unit tests for Phase 5 settlement event ingestion services.
 *
 * Covers:
 *   1. normalizeSolanaObservation()  — pure function, Workers module
 *   2. normalizeStripeObservation()  — pure function, Workers module
 *   3. persistNormalizedProof()      — Workers SQL writer (mocked sql)
 *   4. ingestSolanaProof()           — Express wrapper (mocked emitSettlementEvent)
 *   5. ingestStripeProof()           — Express wrapper (mocked emitSettlementEvent)
 *
 * No real DB required — sql and emitSettlementEvent are mocked.
 * Consistent with tests/unit/settlementDb.test.ts style.
 */

// Mock emitSettlementEvent BEFORE any imports that reference the Express module.
jest.mock('../../src/settlement/settlementEventService', () => ({
  emitSettlementEvent: jest.fn().mockReturnValue('mock-event-id-001'),
}));

import {
  normalizeSolanaObservation,
  normalizeStripeObservation,
  persistNormalizedProof,
  type NormalizedProof,
  type SolanaObservation,
  type StripeObservation,
} from '../../apps/api-edge/src/lib/settlementEventIngestion';

import {
  normalizeSolanaObservation as normalizeSolanaExpress,
  normalizeStripeObservation as normalizeStripeExpress,
  ingestSolanaProof,
  ingestStripeProof,
} from '../../src/settlement/settlementEventIngestion';

import { emitSettlementEvent } from '../../src/settlement/settlementEventService';

const mockEmit = emitSettlementEvent as jest.Mock;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type SqlMock = jest.Mock & { end: jest.Mock };

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

const BASE_SOLANA_OBS: SolanaObservation = {
  txHash: '5UXkLabcdef1234567890abcdef1234567890abcdef12',
  sender: 'PayerWallet111111111111111111111111111111111',
  recipient: 'MerchWallet111111111111111111111111111111111',
  amountUsdc: 12.5,
  memo: 'APV_1700000000000_deadbeef',
  confirmationDepth: 32,
  confirmed: true,
};

const BASE_STRIPE_SESSION_OBS: StripeObservation = {
  stripeEventType: 'checkout.session.completed',
  externalId: 'cs_test_abc123',
  customerId: 'cus_xyz789',
  connectedAccountId: 'acct_connected001',
  amountTotal: 1250,
  currency: 'usd',
  status: 'succeeded',
  metadata: { reference: 'order-42' },
};

const BASE_STRIPE_PI_OBS: StripeObservation = {
  stripeEventType: 'payment_intent.succeeded',
  externalId: 'pi_test_def456',
  customerId: null,
  connectedAccountId: null,
  amountTotal: 500,
  currency: 'usd',
  status: 'succeeded',
  metadata: {},
};

// ---------------------------------------------------------------------------
// 1. normalizeSolanaObservation — Workers version
// ---------------------------------------------------------------------------

describe('normalizeSolanaObservation() [Workers]', () => {
  it('sets protocol to solana', () => {
    expect(normalizeSolanaObservation(BASE_SOLANA_OBS).protocol).toBe('solana');
  });

  it('sets proofType to solana_tx_hash', () => {
    expect(normalizeSolanaObservation(BASE_SOLANA_OBS).proofType).toBe('solana_tx_hash');
  });

  it('maps txHash to externalRef', () => {
    expect(normalizeSolanaObservation(BASE_SOLANA_OBS).externalRef).toBe(BASE_SOLANA_OBS.txHash);
  });

  it('maps sender and recipient', () => {
    const p = normalizeSolanaObservation(BASE_SOLANA_OBS);
    expect(p.sender).toBe(BASE_SOLANA_OBS.sender);
    expect(p.recipient).toBe(BASE_SOLANA_OBS.recipient);
  });

  it('maps amountUsdc to grossAmount', () => {
    expect(normalizeSolanaObservation(BASE_SOLANA_OBS).grossAmount).toBe(12.5);
  });

  it('has null netAmount and feeAmount (not calculated at ingestion)', () => {
    const p = normalizeSolanaObservation(BASE_SOLANA_OBS);
    expect(p.netAmount).toBeNull();
    expect(p.feeAmount).toBeNull();
  });

  it('maps memo', () => {
    expect(normalizeSolanaObservation(BASE_SOLANA_OBS).memo).toBe('APV_1700000000000_deadbeef');
  });

  it('maps confirmed=true to observedStatus="confirmed"', () => {
    expect(normalizeSolanaObservation(BASE_SOLANA_OBS).observedStatus).toBe('confirmed');
  });

  it('maps confirmed=false to observedStatus="pending"', () => {
    const obs: SolanaObservation = { ...BASE_SOLANA_OBS, confirmed: false };
    expect(normalizeSolanaObservation(obs).observedStatus).toBe('pending');
  });

  it('includes all base fields in rawPayload', () => {
    const p = normalizeSolanaObservation(BASE_SOLANA_OBS);
    expect(p.rawPayload.txHash).toBe(BASE_SOLANA_OBS.txHash);
    expect(p.rawPayload.amountUsdc).toBe(12.5);
    expect(p.rawPayload.confirmationDepth).toBe(32);
    expect(p.rawPayload.confirmed).toBe(true);
  });

  it('includes slot in rawPayload when provided', () => {
    const obs: SolanaObservation = { ...BASE_SOLANA_OBS, slot: 123456789 };
    expect(normalizeSolanaObservation(obs).rawPayload.slot).toBe(123456789);
  });

  it('omits slot from rawPayload when not provided', () => {
    const p = normalizeSolanaObservation(BASE_SOLANA_OBS);
    expect('slot' in p.rawPayload).toBe(false);
  });

  it('includes blockTime in rawPayload when provided', () => {
    const obs: SolanaObservation = { ...BASE_SOLANA_OBS, blockTime: 1700000000 };
    expect(normalizeSolanaObservation(obs).rawPayload.blockTime).toBe(1700000000);
  });

  it('handles null sender', () => {
    const obs: SolanaObservation = { ...BASE_SOLANA_OBS, sender: null };
    expect(normalizeSolanaObservation(obs).sender).toBeNull();
  });

  it('handles null memo', () => {
    const obs: SolanaObservation = { ...BASE_SOLANA_OBS, memo: null };
    expect(normalizeSolanaObservation(obs).memo).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. normalizeStripeObservation — Workers version
// ---------------------------------------------------------------------------

describe('normalizeStripeObservation() [Workers]', () => {
  it('sets protocol to stripe', () => {
    expect(normalizeStripeObservation(BASE_STRIPE_SESSION_OBS).protocol).toBe('stripe');
  });

  it('maps checkout.session.completed → proofType=stripe_session_id', () => {
    expect(normalizeStripeObservation(BASE_STRIPE_SESSION_OBS).proofType).toBe('stripe_session_id');
  });

  it('maps payment_intent.succeeded → proofType=stripe_pi_id', () => {
    expect(normalizeStripeObservation(BASE_STRIPE_PI_OBS).proofType).toBe('stripe_pi_id');
  });

  it('maps externalId to externalRef', () => {
    expect(normalizeStripeObservation(BASE_STRIPE_SESSION_OBS).externalRef).toBe('cs_test_abc123');
  });

  it('maps customerId to sender', () => {
    expect(normalizeStripeObservation(BASE_STRIPE_SESSION_OBS).sender).toBe('cus_xyz789');
  });

  it('maps connectedAccountId to recipient', () => {
    expect(normalizeStripeObservation(BASE_STRIPE_SESSION_OBS).recipient).toBe('acct_connected001');
  });

  it('maps amountTotal to grossAmount', () => {
    expect(normalizeStripeObservation(BASE_STRIPE_SESSION_OBS).grossAmount).toBe(1250);
  });

  it('has null netAmount and feeAmount', () => {
    const p = normalizeStripeObservation(BASE_STRIPE_SESSION_OBS);
    expect(p.netAmount).toBeNull();
    expect(p.feeAmount).toBeNull();
  });

  it('extracts metadata.reference into memo', () => {
    expect(normalizeStripeObservation(BASE_STRIPE_SESSION_OBS).memo).toBe('order-42');
  });

  it('returns null memo when metadata.reference is absent', () => {
    const obs: StripeObservation = { ...BASE_STRIPE_SESSION_OBS, metadata: {} };
    expect(normalizeStripeObservation(obs).memo).toBeNull();
  });

  it('maps status=succeeded → observedStatus=confirmed', () => {
    expect(normalizeStripeObservation(BASE_STRIPE_SESSION_OBS).observedStatus).toBe('confirmed');
  });

  it('maps status=canceled → observedStatus=failed', () => {
    const obs: StripeObservation = { ...BASE_STRIPE_SESSION_OBS, status: 'canceled' };
    expect(normalizeStripeObservation(obs).observedStatus).toBe('failed');
  });

  it('maps status=pending → observedStatus=pending', () => {
    const obs: StripeObservation = { ...BASE_STRIPE_SESSION_OBS, status: 'pending' };
    expect(normalizeStripeObservation(obs).observedStatus).toBe('pending');
  });

  it('includes all source fields in rawPayload', () => {
    const p = normalizeStripeObservation(BASE_STRIPE_SESSION_OBS);
    expect(p.rawPayload.stripeEventType).toBe('checkout.session.completed');
    expect(p.rawPayload.externalId).toBe('cs_test_abc123');
    expect(p.rawPayload.amountTotal).toBe(1250);
    expect(p.rawPayload.currency).toBe('usd');
    expect(p.rawPayload.status).toBe('succeeded');
  });

  it('handles null customerId and connectedAccountId', () => {
    const p = normalizeStripeObservation(BASE_STRIPE_PI_OBS);
    expect(p.sender).toBeNull();
    expect(p.recipient).toBeNull();
  });

  it('handles null amountTotal', () => {
    const obs: StripeObservation = { ...BASE_STRIPE_SESSION_OBS, amountTotal: null };
    expect(normalizeStripeObservation(obs).grossAmount).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. persistNormalizedProof — Workers SQL writer
// ---------------------------------------------------------------------------

describe('persistNormalizedProof() [Workers]', () => {
  const SOLANA_PROOF: NormalizedProof = normalizeSolanaObservation(BASE_SOLANA_OBS);
  const STRIPE_PROOF: NormalizedProof = normalizeStripeObservation(BASE_STRIPE_SESSION_OBS);

  it('returns an eventId on success', async () => {
    const sql = makeSqlMock([]);

    const result = await persistNormalizedProof(sql as any, SOLANA_PROOF);

    expect(result).not.toBeNull();
    expect(typeof result!.eventId).toBe('string');
    expect(result!.eventId.length).toBeGreaterThan(0);
  });

  it('calls sql once (the INSERT)', async () => {
    const sql = makeSqlMock([]);

    await persistNormalizedProof(sql as any, SOLANA_PROOF);

    expect(sql).toHaveBeenCalledTimes(1);
  });

  it('passes protocol in the INSERT values', async () => {
    const sql = makeSqlMock([]);

    await persistNormalizedProof(sql as any, SOLANA_PROOF);

    const values = sql.mock.calls[0].slice(1);
    expect(values).toContain('solana');
  });

  it('passes externalRef in the INSERT values', async () => {
    const sql = makeSqlMock([]);

    await persistNormalizedProof(sql as any, SOLANA_PROOF);

    const values = sql.mock.calls[0].slice(1);
    expect(values).toContain(BASE_SOLANA_OBS.txHash);
  });

  it('passes settlementIdentityId when provided', async () => {
    const sql = makeSqlMock([]);
    const opts = { settlementIdentityId: 'si-uuid-001', intentId: 'intent-uuid-001' };

    await persistNormalizedProof(sql as any, SOLANA_PROOF, opts);

    const values = sql.mock.calls[0].slice(1);
    expect(values).toContain('si-uuid-001');
    expect(values).toContain('intent-uuid-001');
  });

  it('passes null for settlementIdentityId when not provided', async () => {
    const sql = makeSqlMock([]);

    await persistNormalizedProof(sql as any, SOLANA_PROOF);

    const values = sql.mock.calls[0].slice(1);
    expect(values).toContain(null);
  });

  it('returns null (does not throw) when settlement_events table is missing', async () => {
    const sql = makeSqlErrorMock(
      new Error('relation "settlement_events" does not exist'),
    );

    const result = await persistNormalizedProof(sql as any, SOLANA_PROOF);

    expect(result).toBeNull();
  });

  it('returns null (does not throw) on unexpected DB error', async () => {
    const sql = makeSqlErrorMock(new Error('connection reset by peer'));

    const result = await persistNormalizedProof(sql as any, STRIPE_PROOF);

    expect(result).toBeNull();
  });

  it('uses on_chain_confirmed event_type for confirmed Solana proof', async () => {
    const sql = makeSqlMock([]);

    await persistNormalizedProof(sql as any, SOLANA_PROOF);

    const values = sql.mock.calls[0].slice(1);
    expect(values).toContain('on_chain_confirmed');
  });

  it('uses webhook_received event_type for confirmed Stripe proof', async () => {
    const sql = makeSqlMock([]);

    await persistNormalizedProof(sql as any, STRIPE_PROOF);

    const values = sql.mock.calls[0].slice(1);
    expect(values).toContain('webhook_received');
  });

  it('uses hash_submitted event_type for pending proof', async () => {
    const pendingProof: NormalizedProof = {
      ...SOLANA_PROOF,
      observedStatus: 'pending',
    };
    const sql = makeSqlMock([]);

    await persistNormalizedProof(sql as any, pendingProof);

    const values = sql.mock.calls[0].slice(1);
    expect(values).toContain('hash_submitted');
  });

  it('uses resolution_failed event_type for failed proof', async () => {
    const failedProof: NormalizedProof = {
      ...SOLANA_PROOF,
      observedStatus: 'failed',
    };
    const sql = makeSqlMock([]);

    await persistNormalizedProof(sql as any, failedProof);

    const values = sql.mock.calls[0].slice(1);
    expect(values).toContain('resolution_failed');
  });

  it('includes normalized fields in the JSONB payload blob', async () => {
    const sql = makeSqlMock([]);

    await persistNormalizedProof(sql as any, SOLANA_PROOF);

    const values = sql.mock.calls[0].slice(1);
    const payloadArg = values.find(
      (v: unknown) => typeof v === 'string' && v.includes('grossAmount'),
    ) as string | undefined;
    expect(payloadArg).toBeDefined();
    const parsed = JSON.parse(payloadArg!.replace('::jsonb', '').trim());
    expect(parsed.grossAmount).toBe(12.5);
    expect(parsed.proofType).toBe('solana_tx_hash');
    expect(parsed.observedStatus).toBe('confirmed');
    expect(parsed.raw).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 4. Express normalization — identical logic to Workers
// ---------------------------------------------------------------------------

describe('normalizeSolanaObservation() [Express]', () => {
  it('produces the same output as the Workers version', () => {
    const workersResult = normalizeSolanaObservation(BASE_SOLANA_OBS);
    const expressResult = normalizeSolanaExpress(BASE_SOLANA_OBS);
    expect(expressResult).toEqual(workersResult);
  });
});

describe('normalizeStripeObservation() [Express]', () => {
  it('produces the same output as the Workers version', () => {
    const workersResult = normalizeStripeObservation(BASE_STRIPE_SESSION_OBS);
    const expressResult = normalizeStripeExpress(BASE_STRIPE_SESSION_OBS);
    expect(expressResult).toEqual(workersResult);
  });
});

// ---------------------------------------------------------------------------
// 5. ingestSolanaProof — Express wrapper
// ---------------------------------------------------------------------------

describe('ingestSolanaProof() [Express]', () => {
  beforeEach(() => jest.resetAllMocks());

  it('calls emitSettlementEvent and returns the event ID', () => {
    mockEmit.mockReturnValue('evt-solana-001');

    const id = ingestSolanaProof(BASE_SOLANA_OBS);

    expect(id).toBe('evt-solana-001');
    expect(mockEmit).toHaveBeenCalledTimes(1);
  });

  it('passes protocol=solana to emitSettlementEvent', () => {
    ingestSolanaProof(BASE_SOLANA_OBS);

    const call = mockEmit.mock.calls[0][0];
    expect(call.protocol).toBe('solana');
  });

  it('passes on_chain_confirmed eventType for a confirmed observation', () => {
    ingestSolanaProof(BASE_SOLANA_OBS);

    const call = mockEmit.mock.calls[0][0];
    expect(call.eventType).toBe('on_chain_confirmed');
  });

  it('passes hash_submitted eventType for a pending observation', () => {
    ingestSolanaProof({ ...BASE_SOLANA_OBS, confirmed: false });

    const call = mockEmit.mock.calls[0][0];
    expect(call.eventType).toBe('hash_submitted');
  });

  it('passes externalRef (txHash) to emitSettlementEvent', () => {
    ingestSolanaProof(BASE_SOLANA_OBS);

    const call = mockEmit.mock.calls[0][0];
    expect(call.externalRef).toBe(BASE_SOLANA_OBS.txHash);
  });

  it('forwards intentId and settlementIdentityId in opts', () => {
    ingestSolanaProof(BASE_SOLANA_OBS, {
      intentId: 'intent-uuid-111',
      settlementIdentityId: 'si-uuid-222',
    });

    const call = mockEmit.mock.calls[0][0];
    expect(call.intentId).toBe('intent-uuid-111');
    expect(call.settlementIdentityId).toBe('si-uuid-222');
  });

  it('includes normalized fields in payload', () => {
    ingestSolanaProof(BASE_SOLANA_OBS);

    const call = mockEmit.mock.calls[0][0];
    expect(call.payload.grossAmount).toBe(12.5);
    expect(call.payload.proofType).toBe('solana_tx_hash');
    expect(call.payload.observedStatus).toBe('confirmed');
    expect(call.payload.memo).toBe('APV_1700000000000_deadbeef');
    expect(call.payload.raw).toBeDefined();
  });

  it('works without opts (no intentId)', () => {
    expect(() => ingestSolanaProof(BASE_SOLANA_OBS)).not.toThrow();
    const call = mockEmit.mock.calls[0][0];
    expect(call.intentId).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 6. ingestStripeProof — Express wrapper
// ---------------------------------------------------------------------------

describe('ingestStripeProof() [Express]', () => {
  beforeEach(() => jest.resetAllMocks());

  it('calls emitSettlementEvent and returns the event ID', () => {
    mockEmit.mockReturnValue('evt-stripe-001');

    const id = ingestStripeProof(BASE_STRIPE_SESSION_OBS);

    expect(id).toBe('evt-stripe-001');
    expect(mockEmit).toHaveBeenCalledTimes(1);
  });

  it('passes protocol=stripe to emitSettlementEvent', () => {
    ingestStripeProof(BASE_STRIPE_SESSION_OBS);

    const call = mockEmit.mock.calls[0][0];
    expect(call.protocol).toBe('stripe');
  });

  it('passes webhook_received eventType for a succeeded session', () => {
    ingestStripeProof(BASE_STRIPE_SESSION_OBS);

    const call = mockEmit.mock.calls[0][0];
    expect(call.eventType).toBe('webhook_received');
  });

  it('passes resolution_failed eventType for a canceled Stripe event', () => {
    ingestStripeProof({ ...BASE_STRIPE_SESSION_OBS, status: 'canceled' });

    const call = mockEmit.mock.calls[0][0];
    expect(call.eventType).toBe('resolution_failed');
  });

  it('passes externalRef (session ID) to emitSettlementEvent', () => {
    ingestStripeProof(BASE_STRIPE_SESSION_OBS);

    const call = mockEmit.mock.calls[0][0];
    expect(call.externalRef).toBe('cs_test_abc123');
  });

  it('uses stripe_pi_id proofType for payment_intent.succeeded', () => {
    ingestStripeProof(BASE_STRIPE_PI_OBS);

    const call = mockEmit.mock.calls[0][0];
    expect(call.payload.proofType).toBe('stripe_pi_id');
  });

  it('includes grossAmount (cents) in payload', () => {
    ingestStripeProof(BASE_STRIPE_SESSION_OBS);

    const call = mockEmit.mock.calls[0][0];
    expect(call.payload.grossAmount).toBe(1250);
  });

  it('forwards intentId in opts', () => {
    ingestStripeProof(BASE_STRIPE_SESSION_OBS, { intentId: 'intent-stripe-333' });

    const call = mockEmit.mock.calls[0][0];
    expect(call.intentId).toBe('intent-stripe-333');
  });

  it('works without opts', () => {
    expect(() => ingestStripeProof(BASE_STRIPE_SESSION_OBS)).not.toThrow();
    const call = mockEmit.mock.calls[0][0];
    expect(call.intentId).toBeUndefined();
  });
});
