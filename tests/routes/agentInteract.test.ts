/**
 * Route integration tests for POST /api/v1/agents/interact
 *
 * All external services (identity verifier, reputation, trust events,
 * intent coordinator) are mocked so the test suite runs without a DB.
 *
 * Test coverage:
 *  - Hard-fail validation (400) including createIntent without amount
 *  - identityFound vs identityVerified semantic separation
 *  - Richer trust event metadata (counterpartyId + extraMetadata)
 *  - Canonical recordTrustEvent reuse (no side-channel)
 *  - Soft-fail degradation paths (warnings[], 200 with partial response)
 */

// ─── DB / Prisma mocks (must come before any imports that touch the DB) ───────
jest.mock('../../src/db/index', () => ({
  query: jest.fn(),
  pool: { on: jest.fn() },
  closePool: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/lib/prisma', () => ({
  __esModule: true,
  default: {
    agent: { findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn() },
    agentTransaction: { findMany: jest.fn() },
    agentrank_scores: { findUnique: jest.fn(), upsert: jest.fn() },
    merchant: { findUnique: jest.fn() },
    paymentIntent: { create: jest.fn() },
    verificationCertificate: { create: jest.fn() },
    coordinatedTransaction: { create: jest.fn(), findUnique: jest.fn() },
    trustEvent: { create: jest.fn(), findMany: jest.fn(), count: jest.fn() },
  },
}));

// ─── Auth middleware mock ─────────────────────────────────────────────────────
jest.mock('../../src/middleware/auth', () => ({
  authenticateApiKey: (req: any, _res: any, next: any) => {
    req.merchant = { id: 'merchant-test-id', name: 'Test Merchant', email: 't@test.com', walletAddress: 'wa' };
    next();
  },
}));

// ─── Foundation-agent mocks ───────────────────────────────────────────────────
const mockGetIdentityRecord = jest.fn();

jest.mock('../../src/agents/index', () => ({
  identityVerifierAgent: {
    getIdentityRecord: (...args: any[]) => mockGetIdentityRecord(...args),
  },
  reputationOracleAgent: {},
  disputeResolverAgent: {},
  intentCoordinatorAgent: {},
}));

const mockCreateIntent = jest.fn();

jest.mock('../../src/agents/IntentCoordinatorAgent', () => ({
  intentCoordinatorAgent: {
    createIntent: (...args: any[]) => mockCreateIntent(...args),
  },
}));

// ─── Service mocks ────────────────────────────────────────────────────────────
const mockGetReputation = jest.fn();
jest.mock('../../src/services/reputationService', () => ({
  getReputation: (...args: any[]) => mockGetReputation(...args),
  updateReputationOnVerification: jest.fn(),
  emitReputationEvent: jest.fn(),
}));

const mockRecordTrustEvent = jest.fn();
jest.mock('../../src/services/trustEventService', () => ({
  recordTrustEvent: (...args: any[]) => mockRecordTrustEvent(...args),
  TRUST_EVENT_CATALOG: {},
  getTrustEvents: jest.fn().mockResolvedValue({ events: [], total: 0 }),
}));

// ─── Other service stubs (needed by server.ts dependencies) ──────────────────
jest.mock('../../src/services/solana-listener', () => ({ startSolanaListener: jest.fn() }));
jest.mock('../../src/services/liquidityService', () => ({ startLiquidityCron: jest.fn() }));
jest.mock('../../src/services/reconciliationDaemon', () => ({ startReconciliationDaemon: jest.fn() }));

// ─── Imports ──────────────────────────────────────────────────────────────────
import request from 'supertest';
import app from '../../src/server';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const BASE = '/api/v1/agents/interact';
const AUTH = { Authorization: 'Bearer sk_test_sim_12345' };

const VALID_BODY = {
  fromAgentId: 'agent-from-001',
  toAgentId: 'agent-to-002',
  interactionType: 'task',
  service: 'data-analysis',
  outcome: 'success',
};

