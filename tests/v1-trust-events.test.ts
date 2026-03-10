/**
 * Tests for GET /api/v1/trust/events — verifies the trust event history
 * endpoint returns events with pagination and filtering support.
 */

import { jest, describe, it, expect, beforeEach } from '@jest/globals';

// --- Prisma mock --------------------------------------------------------
const mockTrustEventFindMany = jest.fn();
const mockTrustEventCount = jest.fn();

jest.mock('../src/lib/prisma', () => ({
  __esModule: true,
  default: {
    trustEvent: {
      findMany: (...args: any[]) => mockTrustEventFindMany(...args),
      count: (...args: any[]) => mockTrustEventCount(...args),
      create: jest.fn().mockResolvedValue({}),
    },
    agentrank_scores: {
      findUnique: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue(null),
    },
  },
}));

// --- DB query mock (for bots table fallback) ----------------------------
jest.mock('../src/db/index', () => ({
  __esModule: true,
  query: jest.fn().mockResolvedValue({ rows: [] }),
  pool: { on: jest.fn() },
  closePool: jest.fn(),
}));

import request from 'supertest';
import express from 'express';
import v1TrustRouter from '../src/routes/v1Trust';

const app = express();
app.use(express.json());
app.use('/api/v1/trust', v1TrustRouter);

// Fixture events
const TRUST_EVENTS = [
  {
    id: 'evt-001',
    eventType: 'agent.verified',
    agentId: 'agent-alpha',
    counterpartyId: null,
    delta: 10,
    metadata: { category: 'identity_verified', description: 'verified' },
    createdAt: new Date('2025-01-01T12:00:00Z'),
  },
  {
    id: 'evt-002',
    eventType: 'trust.score_updated',
    agentId: 'agent-beta',
    counterpartyId: 'agent-gamma',
    delta: 5,
    metadata: { category: 'successful_interaction' },
    createdAt: new Date('2025-01-02T12:00:00Z'),
  },
  {
    id: 'evt-003',
    eventType: 'dispute.filed',
    agentId: 'agent-gamma',
    counterpartyId: 'agent-delta',
    delta: -5,
    metadata: { category: 'dispute_filed', caseId: 'case-001' },
    createdAt: new Date('2025-01-03T12:00:00Z'),
  },
];

