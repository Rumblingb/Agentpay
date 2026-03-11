/**
 * Unit tests for the Phase 6 Intent Resolution Engine.
 *
 * Covers:
 *   1. Pure helpers — toResolutionStatus(), toIntentStatus(), toConfidenceScore()
 *   2. evaluateProof() — the pure evaluation function
 *      a. Solana direct mode (by_recipient): happy path + all failure modes
 *      b. Amount matching: exact, overpaid, fee-tolerance, partial, underpaid
 *      c. Memo matching: requireMemoMatch on/off, missing memo, mismatch
 *      d. Missing context: no identity, no policy
 *      e. Protocol hooks: stripe, ap2 stubs
 *   3. runResolutionEngine() — the orchestrator (Prisma + services mocked)
 *      a. Happy path writes resolution + updates intent status
 *      b. Idempotency: returns existing resolution without re-writing
 *      c. Missing identity writes unmatched resolution
 *
 * No real DB required — Prisma and all services are mocked.
 */

// ── Mocks (must be before any imports that reference the modules) ──────────

jest.mock('../../src/lib/prisma', () => ({
  __esModule: true,
  default: {
    intentResolution: {
      findUnique: jest.fn(),
      create: jest.fn(),
      findMany: jest.fn(),
    },
    matchingPolicy: {
      findFirst: jest.fn(),
    },
    paymentIntent: {
      update: jest.fn(),
    },
  },
}));

jest.mock('../../src/settlement/settlementIdentityService', () => ({
  getActiveByIntentAndProtocol: jest.fn(),
  getSettlementIdentityById: jest.fn(),
}));

jest.mock('../../src/settlement/intentResolutionService', () => ({
  resolveIntent: jest.fn(),
  getResolution: jest.fn(),
}));

jest.mock('../../src/settlement/settlementEventService', () => ({
  emitSettlementEvent: jest.fn(),
}));

// ── Imports ────────────────────────────────────────────────────────────────

import {
  evaluateProof,
  runResolutionEngine,
  toResolutionStatus,
  toIntentStatus,
  toConfidenceScore,
  FEE_TOLERANCE_USDC,
  PARTIAL_TOLERANCE_PCT,
  type RunEngineParams,
  type EvaluationResult,
} from '../../src/settlement/intentResolutionEngine';

import { getActiveByIntentAndProtocol, getSettlementIdentityById } from '../../src/settlement/settlementIdentityService';
import { resolveIntent, getResolution } from '../../src/settlement/intentResolutionService';
import { emitSettlementEvent } from '../../src/settlement/settlementEventService';
import prisma from '../../src/lib/prisma';

import type {
  SettlementIdentityRecord,
  MatchingPolicyRecord,
  IntentResolutionRecord,
} from '../../src/settlement/types';

import type { NormalizedProof } from '../../src/settlement/settlementEventIngestion';

// ── Helpers ────────────────────────────────────────────────────────────────

const MERCHANT_WALLET = 'MerchWallet111111111111111111111111111111111';
const VERIFICATION_TOKEN = 'APV_1700000000000_deadbeef';
const INTENT_ID = 'intent-uuid-001';
const IDENTITY_ID = 'identity-uuid-001';
const POLICY_ID = 'policy-uuid-001';

function makeSolanaProof(overrides: Partial<NormalizedProof> = {}): NormalizedProof {
  return {
    protocol: 'solana',
    proofType: 'solana_tx_hash',
    externalRef: '5UXkLabcdef1234567890abcdef1234567890abcdef12',
    sender: 'PayerWallet111111111111111111111111111111111',
    recipient: MERCHANT_WALLET,
    grossAmount: 10.0,
    netAmount: null,
    feeAmount: null,
    memo: VERIFICATION_TOKEN,
    observedStatus: 'confirmed',
    rawPayload: { confirmationDepth: 32 },
    ...overrides,
  };
}

