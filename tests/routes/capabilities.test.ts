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
import { sha256Hex } from '../../apps/api-edge/src/lib/approvalSessions';
import { encryptPayload } from '../../apps/api-edge/src/lib/rcmCredentialVault';
import { capabilitiesRouter } from '../../apps/api-edge/src/routes/capabilities';

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
    ...extra,
  } as never;
}

function authHeaders(extra: Record<string, string> = {}) {
  return {
    authorization: 'Bearer sk_test_sim',
    ...extra,
  };
}

describe('capabilitiesRouter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('creates a secure capability connect session', async () => {
    const sql = makeSql([
      [{
        id: 'action_session_1',
        merchant_id: '26e7ac4f-017e-4316-bf4f-9a1b37112510',
        action_type: 'auth_required',
        entity_type: 'capability_connect',
        entity_id: 'firecrawl_primary',
        title: 'Connect firecrawl',
        summary: 'Securely connect firecrawl for firecrawl_primary.',
        status: 'pending',
        audience: 'generic',
        auth_type: 'api_key',
        resume_url: null,
        display_payload_json: JSON.stringify({ kind: 'capability_connect' }),
        result_payload_json: JSON.stringify({}),
        metadata_json: JSON.stringify({ provider: 'firecrawl' }),
        expires_at: new Date('2099-04-16T12:30:00.000Z'),
        completed_at: null,
        used_at: null,
        created_at: new Date('2026-04-16T12:00:00.000Z'),
        updated_at: new Date('2026-04-16T12:00:00.000Z'),
      }],
      [{
        id: 'cap_1',
        merchant_id: '26e7ac4f-017e-4316-bf4f-9a1b37112510',
        capability_key: 'firecrawl_primary',
        capability_type: 'external_api',
        capability_scope: 'firecrawl',
        provider: 'firecrawl',
        subject_type: 'merchant',
        subject_ref: 'merchant_1',
        status: 'pending_connect',
        secret_payload_json: {},
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
      }],
      [{
        id: 'sess_1',
        merchant_id: '26e7ac4f-017e-4316-bf4f-9a1b37112510',
        capability_vault_entry_id: 'cap_1',
        session_token_hash: 'hash',
        session_state: 'pending',
        provider: 'firecrawl',
        redirect_url: null,
        callback_url: null,
        connection_payload_json: { fields: [{ key: 'api_key', label: 'API key', secret: true }] },
        metadata: {},
        expires_at: new Date('2099-04-16T12:15:00.000Z'),
        connected_at: null,
        revoked_at: null,
        created_at: new Date('2026-04-16T12:00:00.000Z'),
        updated_at: new Date('2026-04-16T12:00:00.000Z'),
      }],
      [{
        id: 'action_session_1',
        merchant_id: '26e7ac4f-017e-4316-bf4f-9a1b37112510',
        action_type: 'auth_required',
        entity_type: 'capability_connect',
        entity_id: 'firecrawl_primary',
        title: 'Connect firecrawl',
        summary: 'Securely connect firecrawl for firecrawl_primary.',
        status: 'pending',
        audience: 'generic',
        auth_type: 'api_key',
        resume_url: null,
        display_payload_json: JSON.stringify({ kind: 'capability_connect' }),
        result_payload_json: JSON.stringify({}),
        metadata_json: JSON.stringify({ provider: 'firecrawl' }),
        expires_at: new Date('2099-04-16T12:30:00.000Z'),
        completed_at: null,
        used_at: null,
        created_at: new Date('2026-04-16T12:00:00.000Z'),
        updated_at: new Date('2026-04-16T12:00:00.000Z'),
      }],
    ]);
    (createDb as jest.Mock).mockReturnValue(sql);

    const res = await capabilitiesRouter.fetch(
      new Request('http://agentpay.test/connect-sessions', {
        method: 'POST',
        headers: authHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({
          provider: 'firecrawl',
          capabilityKey: 'firecrawl_primary',
          subjectType: 'merchant',
          subjectRef: 'merchant_1',
          baseUrl: 'https://api.firecrawl.dev',
          allowedHosts: ['api.firecrawl.dev'],
          authScheme: 'bearer',
          credentialKind: 'api_key',
        }),
      }),
      authEnv(),
      {} as never,
    );

    const body = await res.json() as Record<string, unknown>;
    expect(res.status).toBe(201);
    expect(body.status).toBe('auth_required');
    expect((body.nextAction as Record<string, unknown>).type).toBe('auth_required');
    expect(JSON.stringify(body)).toContain('sessionToken');
  });

  it('uses provider defaults and returns a hosted connect action with resume continuity', async () => {
    const sessionToken = 'connect-token';
    const sql = makeSql([
      [{
        id: 'action_session_1',
        merchant_id: '26e7ac4f-017e-4316-bf4f-9a1b37112510',
        action_type: 'auth_required',
        entity_type: 'capability_connect',
        entity_id: 'firecrawl_primary',
        title: 'Connect firecrawl',
        summary: 'Securely connect firecrawl for firecrawl_primary.',
        status: 'pending',
        audience: 'generic',
        auth_type: 'api_key',
        resume_url: 'https://host.example.com/resume',
        display_payload_json: JSON.stringify({ kind: 'capability_connect' }),
        result_payload_json: JSON.stringify({}),
        metadata_json: JSON.stringify({ provider: 'firecrawl' }),
        expires_at: new Date('2099-04-16T12:30:00.000Z'),
        completed_at: null,
        used_at: null,
        created_at: new Date('2026-04-16T12:00:00.000Z'),
        updated_at: new Date('2026-04-16T12:00:00.000Z'),
      }],
      [{
        id: 'cap_1',
        merchant_id: '26e7ac4f-017e-4316-bf4f-9a1b37112510',
        capability_key: 'firecrawl_primary',
        capability_type: 'external_api',
        capability_scope: 'firecrawl',
        provider: 'firecrawl',
        subject_type: 'merchant',
        subject_ref: 'merchant_1',
        status: 'pending_connect',
        secret_payload_json: {},
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
      }],
      [{
        id: 'sess_1',
        merchant_id: '26e7ac4f-017e-4316-bf4f-9a1b37112510',
        capability_vault_entry_id: 'cap_1',
        session_token_hash: await sha256Hex(sessionToken),
        session_state: 'pending',
        provider: 'firecrawl',
        redirect_url: null,
        callback_url: null,
        connection_payload_json: {
          fields: [{ key: 'apiKey', label: 'API key', secret: true }],
        },
        metadata: {
          hostedActionSessionId: 'action_session_1',
        },
        expires_at: new Date('2099-04-16T12:15:00.000Z'),
        connected_at: null,
        revoked_at: null,
        created_at: new Date('2026-04-16T12:00:00.000Z'),
        updated_at: new Date('2026-04-16T12:00:00.000Z'),
      }],
      [{
        id: 'action_session_1',
        merchant_id: '26e7ac4f-017e-4316-bf4f-9a1b37112510',
        action_type: 'auth_required',
        entity_type: 'capability_connect',
        entity_id: 'firecrawl_primary',
        title: 'Connect firecrawl',
        summary: 'Securely connect firecrawl for firecrawl_primary.',
        status: 'pending',
        audience: 'generic',
        auth_type: 'api_key',
        resume_url: 'https://host.example.com/resume',
        display_payload_json: JSON.stringify({
          kind: 'capability_connect',
          connectUrl: 'http://agentpay.test/api/capabilities/connect-sessions/sess_1/hosted?token=connect-token',
          actionSessionId: 'action_session_1',
        }),
        result_payload_json: JSON.stringify({}),
        metadata_json: JSON.stringify({
          provider: 'firecrawl',
          capabilityConnectSessionId: 'sess_1',
        }),
        expires_at: new Date('2099-04-16T12:30:00.000Z'),
        completed_at: null,
        used_at: null,
        created_at: new Date('2026-04-16T12:00:00.000Z'),
        updated_at: new Date('2026-04-16T12:00:00.000Z'),
      }],
    ]);
    (createDb as jest.Mock).mockReturnValue(sql);

    const res = await capabilitiesRouter.fetch(
      new Request('http://agentpay.test/connect-sessions', {
        method: 'POST',
        headers: authHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({
          provider: 'firecrawl',
          capabilityKey: 'firecrawl_primary',
          subjectType: 'merchant',
          subjectRef: 'merchant_1',
          resumeUrl: 'https://host.example.com/resume',
        }),
      }),
      authEnv(),
      {} as never,
    );

    const body = await res.json() as Record<string, any>;
    expect(res.status).toBe(201);
    expect(body.actionSession).toEqual({
      sessionId: 'action_session_1',
      status: 'pending',
      statusUrl: 'http://agentpay.test/api/actions/action_session_1',
    });
    expect(body.nextAction.displayPayload.baseUrl).toBe('https://api.firecrawl.dev');
    expect(body.nextAction.displayPayload.allowedHosts).toEqual(['api.firecrawl.dev']);
    expect(body.nextAction.displayPayload.connectUrl).toContain('/api/capabilities/connect-sessions/sess_1/hosted?token=');
  });

  it('rejects blocked connect-session targets before persistence', async () => {
    const sql = makeSql([]);
    (createDb as jest.Mock).mockReturnValue(sql);

    const res = await capabilitiesRouter.fetch(
      new Request('http://agentpay.test/connect-sessions', {
        method: 'POST',
        headers: authHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({
          provider: 'generic_rest_api',
          capabilityKey: 'metadata_blocked',
          subjectType: 'merchant',
          subjectRef: 'merchant_1',
          baseUrl: 'http://169.254.169.254/latest',
          allowedHosts: ['169.254.169.254'],
          authScheme: 'bearer',
          credentialKind: 'api_key',
        }),
      }),
      authEnv(),
      {} as never,
    );

    await expect(res.json()).resolves.toEqual({
      error: 'Capability connect session configuration is invalid',
    });
    expect(res.status).toBe(400);
  });

  it('submits a connected capability secret without requiring merchant auth', async () => {
    const sessionToken = 'connect-token-1';
    const submitSql = makeSql([
      [{
        id: 'sess_1',
        merchant_id: '26e7ac4f-017e-4316-bf4f-9a1b37112510',
        capability_vault_entry_id: 'cap_1',
        session_token_hash: await sha256Hex(sessionToken),
        session_state: 'pending',
        provider: 'firecrawl',
        redirect_url: null,
        callback_url: null,
        connection_payload_json: {},
        metadata: {},
        expires_at: new Date('2099-04-16T12:15:00.000Z'),
        connected_at: null,
        revoked_at: null,
        created_at: new Date('2026-04-16T12:00:00.000Z'),
        updated_at: new Date('2026-04-16T12:00:00.000Z'),
      }],
      [{
        id: 'cap_1',
        merchant_id: '26e7ac4f-017e-4316-bf4f-9a1b37112510',
        capability_key: 'firecrawl_primary',
        capability_type: 'external_api',
        capability_scope: 'firecrawl',
        provider: 'firecrawl',
        subject_type: 'merchant',
        subject_ref: 'merchant_1',
        status: 'pending_connect',
        secret_payload_json: {},
        metadata: {},
        expires_at: null,
        revoked_at: null,
        last_used_at: null,
        created_at: new Date('2026-04-16T12:00:00.000Z'),
        updated_at: new Date('2026-04-16T12:00:00.000Z'),
      }],
      [{
        id: 'sess_1',
        merchant_id: '26e7ac4f-017e-4316-bf4f-9a1b37112510',
        capability_vault_entry_id: 'cap_1',
        session_token_hash: await sha256Hex(sessionToken),
        session_state: 'pending',
        provider: 'firecrawl',
        redirect_url: null,
        callback_url: null,
        connection_payload_json: {},
        metadata: {},
        expires_at: new Date('2099-04-16T12:15:00.000Z'),
        connected_at: null,
        revoked_at: null,
        created_at: new Date('2026-04-16T12:00:00.000Z'),
        updated_at: new Date('2026-04-16T12:00:00.000Z'),
      }],
      [{
        id: 'cap_1',
        merchant_id: '26e7ac4f-017e-4316-bf4f-9a1b37112510',
        capability_key: 'firecrawl_primary',
        capability_type: 'external_api',
        capability_scope: 'firecrawl',
        provider: 'firecrawl',
        subject_type: 'merchant',
        subject_ref: 'merchant_1',
        status: 'active',
        secret_payload_json: {},
        metadata: {},
        expires_at: null,
        revoked_at: null,
        last_used_at: null,
        created_at: new Date('2026-04-16T12:00:00.000Z'),
        updated_at: new Date('2026-04-16T12:05:00.000Z'),
      }],
      [],
    ]);
    (createDb as jest.Mock).mockReturnValue(submitSql);

    const res = await capabilitiesRouter.fetch(
      new Request('http://agentpay.test/connect-sessions/sess_1/submit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sessionToken,
          secretPayload: { apiKey: 'fc_live_123' },
        }),
      }),
      authEnv(),
      {} as never,
    );

    await expect(res.json()).resolves.toEqual({
      status: 'connected',
      capabilityId: 'cap_1',
      capabilityKey: 'firecrawl_primary',
      provider: 'firecrawl',
      actionSession: null,
    });
    expect(res.status).toBe(201);
  });

  it('completes the hosted connect step and redirects back to the host', async () => {
    const sessionToken = 'connect-token-1';
    const submitSql = makeSql([
      [{
        id: 'sess_1',
        merchant_id: '26e7ac4f-017e-4316-bf4f-9a1b37112510',
        capability_vault_entry_id: 'cap_1',
        session_token_hash: await sha256Hex(sessionToken),
        session_state: 'pending',
        provider: 'firecrawl',
        redirect_url: null,
        callback_url: null,
        connection_payload_json: {
          fields: [{ key: 'apiKey', label: 'API key', secret: true }],
        },
        metadata: { hostedActionSessionId: 'action_session_1' },
        expires_at: new Date('2099-04-16T12:15:00.000Z'),
        connected_at: null,
        revoked_at: null,
        created_at: new Date('2026-04-16T12:00:00.000Z'),
        updated_at: new Date('2026-04-16T12:00:00.000Z'),
      }],
      [{
        id: 'cap_1',
        merchant_id: '26e7ac4f-017e-4316-bf4f-9a1b37112510',
        capability_key: 'firecrawl_primary',
        capability_type: 'external_api',
        capability_scope: 'firecrawl',
        provider: 'firecrawl',
        subject_type: 'merchant',
        subject_ref: 'merchant_1',
        status: 'pending_connect',
        secret_payload_json: {},
        metadata: {},
        expires_at: null,
        revoked_at: null,
        last_used_at: null,
        created_at: new Date('2026-04-16T12:00:00.000Z'),
        updated_at: new Date('2026-04-16T12:00:00.000Z'),
      }],
      [{
        id: 'sess_1',
        merchant_id: '26e7ac4f-017e-4316-bf4f-9a1b37112510',
        capability_vault_entry_id: 'cap_1',
        session_token_hash: await sha256Hex(sessionToken),
        session_state: 'pending',
        provider: 'firecrawl',
        redirect_url: null,
        callback_url: null,
        connection_payload_json: {
          fields: [{ key: 'apiKey', label: 'API key', secret: true }],
        },
        metadata: { hostedActionSessionId: 'action_session_1' },
        expires_at: new Date('2099-04-16T12:15:00.000Z'),
        connected_at: null,
        revoked_at: null,
        created_at: new Date('2026-04-16T12:00:00.000Z'),
        updated_at: new Date('2026-04-16T12:00:00.000Z'),
      }],
      [{
        id: 'cap_1',
        merchant_id: '26e7ac4f-017e-4316-bf4f-9a1b37112510',
        capability_key: 'firecrawl_primary',
        capability_type: 'external_api',
        capability_scope: 'firecrawl',
        provider: 'firecrawl',
        subject_type: 'merchant',
        subject_ref: 'merchant_1',
        status: 'active',
        secret_payload_json: {},
        metadata: {},
        expires_at: null,
        revoked_at: null,
        last_used_at: null,
        created_at: new Date('2026-04-16T12:00:00.000Z'),
        updated_at: new Date('2026-04-16T12:05:00.000Z'),
      }],
      [],
      [{
        id: 'action_session_1',
        merchant_id: '26e7ac4f-017e-4316-bf4f-9a1b37112510',
        action_type: 'auth_required',
        entity_type: 'capability_connect',
        entity_id: 'firecrawl_primary',
        title: 'Connect firecrawl',
        summary: 'Securely connect firecrawl for firecrawl_primary.',
        status: 'pending',
        audience: 'generic',
        auth_type: 'api_key',
        resume_url: 'https://host.example.com/resume',
        display_payload_json: JSON.stringify({ kind: 'capability_connect' }),
        result_payload_json: JSON.stringify({}),
        metadata_json: JSON.stringify({ capabilityConnectSessionId: 'sess_1' }),
        expires_at: new Date('2099-04-16T12:30:00.000Z'),
        completed_at: null,
        used_at: null,
        created_at: new Date('2026-04-16T12:00:00.000Z'),
        updated_at: new Date('2026-04-16T12:00:00.000Z'),
      }],
      [{
        id: 'action_session_1',
        merchant_id: '26e7ac4f-017e-4316-bf4f-9a1b37112510',
        action_type: 'auth_required',
        entity_type: 'capability_connect',
        entity_id: 'firecrawl_primary',
        title: 'Connect firecrawl',
        summary: 'Securely connect firecrawl for firecrawl_primary.',
        status: 'completed',
        audience: 'generic',
        auth_type: 'api_key',
        resume_url: 'https://host.example.com/resume',
        display_payload_json: JSON.stringify({ kind: 'capability_connect' }),
        result_payload_json: JSON.stringify({
          connectedCapabilityId: 'cap_1',
          connectedCapabilityKey: 'firecrawl_primary',
        }),
        metadata_json: JSON.stringify({ capabilityConnectSessionId: 'sess_1' }),
        expires_at: new Date('2099-04-16T12:30:00.000Z'),
        completed_at: new Date('2099-04-16T12:06:00.000Z'),
        used_at: null,
        created_at: new Date('2026-04-16T12:00:00.000Z'),
        updated_at: new Date('2026-04-16T12:06:00.000Z'),
      }],
    ]);
    (createDb as jest.Mock).mockReturnValue(submitSql);

    const form = new URLSearchParams({
      sessionToken,
      apiKey: 'fc_live_123',
    });
    const res = await capabilitiesRouter.fetch(
      new Request('http://agentpay.test/connect-sessions/sess_1/hosted', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
      }),
      authEnv(),
      {} as never,
    );

    expect(res.status).toBe(302);
    const location = res.headers.get('location') ?? '';
    expect(location).toContain('https://host.example.com/resume');
    expect(location).toContain('agentpayActionStatus=completed');
    expect(location).toContain('agentpayActionType=auth_required');
  });

  it('gates paid usage once free calls are exhausted', async () => {
    const encryptedBlob = await encryptPayload('a'.repeat(64), JSON.stringify({ apiKey: 'fc_live_123' }));
    (createDb as jest.Mock)
      .mockImplementationOnce(() => makeSql([[
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
      ]]))
      .mockImplementationOnce(() => makeSql([
        [{ count: '5' }],
        [],
        [],
      ]));

    const res = await capabilitiesRouter.fetch(
      new Request('http://agentpay.test/cap_1/execute', {
        method: 'POST',
        headers: authHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({
          method: 'POST',
          path: '/v1/scrape',
          body: { url: 'https://example.com' },
        }),
      }),
      authEnv(),
      {} as never,
    );

    const body = await res.json() as Record<string, unknown>;
    expect(res.status).toBe(200);
    expect(body.status).toBe('approval_required');
    expect((body.nextAction as Record<string, unknown>).type).toBe('approval_required');
  });

  it('executes external API calls through the vaulted proxy with auth injection', async () => {
    const encryptedBlob = await encryptPayload('a'.repeat(64), JSON.stringify({ apiKey: 'fc_live_123' }));
    (createDb as jest.Mock)
      .mockImplementationOnce(() => makeSql([[
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
      ]]))
      .mockImplementationOnce(() => makeSql([
        [{ count: '5' }],
        [],
        [],
        [],
      ]));
    const fetchSpy = jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      status: 200,
      ok: true,
      text: async () => JSON.stringify({ success: true, jobId: 'crawl_1' }),
    } as any);

    const res = await capabilitiesRouter.fetch(
      new Request('http://agentpay.test/cap_1/execute', {
        method: 'POST',
        headers: authHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({
          method: 'POST',
          path: '/v1/scrape',
          body: { url: 'https://example.com' },
          allowPaidUsage: true,
        }),
      }),
      authEnv(),
      {} as never,
    );

    const body = await res.json() as Record<string, unknown>;
    expect(res.status).toBe(200);
    expect(body.status).toBe('completed');
    expect(String(fetchSpy.mock.calls[0][0])).toContain('https://api.firecrawl.dev/v1/scrape');
    expect(fetchSpy.mock.calls[0][1]?.headers).toMatchObject({
      Authorization: 'Bearer fc_live_123',
    });
  });

  it('rejects absolute capability target URLs instead of proxying them', async () => {
    const encryptedBlob = await encryptPayload('a'.repeat(64), JSON.stringify({ apiKey: 'fc_live_123' }));
    (createDb as jest.Mock)
      .mockImplementationOnce(() => makeSql([[
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
      ]]))
      .mockImplementationOnce(() => makeSql([
        [{ count: '0' }],
      ]));

    const res = await capabilitiesRouter.fetch(
      new Request('http://agentpay.test/cap_1/execute', {
        method: 'POST',
        headers: authHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({
          method: 'GET',
          path: 'https://169.254.169.254/latest/meta-data',
        }),
      }),
      authEnv(),
      {} as never,
    );

    await expect(res.json()).resolves.toEqual({
      error: 'Capability path must be relative to the connected base URL',
    });
    expect(res.status).toBe(400);
  });

  it('returns the current capability usage invoice summary', async () => {
    (createDb as jest.Mock).mockReturnValue(makeSql([
      [
        {
          capability_key: 'firecrawl_primary',
          provider: 'firecrawl',
          calls: 7,
          amount_usd: '0.14',
        },
      ],
      [
        {
          already_invoiced_usd: '0.04',
        },
      ],
    ]));

    const res = await capabilitiesRouter.fetch(
      new Request('http://agentpay.test/billing/current', {
        headers: authHeaders(),
      }),
      authEnv(),
      {} as never,
    );

    const body = await res.json() as Record<string, unknown>;
    expect(res.status).toBe(200);
    expect(body.outstandingUsd).toBe(0.1);
    expect(body.payable).toBe(true);
    expect((body.collection as Record<string, unknown>).available).toBe(false);
  });

  it('creates a Stripe checkout session for outstanding capability usage charges', async () => {
    (createDb as jest.Mock)
      .mockImplementationOnce(() => makeSql([
        [
          {
            capability_key: 'firecrawl_primary',
            provider: 'firecrawl',
            calls: 7,
            amount_usd: '0.14',
          },
        ],
        [
          {
            already_invoiced_usd: '0.00',
          },
        ],
      ]))
      .mockImplementationOnce(() => makeSql([
        [{ stripe_billing_customer_id: null }],
      ]))
      .mockImplementationOnce(() => makeSql([[]]))
      .mockImplementationOnce(() => makeSql([[]]))
      .mockImplementationOnce(() => makeSql([[]]));

    const fetchSpy = jest.spyOn(global, 'fetch' as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'cus_cap_1' }),
      } as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'cs_cap_1', url: 'https://checkout.stripe.test/capability' }),
      } as any);

    const res = await capabilitiesRouter.fetch(
      new Request('http://agentpay.test/billing/checkout', {
        method: 'POST',
        headers: authHeaders(),
      }),
      authEnv({ STRIPE_SECRET_KEY: 'sk_test_capability' }),
      {} as never,
    );

    const body = await res.json() as Record<string, unknown>;
    expect(res.status).toBe(201);
    expect(body.checkoutSessionId).toBe('cs_cap_1');
    expect(body.checkoutUrl).toBe('https://checkout.stripe.test/capability');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(String(fetchSpy.mock.calls[0][0])).toContain('https://api.stripe.com/v1/customers');
    expect(String(fetchSpy.mock.calls[1][0])).toContain('https://api.stripe.com/v1/checkout/sessions');
  });
});
