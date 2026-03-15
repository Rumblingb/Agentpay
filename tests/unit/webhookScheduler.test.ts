import { scheduleWebhookWithRollback } from '../../src/services/webhookScheduler';

jest.mock('../../src/lib/prisma', () => ({
  __esModule: true,
  default: {
    transactions: { updateMany: jest.fn() },
  },
}));

jest.mock('../../src/services/webhooks', () => ({
  scheduleWebhook: jest.fn(),
}));

jest.mock('../../src/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() },
}));

const prisma = require('../../src/lib/prisma').default;
const mockUpdateMany = prisma.transactions.updateMany as jest.Mock;
const mockSchedule = require('../../src/services/webhooks').scheduleWebhook as jest.Mock;
const mockLogger = require('../../src/logger').logger as any;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('webhookScheduler', () => {
  it('succeeds when scheduleWebhook resolves and does not rollback', async () => {
    mockUpdateMany.mockResolvedValueOnce({ count: 1 });
    mockSchedule.mockResolvedValueOnce(undefined);

    await scheduleWebhookWithRollback('https://example.com/hook', { foo: 'bar' }, 'mid-1', { id: 'tx-1', webhook_status: 'not_sent' }, { awaitDelivery: true });

    expect(mockUpdateMany).toHaveBeenCalledTimes(1);
    expect(mockSchedule).toHaveBeenCalledTimes(1);
    expect(mockLogger.error).not.toHaveBeenCalled();
  });

  it('rolls back when scheduleWebhook rejects', async () => {
    mockUpdateMany
      .mockResolvedValueOnce({ count: 1 }) // initial mark
      .mockResolvedValueOnce({ count: 1 }); // rollback
    mockSchedule.mockRejectedValueOnce(new Error('boom'));

    await scheduleWebhookWithRollback('https://example.com/hook', { foo: 'bar' }, 'mid-1', { id: 'tx-2', webhook_status: 'not_sent' }, { awaitDelivery: true });

    expect(mockUpdateMany).toHaveBeenCalled();
    // rollback should be attempted (second call)
    expect(mockUpdateMany.mock.calls.length).toBeGreaterThanOrEqual(2);
    // verify rollback used webhook_status scheduled
    const rbWhere = mockUpdateMany.mock.calls[1][0].where;
    expect(rbWhere.webhook_status).toBe('scheduled');
  });
});
