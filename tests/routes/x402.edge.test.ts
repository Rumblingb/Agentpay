jest.mock('../../apps/api-edge/src/lib/db', () => {
  const actual = jest.requireActual('../../apps/api-edge/src/lib/db');
  return {
    ...actual,
    createDb: jest.fn(),
  };
});

import { createDb } from '../../apps/api-edge/src/lib/db';
import apiEdge from '../../apps/api-edge/src/index';

function makeSql() {
  const sql = (jest.fn(async () => {
    throw new Error('no db');
  }) as unknown) as jest.Mock & { end: jest.Mock };
  sql.end = jest.fn().mockResolvedValue(undefined);
  return sql;
}

function appEnv() {
  return {
    DATABASE_URL: 'postgres://agentpay:test@localhost:5432/agentpay',
    WEBHOOK_SECRET: 'w'.repeat(32),
    AGENTPAY_SIGNING_SECRET: 's'.repeat(32),
    VERIFICATION_SECRET: 'v'.repeat(32),
    ADMIN_SECRET_KEY: 'a'.repeat(32),
    CORS_ORIGIN: 'http://localhost:3000',
    API_BASE_URL: 'http://agentpay.test',
    FRONTEND_URL: 'https://agentpay.so',
    AGENTPAY_TEST_MODE: 'true',
    NODE_ENV: 'development',
  } as never;
}

describe('x402 challenge and verify', () => {
  beforeEach(() => {
    (createDb as jest.Mock).mockReturnValue(makeSql());
  });

  afterEach(() => {
    jest.restoreAllMocks();
    (createDb as jest.Mock).mockReset();
  });

  it.each([
    '/api/x402',
    '/api/x402/challenge',
    '/api/x402/pay',
    '/x402',
    '/.well-known/x402',
  ])('returns an HTTP 402 challenge at %s', async (path) => {
    const res = await apiEdge.fetch(
      new Request(`http://agentpay.test${path}`),
      appEnv(),
      {} as never,
    );
    const body = await res.json() as Record<string, unknown>;
    expect(res.status).toBe(402);
    expect(res.headers.get('X-AgentPay-Protocol')).toBe('x402');
    expect(body.scheme).toBe('x402');
    expect(body.paymentEndpoints).toEqual(expect.objectContaining({
      agentpay: 'http://agentpay.test/api/v1/payment-intents',
    }));
  });

  it('keeps empty verify bodies as 400', async () => {
    const res = await apiEdge.fetch(
      new Request('http://agentpay.test/api/x402/verify', { method: 'POST' }),
      appEnv(),
      {} as never,
    );
    expect(res.status).toBe(400);
  });

  it('does not 502 when verify looks up a real payload', async () => {
    const res = await apiEdge.fetch(
      new Request('http://agentpay.test/api/x402/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ paymentId: 'pi_test_1234567890abcdef', requiredAmountUsd: 1 }),
      }),
      appEnv(),
      {} as never,
    );
    const body = await res.json() as Record<string, unknown>;
    expect(res.status).not.toBe(502);
    expect(body.protocol).toBe('x402');
    expect(body.verified).toBe(false);
  });
});
