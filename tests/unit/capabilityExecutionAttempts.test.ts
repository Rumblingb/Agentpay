jest.mock('../../apps/api-edge/src/lib/db', () => ({
  createDb: jest.fn(),
  parseJsonb: (value: unknown, fallback: unknown) => {
    if (typeof value !== 'string') return value ?? fallback;
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  },
}));

jest.mock('../../apps/api-edge/src/lib/capabilityBroker', () => ({
  executeCapabilityProxy: jest.fn(),
  getCapabilityProviderDefaults: jest.fn(),
}));

jest.mock('../../apps/api-edge/src/lib/capabilityVault', () => ({
  getCapability: jest.fn(),
  getCapabilityMetadata: jest.fn(),
}));

import { createDb } from '../../apps/api-edge/src/lib/db';
import {
  executeCapabilityProxy,
  getCapabilityProviderDefaults,
} from '../../apps/api-edge/src/lib/capabilityBroker';
import {
  getCapability,
  getCapabilityMetadata,
} from '../../apps/api-edge/src/lib/capabilityVault';
import { resumeCapabilityExecutionAttempt } from '../../apps/api-edge/src/lib/capabilityExecutionAttempts';

function makeSql(responses: unknown[]) {
  const queue = [...responses];
  const sql = jest.fn(async () => queue.shift()) as jest.Mock & { end: jest.Mock };
  sql.end = jest.fn().mockResolvedValue(undefined);
  return sql;
}

function attemptRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'attempt_1',
    merchant_id: 'merchant_1',
    capability_vault_entry_id: 'capability_1',
    authority_profile_id: 'authority_1',
    hosted_action_session_id: 'action_1',
    principal_id: 'principal_1',
    operator_id: 'operator_1',
    idempotency_key: 'idem_1',
    status: 'resuming',
    blocked_reason: 'funding_required',
    method: 'POST',
    path: '/timeseries/get_range',
    query_json: JSON.stringify({}),
    headers_json: JSON.stringify({ 'x-agentpay-request-id': 'request_1' }),
    body_json: JSON.stringify({ dataset: 'GLBX.MDP3', symbols: ['ES.FUT'] }),
    request_id: 'request_1',
    host_context_json: JSON.stringify({ host: 'mcp' }),
    guardrail_context_json: JSON.stringify({ dailyUsd: 25 }),
    authority_context_json: JSON.stringify({ rail: 'card' }),
    next_action_json: JSON.stringify({ type: 'confirmation_required' }),
    result_payload_json: JSON.stringify({}),
    metadata_json: JSON.stringify({}),
    locked_unit_price_micros: 75_000,
    locked_currency: 'USD',
    used_calls_snapshot: 3,
    free_calls_snapshot: 3,
    resume_count: 1,
    expires_at: new Date('2099-01-01T00:00:00.000Z'),
    completed_at: null,
    created_at: new Date('2026-08-20T00:00:00.000Z'),
    updated_at: new Date('2026-08-20T00:00:00.000Z'),
    ...overrides,
  };
}

const env = { DATABASE_URL: 'postgres://agentpay.test' } as never;

describe('capability execution attempt resume', () => {
  beforeEach(() => {
    (getCapability as jest.Mock).mockResolvedValue({
      id: 'capability_1',
      capabilityKey: 'databento_primary',
      provider: 'databento',
      status: 'active',
    });
    (getCapabilityMetadata as jest.Mock).mockReturnValue({ paidUnitPriceUsdMicros: 75_000 });
    (getCapabilityProviderDefaults as jest.Mock).mockReturnValue({
      provider: 'databento',
      paidUnitPriceUsdMicros: 75_000,
    });
    (executeCapabilityProxy as jest.Mock).mockResolvedValue({
      status: 'completed',
      provider: 'databento',
      data: { records: 5 },
    });
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('replays the exact stored call once and returns the completed attempt to duplicate callbacks', async () => {
    const completed = attemptRow({
      status: 'completed',
      completed_at: new Date('2026-08-20T00:01:00.000Z'),
      result_payload_json: JSON.stringify({ executionResult: { status: 'completed' } }),
    });
    (createDb as jest.Mock)
      .mockReturnValueOnce(makeSql([[attemptRow()]]))
      .mockReturnValueOnce(makeSql([[{
        id: 'merchant_1',
        name: 'AgentPay Demo',
        email: 'demo@agentpay.so',
        wallet_address: null,
        webhook_url: null,
      }]]))
      .mockReturnValueOnce(makeSql([[completed]]))
      .mockReturnValueOnce(makeSql([[], [completed]]));

    const first = await resumeCapabilityExecutionAttempt(env, 'attempt_1');
    const duplicate = await resumeCapabilityExecutionAttempt(env, 'attempt_1');

    expect(first.resumed).toBe(true);
    expect(first.attempt?.status).toBe('completed');
    expect(executeCapabilityProxy).toHaveBeenCalledTimes(1);
    expect(executeCapabilityProxy).toHaveBeenCalledWith(
      env,
      expect.objectContaining({ id: 'merchant_1' }),
      expect.objectContaining({
        capabilityId: 'capability_1',
        method: 'POST',
        path: '/timeseries/get_range',
        body: { dataset: 'GLBX.MDP3', symbols: ['ES.FUT'] },
        requestId: 'request_1',
      }),
    );
    expect(duplicate.resumed).toBe(false);
    expect(duplicate.attempt?.status).toBe('completed');
    expect(executeCapabilityProxy).toHaveBeenCalledTimes(1);
  });

  it('fails closed before execution when provider pricing changes after the human step', async () => {
    const failed = attemptRow({
      status: 'failed',
      blocked_reason: 'pricing_changed',
      completed_at: new Date('2026-08-20T00:01:00.000Z'),
      result_payload_json: JSON.stringify({ error: 'PRICING_CHANGED' }),
    });
    (getCapabilityMetadata as jest.Mock).mockReturnValue({ paidUnitPriceUsdMicros: 100_000 });
    (createDb as jest.Mock)
      .mockReturnValueOnce(makeSql([[attemptRow()]]))
      .mockReturnValueOnce(makeSql([[{
        id: 'merchant_1',
        name: 'AgentPay Demo',
        email: 'demo@agentpay.so',
        wallet_address: null,
        webhook_url: null,
      }]]))
      .mockReturnValueOnce(makeSql([[failed]]));

    const result = await resumeCapabilityExecutionAttempt(env, 'attempt_1');

    expect(result.resumed).toBe(true);
    expect(result.attempt?.status).toBe('failed');
    expect(result.attempt?.blockedReason).toBe('pricing_changed');
    expect(executeCapabilityProxy).not.toHaveBeenCalled();
  });
});
