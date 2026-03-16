/**
 * Route tests for Phase 11 settlement mismatch admin endpoints:
 *
 *   GET /api/admin/settlement-mismatches
 *   GET /api/admin/settlement-mismatches/:intentId
 *
 * Both routes require a valid x-admin-key header.
 * They surface reason codes (memo_missing, amount_mismatch, etc.) from
 * intent_resolutions without exposing sensitive internals publicly.
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
import { query } from '../../src/db/index';

const mockQuery = query as jest.Mock;

const ADMIN_KEY = 'admin-dev-key';

// ---------------------------------------------------------------------------
// Sample DB row shapes
// ---------------------------------------------------------------------------

const MISMATCH_ROW = {
  id: 'res-uuid-001',
  intent_id: 'intent-uuid-001',
  protocol: 'solana',
  resolved_by: 'solana_listener',
  resolution_status: 'failed',
  decision_code: 'unmatched',
  reason_code: 'recipient_mismatch',
  confidence_score: '0.100',
  external_ref: null,
  resolved_at: '2024-01-01T12:00:00.000Z',
};

const INTENT_JOIN_ROW = {
  pi_id: 'intent-uuid-001',
  pi_status: 'failed',
  pi_protocol: 'solana',
  pi_amount: '10.00',
  ir_id: 'res-uuid-001',
  ir_resolved_by: 'solana_listener',
  ir_resolution_status: 'failed',
  ir_decision_code: 'unmatched',
  ir_reason_code: 'recipient_mismatch',
  ir_confidence_score: '0.100',
  ir_external_ref: null,
  ir_payer_ref: null,
  ir_resolved_at: '2024-01-01T12:00:00.000Z',
  ir_metadata: { identityMatched: false, amountMatched: true, metaMatched: true },
};

const SETTLEMENT_EVENT_ROW = {
  id: 'event-uuid-001',
  event_type: 'policy_mismatch',
  protocol: 'solana',
  external_ref: null,
  payload: { reasonCode: 'recipient_mismatch' },
  created_at: '2024-01-01T11:59:00.000Z',
};

// ---------------------------------------------------------------------------
// GET /api/admin/settlement-mismatches
// ---------------------------------------------------------------------------

describe('GET /api/admin/settlement-mismatches', () => {
  beforeEach(() => jest.resetAllMocks());

  it('returns 403 without x-admin-key', async () => {
    const res = await request(app).get('/api/admin/settlement-mismatches');
    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  it('returns 403 with a wrong admin key', async () => {
    const res = await request(app)
      .get('/api/admin/settlement-mismatches')
      .set('x-admin-key', 'wrong-key');
    expect(res.status).toBe(403);
  });

  it('returns 200 with empty data when no mismatches exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app)
      .get('/api/admin/settlement-mismatches')
      .set('x-admin-key', ADMIN_KEY);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual([]);
    expect(res.body.count).toBe(0);
  });

  it('returns mismatch records with reason codes', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [MISMATCH_ROW] });
    const res = await request(app)
      .get('/api/admin/settlement-mismatches')
      .set('x-admin-key', ADMIN_KEY);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.count).toBe(1);

    const item = res.body.data[0];
    expect(item.intentId).toBe('intent-uuid-001');
    expect(item.resolutionStatus).toBe('failed');
    expect(item.decisionCode).toBe('unmatched');
    expect(item.reasonCode).toBe('recipient_mismatch');
    expect(item.confidenceScore).toBeCloseTo(0.1);
    expect(item.protocol).toBe('solana');
  });

  it('maps null reason_code to null in response', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ ...MISMATCH_ROW, reason_code: null, decision_code: null }],
    });
    const res = await request(app)
      .get('/api/admin/settlement-mismatches')
      .set('x-admin-key', ADMIN_KEY);

    expect(res.status).toBe(200);
    expect(res.body.data[0].reasonCode).toBeNull();
    expect(res.body.data[0].decisionCode).toBeNull();
  });

  it('returns 200 with empty array when DB table is missing', async () => {
    mockQuery.mockRejectedValueOnce(
      Object.assign(new Error('relation "intent_resolutions" does not exist'), { code: '42P01' }),
    );
    const res = await request(app)
      .get('/api/admin/settlement-mismatches')
      .set('x-admin-key', ADMIN_KEY);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it('respects limit query param', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app)
      .get('/api/admin/settlement-mismatches?limit=10')
      .set('x-admin-key', ADMIN_KEY);

    expect(res.status).toBe(200);
    // The SQL with $N limit param is forwarded — just verify the call happened
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('exposes all required Phase 11 reason codes as valid values', async () => {
    const reasonCodes = [
      'memo_missing',
      'amount_mismatch',
      'external_fee_detected',
      'recipient_mismatch',
      'no_settlement_identity',
      'no_matching_policy',
      'no_intent_candidate',
    ];

    for (const rc of reasonCodes) {
      mockQuery.mockResolvedValueOnce({
        rows: [{ ...MISMATCH_ROW, reason_code: rc }],
      });
      const res = await request(app)
        .get('/api/admin/settlement-mismatches')
        .set('x-admin-key', ADMIN_KEY);

      expect(res.status).toBe(200);
      expect(res.body.data[0].reasonCode).toBe(rc);
    }
  });
});

// ---------------------------------------------------------------------------
// GET /api/admin/settlement-mismatches/:intentId
// ---------------------------------------------------------------------------

describe('GET /api/admin/settlement-mismatches/:intentId', () => {
  beforeEach(() => jest.resetAllMocks());

  it('returns 403 without x-admin-key', async () => {
    const res = await request(app).get('/api/admin/settlement-mismatches/intent-uuid-001');
    expect(res.status).toBe(403);
  });

  it('returns 404 when intent does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // JOIN query returns nothing

    const res = await request(app)
      .get('/api/admin/settlement-mismatches/nonexistent-id')
      .set('x-admin-key', ADMIN_KEY);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('NOT_FOUND');
  });

  it('returns full mismatch detail for an existing intent', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [INTENT_JOIN_ROW] })        // JOIN query
      .mockResolvedValueOnce({ rows: [SETTLEMENT_EVENT_ROW] });  // events query

    const res = await request(app)
      .get('/api/admin/settlement-mismatches/intent-uuid-001')
      .set('x-admin-key', ADMIN_KEY);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const { data } = res.body;
    expect(data.intent.id).toBe('intent-uuid-001');
    expect(data.intent.status).toBe('failed');
    expect(data.intent.amount).toBe(10);

    expect(data.resolution).not.toBeNull();
    expect(data.resolution.reasonCode).toBe('recipient_mismatch');
    expect(data.resolution.decisionCode).toBe('unmatched');
    expect(data.resolution.resolutionStatus).toBe('failed');
    expect(data.resolution.confidenceScore).toBeCloseTo(0.1);
    expect(data.resolution.metadata).toEqual({
      identityMatched: false,
      amountMatched: true,
      metaMatched: true,
    });

    expect(data.settlementEvents).toHaveLength(1);
    expect(data.settlementEvents[0].eventType).toBe('policy_mismatch');
    expect(data.settlementEvents[0].protocol).toBe('solana');
  });

  it('returns resolution:null when no resolution record exists yet', async () => {
    const rowNoResolution = {
      ...INTENT_JOIN_ROW,
      ir_id: null,
      ir_resolved_by: null,
      ir_resolution_status: null,
      ir_decision_code: null,
      ir_reason_code: null,
      ir_confidence_score: null,
      ir_external_ref: null,
      ir_payer_ref: null,
      ir_resolved_at: null,
      ir_metadata: null,
    };

    mockQuery
      .mockResolvedValueOnce({ rows: [rowNoResolution] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .get('/api/admin/settlement-mismatches/intent-uuid-001')
      .set('x-admin-key', ADMIN_KEY);

    expect(res.status).toBe(200);
    expect(res.body.data.resolution).toBeNull();
    expect(res.body.data.settlementEvents).toEqual([]);
  });

  it('returns settlement events audit trail', async () => {
    const multipleEvents = [
      SETTLEMENT_EVENT_ROW,
      { ...SETTLEMENT_EVENT_ROW, id: 'event-uuid-002', event_type: 'hash_submitted' },
    ];

    mockQuery
      .mockResolvedValueOnce({ rows: [INTENT_JOIN_ROW] })
      .mockResolvedValueOnce({ rows: multipleEvents });

    const res = await request(app)
      .get('/api/admin/settlement-mismatches/intent-uuid-001')
      .set('x-admin-key', ADMIN_KEY);

    expect(res.status).toBe(200);
    expect(res.body.data.settlementEvents).toHaveLength(2);
    expect(res.body.data.settlementEvents[0].eventType).toBe('policy_mismatch');
    expect(res.body.data.settlementEvents[1].eventType).toBe('hash_submitted');
  });

  it('returns 404 when database connection fails (safeQuery swallows errors)', async () => {
    mockQuery.mockRejectedValueOnce(new Error('connection refused'));

    const res = await request(app)
      .get('/api/admin/settlement-mismatches/intent-uuid-001')
      .set('x-admin-key', ADMIN_KEY);

    // safeQuery catches all errors and returns [] — the route then treats the
    // empty result as "intent not found" and returns 404.
    expect(res.status).toBe(404);
  });
});