function makeIdentity(overrides: Partial<SettlementIdentityRecord> = {}): SettlementIdentityRecord {
  return {
    id: IDENTITY_ID,
    intentId: INTENT_ID,
    protocol: 'solana',
    externalRef: null,
    status: 'pending',
    settledAt: null,
    metadata: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makePolicy(overrides: Partial<MatchingPolicyRecord> = {}): MatchingPolicyRecord {
  return {
    id: POLICY_ID,
    protocol: 'solana',
    matchStrategy: 'by_recipient',
    requireMemoMatch: false,
    confirmationDepth: 2,
    ttlSeconds: 1800,
    isActive: true,
    config: { amountMode: 'exact', feeTolerance: FEE_TOLERANCE_USDC },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeResolutionRecord(overrides: Partial<IntentResolutionRecord> = {}): IntentResolutionRecord {
  return {
    id: 'resolution-uuid-001',
    intentId: INTENT_ID,
    settlementIdentityId: IDENTITY_ID,
    protocol: 'solana',
    resolvedBy: 'solana_listener',
    resolutionStatus: 'confirmed',
    decisionCode: 'matched',
    reasonCode: 'exact_amount',
    confidenceScore: 1.0,
    externalRef: '5UXkLxxx',
    confirmationDepth: 32,
    payerRef: 'PayerWallet1',
    resolvedAt: new Date().toISOString(),
    metadata: {},
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

// ── 1. Pure helper mappings ────────────────────────────────────────────────

describe('toResolutionStatus()', () => {
  it('matched → confirmed', () => expect(toResolutionStatus('matched')).toBe('confirmed'));
  it('matched_with_external_fee → confirmed', () =>
    expect(toResolutionStatus('matched_with_external_fee')).toBe('confirmed'));
  it('overpaid → confirmed', () => expect(toResolutionStatus('overpaid')).toBe('confirmed'));
  it('partial_match → failed', () => expect(toResolutionStatus('partial_match')).toBe('failed'));
  it('underpaid → failed', () => expect(toResolutionStatus('underpaid')).toBe('failed'));
  it('unmatched → failed', () => expect(toResolutionStatus('unmatched')).toBe('failed'));
  it('rejected → failed', () => expect(toResolutionStatus('rejected')).toBe('failed'));
});

describe('toIntentStatus()', () => {
  it('confirmed → completed', () => expect(toIntentStatus('confirmed')).toBe('completed'));
  it('failed → failed', () => expect(toIntentStatus('failed')).toBe('failed'));
  it('expired → expired', () => expect(toIntentStatus('expired')).toBe('expired'));
  it('disputed → failed', () => expect(toIntentStatus('disputed')).toBe('failed'));
});

describe('toConfidenceScore()', () => {
  it('matched → 1.0', () => expect(toConfidenceScore('matched')).toBe(1.0));
  it('overpaid → 0.95', () => expect(toConfidenceScore('overpaid')).toBe(0.95));
  it('matched_with_external_fee → 0.92', () =>
    expect(toConfidenceScore('matched_with_external_fee')).toBe(0.92));
  it('partial_match → 0.65', () => expect(toConfidenceScore('partial_match')).toBe(0.65));
  it('underpaid → 0.25', () => expect(toConfidenceScore('underpaid')).toBe(0.25));
  it('unmatched → 0.0', () => expect(toConfidenceScore('unmatched')).toBe(0.0));
  it('rejected → 0.0', () => expect(toConfidenceScore('rejected')).toBe(0.0));
});

// ── 2. evaluateProof() ─────────────────────────────────────────────────────

describe('evaluateProof() — Solana by_recipient, exact amount, memo off', () => {
  const policy = makePolicy({ requireMemoMatch: false });
  const identity = makeIdentity();

  it('happy path: returns matched with confidence 1.0', () => {
    const proof = makeSolanaProof({ grossAmount: 10.0 });
    const result = evaluateProof(proof, {
      intentId: INTENT_ID,
      expectedAmountUsdc: 10.0,
      merchantWallet: MERCHANT_WALLET,
      verificationToken: VERIFICATION_TOKEN,
      settlementIdentity: identity,
      policy,
    });
    expect(result.decision).toBe('matched');
    expect(result.reasonCode).toBe('exact_amount');
    expect(result.resolutionStatus).toBe('confirmed');
    expect(result.confidenceScore).toBe(1.0);
    expect(result.identityMatched).toBe(true);
    expect(result.amountMatched).toBe(true);
    expect(result.metaMatched).toBe(true);
    expect(result.delta).toBe(0);
    expect(result.observedAmount).toBe(10.0);
    expect(result.expectedAmount).toBe(10.0);
  });

  it('wrong recipient → unmatched, recipient_mismatch', () => {
    const proof = makeSolanaProof({ recipient: 'WrongWallet1111111111111111111111111111111' });
    const result = evaluateProof(proof, {
      intentId: INTENT_ID,
      expectedAmountUsdc: 10.0,
      merchantWallet: MERCHANT_WALLET,
      verificationToken: VERIFICATION_TOKEN,
      settlementIdentity: identity,
      policy,
    });
    expect(result.decision).toBe('unmatched');
    expect(result.reasonCode).toBe('recipient_mismatch');
    expect(result.resolutionStatus).toBe('failed');
    expect(result.confidenceScore).toBe(0.0);
    expect(result.identityMatched).toBe(false);
  });

  it('null merchantWallet → unmatched, recipient_mismatch', () => {
    const proof = makeSolanaProof();
    const result = evaluateProof(proof, {
      intentId: INTENT_ID,
      expectedAmountUsdc: 10.0,
      merchantWallet: null,
      verificationToken: VERIFICATION_TOKEN,
      settlementIdentity: identity,
      policy,
    });
    expect(result.decision).toBe('unmatched');
    expect(result.reasonCode).toBe('recipient_mismatch');
  });
});

describe('evaluateProof() — amount matching', () => {
  const policy = makePolicy({ requireMemoMatch: false });
  const identity = makeIdentity();
  const ctx = {
    intentId: INTENT_ID,
    expectedAmountUsdc: 10.0,
    merchantWallet: MERCHANT_WALLET,
    verificationToken: VERIFICATION_TOKEN,
    settlementIdentity: identity,
    policy,
  };

  it('overpayment → overpaid, overpay_accepted, confirmed', () => {
    const result = evaluateProof(makeSolanaProof({ grossAmount: 12.0 }), ctx);
    expect(result.decision).toBe('overpaid');
    expect(result.reasonCode).toBe('overpay_accepted');
    expect(result.resolutionStatus).toBe('confirmed');
    expect(result.delta).toBe(2.0);
    expect(result.observedAmount).toBe(12.0);
  });

  it('shortfall within fee tolerance → matched_with_external_fee, external_fee_detected', () => {
    const proof = makeSolanaProof({ grossAmount: 10.0 - FEE_TOLERANCE_USDC });
    const result = evaluateProof(proof, ctx);
    expect(result.decision).toBe('matched_with_external_fee');
    expect(result.reasonCode).toBe('external_fee_detected');
    expect(result.resolutionStatus).toBe('confirmed');
    expect(result.confidenceScore).toBe(0.92);
    expect(result.amountMatched).toBe(true);
  });

  it('shortfall exactly at fee tolerance boundary → matched_with_external_fee', () => {
    const proof = makeSolanaProof({ grossAmount: 10.0 - FEE_TOLERANCE_USDC });
    const result = evaluateProof(proof, ctx);
    expect(result.decision).toBe('matched_with_external_fee');
  });

  it('shortfall just above fee tolerance but within partial threshold → partial_match', () => {
    // 5 % of $10 = $0.50 partial threshold; fee tolerance = $0.02
    // $9.70 is a $0.30 shortfall: above the $0.02 fee tolerance,
    // and within the $0.50 (5%) partial threshold — so it's a partial_match
    const proof = makeSolanaProof({ grossAmount: 9.70 });
    const result = evaluateProof(proof, ctx);
    expect(result.decision).toBe('partial_match');
    expect(result.reasonCode).toBe('amount_mismatch');
    expect(result.resolutionStatus).toBe('failed');
    expect(result.confidenceScore).toBe(0.65);
    expect(result.amountMatched).toBe(false);
  });

  it('shortfall beyond partial tolerance → underpaid', () => {
    const proof = makeSolanaProof({ grossAmount: 8.0 }); // $2 short on $10 = 20%
    const result = evaluateProof(proof, ctx);
    expect(result.decision).toBe('underpaid');
    expect(result.reasonCode).toBe('amount_mismatch');
    expect(result.resolutionStatus).toBe('failed');
    expect(result.confidenceScore).toBe(0.25);
    expect(result.delta).toBe(-2.0);
  });

  it('null grossAmount → unmatched (amount unknown)', () => {
    const proof = makeSolanaProof({ grossAmount: null });
    const result = evaluateProof(proof, ctx);
    // Identity passes (recipient matches), amount fails because grossAmount is null
    expect(result.decision).toBe('unmatched');
    expect(result.reasonCode).toBe('amount_mismatch');
    expect(result.delta).toBeNull();
  });

  it('amountMode=at_least with overpayment → overpaid, confirmed', () => {
    const p = makePolicy({ config: { amountMode: 'at_least' }, requireMemoMatch: false });
    const result = evaluateProof(makeSolanaProof({ grossAmount: 15.0 }), { ...ctx, policy: p });
    expect(result.decision).toBe('overpaid');
    expect(result.resolutionStatus).toBe('confirmed');
  });

  it('amountMode=at_least with shortfall → underpaid', () => {
    const p = makePolicy({ config: { amountMode: 'at_least' }, requireMemoMatch: false });
    const result = evaluateProof(makeSolanaProof({ grossAmount: 5.0 }), { ...ctx, policy: p });
    expect(result.decision).toBe('underpaid');
    expect(result.resolutionStatus).toBe('failed');
  });

  it('amountMode=any with positive amount → matched', () => {
    const p = makePolicy({ config: { amountMode: 'any' }, requireMemoMatch: false });
    const result = evaluateProof(makeSolanaProof({ grossAmount: 0.01 }), { ...ctx, policy: p });
    expect(result.decision).toBe('matched');
  });

  it('amountMode=any with zero amount → unmatched', () => {
    const p = makePolicy({ config: { amountMode: 'any' }, requireMemoMatch: false });
    const result = evaluateProof(makeSolanaProof({ grossAmount: 0 }), { ...ctx, policy: p });
    expect(result.decision).toBe('unmatched');
  });

  it('policy.config.feeTolerance override is respected', () => {
    // Set a custom $1.00 fee tolerance
    const p = makePolicy({
      config: { amountMode: 'exact', feeTolerance: 1.0 },
      requireMemoMatch: false,
    });
    const proof = makeSolanaProof({ grossAmount: 9.50 }); // $0.50 short
    const result = evaluateProof(proof, { ...ctx, policy: p });
    expect(result.decision).toBe('matched_with_external_fee');
    expect(result.reasonCode).toBe('external_fee_detected');
  });
});

describe('evaluateProof() — memo / reference matching', () => {
  const identity = makeIdentity();
  const policyWithMemo = makePolicy({ requireMemoMatch: true });
  const ctx = {
    intentId: INTENT_ID,
    expectedAmountUsdc: 10.0,
    merchantWallet: MERCHANT_WALLET,
    verificationToken: VERIFICATION_TOKEN,
    settlementIdentity: identity,
    policy: policyWithMemo,
  };

  it('memo matches verificationToken → matched', () => {
    const proof = makeSolanaProof({ memo: VERIFICATION_TOKEN });
    const result = evaluateProof(proof, ctx);
    expect(result.decision).toBe('matched');
    expect(result.metaMatched).toBe(true);
  });

  it('memo missing → rejected, memo_missing', () => {
    const proof = makeSolanaProof({ memo: null });
    const result = evaluateProof(proof, ctx);
    expect(result.decision).toBe('rejected');
    expect(result.reasonCode).toBe('memo_missing');
    expect(result.resolutionStatus).toBe('failed');
    expect(result.confidenceScore).toBe(0.0);
    expect(result.metaMatched).toBe(false);
  });

  it('memo mismatch → rejected, memo_mismatch', () => {
    const proof = makeSolanaProof({ memo: 'wrong-token-12345' });
    const result = evaluateProof(proof, ctx);
    expect(result.decision).toBe('rejected');
    expect(result.reasonCode).toBe('memo_mismatch');
    expect(result.metaMatched).toBe(false);
  });

  it('requireMemoMatch=false + missing memo → matched (memo not checked)', () => {
    const policyNoMemo = makePolicy({ requireMemoMatch: false });
    const proof = makeSolanaProof({ memo: null });
    const result = evaluateProof(proof, { ...ctx, policy: policyNoMemo });
    expect(result.decision).toBe('matched');
    expect(result.metaMatched).toBe(true);
  });

  it('memo fail does not trigger if identity already failed', () => {
    // Wrong recipient → unmatched, not rejected (identity wins)
    const proof = makeSolanaProof({
      recipient: 'WrongWallet111111111111111111111111111111111',
      memo: null,
    });
    const result = evaluateProof(proof, ctx);
    expect(result.decision).toBe('unmatched');
    expect(result.reasonCode).toBe('recipient_mismatch');
  });
});

describe('evaluateProof() — missing context', () => {
  it('no settlement identity, no policy → rejected, no_settlement_identity', () => {
    const proof = makeSolanaProof();
    const result = evaluateProof(proof, {
      intentId: INTENT_ID,
      expectedAmountUsdc: 10.0,
      merchantWallet: MERCHANT_WALLET,
      verificationToken: VERIFICATION_TOKEN,
      settlementIdentity: null,
      policy: null,
    });
    expect(result.decision).toBe('rejected');
    expect(result.reasonCode).toBe('no_settlement_identity');
    expect(result.resolutionStatus).toBe('failed');
    expect(result.confidenceScore).toBe(0.0);
  });

  it('identity present but no policy → rejected, no_matching_policy', () => {
    const proof = makeSolanaProof();
    const result = evaluateProof(proof, {
      intentId: INTENT_ID,
      expectedAmountUsdc: 10.0,
      merchantWallet: MERCHANT_WALLET,
      verificationToken: VERIFICATION_TOKEN,
      settlementIdentity: makeIdentity(),
      policy: null,
    });
    expect(result.decision).toBe('rejected');
    expect(result.reasonCode).toBe('no_matching_policy');
  });

  it('identity missing (policy present) → unmatched, no_settlement_identity', () => {
    const proof = makeSolanaProof();
    const result = evaluateProof(proof, {
      intentId: INTENT_ID,
      expectedAmountUsdc: 10.0,
      merchantWallet: MERCHANT_WALLET,
      verificationToken: VERIFICATION_TOKEN,
      settlementIdentity: null,
      policy: makePolicy(),
    });
    expect(result.decision).toBe('unmatched');
    expect(result.reasonCode).toBe('no_settlement_identity');
  });
});

describe('evaluateProof() — Solana by_memo strategy', () => {
  const policy = makePolicy({ matchStrategy: 'by_memo', requireMemoMatch: false });
  const identity = makeIdentity();
  const ctx = {
    intentId: INTENT_ID,
    expectedAmountUsdc: 10.0,
    merchantWallet: MERCHANT_WALLET,
    verificationToken: VERIFICATION_TOKEN,
    settlementIdentity: identity,
    policy,
  };

  it('memo matches verificationToken → matched', () => {
    const proof = makeSolanaProof({ memo: VERIFICATION_TOKEN });
    const result = evaluateProof(proof, ctx);
    expect(result.decision).toBe('matched');
    expect(result.identityMatched).toBe(true);
  });

  it('memo missing → unmatched, memo_missing', () => {
    const proof = makeSolanaProof({ memo: null });
    const result = evaluateProof(proof, ctx);
    expect(result.decision).toBe('unmatched');
    expect(result.reasonCode).toBe('memo_missing');
  });
});

describe('evaluateProof() — Stripe by_external_ref stub', () => {
  function makeStripeProof(overrides: Partial<NormalizedProof> = {}): NormalizedProof {
    return {
      protocol: 'stripe',
      proofType: 'stripe_session_id',
      externalRef: 'cs_test_abc123',
      sender: 'cus_xyz',
      recipient: 'acct_connected',
      grossAmount: 1000, // cents (stripe uses cents; engine receives USDC equivalent)
      netAmount: null,
      feeAmount: null,
      memo: null,
      observedStatus: 'confirmed',
      rawPayload: {},
      ...overrides,
    };
  }

  const policy = makePolicy({
    protocol: 'stripe',
    matchStrategy: 'by_external_ref',
    requireMemoMatch: false,
    config: { amountMode: 'exact' },
  });
  const identity = makeIdentity({
    protocol: 'stripe',
    externalRef: 'cs_test_abc123',
  });
  const ctx = {
    intentId: INTENT_ID,
    expectedAmountUsdc: 1000,
    merchantWallet: null,
    verificationToken: null,
    settlementIdentity: identity,
    policy,
  };

  it('matching externalRef + exact amount → matched', () => {
    const result = evaluateProof(makeStripeProof(), ctx);
    expect(result.decision).toBe('matched');
    expect(result.identityMatched).toBe(true);
  });

  it('wrong externalRef → unmatched, external_ref_mismatch', () => {
    const result = evaluateProof(makeStripeProof({ externalRef: 'cs_test_wrong' }), ctx);
    expect(result.decision).toBe('unmatched');
    expect(result.reasonCode).toBe('external_ref_mismatch');
  });
});

describe('evaluateProof() — result shape invariants', () => {
  it('delta = observedAmount - expectedAmount for all decisions', () => {
    const cases: Array<[number, string]> = [
      [10.0, 'matched'],
      [12.0, 'overpaid'],
      [9.99, 'matched_with_external_fee'],
    ];
    const identity = makeIdentity();
    const policy = makePolicy({ requireMemoMatch: false });

    for (const [grossAmount, expectedDecision] of cases) {
      const proof = makeSolanaProof({ grossAmount });
      const result = evaluateProof(proof, {
        intentId: INTENT_ID,
        expectedAmountUsdc: 10.0,
        merchantWallet: MERCHANT_WALLET,
        verificationToken: VERIFICATION_TOKEN,
        settlementIdentity: identity,
        policy,
      });
      expect(result.decision).toBe(expectedDecision);
      if (result.delta !== null) {
        expect(result.observedAmount).toBe(result.expectedAmount + result.delta);
      }
    }
  });

  it('confidenceScore is always between 0 and 1', () => {
    const identity = makeIdentity();
    const policy = makePolicy({ requireMemoMatch: false });
    const amounts = [0.01, 8.0, 9.70, 9.99, 10.0, 11.0];

    for (const grossAmount of amounts) {
      const result = evaluateProof(makeSolanaProof({ grossAmount }), {
        intentId: INTENT_ID,
        expectedAmountUsdc: 10.0,
        merchantWallet: MERCHANT_WALLET,
        verificationToken: VERIFICATION_TOKEN,
        settlementIdentity: identity,
        policy,
      });
      expect(result.confidenceScore).toBeGreaterThanOrEqual(0);
      expect(result.confidenceScore).toBeLessThanOrEqual(1);
    }
  });
});

// ── 3. runResolutionEngine() ───────────────────────────────────────────────

const mockGetActiveByIntentAndProtocol = getActiveByIntentAndProtocol as jest.Mock;
const mockGetSettlementIdentityById   = getSettlementIdentityById as jest.Mock;
const mockResolveIntent               = resolveIntent as jest.Mock;
const mockGetResolution               = getResolution as jest.Mock;
const mockEmitSettlementEvent         = emitSettlementEvent as jest.Mock;
const mockPrismaMatchingPolicy        = (prisma.matchingPolicy.findFirst as jest.Mock);
const mockPrismaPaymentIntent         = (prisma.paymentIntent.update as jest.Mock);

const BASE_PARAMS: RunEngineParams = {
  intentId: INTENT_ID,
  proof: makeSolanaProof({ grossAmount: 10.0 }),
  expectedAmountUsdc: 10.0,
  merchantWallet: MERCHANT_WALLET,
  verificationToken: VERIFICATION_TOKEN,
  resolvedBy: 'solana_listener',
};

function setupHappyPath() {
  mockGetResolution.mockResolvedValue(null); // not yet resolved
  mockGetActiveByIntentAndProtocol.mockResolvedValue(makeIdentity());
  mockPrismaMatchingPolicy.mockResolvedValue({
    id: POLICY_ID,
    protocol: 'solana',
    matchStrategy: 'by_recipient',
    requireMemoMatch: false,
    confirmationDepth: 2,
    ttlSeconds: 1800,
    isActive: true,
    config: { amountMode: 'exact', feeTolerance: FEE_TOLERANCE_USDC },
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  mockResolveIntent.mockResolvedValue(makeResolutionRecord());
  mockPrismaPaymentIntent.mockResolvedValue({});
  mockEmitSettlementEvent.mockReturnValue('event-id-001');
}

describe('runResolutionEngine()', () => {
  beforeEach(() => jest.resetAllMocks());

  it('happy path: returns EngineRunResult with matched decision', async () => {
    setupHappyPath();

    const result = await runResolutionEngine(BASE_PARAMS);

    expect(result.wasAlreadyResolved).toBe(false);
    expect(result.evaluation.decision).toBe('matched');
    expect(result.evaluation.resolutionStatus).toBe('confirmed');
    expect(result.evaluation.confidenceScore).toBe(1.0);
    expect(result.resolution).toBeDefined();
  });

  it('calls resolveIntent with correct params on match', async () => {
    setupHappyPath();

    await runResolutionEngine(BASE_PARAMS);

    expect(mockResolveIntent).toHaveBeenCalledTimes(1);
    const call = mockResolveIntent.mock.calls[0][0];
    expect(call.intentId).toBe(INTENT_ID);
    expect(call.protocol).toBe('solana');
    expect(call.resolvedBy).toBe('solana_listener');
    expect(call.resolutionStatus).toBe('confirmed');
    expect(call.decisionCode).toBe('matched');
    expect(call.reasonCode).toBe('exact_amount');
    expect(call.confidenceScore).toBe(1.0);
    expect(call.settlementIdentityId).toBe(IDENTITY_ID);
  });

  it('updates payment_intents.status to completed on confirmed resolution', async () => {
    setupHappyPath();

    await runResolutionEngine(BASE_PARAMS);

    expect(mockPrismaPaymentIntent).toHaveBeenCalledWith({
      where: { id: INTENT_ID },
      data: expect.objectContaining({ status: 'completed' }),
    });
  });

  it('updates payment_intents.status to failed on unmatched resolution', async () => {
    mockGetResolution.mockResolvedValue(null);
    mockGetActiveByIntentAndProtocol.mockResolvedValue(makeIdentity());
    mockPrismaMatchingPolicy.mockResolvedValue({
      id: POLICY_ID, protocol: 'solana', matchStrategy: 'by_recipient',
      requireMemoMatch: false, confirmationDepth: 2, ttlSeconds: 1800, isActive: true,
      config: { amountMode: 'exact' }, createdAt: new Date(), updatedAt: new Date(),
    });
    mockResolveIntent.mockResolvedValue(makeResolutionRecord({ resolutionStatus: 'failed', decisionCode: 'unmatched' }));
    mockPrismaPaymentIntent.mockResolvedValue({});
    mockEmitSettlementEvent.mockReturnValue('event-id-002');

    const params: RunEngineParams = {
      ...BASE_PARAMS,
      proof: makeSolanaProof({ recipient: 'WrongWallet1111111111111111111111111111111' }),
    };

    await runResolutionEngine(params);

    expect(mockPrismaPaymentIntent).toHaveBeenCalledWith({
      where: { id: INTENT_ID },
      data: expect.objectContaining({ status: 'failed' }),
    });
  });

  it('emits settlement event fire-and-forget', async () => {
    setupHappyPath();

    await runResolutionEngine(BASE_PARAMS);

    expect(mockEmitSettlementEvent).toHaveBeenCalledTimes(1);
    const call = mockEmitSettlementEvent.mock.calls[0][0];
    expect(call.eventType).toBe('on_chain_confirmed');
    expect(call.intentId).toBe(INTENT_ID);
    expect(call.payload.decision).toBe('matched');
    expect(call.payload.reasonCode).toBe('exact_amount');
  });

  it('idempotency: returns existing resolution without re-writing', async () => {
    const existing = makeResolutionRecord();
    mockGetResolution.mockResolvedValue(existing);

    const result = await runResolutionEngine(BASE_PARAMS);

    expect(result.wasAlreadyResolved).toBe(true);
    expect(result.resolution).toEqual(existing);
    expect(mockResolveIntent).not.toHaveBeenCalled();
    expect(mockPrismaPaymentIntent).not.toHaveBeenCalled();
  });

  it('missing settlement identity → unmatched resolution written', async () => {
    mockGetResolution.mockResolvedValue(null);
    mockGetActiveByIntentAndProtocol.mockResolvedValue(null); // no identity
    mockPrismaMatchingPolicy.mockResolvedValue({
      id: POLICY_ID, protocol: 'solana', matchStrategy: 'by_recipient',
      requireMemoMatch: false, confirmationDepth: 2, ttlSeconds: 1800, isActive: true,
      config: { amountMode: 'exact' }, createdAt: new Date(), updatedAt: new Date(),
    });
    mockResolveIntent.mockResolvedValue(makeResolutionRecord({ resolutionStatus: 'failed', decisionCode: 'unmatched' }));
    mockPrismaPaymentIntent.mockResolvedValue({});
    mockEmitSettlementEvent.mockReturnValue('event-id-003');

    const result = await runResolutionEngine(BASE_PARAMS);

    expect(result.evaluation.decision).toBe('unmatched');
    expect(result.evaluation.reasonCode).toBe('no_settlement_identity');
    expect(mockResolveIntent).toHaveBeenCalledWith(
      expect.objectContaining({ decisionCode: 'unmatched', reasonCode: 'no_settlement_identity' }),
    );
  });

  it('missing policy → rejected resolution written', async () => {
    mockGetResolution.mockResolvedValue(null);
    mockGetActiveByIntentAndProtocol.mockResolvedValue(makeIdentity());
    mockPrismaMatchingPolicy.mockResolvedValue(null); // no policy
    mockResolveIntent.mockResolvedValue(makeResolutionRecord({ resolutionStatus: 'failed', decisionCode: 'rejected' }));
    mockPrismaPaymentIntent.mockResolvedValue({});
    mockEmitSettlementEvent.mockReturnValue('event-id-004');

    const result = await runResolutionEngine(BASE_PARAMS);

    expect(result.evaluation.decision).toBe('rejected');
    expect(result.evaluation.reasonCode).toBe('no_matching_policy');
  });

  it('uses pre-loaded settlementIdentityId when provided', async () => {
    mockGetResolution.mockResolvedValue(null);
    mockGetSettlementIdentityById.mockResolvedValue(makeIdentity());
    mockPrismaMatchingPolicy.mockResolvedValue({
      id: POLICY_ID, protocol: 'solana', matchStrategy: 'by_recipient',
      requireMemoMatch: false, confirmationDepth: 2, ttlSeconds: 1800, isActive: true,
      config: { amountMode: 'exact' }, createdAt: new Date(), updatedAt: new Date(),
    });
    mockResolveIntent.mockResolvedValue(makeResolutionRecord());
    mockPrismaPaymentIntent.mockResolvedValue({});
    mockEmitSettlementEvent.mockReturnValue('event-id-005');

    await runResolutionEngine({ ...BASE_PARAMS, settlementIdentityId: IDENTITY_ID });

    // Should use getSettlementIdentityById, not getActiveByIntentAndProtocol
    expect(mockGetSettlementIdentityById).toHaveBeenCalledWith(IDENTITY_ID);
    expect(mockGetActiveByIntentAndProtocol).not.toHaveBeenCalled();
  });

  it('intent status update failure does not throw (non-fatal)', async () => {
    setupHappyPath();
    mockPrismaPaymentIntent.mockRejectedValue(new Error('DB connection lost'));

    // Should NOT throw — intent update is best-effort
    await expect(runResolutionEngine(BASE_PARAMS)).resolves.toBeDefined();
  });

  it('resolution record includes metadata with observedAmount and delta', async () => {
    setupHappyPath();

    await runResolutionEngine(BASE_PARAMS);

    const call = mockResolveIntent.mock.calls[0][0];
    expect(call.metadata.observedAmount).toBe(10.0);
    expect(call.metadata.expectedAmount).toBe(10.0);
    expect(call.metadata.delta).toBe(0);
    expect(call.metadata.proofType).toBe('solana_tx_hash');
  });

  it('passes confirmationDepth from rawPayload to resolveIntent', async () => {
    setupHappyPath();
    const proof = makeSolanaProof({ rawPayload: { confirmationDepth: 64 } });

    await runResolutionEngine({ ...BASE_PARAMS, proof });

    const call = mockResolveIntent.mock.calls[0][0];
    expect(call.confirmationDepth).toBe(64);
  });
});
