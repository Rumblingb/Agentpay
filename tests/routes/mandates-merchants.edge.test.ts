jest.mock('../../apps/api-edge/src/lib/db', () => {
  const actual = jest.requireActual('../../apps/api-edge/src/lib/db');
  return {
    ...actual,
    createDb: jest.fn(),
  };
});

jest.mock('../../apps/api-edge/src/lib/pbkdf2', () => ({
  pbkdf2Hex: jest.fn().mockResolvedValue('hash_test_value'),
}));

jest.mock('../../apps/api-edge/src/lib/hmac', () => ({
  hmacSign: jest.fn().mockResolvedValue('hmac_signature'),
  hmacVerify: jest.fn().mockResolvedValue(true),
}));

import { createDb } from '../../apps/api-edge/src/lib/db';
import apiEdge from '../../apps/api-edge/src/index';

function makeSql(responses: unknown[]) {
  const queue = [...responses];
  const sql = (jest.fn(async () => queue.shift()) as unknown) as jest.Mock & {
    end: jest.Mock;
  };
  sql.mockImplementation(async () => queue.shift());
  sql.end = jest.fn().mockResolvedValue(undefined);
  return sql;
}

function appEnv(extra: Record<string, unknown> = {}) {
  return {
    DATABASE_URL: 'postgres://agentpay:test@localhost:5432/agentpay',
    WEBHOOK_SECRET: 'w'.repeat(32),
    AGENTPAY_SIGNING_SECRET: 's'.repeat(32),
    VERIFICATION_SECRET: 'v'.repeat(32),
    ADMIN_SECRET_KEY: 'a'.repeat(32),
    CORS_ORIGIN: 'http://localhost:3000',
    API_BASE_URL: 'http://agentpay.test',
    FRONTEND_URL: 'http://agentpay.test',
    AGENTPAY_TEST_MODE: 'true',
    NODE_ENV: 'development',
    ...extra,
  } as never;
}

function authHeaders(extra: Record<string, string> = {}) {
  return {
    authorization: 'Bearer sk_test_sim',
    ...extra,
  };
}

function makeExecutionContext() {
  const tasks: Promise<unknown>[] = [];
  return {
    ctx: {
      waitUntil(promise: Promise<unknown>) {
        tasks.push(promise);
      },
    },
    async flush() {
      await Promise.all(tasks);
    },
  };
}

describe('api-edge mandate routing', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    (createDb as jest.Mock).mockReset();
  });

  it('serves mandate details from /api/mandates/:intentId', async () => {
    (createDb as jest.Mock).mockReturnValue(makeSql([[
      {
        id: '1f4e4c4c-13af-4bc2-bd91-c0dbcf584271',
        principal_id: 'principal_1',
        operator_id: 'agent_1',
        source: 'delegated_agent',
        objective: 'Book the train',
        constraints_json: JSON.stringify({ budgetMax: 5000 }),
        status: 'approved',
        recommendation_json: JSON.stringify({ summary: 'Fastest route' }),
        approval_json: JSON.stringify({ requiredFrom: 'human' }),
        actor_id: 'principal_1',
        approved_at: new Date('2026-04-19T08:05:00.000Z'),
        created_at: new Date('2026-04-19T08:00:00.000Z'),
        updated_at: new Date('2026-04-19T08:05:00.000Z'),
      },
    ]]));

    const res = await apiEdge.fetch(
      new Request('http://agentpay.test/api/mandates/1f4e4c4c-13af-4bc2-bd91-c0dbcf584271', {
        headers: authHeaders(),
      }),
      appEnv(),
      {} as never,
    );

    const body = await res.json() as Record<string, unknown>;
    expect(res.status).toBe(200);
    expect(body.intentId).toBe('1f4e4c4c-13af-4bc2-bd91-c0dbcf584271');
    expect(body.status).toBe('approved');
    expect(body.principalId).toBe('principal_1');
  });

  it('serves mandate history from /api/mandates/:intentId/history', async () => {
    (createDb as jest.Mock).mockReturnValue(makeSql([[
      {
        id: '1f4e4c4c-13af-4bc2-bd91-c0dbcf584271',
        principal_id: 'principal_1',
        operator_id: 'agent_1',
        source: 'delegated_agent',
        objective: 'Book the train',
        constraints_json: JSON.stringify({ budgetMax: 5000 }),
        status: 'completed',
        recommendation_json: JSON.stringify({ summary: 'Fastest route' }),
        approval_json: JSON.stringify({ requiredFrom: 'human' }),
        actor_id: 'principal_1',
        approved_at: new Date('2026-04-19T08:05:00.000Z'),
        created_at: new Date('2026-04-19T08:00:00.000Z'),
        updated_at: new Date('2026-04-19T08:20:00.000Z'),
      },
    ]]));

    const res = await apiEdge.fetch(
      new Request('http://agentpay.test/api/mandates/1f4e4c4c-13af-4bc2-bd91-c0dbcf584271/history', {
        headers: authHeaders(),
      }),
      appEnv(),
      {} as never,
    );

    const body = await res.json() as Record<string, unknown>;
    const events = body.events as Array<Record<string, unknown>>;
    expect(res.status).toBe(200);
    expect(events.map((event) => event.event)).toEqual(expect.arrayContaining([
      'created',
      'planned',
      'approved',
      'execution_started',
      'completed',
    ]));
  });

  it('cancels mandates through the mounted /api/mandates route', async () => {
    (createDb as jest.Mock).mockReturnValue(makeSql([
      [{ id: '1f4e4c4c-13af-4bc2-bd91-c0dbcf584271', status: 'approved' }],
      [],
    ]));

    const res = await apiEdge.fetch(
      new Request('http://agentpay.test/api/mandates/1f4e4c4c-13af-4bc2-bd91-c0dbcf584271/cancel', {
        method: 'POST',
        headers: authHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({
          actorId: 'principal_1',
          reason: 'User revoked authority',
        }),
      }),
      appEnv(),
      {} as never,
    );

    const body = await res.json() as Record<string, unknown>;
    expect(res.status).toBe(200);
    expect(body.status).toBe('cancelled');
    expect(body.actorId).toBe('principal_1');
  });
});

