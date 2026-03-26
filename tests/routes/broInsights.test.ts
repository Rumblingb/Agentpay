jest.mock('../../apps/api-edge/src/lib/db', () => ({
  createDb: jest.fn(),
}));

jest.mock('../../apps/api-edge/src/lib/openclaw', () => ({
  dispatchToOpenClaw: jest.fn(),
}));

import { createDb } from '../../apps/api-edge/src/lib/db';
import { dispatchToOpenClaw } from '../../apps/api-edge/src/lib/openclaw';
import { broInsightsRouter } from '../../apps/api-edge/src/routes/broInsights';

function makeSql(responses: unknown[]) {
  const queue = [...responses];
  const sql = (jest.fn(async () => queue.shift()) as unknown) as jest.Mock & { end: jest.Mock };
  sql.end = jest.fn().mockResolvedValue(undefined);
  return sql;
}

describe('broInsights founder metrics route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects unauthorized access', async () => {
    const res = await broInsightsRouter.fetch(
      new Request('http://bro.test/founder-metrics'),
      { ADMIN_SECRET_KEY: 'secret' } as never,
      {} as never,
    );

    expect(res.status).toBe(401);
  });

  it('serves the admin dashboard html when authorized', async () => {
    const res = await broInsightsRouter.fetch(
      new Request('http://bro.test/dashboard?key=secret'),
      { ADMIN_SECRET_KEY: 'secret' } as never,
      {} as never,
    );
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(body).toContain('Bro Founder Console');
    expect(body).toContain('/api/admin/founder-metrics');
  });

  it('reports issued-only provider success and marketplace economics', async () => {
    const sql = makeSql([
      [{ status: 'completed', count: 4 }, { status: 'failed', count: 1 }],
      [{ bookingState: 'issued', count: 2 }, { bookingState: 'payment_confirmed', count: 1 }],
      [{ provider: 'stripe', corridor: 'London -> Paris', total: 3, succeeded: 1 }],
      [{ attempted: 2, saved: 1, escalated: 1 }],
      [{ avgMinutes: 18.4, p95Minutes: 42.7 }],
      [{ protocol: 'marketplace_hire', intents: 5, grossVolumeUsdc: 250, platformRevenueUsdc: 12.5 }],
    ]);
    (createDb as jest.Mock).mockReturnValue(sql);

    const res = await broInsightsRouter.fetch(
      new Request('http://bro.test/founder-metrics', {
        headers: { 'x-admin-key': 'secret' },
      }),
      { ADMIN_SECRET_KEY: 'secret' } as never,
      {} as never,
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.providerPerformance[0]).toMatchObject({
      provider: 'stripe',
      total: 3,
      succeeded: 1,
      successRate: 0.3333,
    });
    expect(body.economics.byProtocol[0]).toMatchObject({
      protocol: 'marketplace_hire',
      grossVolumeUsdc: 250,
      platformRevenueUsdc: 12.5,
    });
    expect(body.recovery.saveRate).toBe(0.5);
    expect(sql.end).toHaveBeenCalled();
  });

  it('builds an actionable ops queue sorted by urgency', async () => {
    const sql = makeSql([[
      {
        id: 'job-dispatch',
        status: 'confirmed',
        metadata: {
          protocol: 'marketplace_hire',
          paymentConfirmed: true,
          paymentConfirmedAt: new Date(Date.now() - 11 * 60 * 1000).toISOString(),
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date('2026-03-26T10:00:00.000Z').toISOString(),
      },
      {
        id: 'job-failed',
        status: 'failed',
        metadata: {
          protocol: 'marketplace_hire',
          fulfilmentFailed: true,
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date('2026-03-26T11:00:00.000Z').toISOString(),
      },
    ]]);
    (createDb as jest.Mock).mockReturnValue(sql);

    const res = await broInsightsRouter.fetch(
      new Request('http://bro.test/ops-queue', {
        headers: { 'x-admin-key': 'secret' },
      }),
      { ADMIN_SECRET_KEY: 'secret' } as never,
      {} as never,
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.queueDepth).toBe(2);
    expect(body.byPriority).toEqual({ p1: 1, p3: 1 });
    expect(body.jobs[0]).toMatchObject({
      jobId: 'job-failed',
      opsPriority: 1,
      recommendedAction: 'escalate_manual',
    });
    expect(body.jobs[1]).toMatchObject({
      jobId: 'job-dispatch',
      opsPriority: 3,
      recommendedAction: 'retry_dispatch',
    });
  });

  it('recovers a dispatchable booking-health job', async () => {
    const sql = makeSql([
      [{
        id: 'job-dispatch',
        status: 'confirmed',
        metadata: {
          protocol: 'marketplace_hire',
          paymentConfirmed: true,
          paymentConfirmedAt: new Date(Date.now() - 11 * 60 * 1000).toISOString(),
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }],
      undefined,
    ]);
    (createDb as jest.Mock).mockReturnValue(sql);
    (dispatchToOpenClaw as jest.Mock).mockResolvedValue({
      status: 'dispatched',
      openclawJobId: 'oc-123',
      dispatchedAt: '2026-03-26T12:00:00.000Z',
    });

    const res = await broInsightsRouter.fetch(
      new Request('http://bro.test/booking-health/job-dispatch/recover', {
        method: 'POST',
        headers: { 'x-admin-key': 'secret' },
      }),
      { ADMIN_SECRET_KEY: 'secret' } as never,
      {} as never,
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      jobId: 'job-dispatch',
    });
    expect(dispatchToOpenClaw).toHaveBeenCalledWith(expect.anything(), 'job-dispatch', expect.objectContaining({
      paymentConfirmed: true,
    }));
    expect(sql).toHaveBeenCalledTimes(2);
  });

  it('escalates a booking-health job for manual review', async () => {
    const sql = makeSql([
      [{ id: 'job-failed' }],
      undefined,
    ]);
    (createDb as jest.Mock).mockReturnValue(sql);

    const res = await broInsightsRouter.fetch(
      new Request('http://bro.test/booking-health/job-failed/escalate', {
        method: 'POST',
        headers: { 'x-admin-key': 'secret', 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Needs human help' }),
      }),
      { ADMIN_SECRET_KEY: 'secret' } as never,
      {} as never,
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      jobId: 'job-failed',
      manualReviewRequired: true,
    });
    expect(sql).toHaveBeenCalledTimes(2);
  });
});