describe('GET /api/v1/trust/events', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns paginated trust events', async () => {
    mockTrustEventFindMany.mockResolvedValueOnce(TRUST_EVENTS);
    mockTrustEventCount.mockResolvedValueOnce(3);

    const res = await request(app).get('/api/v1/trust/events?limit=10&offset=0');

    expect(res.status).toBe(200);
    expect(res.body.events).toHaveLength(3);
    expect(res.body.pagination).toMatchObject({
      total: 3,
      limit: 10,
      offset: 0,
      hasMore: false,
    });
  });

  it('includes correct event fields', async () => {
    mockTrustEventFindMany.mockResolvedValueOnce([TRUST_EVENTS[0]]);
    mockTrustEventCount.mockResolvedValueOnce(1);

    const res = await request(app).get('/api/v1/trust/events');

    expect(res.status).toBe(200);
    const event = res.body.events[0];
    expect(event).toMatchObject({
      id: 'evt-001',
      eventType: 'agent.verified',
      agentId: 'agent-alpha',
      counterpartyId: null,
      delta: 10,
    });
    expect(typeof event.timestamp).toBe('string');
    expect(typeof event.metadata).toBe('object');
  });

  it('filters by agentId', async () => {
    mockTrustEventFindMany.mockResolvedValueOnce([TRUST_EVENTS[0]]);
    mockTrustEventCount.mockResolvedValueOnce(1);

    const res = await request(app).get('/api/v1/trust/events?agentId=agent-alpha');

    expect(res.status).toBe(200);

    // Verify the filter was forwarded to Prisma
    expect(mockTrustEventFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ agentId: 'agent-alpha' }),
      }),
    );
  });

  it('filters by eventType', async () => {
    mockTrustEventFindMany.mockResolvedValueOnce([TRUST_EVENTS[2]]);
    mockTrustEventCount.mockResolvedValueOnce(1);

    const res = await request(app).get('/api/v1/trust/events?eventType=dispute.filed');

    expect(res.status).toBe(200);
    expect(mockTrustEventFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ eventType: 'dispute.filed' }),
      }),
    );
  });

  it('clamps limit to max 100', async () => {
    mockTrustEventFindMany.mockResolvedValueOnce([]);
    mockTrustEventCount.mockResolvedValueOnce(0);

    const res = await request(app).get('/api/v1/trust/events?limit=9999');

    expect(res.status).toBe(200);
    expect(mockTrustEventFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 100 }),
    );
  });

  it('returns empty list gracefully when DB is unavailable', async () => {
    const tableError = new Error('relation "trust_events" does not exist');
    mockTrustEventFindMany.mockRejectedValueOnce(tableError);
    mockTrustEventCount.mockRejectedValueOnce(tableError);

    const res = await request(app).get('/api/v1/trust/events');

    // Endpoint should not crash — returns empty list
    expect(res.status).toBe(200);
    expect(res.body.events).toEqual([]);
    expect(res.body.pagination.total).toBe(0);
  });

  it('calculates hasMore correctly', async () => {
    mockTrustEventFindMany.mockResolvedValueOnce(TRUST_EVENTS.slice(0, 2));
    mockTrustEventCount.mockResolvedValueOnce(5);

    const res = await request(app).get('/api/v1/trust/events?limit=2&offset=0');

    expect(res.status).toBe(200);
    expect(res.body.pagination.hasMore).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Schema stability tests
// ---------------------------------------------------------------------------

import { assertTrustEventRecord } from '../src/services/trustEventService';

describe('TrustEventRecord schema', () => {
  it('assertTrustEventRecord passes for a fully valid event', () => {
    expect(() => assertTrustEventRecord({
      id: 'evt-abc',
      eventType: 'agent.verified',
      agentId: 'agent-x',
      counterpartyId: null,
      delta: 10,
      metadata: { category: 'identity_verified' },
      timestamp: '2025-01-01T00:00:00.000Z',
    })).not.toThrow();
  });

  it('assertTrustEventRecord passes when counterpartyId is a string', () => {
    expect(() => assertTrustEventRecord({
      id: 'evt-def',
      eventType: 'dispute.filed',
      agentId: 'agent-a',
      counterpartyId: 'agent-b',
      delta: -5,
      metadata: { category: 'dispute_filed' },
      timestamp: '2025-01-01T00:00:00.000Z',
    })).not.toThrow();
  });

  it('assertTrustEventRecord throws when eventType is missing', () => {
    expect(() => assertTrustEventRecord({
      id: 'evt-bad',
      agentId: 'agent-x',
      counterpartyId: null,
      delta: 0,
      metadata: {},
      timestamp: '2025-01-01T00:00:00.000Z',
    })).toThrow('[TrustEvent] event.eventType is missing or empty');
  });

  it('assertTrustEventRecord throws when agentId is missing', () => {
    expect(() => assertTrustEventRecord({
      id: 'evt-bad',
      eventType: 'agent.verified',
      counterpartyId: null,
      delta: 0,
      metadata: {},
      timestamp: '2025-01-01T00:00:00.000Z',
    })).toThrow('[TrustEvent] event.agentId is missing or empty');
  });

  it('assertTrustEventRecord throws when timestamp is missing', () => {
    expect(() => assertTrustEventRecord({
      id: 'evt-bad',
      eventType: 'agent.verified',
      agentId: 'agent-x',
      counterpartyId: null,
      delta: 0,
      metadata: {},
    })).toThrow('[TrustEvent] event.timestamp is missing or empty');
  });

  it('assertTrustEventRecord throws when metadata is not an object', () => {
    expect(() => assertTrustEventRecord({
      id: 'evt-bad',
      eventType: 'agent.verified',
      agentId: 'agent-x',
      counterpartyId: null,
      delta: 0,
      metadata: null,
      timestamp: '2025-01-01T00:00:00.000Z',
    })).toThrow('[TrustEvent] event.metadata must be an object');
  });

  it('assertTrustEventRecord throws when delta is not a number', () => {
    expect(() => assertTrustEventRecord({
      id: 'evt-bad',
      eventType: 'agent.verified',
      agentId: 'agent-x',
      counterpartyId: null,
      delta: '10', // string instead of number
      metadata: {},
      timestamp: '2025-01-01T00:00:00.000Z',
    })).toThrow('[TrustEvent] event.delta must be a number');
  });

  it('assertTrustEventRecord throws when counterpartyId is an invalid type', () => {
    expect(() => assertTrustEventRecord({
      id: 'evt-bad',
      eventType: 'agent.verified',
      agentId: 'agent-x',
      counterpartyId: 123, // should be string or null
      delta: 0,
      metadata: {},
      timestamp: '2025-01-01T00:00:00.000Z',
    })).toThrow('[TrustEvent] event.counterpartyId must be a string or null');
  });

  it('GET /api/v1/trust/events: every returned event has all required schema fields', async () => {
    mockTrustEventFindMany.mockResolvedValueOnce(TRUST_EVENTS);
    mockTrustEventCount.mockResolvedValueOnce(TRUST_EVENTS.length);

    const res = await request(app).get('/api/v1/trust/events');

    expect(res.status).toBe(200);
    for (const event of res.body.events) {
      expect(typeof event.id).toBe('string');
      expect(typeof event.eventType).toBe('string');
      expect(typeof event.agentId).toBe('string');
      // counterpartyId is allowed to be null or a string — never undefined
      expect(event.counterpartyId === null || typeof event.counterpartyId === 'string').toBe(true);
      expect(typeof event.delta).toBe('number');
      expect(typeof event.metadata).toBe('object');
      expect(event.metadata).not.toBeNull();
      expect(typeof event.timestamp).toBe('string');
      expect(new Date(event.timestamp).getTime()).not.toBeNaN();
    }
  });
});
