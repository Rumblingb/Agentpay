jest.mock('../../apps/api-edge/src/lib/db', () => {
  const actual = jest.requireActual('../../apps/api-edge/src/lib/db');
  return {
    ...actual,
    createDb: jest.fn(),
  };
});

import { createDb } from '../../apps/api-edge/src/lib/db';
import apiEdge from '../../apps/api-edge/src/index';

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

function makeSql(responses: unknown[] | Error) {
  const sql = (jest.fn(async () => {
    if (responses instanceof Error) throw responses;
    return (responses as unknown[]).shift() ?? [];
  }) as unknown) as jest.Mock & { end: jest.Mock };
  sql.end = jest.fn().mockResolvedValue(undefined);
  return sql;
}

describe('GET /api/receipt/demo', () => {
  afterEach(() => {
    (createDb as jest.Mock).mockReset();
  });

  it('returns a demo receipt instead of 500', async () => {
    const res = await apiEdge.fetch(
      new Request('http://agentpay.test/api/receipt/demo'),
      appEnv(),
      {} as never,
    );
    const body = await res.json() as Record<string, unknown>;
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.demo).toBe(true);
    expect((body.intent as Record<string, unknown>).id).toBe('demo');
    expect(createDb).not.toHaveBeenCalled();
  });

  it('returns 404 for a non-uuid intent id instead of 500', async () => {
    const res = await apiEdge.fetch(
      new Request('http://agentpay.test/api/receipt/not-a-uuid'),
      appEnv(),
      {} as never,
    );
    const body = await res.json() as Record<string, unknown>;
    expect(res.status).toBe(404);
    expect(body.error).toBe('NOT_FOUND');
    expect(createDb).not.toHaveBeenCalled();
  });

  it('returns a receipt without joining agents', async () => {
    (createDb as jest.Mock).mockReturnValue(makeSql([[
      {
        id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12',
        amount: 1.5,
        currency: 'USDC',
        status: 'pending',
        protocol: 'x402',
        agentId: null,
        expiresAt: new Date('2026-09-06T17:00:00.000Z'),
        createdAt: new Date('2026-09-06T16:30:00.000Z'),
        updatedAt: new Date('2026-09-06T16:30:00.000Z'),
      },
    ], [], []]));

    const res = await apiEdge.fetch(
      new Request('http://agentpay.test/api/receipt/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12'),
      appEnv(),
      {} as never,
    );
    const body = await res.json() as { success: boolean; intent: { id: string; agent: null } };
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.intent.id).toBe('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12');
    expect(body.intent.agent).toBeNull();
  });

  it('returns 503 instead of 500 when the database probe fails', async () => {
    (createDb as jest.Mock).mockReturnValue(makeSql(new Error('hyperdrive down')));
    const res = await apiEdge.fetch(
      new Request('http://agentpay.test/api/receipt/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12'),
      appEnv(),
      {} as never,
    );
    const body = await res.json() as Record<string, unknown>;
    expect(res.status).toBe(503);
    expect(body.error).toBe('RECEIPT_UNAVAILABLE');
  });
});
