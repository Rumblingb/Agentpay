jest.mock('../../apps/api-edge/src/lib/db', () => ({
  createDb: jest.fn(),
}));

import { createDb } from '../../apps/api-edge/src/lib/db';
import { broInsightsRouter } from '../../apps/api-edge/src/routes/broInsights';

function makeSql(responses: unknown[]) {
  const queue = [...responses];
  const sql = (jest.fn(async () => queue.shift()) as unknown) as jest.Mock & { end: jest.Mock };
  sql.end = jest.fn().mockResolvedValue(undefined);
  return sql;
}

describe('broInsights recovery queue routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects unauthorized queue access', async () => {
    const res = await broInsightsRouter.fetch(
      new Request('http://bro.test/queue'),
      { ADMIN_SECRET_KEY: 'secret' } as never,
      {} as never,
    );

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: 'UNAUTHORIZED' });
  });

  it('serves the recovery dashboard html when authorized', async () => {
    const sql = makeSql([[]]);
    (createDb as jest.Mock).mockReturnValue(sql);

    const res = await broInsightsRouter.fetch(
      new Request('http://bro.test/', {
        headers: { 'x-admin-key': 'secret' },
      }),
      { ADMIN_SECRET_KEY: 'secret' } as never,
      {} as never,
    );
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(body).toContain('Recovery Queue');
    expect(body).toContain('/api/admin/insights/queue');
    expect(body).toContain('/api/admin/insights/retry/');
    expect(sql.end).toHaveBeenCalled();
  });

  it('returns the queue rows for failed and pending jobs', async () => {
    const sql = makeSql([[
      {
        id: 'job-pending',
        status: 'pending',
        provider: 'airwallex',
        corridor: 'Bristol -> Rome',
        created_at: '2026-03-26T10:00:00.000Z',
        recoveryAttemptCount: '1',
        recommendedAction: 'retry_dispatch',
      },
      {
        id: 'job-failed',
        status: 'failed',
        provider: 'stripe',
        corridor: 'London -> Paris',
        created_at: '2026-03-26T09:00:00.000Z',
        recoveryAttemptCount: '2',
        recommendedAction: 'manual_review',
      },
    ]]);
    (createDb as jest.Mock).mockReturnValue(sql);

    const res = await broInsightsRouter.fetch(
      new Request('http://bro.test/queue', {
        headers: { 'x-admin-key': 'secret' },
      }),
      { ADMIN_SECRET_KEY: 'secret' } as never,
      {} as never,
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual([
      expect.objectContaining({
        id: 'job-pending',
        status: 'pending',
        provider: 'airwallex',
        corridor: 'Bristol -> Rome',
        recoveryAttemptCount: '1',
        recommendedAction: 'retry_dispatch',
      }),
      expect.objectContaining({
        id: 'job-failed',
        status: 'failed',
        provider: 'stripe',
        corridor: 'London -> Paris',
        recoveryAttemptCount: '2',
        recommendedAction: 'manual_review',
      }),
    ]);
    expect(sql.end).toHaveBeenCalled();
  });

  it('retries an existing job', async () => {
    const sql = makeSql([
      [{ id: 'job-retry' }],
      undefined,
    ]);
    (createDb as jest.Mock).mockReturnValue(sql);

    const res = await broInsightsRouter.fetch(
      new Request('http://bro.test/retry/job-retry', {
        method: 'POST',
        headers: { 'x-admin-key': 'secret' },
      }),
      { ADMIN_SECRET_KEY: 'secret' } as never,
      {} as never,
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, jobId: 'job-retry' });
    expect(sql).toHaveBeenCalledTimes(2);
    expect(sql.end).toHaveBeenCalled();
  });

  it('returns 404 when retrying a missing job', async () => {
    const sql = makeSql([[]]);
    (createDb as jest.Mock).mockReturnValue(sql);

    const res = await broInsightsRouter.fetch(
      new Request('http://bro.test/retry/missing-job', {
        method: 'POST',
        headers: { 'x-admin-key': 'secret' },
      }),
      { ADMIN_SECRET_KEY: 'secret' } as never,
      {} as never,
    );
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body).toEqual({ error: 'Job not found' });
    expect(sql).toHaveBeenCalledTimes(1);
    expect(sql.end).toHaveBeenCalled();
  });
});
