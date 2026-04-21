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
import { retrieveCapabilitySecret } from '../../apps/api-edge/src/lib/capabilityVault';
import { encryptPayload } from '../../apps/api-edge/src/lib/rcmCredentialVault';

function makeSql(responses: unknown[]) {
  const queue = [...responses];
  const sql = (jest.fn(async () => queue.shift()) as unknown) as jest.Mock & {
    end: jest.Mock;
  };
  sql.end = jest.fn().mockResolvedValue(undefined);
  return sql;
}

describe('capability vault key rotation', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    (createDb as jest.Mock).mockReset();
  });

  it('decrypts stored capability secrets with a previous rotation key', async () => {
    const oldKey = 'a'.repeat(64);
    const newKey = 'b'.repeat(64);
    const encryptedBlob = await encryptPayload(oldKey, JSON.stringify({ apiKey: 'fc_live_123' }));
    (createDb as jest.Mock).mockReturnValue(makeSql([[
      {
        id: 'cap_1',
        merchant_id: '26e7ac4f-017e-4316-bf4f-9a1b37112510',
        capability_key: 'firecrawl_primary',
        capability_type: 'external_api',
        capability_scope: 'firecrawl',
        provider: 'firecrawl',
        subject_type: 'merchant',
        subject_ref: 'merchant_1',
        status: 'active',
        secret_payload_json: { encryptedBlob },
        metadata: {
          authScheme: 'bearer',
          credentialKind: 'api_key',
          baseUrl: 'https://api.firecrawl.dev',
          allowedHosts: ['api.firecrawl.dev'],
          scopes: [],
          freeCalls: 5,
          paidUnitPriceUsdMicros: 20000,
        },
        expires_at: null,
        revoked_at: null,
        last_used_at: null,
        created_at: new Date('2026-04-16T12:00:00.000Z'),
        updated_at: new Date('2026-04-16T12:00:00.000Z'),
      },
    ]]));

    const result = await retrieveCapabilitySecret({
      CAPABILITY_VAULT_ENCRYPTION_KEY: newKey,
      CAPABILITY_VAULT_DECRYPTION_KEYS: oldKey,
    } as never, '26e7ac4f-017e-4316-bf4f-9a1b37112510', 'cap_1');

    expect(result?.capability.id).toBe('cap_1');
    expect(result?.secretPayload).toEqual({ apiKey: 'fc_live_123' });
  });
});
