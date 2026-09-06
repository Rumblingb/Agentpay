jest.mock('../../apps/api-edge/src/lib/db', () => {
  const actual = jest.requireActual('../../apps/api-edge/src/lib/db');
  return {
    ...actual,
    createDb: jest.fn(),
  };
});

import { createDb } from '../../apps/api-edge/src/lib/db';
import apiEdge from '../../apps/api-edge/src/index';

function makeSql(responses: unknown[]) {
  const queue = [...responses];
  const sql = (jest.fn(async () => queue.shift() ?? []) as unknown) as jest.Mock & {
    end: jest.Mock;
  };
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

describe('GET /api/passport/:agentId', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    (createDb as jest.Mock).mockReset();
  });

  it('returns an empty passport instead of 500 before the first transaction', async () => {
    (createDb as jest.Mock).mockReturnValue(makeSql([[], [], []]));
    const res = await apiEdge.fetch(
      new Request('http://agentpay.test/api/passport/agt_new_agent'),
      appEnv(),
      {} as never,
    );
    const body = await res.json() as { success: boolean; empty: boolean; passport: { agentId: string } };
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.empty).toBe(true);
    expect(body.passport.agentId).toBe('agt_new_agent');
  });
});
