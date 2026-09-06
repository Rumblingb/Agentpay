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
});
