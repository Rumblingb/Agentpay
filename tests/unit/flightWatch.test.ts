jest.mock('postgres', () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock('../../apps/api-edge/src/routes/tripRooms', () => ({
  fanOutToTripRoom: jest.fn(),
}));

import postgres from 'postgres';
import { fanOutToTripRoom } from '../../apps/api-edge/src/routes/tripRooms';
import { runFlightWatch } from '../../apps/api-edge/src/cron/flightWatch';

function makeSql(responses: unknown[]) {
  const queue = [...responses];
  const sql = (jest.fn(async () => queue.shift()) as unknown) as jest.Mock & { end: jest.Mock };
  sql.end = jest.fn().mockResolvedValue(undefined);
  return sql;
}

describe('runFlightWatch', () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (global as any).fetch = fetchMock;
  });

  it('sends flight delay notifications using the shared receipt contract', async () => {
    const sql = makeSql([
      [{
        id: 'job-flight-delay',
        metadata: {
          pushToken: 'ExponentPushToken[test]',
          flightDetails: {
            flightNumber: 'BA0215',
            departureAt: '2026-03-26T14:00:00.000Z',
            origin: 'LHR',
            destination: 'FCO',
          },
        },
      }],
      undefined,
    ]);
    (postgres as jest.Mock).mockReturnValue(sql);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [{
          flight_status: 'active',
          departure: { delay: 25, estimated: '2026-03-26T14:25:00.000Z', gate: 'A12' },
          arrival: {},
        }],
      }),
    });
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });

    await runFlightWatch({
      AVIATIONSTACK_API_KEY: 'key',
      HYPERDRIVE: { connectionString: 'postgres://test' },
    } as never);

    const pushBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(pushBody.data).toMatchObject({
      intentId: 'job-flight-delay',
      screen: 'receipt',
      action: 'delay',
      delayMinutes: 25,
      disruptionRoute: 'LHR → FCO',
    });
    expect(fanOutToTripRoom).toHaveBeenCalled();
  });

  it('sends gate updates using gate_assigned action', async () => {
    const sql = makeSql([
      [{
        id: 'job-flight-gate',
        metadata: {
          pushToken: 'ExponentPushToken[test]',
          flightDetails: {
            flightNumber: 'BA0215',
            departureAt: '2026-03-26T14:00:00.000Z',
            origin: 'LHR',
            destination: 'FCO',
          },
        },
      }],
      undefined,
    ]);
    (postgres as jest.Mock).mockReturnValue(sql);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [{
          flight_status: 'scheduled',
          departure: { gate: 'B7' },
          arrival: {},
        }],
      }),
    });
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });

    await runFlightWatch({
      AVIATIONSTACK_API_KEY: 'key',
      HYPERDRIVE: { connectionString: 'postgres://test' },
    } as never);

    const pushBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(pushBody.data).toMatchObject({
      intentId: 'job-flight-gate',
      screen: 'receipt',
      action: 'gate_assigned',
      gate: 'B7',
      disruptionRoute: 'LHR → FCO',
    });
  });
});
