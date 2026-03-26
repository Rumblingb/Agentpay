jest.mock('../../apps/api-edge/src/lib/db', () => ({
  createDb: jest.fn(),
}));

jest.mock('../../apps/api-edge/src/lib/openclaw', () => ({
  dispatchToOpenClaw: jest.fn(),
}));

import { createDb } from '../../apps/api-edge/src/lib/db';
import { dispatchToOpenClaw } from '../../apps/api-edge/src/lib/openclaw';
import { runAutoRecoverySweep } from '../../apps/api-edge/src/lib/bookingRecovery';

function makeSql(responses: unknown[]) {
  const queue = [...responses];
  const sql = (jest.fn(async () => queue.shift()) as unknown) as jest.Mock & { end: jest.Mock };
  sql.end = jest.fn().mockResolvedValue(undefined);
  return sql;
}

describe('runAutoRecoverySweep', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('retries dispatch for recoverable jobs and persists recovery metadata', async () => {
    const sql = makeSql([[
      {
        id: 'job-1',
        status: 'confirmed',
        metadata: {
          protocol: 'marketplace_hire',
          paymentConfirmed: true,
          paymentConfirmedAt: new Date(Date.now() - 11 * 60 * 1000).toISOString(),
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ], undefined]);
    (createDb as jest.Mock).mockReturnValue(sql);
    (dispatchToOpenClaw as jest.Mock).mockResolvedValue({
      status: 'dispatched',
      openclawJobId: 'oc-123',
      dispatchedAt: new Date().toISOString(),
    });

    const result = await runAutoRecoverySweep({} as never, { limit: 10 });

    expect(result.scanned).toBe(1);
    expect(result.acted).toBe(1);
    expect(result.results[0]).toMatchObject({
      jobId: 'job-1',
      recommendedAction: 'retry_dispatch',
      ok: true,
    });
    expect(dispatchToOpenClaw).toHaveBeenCalledWith(expect.anything(), 'job-1', expect.objectContaining({
      paymentConfirmed: true,
    }));
    expect(sql).toHaveBeenCalledTimes(2);
    expect(sql.end).toHaveBeenCalled();
  });

  it('marks manual review when policy calls for escalation', async () => {
    const sql = makeSql([[
      {
        id: 'job-2',
        status: 'failed',
        metadata: {
          protocol: 'marketplace_hire',
          bookingState: 'failed',
          fulfilmentFailed: true,
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ], undefined]);
    (createDb as jest.Mock).mockReturnValue(sql);

    const result = await runAutoRecoverySweep({} as never, { limit: 10 });

    expect(result.acted).toBe(1);
    expect(result.results[0]).toMatchObject({
      jobId: 'job-2',
      recommendedAction: 'escalate_manual',
      ok: true,
    });
    expect(dispatchToOpenClaw).not.toHaveBeenCalled();
    expect(sql).toHaveBeenCalledTimes(2);
  });
});
