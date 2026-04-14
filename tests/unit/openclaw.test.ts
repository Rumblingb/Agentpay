import {
  buildOpenClawDispatchPatch,
  buildPayload,
  dispatchToOpenClaw,
  shouldDispatchToOpenClaw,
  validatePayload,
} from '../../apps/api-edge/src/lib/openclaw';

describe('OpenClaw eligibility', () => {
  it('rejects non-pending jobs', () => {
    expect(shouldDispatchToOpenClaw({})).toEqual({
      ok: false,
      reason: 'pendingFulfilment is not true',
    });
  });

  it('rejects flight jobs', () => {
    expect(shouldDispatchToOpenClaw({
      pendingFulfilment: true,
      flightDetails: { origin: 'LHR', destination: 'JFK' },
    })).toEqual({
      ok: false,
      reason: 'flight job is not eligible for OpenClaw',
    });
  });

  it('rejects eu jobs explicitly', () => {
    expect(shouldDispatchToOpenClaw({
      pendingFulfilment: true,
      trainDetails: { origin: 'Paris', destination: 'Lyon', country: 'eu' },
    })).toEqual({
      ok: false,
      reason: 'eu jobs are not yet supported by OpenClaw dispatch',
    });
  });

  it('accepts uk rail jobs with train details', () => {
    expect(shouldDispatchToOpenClaw({
      pendingFulfilment: true,
      trainDetails: { origin: 'London', destination: 'Manchester', country: 'uk' },
    })).toEqual({ ok: true });
  });
});

describe('OpenClaw payload building', () => {
  it('uses current trainDetails metadata when present', () => {
    const payload = buildPayload('job_1', {
      pendingFulfilment: true,
      trainDetails: {
        origin: 'London',
        destination: 'Manchester',
        departureDatetime: '2026-04-01T08:30:00Z',
        departureTime: '08:30',
        operator: 'Avanti',
        classCode: 'first',
        estimatedFareGbp: 87,
      },
      userName: 'Ada Lovelace',
      userEmail: 'ada@example.com',
      userPhone: '+447700900000',
    });

    expect(payload.fromStation).toBe('London');
    expect(payload.toStation).toBe('Manchester');
    expect(payload.departureDate).toBe('2026-04-01');
    expect(payload.operator).toBe('Avanti');
    expect(payload.trainClass).toBe('first');
    expect(payload.passengers[0]).toEqual({
      legalName: 'Ada Lovelace',
      email: 'ada@example.com',
      phone: '+447700900000',
    });
  });

  it('falls back to legacy metadata shapes', () => {
    const payload = buildPayload('job_legacy', {
      pendingFulfilment: true,
      plan: [{
        skills: [{
          parameters: {
            fromStation: 'Derby',
            toStation: 'York',
            travelDate: '2026-05-02',
            departureTime: '10:15',
            operator: 'LNER',
            fareGbp: '42.5',
          },
        }],
      }],
      travelProfile: {
        legalName: 'Grace Hopper',
        email: 'grace@example.com',
        phone: '+15551234567',
        nationality: 'uk',
      },
    });

    expect(payload.fromStation).toBe('Derby');
    expect(payload.toStation).toBe('York');
    expect(payload.departureDate).toBe('2026-05-02');
    expect(payload.departureTime).toBe('10:15');
    expect(payload.operator).toBe('LNER');
    expect(payload.fareGbp).toBe(42.5);
    expect(payload.passengers[0].legalName).toBe('Grace Hopper');
    expect(payload.passengers[0].email).toBe('grace@example.com');
  });

  it('flags incomplete payloads', () => {
    expect(validatePayload(buildPayload('job_bad', {
      pendingFulfilment: true,
      trainDetails: {},
    }))).toBe('Missing fromStation');
  });
});

describe('dispatchToOpenClaw', () => {
  const env = {
    OPENCLAW_API_URL: 'https://openclaw.example.com',
    OPENCLAW_API_KEY: 'secret',
  } as any;

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('skips ineligible jobs before fetch', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch' as any);
    const result = await dispatchToOpenClaw(env, 'job_flight', {
      pendingFulfilment: true,
      flightDetails: { origin: 'LHR', destination: 'JFK' },
    });

    expect(result.status).toBe('failed');
    expect(result.error).toContain('flight job');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('dispatches valid rail jobs', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true,
      json: async () => ({ jobId: 'claw_123' }),
    } as any);

    const result = await dispatchToOpenClaw(env, 'job_ok', {
      pendingFulfilment: true,
      trainDetails: {
        origin: 'London',
        destination: 'Manchester',
        departureDatetime: '2026-04-01T08:30:00Z',
      },
      userName: 'Ada Lovelace',
      userEmail: 'ada@example.com',
    });

    expect(result).toMatchObject({
      status: 'dispatched',
      openclawJobId: 'claw_123',
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('marks 5xx dispatch failures as retryable', async () => {
    jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({ error: 'temporary outage' }),
    } as any);

    const result = await dispatchToOpenClaw(env, 'job_retry', {
      pendingFulfilment: true,
      trainDetails: {
        origin: 'London',
        destination: 'Manchester',
        departureDatetime: '2026-04-01T08:30:00Z',
      },
      userName: 'Ada Lovelace',
      userEmail: 'ada@example.com',
    });

    expect(result).toMatchObject({
      status: 'failed',
      retryable: true,
    });
  });
});

describe('buildOpenClawDispatchPatch', () => {
  it('stamps retry-pending metadata for retryable failures', () => {
    const patch = buildOpenClawDispatchPatch(
      { dispatchAttemptCount: 1, openclawJobId: 'claw_old' },
      {
        status: 'failed',
        error: 'gateway timeout',
        dispatchedAt: '2026-04-15T00:00:00.000Z',
        retryable: true,
      },
    );

    expect(patch).toMatchObject({
      dispatchStatus: 'retry_pending',
      dispatchAttemptCount: 2,
      dispatchRetryable: true,
      openclawJobId: 'claw_old',
      openclawError: 'gateway timeout',
    });
    expect(patch.nextDispatchRetryAt).toBe('2026-04-15T00:15:00.000Z');
  });
});
