jest.mock('../../apps/api-edge/src/lib/db', () => ({
  createDb: jest.fn(),
  parseJsonb: (val: unknown, fallback: unknown) => {
    if (val === null || val === undefined) return fallback;
    if (typeof val === 'string') {
      try { return JSON.parse(val); } catch { return fallback; }
    }
    if (typeof val === 'object') return val;
    return fallback;
  },
}));

import { createDb } from '../../apps/api-edge/src/lib/db';
import { capabilitiesRouter } from '../../apps/api-edge/src/routes/capabilities';
import { encryptPayload } from '../../apps/api-edge/src/lib/rcmCredentialVault';
import { sha256Hex } from '../../apps/api-edge/src/lib/approvalSessions';

function makeSql(responses: unknown[]) {
  const queue = [...responses];
  const sql = (jest.fn(async () => queue.shift()) as unknown) as jest.Mock & {
    end: jest.Mock;
  };
  sql.end = jest.fn().mockResolvedValue(undefined);
  return sql;
}

function authEnv(extra: Record<string, unknown> = {}) {
  return {
    AGENTPAY_TEST_MODE: 'true',
    API_BASE_URL: 'http://agentpay.test',
    CAPABILITY_VAULT_ENCRYPTION_KEY: 'a'.repeat(64),
    RCM_VAULT_ENCRYPTION_KEY: 'a'.repeat(64),
    RESEND_API_KEY: 're_test_123',
    ...extra,
  } as never;
}

function authHeaders(extra: Record<string, string> = {}) {
  return {
    authorization: 'Bearer sk_test_sim',
    ...extra,
  };
}

describe('capabilitiesRouter vault-from-env', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    (createDb as jest.Mock).mockReset();
  });

  it('fails closed when the OTP email cannot be delivered', async () => {
    (createDb as jest.Mock).mockReturnValue(makeSql([[], []]));
    jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => JSON.stringify({ message: 'Domain not verified' }),
    } as any);

    const res = await capabilitiesRouter.fetch(
      new Request('http://agentpay.test/vault-from-env', {
        method: 'POST',
        headers: authHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({
          credentials: [{
            provider: 'firecrawl',
            label: 'Firecrawl',
            baseUrl: 'https://api.firecrawl.dev',
            authScheme: 'bearer',
            credentialKind: 'api_key',
            keyValue: 'fc_live_123',
          }],
        }),
      }),
      authEnv(),
      {} as never,
    );

    await expect(res.json()).resolves.toEqual({
      error: 'Failed to deliver vault confirmation code',
    });
    expect(res.status).toBe(502);
  });

  it('returns the actual stored capability id after OTP confirmation', async () => {
    const vaultKey = 'a'.repeat(64);
    const otp = '123456';
    const encryptedBundle = await encryptPayload(vaultKey, JSON.stringify([{
      provider: 'firecrawl',
      label: 'Firecrawl',
      baseUrl: 'https://api.firecrawl.dev',
      authScheme: 'bearer',
      credentialKind: 'api_key',
      keyValue: 'fc_live_123',
    }]));

    (createDb as jest.Mock).mockReturnValue(makeSql([
      [{
        id: 'vfs_1',
        merchant_id: '26e7ac4f-017e-4316-bf4f-9a1b37112510',
        status: 'pending',
        result_payload_json: {
          otp_hash: await sha256Hex(otp),
          encrypted_bundle: encryptedBundle,
          attempt_count: 0,
        },
        expires_at: new Date('2099-04-19T12:00:00.000Z'),
      }],
      [{ id: 'cap_existing', capability_key: 'firecrawl_primary' }],
      [],
    ]));

    const res = await capabilitiesRouter.fetch(
      new Request('http://agentpay.test/vault-from-env/vfs_1/confirm', {
        method: 'POST',
        headers: authHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({ otp }),
      }),
      authEnv(),
      {} as never,
    );

    const body = await res.json() as Record<string, unknown>;
    expect(res.status).toBe(200);
    expect(body.vaulted).toEqual([{
      provider: 'firecrawl',
      capabilityId: 'cap_existing',
      capabilityKey: 'firecrawl_primary',
    }]);
  });
});