describe('api-edge merchant email delivery', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    (createDb as jest.Mock).mockReset();
  });

  it('returns the API key inline when registration email delivery fails', async () => {
    (createDb as jest.Mock).mockReturnValue(makeSql([[], []]));
    const fetchSpy = jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => JSON.stringify({ message: 'Domain not verified' }),
    } as any);
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const res = await apiEdge.fetch(
      new Request('http://agentpay.test/api/merchants/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Rajiv Store',
          email: 'Vishar.Baskaran@Example.com',
        }),
      }),
      appEnv({ RESEND_API_KEY: 're_test_123' }),
      {} as never,
    );

    const body = await res.json() as Record<string, unknown>;
    expect(res.status).toBe(201);
    expect(body.success).toBe(true);
    expect(typeof body.apiKey).toBe('string');
    expect(body.emailDelivery).toEqual({
      status: 'failed',
      provider: 'resend',
    });
    expect(body.message).toEqual(expect.stringContaining('returned directly'));
    expect(JSON.parse(fetchSpy.mock.calls[0][1]?.body as string)).toMatchObject({
      to: ['vishar.baskaran@example.com'],
    });
    expect(errorSpy).toHaveBeenCalledWith(
      '[merchants] register: Resend rejected email',
      expect.objectContaining({ status: 403 }),
    );
  });

  it('keeps recovery responses generic while logging Resend delivery failures', async () => {
    (createDb as jest.Mock).mockReturnValue(makeSql([[
      {
        id: '26e7ac4f-017e-4316-bf4f-9a1b37112510',
        apiKeyHash: '1234567890abcdef1234567890abcdef',
      },
    ]]));
    const fetchSpy = jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => JSON.stringify({ message: 'From address not verified' }),
    } as any);
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const exec = makeExecutionContext();

    const res = await apiEdge.fetch(
      new Request('http://agentpay.test/api/merchants/recover/request', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: 'Recover@Example.com',
        }),
      }),
      appEnv({ RESEND_API_KEY: 're_test_123' }),
      exec.ctx as never,
    );

    const body = await res.json() as Record<string, unknown>;
    await exec.flush();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      success: true,
      message: 'If an account with that email exists, recovery instructions have been sent.',
    });
    expect(JSON.parse(fetchSpy.mock.calls[0][1]?.body as string)).toMatchObject({
      to: ['recover@example.com'],
    });
    expect(errorSpy).toHaveBeenCalledWith(
      '[merchants] recover/request: Resend rejected email',
      expect.objectContaining({ status: 403 }),
    );
  });
});
