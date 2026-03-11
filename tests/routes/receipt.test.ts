/**
 * Route tests for GET /api/receipt/:intentId
 *
 * Tests: successful receipt fetch, not-found, verificationToken exclusion,
 * sanitizeIntent integration, rate-limiting headers.
 * Phase 8: resolution and settlement fields.
 */

jest.mock('../../src/db/index', () => ({
  query: jest.fn(),
  pool: { on: jest.fn() },
  closePool: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/lib/prisma', () => ({
  __esModule: true,
  default: {
    merchant: { findUnique: jest.fn(), findUniqueOrThrow: jest.fn() },
    paymentIntent: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    verificationCertificate: { create: jest.fn() },
    agentrank_scores: { findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
    agent: { findMany: jest.fn(), create: jest.fn(), findUnique: jest.fn() },
  },
}));

import request from 'supertest';
import app from '../../src/server';
import prisma from '../../src/lib/prisma';

const mockFindUnique = prisma.paymentIntent.findUnique as jest.Mock;

const MOCK_INTENT_BASE = {
  id: 'intent-uuid-receipt-001',
  amount: '15.50',
  currency: 'USDC',
  status: 'confirmed',
  protocol: 'ap2',
  agentId: 'agent-uuid-001',
  verificationToken: 'THIS-MUST-NOT-APPEAR-IN-RESPONSE',
  expiresAt: new Date('2030-01-01T00:00:00Z'),
  createdAt: new Date('2024-01-01T00:00:00Z'),
  updatedAt: new Date('2024-01-01T00:00:00Z'),
  agent: {
    id: 'agent-uuid-001',
    displayName: 'DataBot',
    riskScore: 5,
  },
  resolution: null,
  settlementIdentities: [],
};

const MOCK_RESOLUTION = {
  resolutionStatus: 'confirmed',
  decisionCode: 'matched',
  reasonCode: null,
  confidenceScore: '0.980',
  resolvedAt: new Date('2024-01-01T12:00:00Z'),
  resolvedBy: 'solana_listener',
  protocol: 'solana',
  externalRef: 'tx_abc123',
};

const MOCK_SETTLEMENT_IDENTITY = {
  status: 'settled',
  protocol: 'solana',
  externalRef: 'tx_abc123',
  settledAt: new Date('2024-01-01T12:00:00Z'),
};

// Backward-compat alias used by older tests
const MOCK_INTENT = MOCK_INTENT_BASE;

describe('GET /api/receipt/:intentId', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 200 with intent data for a valid intentId', async () => {
    mockFindUnique.mockResolvedValueOnce(MOCK_INTENT_BASE);
    const res = await request(app).get(`/api/receipt/${MOCK_INTENT_BASE.id}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.intent.id).toBe(MOCK_INTENT_BASE.id);
    expect(res.body.intent.status).toBe('confirmed');
  });

  it('NEVER exposes verificationToken in the response', async () => {
    mockFindUnique.mockResolvedValueOnce(MOCK_INTENT_BASE);
    const res = await request(app).get(`/api/receipt/${MOCK_INTENT_BASE.id}`);

    expect(res.status).toBe(200);
    // Check recursively — token must not appear anywhere
    const bodyStr = JSON.stringify(res.body);
    expect(bodyStr).not.toContain('THIS-MUST-NOT-APPEAR-IN-RESPONSE');
    expect(bodyStr).not.toContain('verificationToken');
  });

  it('includes agent info in the response', async () => {
    mockFindUnique.mockResolvedValueOnce(MOCK_INTENT_BASE);
    const res = await request(app).get(`/api/receipt/${MOCK_INTENT_BASE.id}`);

    expect(res.body.intent.agent).toBeDefined();
    expect(res.body.intent.agent.displayName).toBe('DataBot');
  });

  it('returns null agent when intent has no agent', async () => {
    const intentWithoutAgent = { ...MOCK_INTENT_BASE, agentId: null, agent: null };
    mockFindUnique.mockResolvedValueOnce(intentWithoutAgent);
    const res = await request(app).get(`/api/receipt/${MOCK_INTENT_BASE.id}`);

    expect(res.status).toBe(200);
    expect(res.body.intent.agent).toBeNull();
  });

  it('returns 404 for non-existent intentId', async () => {
    mockFindUnique.mockResolvedValueOnce(null);
    const res = await request(app).get('/api/receipt/00000000-0000-0000-0000-000000000000');

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('NOT_FOUND');
  });

  it('returns escrow:null in the response (future feature placeholder)', async () => {
    mockFindUnique.mockResolvedValueOnce(MOCK_INTENT_BASE);
    const res = await request(app).get(`/api/receipt/${MOCK_INTENT_BASE.id}`);

    expect(res.body.escrow).toBeNull();
  });

  it('returns 500 on DB error', async () => {
    mockFindUnique.mockRejectedValueOnce(new Error('DB connection lost'));
    const res = await request(app).get(`/api/receipt/${MOCK_INTENT_BASE.id}`);

    expect(res.status).toBe(500);
  });

  it('converts amount to number in response', async () => {
    mockFindUnique.mockResolvedValueOnce(MOCK_INTENT_BASE);
    const res = await request(app).get(`/api/receipt/${MOCK_INTENT_BASE.id}`);

    expect(typeof res.body.intent.amount).toBe('number');
    expect(res.body.intent.amount).toBe(15.5);
  });

  it('exposes timestamps as ISO strings', async () => {
    mockFindUnique.mockResolvedValueOnce(MOCK_INTENT_BASE);
    const res = await request(app).get(`/api/receipt/${MOCK_INTENT_BASE.id}`);

    expect(typeof res.body.intent.expiresAt).toBe('string');
    expect(res.body.intent.expiresAt).toContain('T');
  });

  // ── Phase 8: resolution field ────────────────────────────────────────────

  it('returns resolution:null when no resolution record exists', async () => {
    mockFindUnique.mockResolvedValueOnce(MOCK_INTENT_BASE);
    const res = await request(app).get(`/api/receipt/${MOCK_INTENT_BASE.id}`);

    expect(res.status).toBe(200);
    expect(res.body.resolution).toBeNull();
  });

  it('returns resolution object when Phase 6 engine has run', async () => {
    const intentWithResolution = {
      ...MOCK_INTENT_BASE,
      resolution: MOCK_RESOLUTION,
    };
    mockFindUnique.mockResolvedValueOnce(intentWithResolution);
    const res = await request(app).get(`/api/receipt/${MOCK_INTENT_BASE.id}`);

    expect(res.status).toBe(200);
    const { resolution } = res.body;
    expect(resolution).not.toBeNull();
    expect(resolution.status).toBe('confirmed');
    expect(resolution.decisionCode).toBe('matched');
    expect(resolution.reasonCode).toBeNull();
    expect(typeof resolution.confidenceScore).toBe('number');
    expect(resolution.confidenceScore).toBeCloseTo(0.98);
    expect(resolution.resolvedBy).toBe('solana_listener');
    expect(resolution.protocol).toBe('solana');
    expect(resolution.externalRef).toBe('tx_abc123');
    expect(resolution.resolvedAt).toContain('T'); // ISO string
  });

  it('resolution.confidenceScore is null when not set by engine', async () => {
    const intentWithResolution = {
      ...MOCK_INTENT_BASE,
      resolution: { ...MOCK_RESOLUTION, confidenceScore: null },
    };
    mockFindUnique.mockResolvedValueOnce(intentWithResolution);
    const res = await request(app).get(`/api/receipt/${MOCK_INTENT_BASE.id}`);

    expect(res.body.resolution.confidenceScore).toBeNull();
  });

  it('resolution reflects unmatched state with reasonCode', async () => {
    const intentWithFailedResolution = {
      ...MOCK_INTENT_BASE,
      status: 'failed',
      resolution: {
        ...MOCK_RESOLUTION,
        resolutionStatus: 'failed',
        decisionCode: 'unmatched',
        reasonCode: 'recipient_mismatch',
        confidenceScore: '0.100',
      },
    };
    mockFindUnique.mockResolvedValueOnce(intentWithFailedResolution);
    const res = await request(app).get(`/api/receipt/${MOCK_INTENT_BASE.id}`);

    expect(res.body.resolution.status).toBe('failed');
    expect(res.body.resolution.decisionCode).toBe('unmatched');
    expect(res.body.resolution.reasonCode).toBe('recipient_mismatch');
  });

  // ── Phase 8: settlement field ────────────────────────────────────────────

  it('returns settlement:null when no settlement identity exists', async () => {
    mockFindUnique.mockResolvedValueOnce(MOCK_INTENT_BASE);
    const res = await request(app).get(`/api/receipt/${MOCK_INTENT_BASE.id}`);

    expect(res.status).toBe(200);
    expect(res.body.settlement).toBeNull();
  });

  it('returns settlement object when a settlement identity exists', async () => {
    const intentWithSettlement = {
      ...MOCK_INTENT_BASE,
      settlementIdentities: [MOCK_SETTLEMENT_IDENTITY],
    };
    mockFindUnique.mockResolvedValueOnce(intentWithSettlement);
    const res = await request(app).get(`/api/receipt/${MOCK_INTENT_BASE.id}`);

    expect(res.status).toBe(200);
    const { settlement } = res.body;
    expect(settlement).not.toBeNull();
    expect(settlement.status).toBe('settled');
    expect(settlement.protocol).toBe('solana');
    expect(settlement.externalRef).toBe('tx_abc123');
    expect(settlement.settledAt).toContain('T'); // ISO string
  });

  it('settlement.settledAt is null when not yet settled', async () => {
    const intentWithPendingSettlement = {
      ...MOCK_INTENT_BASE,
      settlementIdentities: [
        { status: 'pending', protocol: 'solana', externalRef: null, settledAt: null },
      ],
    };
    mockFindUnique.mockResolvedValueOnce(intentWithPendingSettlement);
    const res = await request(app).get(`/api/receipt/${MOCK_INTENT_BASE.id}`);

    expect(res.body.settlement.status).toBe('pending');
    expect(res.body.settlement.settledAt).toBeNull();
    expect(res.body.settlement.externalRef).toBeNull();
  });

  it('returns both resolution and settlement when both are present', async () => {
    const intentFull = {
      ...MOCK_INTENT_BASE,
      resolution: MOCK_RESOLUTION,
      settlementIdentities: [MOCK_SETTLEMENT_IDENTITY],
    };
    mockFindUnique.mockResolvedValueOnce(intentFull);
    const res = await request(app).get(`/api/receipt/${MOCK_INTENT_BASE.id}`);

    expect(res.status).toBe(200);
    expect(res.body.resolution).not.toBeNull();
    expect(res.body.settlement).not.toBeNull();
    // All existing fields still present
    expect(res.body.intent.id).toBe(MOCK_INTENT_BASE.id);
    expect(res.body.intent.amount).toBe(15.5);
    expect(res.body.escrow).toBeNull();
  });

  // backward-compat alias
  it('backward compat: MOCK_INTENT alias still works', async () => {
    mockFindUnique.mockResolvedValueOnce(MOCK_INTENT);
    const res = await request(app).get(`/api/receipt/${MOCK_INTENT.id}`);
    expect(res.status).toBe(200);
  });
});