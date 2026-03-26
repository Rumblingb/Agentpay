jest.mock('postgres', () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock('../../apps/api-edge/src/routes/tripRooms', () => ({
  fanOutToTripRoom: jest.fn(),
}));

jest.mock('../../apps/api-edge/src/lib/rtt', () => ({
  stationToCRS: jest.fn((name: string) => (name === 'Bristol Temple Meads' ? 'BRI' : 'PAD')),
  checkServiceStatus: jest.fn(),
  queryRTT: jest.fn(),
}));

import postgres from 'postgres';
import { fanOutToTripRoom } from '../../apps/api-edge/src/routes/tripRooms';
import { checkServiceStatus, queryRTT } from '../../apps/api-edge/src/lib/rtt';
import { runPlatformWatch } from '../../apps/api-edge/src/cron/platformWatch';

function makeSql(responses: unknown[]) {
  const queue = [...responses];
  const sql = (jest.fn(async () => queue.shift()) as unknown) as jest.Mock & { end: jest.Mock };
  sql.end = jest.fn().mockResolvedValue(undefined);
  return sql;
}

describe('runPlatformWatch', () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (global as any).fetch = fetchMock;
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
  });

  it('sends cancelled notifications with receipt action and transcript', async () => {
    const sql = makeSql([
      [{
        id: 'job-cancelled',
        metadata: {
          pushToken: 'ExponentPushToken[test]',
          departureDatetime: '2026-03-26T12:00:00.000Z',
          trainDetails: {
            origin: 'Bristol Temple Meads',
            destination: 'London Paddington',
            serviceUid: 'svc-1',
          },
        },
      }],
      undefined,
    ]);
    (postgres as jest.Mock).mockReturnValue(sql);
    (checkServiceStatus as jest.Mock).mockResolvedValue({ isCancelled: true });
    (queryRTT as jest.Mock).mockResolvedValue({
      services: [{ departureTime: '12:30', arrivalTime: '13:59', estimatedFareGbp: 42, operator: 'GWR', serviceUid: 'svc-2' }],
    });

    await runPlatformWatch({ HYPERDRIVE: { connectionString: 'postgres://test' } } as never);

    const pushBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(pushBody.data).toMatchObject({
      intentId: 'job-cancelled',
      screen: 'receipt',
      action: 'cancelled',
      destination: 'London Paddington',
      disruptionRoute: 'Bristol Temple Meads → London Paddington',
    });
    expect(pushBody.data.transcript).toContain('Rebook my cancelled');
    expect(fanOutToTripRoom).toHaveBeenCalled();
    expect(sql.end).toHaveBeenCalled();
  });

  it('sends delay notifications with receipt action and delay minutes', async () => {
    const sql = makeSql([
      [{
        id: 'job-delay',
        metadata: {
          pushToken: 'ExponentPushToken[test]',
          departureDatetime: '2026-03-26T12:00:00.000Z',
          trainDetails: {
            origin: 'Bristol Temple Meads',
            destination: 'London Paddington',
            serviceUid: 'svc-1',
            platform: '4',
          },
        },
      }],
      undefined,
    ]);
    (postgres as jest.Mock).mockReturnValue(sql);
    (checkServiceStatus as jest.Mock).mockResolvedValue({ isCancelled: false, platform: '4', delayMinutes: 18 });
    (queryRTT as jest.Mock).mockResolvedValue({ services: [] });

    await runPlatformWatch({ HYPERDRIVE: { connectionString: 'postgres://test' } } as never);

    const pushBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(pushBody.data).toMatchObject({
      intentId: 'job-delay',
      screen: 'receipt',
      action: 'delay',
      delayMinutes: 18,
      disruptionRoute: 'Bristol Temple Meads → London Paddington',
    });
  });
});