/** Returns a mock identity record as returned by identityVerifierAgent.getIdentityRecord() */
const IDENTITY_RECORD = (agentId: string, verified = true) => ({
  agentId,
  verified,
  credentials: [],
  linkedIdentities: [],
  trustLevel: verified ? 'verified' : 'unverified',
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('POST /api/v1/agents/interact', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    // Default: identity lookup succeeds for both agents
    mockGetIdentityRecord
      .mockResolvedValueOnce(IDENTITY_RECORD('agent-from-001'))
      .mockResolvedValueOnce(IDENTITY_RECORD('agent-to-002'));
    // Default: trust event recording succeeds
    mockRecordTrustEvent.mockResolvedValue({ score: 100, grade: 'B' });
  });

  // ── Hard-fail validation (reviewer fix #1) ────────────────────────────────

  it('returns 400 when fromAgentId is missing', async () => {
    const { fromAgentId: _omit, ...body } = VALID_BODY;
    const res = await request(app).post(BASE).set(AUTH).send(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation error');
  });

  it('returns 400 when toAgentId is missing', async () => {
    const { toAgentId: _omit, ...body } = VALID_BODY;
    const res = await request(app).post(BASE).set(AUTH).send(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation error');
  });

  it('returns 400 for an invalid interactionType', async () => {
    const res = await request(app)
      .post(BASE)
      .set(AUTH)
      .send({ ...VALID_BODY, interactionType: 'invalid-type' });
    expect(res.status).toBe(400);
  });

  it('returns 400 for an invalid outcome', async () => {
    const res = await request(app)
      .post(BASE)
      .set(AUTH)
      .send({ ...VALID_BODY, outcome: 'unknown' });
    expect(res.status).toBe(400);
  });

  it('returns 400 (hard fail) when createIntent is true but amount is missing', async () => {
    // This is a hard fail — not a warning — because the caller explicitly
    // requested something that cannot succeed without the missing field.
    const res = await request(app)
      .post(BASE)
      .set(AUTH)
      .send({ ...VALID_BODY, createIntent: true }); // no amount

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation error');
    expect(res.body.details.some((d: string) => d.includes('amount is required when createIntent is true'))).toBe(true);
  });

  // ── Auth ─────────────────────────────────────────────────────────────────────

  it('endpoint exists and responds (auth mock always passes in test mode)', async () => {
    const res = await request(app).post(BASE).set(AUTH).send(VALID_BODY);
    expect([200, 400, 401]).toContain(res.status);
  });

  // ── Happy path ────────────────────────────────────────────────────────────

  it('returns 200 with structured response on minimal valid input', async () => {
    const res = await request(app).post(BASE).set(AUTH).send(VALID_BODY);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(typeof res.body.interactionId).toBe('string');
    expect(res.body.interactionId).toMatch(/^interact_/);
    expect(res.body.fromAgent.agentId).toBe('agent-from-001');
    expect(res.body.toAgent.agentId).toBe('agent-to-002');
    expect(res.body.interaction.type).toBe('task');
    expect(res.body.interaction.outcome).toBe('success');
    expect(Array.isArray(res.body.warnings)).toBe(true);
    expect(Array.isArray(res.body.emittedEvents)).toBe(true);
    expect(res.body.intent).toBeNull();
  });

  // ── Identity semantics (reviewer fix #3) ─────────────────────────────────
  // identityFound = record exists; identityVerified = active credential exists.
  // These are DISTINCT fields — external agents must not conflate them.

  it('sets identityFound and identityVerified when lookup succeeds and agent is verified', async () => {
    const res = await request(app).post(BASE).set(AUTH).send(VALID_BODY);

    expect(res.status).toBe(200);
    expect(res.body.fromAgent.identityFound).toBe(true);
    expect(res.body.fromAgent.identityVerified).toBe(true);
    expect(res.body.toAgent.identityFound).toBe(true);
    expect(res.body.toAgent.identityVerified).toBe(true);
  });

  it('sets identityFound=true and identityVerified=false when agent has no active credential', async () => {
    jest.resetAllMocks();
    mockGetIdentityRecord
      .mockResolvedValueOnce(IDENTITY_RECORD('agent-from-001', false)) // unverified
      .mockResolvedValueOnce(IDENTITY_RECORD('agent-to-002', false));
    mockRecordTrustEvent.mockResolvedValue({ score: 50, grade: 'C' });

    const res = await request(app).post(BASE).set(AUTH).send(VALID_BODY);

    expect(res.status).toBe(200);
    expect(res.body.fromAgent.identityFound).toBe(true);
    expect(res.body.fromAgent.identityVerified).toBe(false);
    expect(res.body.fromAgent.trustLevel).toBe('unverified');
  });

  it('sets identityFound=false when identity lookup throws', async () => {
    jest.resetAllMocks();
    mockGetIdentityRecord
      .mockRejectedValueOnce(new Error('Agent not found'))
      .mockResolvedValueOnce(IDENTITY_RECORD('agent-to-002'));
    mockRecordTrustEvent.mockResolvedValue({ score: 50, grade: 'C' });

    const res = await request(app).post(BASE).set(AUTH).send(VALID_BODY);

    expect(res.status).toBe(200);
    expect(res.body.fromAgent.identityFound).toBe(false);
    expect(res.body.fromAgent.identityVerified).toBe(false);
  });

  // ── Richer trust event metadata (reviewer fix #2) ─────────────────────────
  // interactionType, service, trustCheck, createIntent are all preserved
  // in the event metadata — not collapsed to a binary success/failure.

  it('calls recordTrustEvent with counterpartyId and rich extraMetadata', async () => {
    await request(app).post(BASE).set(AUTH).send({
      ...VALID_BODY,
      outcome: 'success',
      trustCheck: true,
    });

    expect(mockRecordTrustEvent).toHaveBeenCalledWith(
      'agent-from-001',
      'successful_interaction',
      expect.any(String),
      'agent-to-002',               // counterpartyId — both sides of event captured
      expect.objectContaining({
        interactionType: 'task',    // richer semantics preserved
        service: 'data-analysis',
        outcome: 'success',
        trustCheckPerformed: true,
        intentCreationRequested: false,
      }),
    );
  });

  it('calls recordTrustEvent with "successful_interaction" when outcome is success', async () => {
    await request(app).post(BASE).set(AUTH).send({ ...VALID_BODY, outcome: 'success' });
    expect(mockRecordTrustEvent).toHaveBeenCalledWith(
      'agent-from-001',
      'successful_interaction',
      expect.any(String),
      'agent-to-002',
      expect.any(Object),
    );
  });

  it('calls recordTrustEvent with "failed_interaction" when outcome is failure', async () => {
    jest.resetAllMocks();
    mockGetIdentityRecord
      .mockResolvedValueOnce(IDENTITY_RECORD('agent-from-001'))
      .mockResolvedValueOnce(IDENTITY_RECORD('agent-to-002'));
    mockRecordTrustEvent.mockResolvedValue({ score: 90, grade: 'B' });

    await request(app).post(BASE).set(AUTH).send({ ...VALID_BODY, outcome: 'failure' });

    expect(mockRecordTrustEvent).toHaveBeenCalledWith(
      'agent-from-001',
      'failed_interaction',
      expect.any(String),
      'agent-to-002',
      expect.objectContaining({ outcome: 'failure' }),
    );
  });

  // ── interaction context preserved in response ─────────────────────────────

  it('preserves trustCheckPerformed and intentCreated in interaction field', async () => {
    const fakeIntent = { intentId: 'i-001', status: 'routing', route: {}, steps: [], executionMode: 'simulated', createdAt: new Date() };
    mockCreateIntent.mockResolvedValue(fakeIntent);

    const res = await request(app).post(BASE).set(AUTH).send({
      ...VALID_BODY,
      trustCheck: true,
      createIntent: true,
      amount: 5.0,
    });

    expect(res.status).toBe(200);
    expect(res.body.interaction.trustCheckPerformed).toBe(true);
    expect(res.body.interaction.intentCreated).toBe(true);
  });

  // ── trustCheck ───────────────────────────────────────────────────────────

  it('includes trustScore in toAgent when trustCheck is true', async () => {
    mockGetReputation.mockResolvedValue({
      trustScore: 82,
      totalPayments: 10,
      successRate: 0.9,
      disputeRate: 0.01,
      lastPaymentAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await request(app).post(BASE).set(AUTH).send({ ...VALID_BODY, trustCheck: true });

    expect(res.status).toBe(200);
    expect(res.body.toAgent.trustScore).toBe(82);
  });

  it('adds a warning (soft fail) when trustCheck is true but reputation lookup fails', async () => {
    mockGetReputation.mockRejectedValue(new Error('DB timeout'));

    const res = await request(app).post(BASE).set(AUTH).send({ ...VALID_BODY, trustCheck: true });

    expect(res.status).toBe(200);
    expect(res.body.warnings.some((w: string) => w.includes('Trust score lookup failed'))).toBe(true);
  });

  it('does NOT include trustScore when trustCheck is false', async () => {
    const res = await request(app).post(BASE).set(AUTH).send({ ...VALID_BODY, trustCheck: false });
    expect(res.status).toBe(200);
    expect('trustScore' in res.body.toAgent).toBe(false);
  });

  // ── createIntent ─────────────────────────────────────────────────────────

  it('creates intent when createIntent is true and amount is provided', async () => {
    const fakeIntent = { intentId: 'intent-001', status: 'routing', route: {}, steps: [], executionMode: 'simulated', createdAt: new Date() };
    mockCreateIntent.mockResolvedValue(fakeIntent);

    const res = await request(app)
      .post(BASE)
      .set(AUTH)
      .send({ ...VALID_BODY, createIntent: true, amount: 10.0, currency: 'USDC' });

    expect(res.status).toBe(200);
    expect(res.body.intent).not.toBeNull();
    expect(mockCreateIntent).toHaveBeenCalledWith(
      expect.objectContaining({ fromAgent: 'agent-from-001', toAgent: 'agent-to-002', amount: 10.0 }),
    );
  });

  it('adds a warning (soft fail) when intent creation coordinator throws', async () => {
    mockCreateIntent.mockRejectedValue(new Error('Coordinator offline'));

    const res = await request(app)
      .post(BASE)
      .set(AUTH)
      .send({ ...VALID_BODY, createIntent: true, amount: 5.0 });

    expect(res.status).toBe(200);
    expect(res.body.intent).toBeNull();
    expect(res.body.warnings.some((w: string) => w.includes('Intent creation failed'))).toBe(true);
  });

  // ── Soft-fail degradation (reviewer fix #1 boundary) ─────────────────────

  it('continues with 200 and adds warning when fromAgent identity lookup fails', async () => {
    jest.resetAllMocks();
    mockGetIdentityRecord
      .mockRejectedValueOnce(new Error('Identity service down'))
      .mockResolvedValueOnce(IDENTITY_RECORD('agent-to-002'));
    mockRecordTrustEvent.mockResolvedValue({ score: 50, grade: 'C' });

    const res = await request(app).post(BASE).set(AUTH).send(VALID_BODY);

    expect(res.status).toBe(200);
    expect(res.body.fromAgent.identityFound).toBe(false);
    expect(res.body.fromAgent.identityVerified).toBe(false);
    expect(res.body.warnings.some((w: string) => w.includes('fromAgent identity lookup unavailable'))).toBe(true);
  });

  it('continues with 200 and adds warning when trust event recording fails', async () => {
    jest.resetAllMocks();
    mockGetIdentityRecord
      .mockResolvedValueOnce(IDENTITY_RECORD('agent-from-001'))
      .mockResolvedValueOnce(IDENTITY_RECORD('agent-to-002'));
    mockRecordTrustEvent.mockRejectedValue(new Error('AgentRank DB offline'));

    const res = await request(app).post(BASE).set(AUTH).send(VALID_BODY);

    expect(res.status).toBe(200);
    expect(res.body.emittedEvents).toEqual([]);
    expect(res.body.warnings.some((w: string) => w.includes('Trust event recording failed'))).toBe(true);
  });

  // ── Emitted events shape ──────────────────────────────────────────────────

  it('returns emitted events with counterpartyId and metadata', async () => {
    const res = await request(app).post(BASE).set(AUTH).send(VALID_BODY);

    expect(res.status).toBe(200);
    if (res.body.emittedEvents.length > 0) {
      const ev = res.body.emittedEvents[0];
      expect(ev).toHaveProperty('category');
      expect(ev).toHaveProperty('agentId');
      expect(ev).toHaveProperty('counterpartyId', 'agent-to-002');
      expect(ev).toHaveProperty('delta');
      expect(ev).toHaveProperty('score');
      expect(ev).toHaveProperty('grade');
      expect(ev).toHaveProperty('metadata');
      expect(ev.metadata).toHaveProperty('interactionType');
      expect(ev.metadata).toHaveProperty('outcome');
    }
  });
});
