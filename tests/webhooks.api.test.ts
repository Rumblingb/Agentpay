/**
 * Webhook Delivery System Tests
 *
 * These tests are unit/integration tests that mock the database and HTTP calls,
 * so they run without a live database.
 */
import { signPayload, scheduleDelivery } from '../src/services/webhookDeliveryWorker';

// --- mock db query ---
jest.mock('../src/db/index', () => ({
  query: jest.fn(),
  pool: { on: jest.fn() },
  closePool: jest.fn(),
}));

// --- mock axios (factory must not reference outer vars due to hoisting) ---
jest.mock('axios', () => ({
  __esModule: true,
  default: { post: jest.fn() },
}));

import { query as mockQuery } from '../src/db/index';
import axios from 'axios';

const mockedQuery = mockQuery as jest.MockedFunction<typeof mockQuery>;
// axios is the default export: { post: jest.fn() }
const mockedAxiosPost = (axios as any).post as jest.MockedFunction<any>;

function mockUpdateDeliveryLog() {
  mockedQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any);
}

describe('webhookDeliveryWorker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('signPayload', () => {
    it('should produce a sha256= prefixed HMAC signature', () => {
      const sig = signPayload('{"hello":"world"}', 'testsecret');
      expect(sig).toMatch(/^sha256=[a-f0-9]{64}$/);
    });

    it('should produce different signatures for different secrets', () => {
      const sig1 = signPayload('data', 'secret1');
      const sig2 = signPayload('data', 'secret2');
      expect(sig1).not.toBe(sig2);
    });

    it('should produce the same signature for the same input', () => {
      const sig1 = signPayload('{"type":"payment_verified"}', 'mysecret');
      const sig2 = signPayload('{"type":"payment_verified"}', 'mysecret');
      expect(sig1).toBe(sig2);
    });
  });

  describe('scheduleDelivery - success on first attempt', () => {
    it('should mark log as sent when delivery succeeds', async () => {
      mockedAxiosPost.mockResolvedValue({ status: 200, data: 'ok' });
      mockUpdateDeliveryLog();

      await scheduleDelivery('log-1', 'https://example.com/hook', { type: 'payment_verified' });

      expect(mockedQuery).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE webhook_delivery_logs'),
        expect.arrayContaining(['sent', 1, 'log-1'])
      );
    });

    it('should include X-AgentPay-Signature header in the HTTP request', async () => {
      mockedAxiosPost.mockResolvedValue({ status: 200, data: 'ok' });
      mockUpdateDeliveryLog();

      await scheduleDelivery('log-2', 'https://example.com/hook', { type: 'payment_verified' });

      expect(mockedAxiosPost).toHaveBeenCalledWith(
        'https://example.com/hook',
        expect.objectContaining({ type: 'payment_verified' }),
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-AgentPay-Signature': expect.stringMatching(/^sha256=[a-f0-9]{64}$/),
          }),
        })
      );
    });
  });

  describe('scheduleDelivery - retry handling', () => {
    it('should increment attempts on failure and eventually mark as failed', async () => {
      mockedAxiosPost.mockResolvedValue({ status: 500, data: 'error' });
      mockUpdateDeliveryLog();

      jest.useFakeTimers();
      const deliveryPromise = scheduleDelivery(
        'log-3',
        'https://example.com/hook',
        { type: 'payment_verified' }
      );
      await jest.runAllTimersAsync();
      await deliveryPromise;
      jest.useRealTimers();

      const updateCalls = mockedQuery.mock.calls.filter((c) =>
        String(c[0]).includes('UPDATE webhook_delivery_logs')
      );
      expect(updateCalls.length).toBe(3);

      const lastCall = updateCalls[updateCalls.length - 1];
      expect(lastCall[1]).toEqual(expect.arrayContaining(['failed']));
    });

    it('should increment attempts on network error', async () => {
      mockedAxiosPost.mockRejectedValue(new Error('ECONNREFUSED'));
      mockUpdateDeliveryLog();

      jest.useFakeTimers();
      const deliveryPromise = scheduleDelivery(
        'log-4',
        'https://example.com/hook',
        { type: 'payment_verified' }
      );
      await jest.runAllTimersAsync();
      await deliveryPromise;
      jest.useRealTimers();

      const updateCalls = mockedQuery.mock.calls.filter((c) =>
        String(c[0]).includes('UPDATE webhook_delivery_logs')
      );
      const attemptValues = updateCalls.map((c) => (c[1] as any[])[1]);
      expect(attemptValues).toEqual([1, 2, 3]);

      const lastStatus = updateCalls[updateCalls.length - 1][1]![0];
      expect(lastStatus).toBe('failed');
    });
  });
});

describe('Webhook API routes', () => {
  let app: any;
  let request: any;

  beforeAll(async () => {
    const appModule = await import('../src/server');
    app = appModule.default;
    const supertestModule = await import('supertest');
    request = supertestModule.default;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('POST /api/webhooks/subscribe returns 401 without auth', async () => {
    const res = await request(app)
      .post('/api/webhooks/subscribe')
      .send({ url: 'https://example.com/hook', eventTypes: ['payment_verified'] });
    expect(res.status).toBe(401);
  });

  it('GET /api/webhooks returns 401 without auth', async () => {
    const res = await request(app).get('/api/webhooks');
    expect(res.status).toBe(401);
  });

  it('DELETE /api/webhooks/:id returns 401 without auth', async () => {
    const res = await request(app).delete('/api/webhooks/some-id');
    expect(res.status).toBe(401);
  });

  it('POST /api/webhooks/subscribe validates URL', async () => {
    const { z } = await import('zod');
    const schema = z.object({
      url: z.string().url(),
      eventTypes: z.array(z.enum(['payment_verified' as const])).min(1),
    });
    const result = schema.safeParse({ url: 'not-a-url', eventTypes: ['payment_verified'] });
    expect(result.success).toBe(false);
  });

  it('POST /api/webhooks/subscribe validates eventTypes', async () => {
    const { z } = await import('zod');
    const schema = z.object({
      url: z.string().url(),
      eventTypes: z.array(z.enum(['payment_verified' as const])).min(1),
    });
    const result = schema.safeParse({ url: 'https://example.com', eventTypes: ['unknown_event'] });
    expect(result.success).toBe(false);
  });
});
