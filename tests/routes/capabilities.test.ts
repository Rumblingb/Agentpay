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

  it('creates a hosted onboarding session for multi-provider setup', async () => {
    (createDb as jest.Mock)
      .mockImplementationOnce(() => makeSql([[]]))
      .mockImplementationOnce(() => makeSql([[
        {
          id: 'action_session_onboarding',
          merchant_id: '26e7ac4f-017e-4316-bf4f-9a1b37112510',
          action_type: 'auth_required',
          entity_type: 'capability_onboarding',
          entity_id: 'principal_1',
          title: 'Finish your AgentPay setup',
          summary: 'Set your guardrails, connect your APIs once, and let AgentPay keep execution governed and secure across every host.',
          status: 'pending',
          audience: 'generic',
          auth_type: 'api_key',
          resume_url: 'https://host.example.com/resume',
          display_payload_json: JSON.stringify({}),
          result_payload_json: JSON.stringify({}),
          metadata_json: JSON.stringify({}),
          expires_at: new Date('2099-04-16T12:30:00.000Z'),
          completed_at: null,
          used_at: null,
          created_at: new Date('2026-04-16T12:00:00.000Z'),
          updated_at: new Date('2026-04-16T12:00:00.000Z'),
        },
      ]]))
      .mockImplementationOnce(() => makeSql([[
        {
          id: 'action_session_onboarding',
          merchant_id: '26e7ac4f-017e-4316-bf4f-9a1b37112510',
          action_type: 'auth_required',
          entity_type: 'capability_onboarding',
          entity_id: 'principal_1',
          title: 'Finish your AgentPay setup',
          summary: 'Set your guardrails, connect your APIs once, and let AgentPay keep execution governed and secure across every host.',
          status: 'pending',
          audience: 'generic',
          auth_type: 'api_key',
          resume_url: 'https://host.example.com/resume',
          display_payload_json: JSON.stringify({
            kind: 'capability_onboarding',
            onboardingUrl: 'http://agentpay.test/api/capabilities/onboarding-sessions/action_session_onboarding/hosted?token=setup-token',
          }),
          result_payload_json: JSON.stringify({}),
          metadata_json: JSON.stringify({ onboardingUrlIssued: true }),
          expires_at: new Date('2099-04-16T12:30:00.000Z'),
          completed_at: null,
          used_at: null,
          created_at: new Date('2026-04-16T12:00:00.000Z'),
          updated_at: new Date('2026-04-16T12:00:00.000Z'),
        },
      ]]));

    const res = await capabilitiesRouter.fetch(
      new Request('http://agentpay.test/onboarding-sessions', {
        method: 'POST',
        headers: authHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({
          subjectType: 'merchant',
          subjectRef: 'merchant_1',
          principalId: 'principal_1',
          operatorId: 'operator_1',
          contactEmail: 'rajiv_baskaran@agentpay.so',
          contactName: 'Rajiv Baskaran',
          preferredFundingRail: 'card',
          resumeUrl: 'https://host.example.com/resume',
          providers: [
            { provider: 'firecrawl' },
            { provider: 'databento' },
          ],
        }),
      }),
      authEnv(),
      {} as never,
    );

    const body = await res.json() as Record<string, any>;
    expect(res.status).toBe(201);
    expect(body.status).toBe('auth_required');
    expect(body.nextAction.displayPayload.kind).toBe('capability_onboarding');
    expect(body.nextAction.displayPayload.walletStatus).toBe('missing');
    expect(body.nextAction.displayPayload.providers).toHaveLength(2);
    expect(body.nextAction.displayPayload.providers[0].category).toBe('browser');
    expect(body.nextAction.displayPayload.providers[0].partnershipStatus).toBe('flagship');
    expect(body.nextAction.displayPayload.providers[1].proofHeadline).toContain('exact query');
    expect(body.nextAction.displayPayload.onboardingUrl).toContain('/api/capabilities/onboarding-sessions/action_session_onboarding/hosted?token=');
  });

  it('completes hosted onboarding, vaults capabilities, and redirects back to the host', async () => {
    const sessionToken = 'setup-token';
    const sessionTokenHash = await sha256Hex(sessionToken);
    const providerSpecs = [
      {
        provider: 'firecrawl',
        label: 'Firecrawl',
        capabilityKey: 'firecrawl_primary',
        baseUrl: 'https://api.firecrawl.dev',
        allowedHosts: ['api.firecrawl.dev'],
        authScheme: 'bearer',
        credentialKind: 'api_key',
        headerName: null,
        freeCalls: 5,
        paidUnitPriceUsdMicros: 20000,
        description: 'Web extraction and crawl API.',
        required: true,
        fields: [{ key: 'apiKey', label: 'Firecrawl API key', secret: true }],
      },
      {
        provider: 'databento',
        label: 'Databento',
        capabilityKey: 'databento_primary',
        baseUrl: 'https://hist.databento.com/v0',
        allowedHosts: ['hist.databento.com'],
        authScheme: 'bearer',
        credentialKind: 'api_key',
        headerName: null,
        freeCalls: 3,
        paidUnitPriceUsdMicros: 75000,
        description: 'Historical market data.',
        required: true,
        fields: [{ key: 'apiKey', label: 'Databento API key', secret: true }],
      },
    ];

    (createDb as jest.Mock)
      .mockImplementationOnce(() => makeSql([[
        {
          id: 'action_session_onboarding',
          merchant_id: '26e7ac4f-017e-4316-bf4f-9a1b37112510',
          status: 'pending',
          title: 'Finish your AgentPay setup',
          summary: 'Set your guardrails, connect your APIs once, and let AgentPay keep execution governed and secure across every host.',
          resume_url: 'https://host.example.com/resume',
          display_payload_json: JSON.stringify({
            subjectType: 'merchant',
            subjectRef: 'merchant_1',
            principalId: 'principal_1',
            operatorId: 'operator_1',
            contactEmail: 'rajiv_baskaran@agentpay.so',
            contactName: 'Rajiv Baskaran',
            preferredFundingRail: 'card',
            walletStatus: 'missing',
            providers: providerSpecs,
          }),
          metadata_json: JSON.stringify({
            sessionTokenHash,
          }),
          result_payload_json: JSON.stringify({}),
          expires_at: new Date('2099-04-16T12:30:00.000Z'),
        },
      ]]))
      .mockImplementationOnce(() => makeSql([[
        {
          id: 'authority_1',
          merchant_id: '26e7ac4f-017e-4316-bf4f-9a1b37112510',
          principal_id: 'principal_1',
          operator_id: 'operator_1',
          status: 'active',
          wallet_status: 'missing',
          preferred_funding_rail: 'card',
          default_payment_method_type: null,
          default_payment_reference: null,
          contact_email: 'rajiv_baskaran@agentpay.so',
          contact_name: 'Rajiv Baskaran',
          autonomy_policy_json: JSON.stringify({ autoApproveUsd: 1.5, otpEveryPaidAction: true }),
          limits_json: JSON.stringify({ perActionUsd: 10, dailyUsd: 25, monthlyUsd: 200 }),
          metadata_json: JSON.stringify({ source: 'capability_onboarding_hosted' }),
          created_at: new Date('2026-04-16T12:00:00.000Z'),
          updated_at: new Date('2026-04-16T12:01:00.000Z'),
        },
      ]]))
      .mockImplementationOnce(() => makeSql([[
        {
          id: 'cap_firecrawl',
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
          updated_at: new Date('2026-04-16T12:01:00.000Z'),
        },
      ]]))
      .mockImplementationOnce(() => makeSql([[
        {
          id: 'cap_databento',
          merchant_id: '26e7ac4f-017e-4316-bf4f-9a1b37112510',
          capability_key: 'databento_primary',
          capability_type: 'external_api',
          capability_scope: 'databento',
          provider: 'databento',
          subject_type: 'merchant',
          subject_ref: 'merchant_1',
          status: 'active',
          secret_payload_json: {},
          metadata: {},
          expires_at: null,
          revoked_at: null,
          last_used_at: null,
          created_at: new Date('2026-04-16T12:00:00.000Z'),
          updated_at: new Date('2026-04-16T12:01:00.000Z'),
        },
      ]]))
      .mockImplementationOnce(() => makeSql([
        [{
          id: 'action_session_onboarding',
          merchant_id: '26e7ac4f-017e-4316-bf4f-9a1b37112510',
          action_type: 'auth_required',
          entity_type: 'capability_onboarding',
          entity_id: 'principal_1',
          title: 'Finish your AgentPay setup',
          summary: 'Set your guardrails, connect your APIs once, and let AgentPay keep execution governed and secure across every host.',
          status: 'pending',
          audience: 'generic',
          auth_type: 'api_key',
          resume_url: 'https://host.example.com/resume',
          display_payload_json: JSON.stringify({ kind: 'capability_onboarding' }),
          result_payload_json: JSON.stringify({}),
          metadata_json: JSON.stringify({}),
          expires_at: new Date('2099-04-16T12:30:00.000Z'),
          completed_at: null,
          used_at: null,
          created_at: new Date('2026-04-16T12:00:00.000Z'),
          updated_at: new Date('2026-04-16T12:00:00.000Z'),
        }],
        [{
          id: 'action_session_onboarding',
          merchant_id: '26e7ac4f-017e-4316-bf4f-9a1b37112510',
          action_type: 'auth_required',
          entity_type: 'capability_onboarding',
          entity_id: 'principal_1',
          title: 'Finish your AgentPay setup',
          summary: 'Set your guardrails, connect your APIs once, and let AgentPay keep execution governed and secure across every host.',
          status: 'completed',
          audience: 'generic',
          auth_type: 'api_key',
          resume_url: 'https://host.example.com/resume',
          display_payload_json: JSON.stringify({ kind: 'capability_onboarding' }),
          result_payload_json: JSON.stringify({
            authorityProfileId: 'authority_1',
            connectedCapabilities: [
              { capabilityId: 'cap_firecrawl', capabilityKey: 'firecrawl_primary', provider: 'firecrawl' },
              { capabilityId: 'cap_databento', capabilityKey: 'databento_primary', provider: 'databento' },
            ],
          }),
          metadata_json: JSON.stringify({ completedFrom: 'capability_onboarding_hosted' }),
          expires_at: new Date('2099-04-16T12:30:00.000Z'),
          completed_at: new Date('2099-04-16T12:05:00.000Z'),
          used_at: null,
          created_at: new Date('2026-04-16T12:00:00.000Z'),
          updated_at: new Date('2026-04-16T12:05:00.000Z'),
        }],
      ]));

    const form = new URLSearchParams({
      sessionToken,
      contactEmail: 'rajiv_baskaran@agentpay.so',
      contactName: 'Rajiv Baskaran',
      preferredFundingRail: 'card',
      autoApproveUsd: '1.5',
      perActionUsd: '10',
      dailyUsd: '25',
      monthlyUsd: '200',
      otpEveryPaidAction: 'on',
      firecrawl__apiKey: 'fc_live_123',
      databento__apiKey: 'db_live_123',
    });

    const res = await capabilitiesRouter.fetch(
      new Request('http://agentpay.test/onboarding-sessions/action_session_onboarding/hosted', {
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

  it('returns a terminal-native control plane for agents and humans', async () => {
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
        },
      ]]))
      .mockImplementationOnce(() => makeSql([
        [{ capability_key: 'firecrawl_primary', provider: 'firecrawl', calls: 7, amount_usd: '0.14' }],
        [{ already_invoiced_usd: '0.04' }],
      ]))
      .mockImplementationOnce(() => makeSql([[
        {
          id: 'action_pending_1',
          action_type: 'auth_required',
          entity_type: 'capability_onboarding',
          entity_id: 'principal_1',
          title: 'Finish setup',
          summary: 'Connect APIs once.',
          resume_url: 'https://host.example.com/resume',
          expires_at: new Date('2099-04-16T12:30:00.000Z'),
        },
      ]]))
      .mockImplementationOnce(() => makeSql([[
        {
          id: 'authority_1',
          merchant_id: '26e7ac4f-017e-4316-bf4f-9a1b37112510',
          principal_id: 'principal_1',
          operator_id: 'operator_1',
          status: 'active',
          wallet_status: 'ready',
          preferred_funding_rail: 'card',
          default_payment_method_type: 'card',
          default_payment_reference: 'pm_1',
          contact_email: 'rajiv_baskaran@agentpay.so',
          contact_name: 'Rajiv Baskaran',
          autonomy_policy_json: JSON.stringify({ autoApproveUsd: 2 }),
          limits_json: JSON.stringify({ dailyUsd: 25 }),
          metadata_json: JSON.stringify({}),
          created_at: new Date('2026-04-16T12:00:00.000Z'),
          updated_at: new Date('2026-04-16T12:01:00.000Z'),
        },
      ]]))
      .mockImplementationOnce(() => makeSql([[
        {
          id: 'lease_1',
          merchant_id: '26e7ac4f-017e-4316-bf4f-9a1b37112510',
          capability_vault_entry_id: 'cap_1',
          subject_type: 'workspace',
          subject_ref: 'workbench_1',
          principal_id: 'principal_1',
          operator_id: 'operator_1',
          workbench_id: 'local_ws_1',
          workbench_label: 'Main repo',
          lease_token_hash: 'hash',
          status: 'active',
          metadata_json: JSON.stringify({ source: 'access_resolve' }),
          expires_at: new Date('2099-04-16T12:30:00.000Z'),
          revoked_at: null,
          last_used_at: new Date('2026-04-16T12:05:00.000Z'),
          created_at: new Date('2026-04-16T12:00:00.000Z'),
          updated_at: new Date('2026-04-16T12:05:00.000Z'),
        },
      ]]))
      .mockImplementationOnce(() => makeSql([[
        {
          id: 'authority_1',
          merchant_id: '26e7ac4f-017e-4316-bf4f-9a1b37112510',
          principal_id: 'principal_1',
          operator_id: 'operator_1',
          status: 'active',
          wallet_status: 'ready',
          preferred_funding_rail: 'card',
          default_payment_method_type: 'card',
          default_payment_reference: 'pm_1',
          contact_email: 'rajiv_baskaran@agentpay.so',
          contact_name: 'Rajiv Baskaran',
          autonomy_policy_json: JSON.stringify({ autoApproveUsd: 2 }),
          limits_json: JSON.stringify({ dailyUsd: 25 }),
          metadata_json: JSON.stringify({}),
          created_at: new Date('2026-04-16T12:00:00.000Z'),
          updated_at: new Date('2026-04-16T12:01:00.000Z'),
        },
      ]]))
      .mockImplementationOnce(() => makeSql([[
        {
          stripe_pm_id: 'pm_1',
          payment_method_type: 'card',
        },
      ]]))
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
        },
      ]]))
      .mockImplementationOnce(() => makeSql([[
        {
          id: 'lease_1',
          merchant_id: '26e7ac4f-017e-4316-bf4f-9a1b37112510',
          capability_vault_entry_id: 'cap_1',
          subject_type: 'workspace',
          subject_ref: 'workbench_1',
          principal_id: 'principal_1',
          operator_id: 'operator_1',
          workbench_id: 'local_ws_1',
          workbench_label: 'Main repo',
          lease_token_hash: 'hash',
          status: 'active',
          metadata_json: JSON.stringify({ source: 'access_resolve' }),
          expires_at: new Date('2099-04-16T12:30:00.000Z'),
          revoked_at: null,
          last_used_at: new Date('2026-04-16T12:05:00.000Z'),
          created_at: new Date('2026-04-16T12:00:00.000Z'),
          updated_at: new Date('2026-04-16T12:05:00.000Z'),
        },
      ]]))
      .mockImplementationOnce(() => makeSql([[
        {
          id: 'action_pending_1',
          action_type: 'auth_required',
          entity_type: 'capability_onboarding',
          entity_id: 'principal_1',
          title: 'Finish setup',
          summary: 'Connect APIs once.',
          resume_url: 'https://host.example.com/resume',
          expires_at: new Date('2099-04-16T12:30:00.000Z'),
        },
      ]]));

    const res = await capabilitiesRouter.fetch(
      new Request('http://agentpay.test/terminal/control-plane?principalId=principal_1&workbenchId=local_ws_1', {
        headers: authHeaders(),
      }),
      authEnv(),
      {} as never,
    );

    const body = await res.json() as Record<string, any>;
    expect(res.status).toBe(200);
    expect(body.surface).toBe('terminal_native_control_plane');
    expect(body.stance.runtime).toBe('host_and_terminal_only');
    expect(body.capabilities).toHaveLength(1);
    expect(body.pendingActions).toHaveLength(1);
    expect(body.authorityProfile.walletStatus).toBe('ready');
    expect(body.workbenchLeases).toHaveLength(1);
    expect(body.authorityBootstrap.status).toBe('ready');
    expect(body.suggestedToolCalls).toHaveLength(9);
    expect(body.suggestedToolCalls[0].tool).toBe('agentpay_read_authority_bootstrap');
    expect(body.suggestedToolCalls[2].tool).toBe('agentpay_resolve_provider_access');
  });

  it('returns an authority bootstrap snapshot with missing funding and provider access called out', async () => {
    (createDb as jest.Mock)
      .mockImplementationOnce(() => makeSql([[
        {
          id: 'authority_1',
          merchant_id: '26e7ac4f-017e-4316-bf4f-9a1b37112510',
          principal_id: 'principal_1',
          operator_id: 'operator_1',
          status: 'active',
          wallet_status: 'missing',
          preferred_funding_rail: 'card',
          default_payment_method_type: null,
          default_payment_reference: null,
          contact_email: 'rajiv_baskaran@agentpay.so',
          contact_name: 'Rajiv Baskaran',
          autonomy_policy_json: JSON.stringify({ autoApproveUsd: 1, otpEveryPaidAction: true }),
          limits_json: JSON.stringify({ dailyUsd: 25 }),
          metadata_json: JSON.stringify({}),
          created_at: new Date('2026-04-16T12:00:00.000Z'),
          updated_at: new Date('2026-04-16T12:01:00.000Z'),
        },
      ]]))
      .mockImplementationOnce(() => makeSql([[]]))
      .mockImplementationOnce(() => makeSql([[]]))
      .mockImplementationOnce(() => makeSql([[]]))
      .mockImplementationOnce(() => makeSql([[{
        id: 'action_pending_1',
        action_type: 'auth_required',
        entity_type: 'capability_onboarding',
        entity_id: 'principal_1',
        title: 'Finish setup',
        summary: 'Connect APIs once.',
        resume_url: 'https://host.example.com/resume',
        expires_at: new Date('2099-04-16T12:30:00.000Z'),
      }]]));

    const res = await capabilitiesRouter.fetch(
      new Request('http://agentpay.test/authority-bootstrap?principalId=principal_1&subjectType=workspace&subjectRef=workbench_1&workbenchId=local_ws_1', {
        headers: authHeaders(),
      }),
      authEnv(),
      {} as never,
    );

    const body = await res.json() as Record<string, any>;
    expect(res.status).toBe(200);
    expect(body.status).toBe('needs_funding_method');
    expect(body.missing).toContain('payment_method');
    expect(body.missing).toContain('provider_access');
    expect(body.nextAction.tool).toBe('agentpay_create_onboarding_session');
  });

  it('updates authority bootstrap defaults from the terminal control plane', async () => {
    (createDb as jest.Mock)
      .mockImplementationOnce(() => makeSql([[]]))
      .mockImplementationOnce(() => makeSql([[
        {
          id: 'authority_1',
          merchant_id: '26e7ac4f-017e-4316-bf4f-9a1b37112510',
          principal_id: 'principal_1',
          operator_id: 'operator_1',
          status: 'active',
          wallet_status: 'missing',
          preferred_funding_rail: 'card',
          default_payment_method_type: null,
          default_payment_reference: null,
          contact_email: 'rajiv_baskaran@agentpay.so',
          contact_name: 'Rajiv Baskaran',
          autonomy_policy_json: JSON.stringify({ autoApproveUsd: 3, otpEveryPaidAction: true }),
          limits_json: JSON.stringify({ perActionUsd: 8, dailyUsd: 30, monthlyUsd: 300 }),
          metadata_json: JSON.stringify({ source: 'terminal_authority_bootstrap' }),
          created_at: new Date('2026-04-16T12:00:00.000Z'),
          updated_at: new Date('2026-04-16T12:01:00.000Z'),
        },
      ]]))
      .mockImplementationOnce(() => makeSql([[
        {
          id: 'authority_1',
          merchant_id: '26e7ac4f-017e-4316-bf4f-9a1b37112510',
          principal_id: 'principal_1',
          operator_id: 'operator_1',
          status: 'active',
          wallet_status: 'missing',
          preferred_funding_rail: 'card',
          default_payment_method_type: null,
          default_payment_reference: null,
          contact_email: 'rajiv_baskaran@agentpay.so',
          contact_name: 'Rajiv Baskaran',
          autonomy_policy_json: JSON.stringify({ autoApproveUsd: 3, otpEveryPaidAction: true }),
          limits_json: JSON.stringify({ perActionUsd: 8, dailyUsd: 30, monthlyUsd: 300 }),
          metadata_json: JSON.stringify({ source: 'terminal_authority_bootstrap' }),
          created_at: new Date('2026-04-16T12:00:00.000Z'),
          updated_at: new Date('2026-04-16T12:01:00.000Z'),
        },
      ]]))
      .mockImplementationOnce(() => makeSql([[]]))
      .mockImplementationOnce(() => makeSql([[]]))
      .mockImplementationOnce(() => makeSql([[]]))
      .mockImplementationOnce(() => makeSql([[{
        id: 'action_pending_1',
        action_type: 'auth_required',
        entity_type: 'capability_onboarding',
        entity_id: 'principal_1',
        title: 'Finish setup',
        summary: 'Connect APIs once.',
        resume_url: 'https://host.example.com/resume',
        expires_at: new Date('2099-04-16T12:30:00.000Z'),
      }]]));

    const res = await capabilitiesRouter.fetch(
      new Request('http://agentpay.test/authority-bootstrap', {
        method: 'POST',
        headers: authHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({
          principalId: 'principal_1',
          operatorId: 'operator_1',
          workbenchId: 'local_ws_1',
          autoApproveUsd: 3,
          perActionUsd: 8,
          dailyUsd: 30,
          monthlyUsd: 300,
          otpEveryPaidAction: true,
          contactEmail: 'rajiv_baskaran@agentpay.so',
          contactName: 'Rajiv Baskaran',
          preferredFundingRail: 'card',
        }),
      }),
      authEnv(),
      {} as never,
    );

    const body = await res.json() as Record<string, any>;
    expect(res.status).toBe(200);
    expect(body.updated).toBe(true);
    expect(body.guardrails.autoApproveUsd).toBe(3);
    expect(body.guardrails.otpEveryPaidAction).toBe(true);
    expect(body.status).toBe('needs_funding_method');
  });

  it('lists active workbench leases through the control plane API', async () => {
    (createDb as jest.Mock)
      .mockImplementationOnce(() => makeSql([[
        {
          id: 'lease_1',
          merchant_id: '26e7ac4f-017e-4316-bf4f-9a1b37112510',
          capability_vault_entry_id: 'cap_firecrawl',
          subject_type: 'workspace',
          subject_ref: 'workbench_1',
          principal_id: 'principal_1',
          operator_id: 'operator_1',
          workbench_id: 'local_ws_1',
          workbench_label: 'Main repo',
          lease_token_hash: 'hash',
          status: 'active',
          metadata_json: JSON.stringify({ source: 'access_resolve' }),
          expires_at: new Date('2099-04-16T12:30:00.000Z'),
          revoked_at: null,
          last_used_at: new Date('2026-04-16T12:05:00.000Z'),
          created_at: new Date('2026-04-16T12:00:00.000Z'),
          updated_at: new Date('2026-04-16T12:05:00.000Z'),
        },
      ]]));

    const res = await capabilitiesRouter.fetch(
      new Request('http://agentpay.test/leases?principalId=principal_1&workbenchId=local_ws_1', {
        headers: authHeaders(),
      }),
      authEnv(),
      {} as never,
    );

    const body = await res.json() as Record<string, any>;
    expect(res.status).toBe(200);
    expect(body.summary.total).toBe(1);
    expect(body.leases[0].workbenchId).toBe('local_ws_1');
  });

  it('revokes a workbench lease without touching the vaulted capability', async () => {
    (createDb as jest.Mock)
      .mockImplementationOnce(() => makeSql([[
        {
          id: 'lease_1',
          merchant_id: '26e7ac4f-017e-4316-bf4f-9a1b37112510',
          capability_vault_entry_id: 'cap_firecrawl',
          subject_type: 'workspace',
          subject_ref: 'workbench_1',
          principal_id: 'principal_1',
          operator_id: 'operator_1',
          workbench_id: 'local_ws_1',
          workbench_label: 'Main repo',
          lease_token_hash: 'hash',
          status: 'revoked',
          metadata_json: JSON.stringify({ revokedReason: 'lost_device' }),
          expires_at: new Date('2099-04-16T12:30:00.000Z'),
          revoked_at: new Date('2026-04-16T12:10:00.000Z'),
          last_used_at: new Date('2026-04-16T12:05:00.000Z'),
          created_at: new Date('2026-04-16T12:00:00.000Z'),
          updated_at: new Date('2026-04-16T12:10:00.000Z'),
        },
      ]]));

    const res = await capabilitiesRouter.fetch(
      new Request('http://agentpay.test/leases/lease_1/revoke', {
        method: 'POST',
        headers: authHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({ reason: 'lost_device' }),
      }),
      authEnv(),
      {} as never,
    );

    const body = await res.json() as Record<string, any>;
    expect(res.status).toBe(200);
    expect(body.revoked).toBe(true);
    expect(body.lease.status).toBe('revoked');
    expect(body.lease.metadata.revokedReason).toBe('lost_device');
  });

  it('reuses existing governed access for the same workbench', async () => {
    (createDb as jest.Mock)
      .mockImplementationOnce(() => makeSql([[
        {
          id: 'cap_databento',
          merchant_id: '26e7ac4f-017e-4316-bf4f-9a1b37112510',
          capability_key: 'databento_primary',
          capability_type: 'external_api',
          capability_scope: 'databento',
          provider: 'databento',
          subject_type: 'workspace',
          subject_ref: 'workbench_1',
          status: 'active',
          secret_payload_json: {},
          metadata: {
            authScheme: 'bearer',
            credentialKind: 'api_key',
            baseUrl: 'https://hist.databento.com/v0',
            allowedHosts: ['hist.databento.com'],
            scopes: [],
            freeCalls: 3,
            paidUnitPriceUsdMicros: 75000,
          },
          expires_at: null,
          revoked_at: null,
          last_used_at: new Date('2026-04-16T12:02:00.000Z'),
          created_at: new Date('2026-04-16T12:00:00.000Z'),
          updated_at: new Date('2026-04-16T12:02:00.000Z'),
        },
      ]]))
      .mockImplementationOnce(() => makeSql([[
        {
          id: 'authority_1',
          merchant_id: '26e7ac4f-017e-4316-bf4f-9a1b37112510',
          principal_id: 'principal_1',
          operator_id: 'operator_1',
          status: 'active',
          wallet_status: 'ready',
          preferred_funding_rail: 'card',
          default_payment_method_type: 'card',
          default_payment_reference: 'pm_1',
          contact_email: 'rajiv_baskaran@agentpay.so',
          contact_name: 'Rajiv Baskaran',
          autonomy_policy_json: JSON.stringify({ autoApproveUsd: 5 }),
          limits_json: JSON.stringify({ dailyUsd: 50 }),
          metadata_json: JSON.stringify({}),
          created_at: new Date('2026-04-16T12:00:00.000Z'),
          updated_at: new Date('2026-04-16T12:02:00.000Z'),
        },
      ]]));

    const res = await capabilitiesRouter.fetch(
      new Request('http://agentpay.test/access-resolve', {
        method: 'POST',
        headers: authHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({
          provider: 'databento',
          subjectType: 'workspace',
          subjectRef: 'workbench_1',
          principalId: 'principal_1',
          operatorId: 'operator_1',
        }),
      }),
      authEnv(),
      {} as never,
    );

    const body = await res.json() as Record<string, any>;
    expect(res.status).toBe(200);
    expect(body.status).toBe('ready');
    expect(body.reusedExistingAccess).toBe(true);
    expect(body.capability.provider).toBe('databento');
    expect(body.continuity.mode).toBe('persistent_governed_access');
    expect(body.execute.endpoint).toBe('/api/capabilities/cap_databento/execute');
  });

  it('issues an opaque workbench lease instead of returning local raw secrets', async () => {
    (createDb as jest.Mock)
      .mockImplementationOnce(() => makeSql([[
        {
          id: 'cap_databento',
          merchant_id: '26e7ac4f-017e-4316-bf4f-9a1b37112510',
          capability_key: 'databento_primary',
          capability_type: 'external_api',
          capability_scope: 'databento',
          provider: 'databento',
          subject_type: 'workspace',
          subject_ref: 'workbench_1',
          status: 'active',
          secret_payload_json: {},
          metadata: {
            authScheme: 'bearer',
            credentialKind: 'api_key',
            baseUrl: 'https://hist.databento.com/v0',
            allowedHosts: ['hist.databento.com'],
            scopes: [],
            freeCalls: 3,
            paidUnitPriceUsdMicros: 75000,
          },
          expires_at: null,
          revoked_at: null,
          last_used_at: new Date('2026-04-16T12:02:00.000Z'),
          created_at: new Date('2026-04-16T12:00:00.000Z'),
          updated_at: new Date('2026-04-16T12:02:00.000Z'),
        },
      ]]))
      .mockImplementationOnce(() => makeSql([[
        {
          id: 'authority_1',
          merchant_id: '26e7ac4f-017e-4316-bf4f-9a1b37112510',
          principal_id: 'principal_1',
          operator_id: 'operator_1',
          status: 'active',
          wallet_status: 'ready',
          preferred_funding_rail: 'card',
          default_payment_method_type: 'card',
          default_payment_reference: 'pm_1',
          contact_email: 'rajiv_baskaran@agentpay.so',
          contact_name: 'Rajiv Baskaran',
          autonomy_policy_json: JSON.stringify({ autoApproveUsd: 5 }),
          limits_json: JSON.stringify({ dailyUsd: 50 }),
          metadata_json: JSON.stringify({}),
          created_at: new Date('2026-04-16T12:00:00.000Z'),
          updated_at: new Date('2026-04-16T12:02:00.000Z'),
        },
      ]]))
      .mockImplementationOnce(() => makeSql([[
        {
          id: 'lease_1',
          merchant_id: '26e7ac4f-017e-4316-bf4f-9a1b37112510',
          capability_vault_entry_id: 'cap_databento',
          subject_type: 'workspace',
          subject_ref: 'workbench_1',
          principal_id: 'principal_1',
          operator_id: 'operator_1',
          workbench_id: 'local_ws_1',
          workbench_label: 'Main repo',
          lease_token_hash: 'hash',
          status: 'active',
          metadata_json: JSON.stringify({ source: 'access_resolve' }),
          expires_at: new Date('2099-04-16T12:30:00.000Z'),
          revoked_at: null,
          last_used_at: null,
          created_at: new Date('2026-04-16T12:00:00.000Z'),
          updated_at: new Date('2026-04-16T12:00:00.000Z'),
        },
      ]]));

    const res = await capabilitiesRouter.fetch(
      new Request('http://agentpay.test/access-resolve', {
        method: 'POST',
        headers: authHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({
          provider: 'databento',
          subjectType: 'workspace',
          subjectRef: 'workbench_1',
          principalId: 'principal_1',
          operatorId: 'operator_1',
          issueWorkbenchLease: true,
          workbenchId: 'local_ws_1',
          workbenchLabel: 'Main repo',
        }),
      }),
      authEnv(),
      {} as never,
    );

    const body = await res.json() as Record<string, any>;
    expect(res.status).toBe(200);
    expect(body.status).toBe('ready');
    expect(body.workbenchLease.workbenchId).toBe('local_ws_1');
    expect(body.workbenchLease.token).toMatch(/^apcl_/);
    expect(body.workbenchLease.executeEndpoint).toBe('/api/capabilities/lease-execute');
  });

  it('executes a capability through a workbench lease without a raw provider key', async () => {
    const encryptedBlob = await encryptPayload('a'.repeat(64), JSON.stringify({ apiKey: 'fc_live_123' }));
    const fetchSpy = jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      status: 200,
      ok: true,
      text: async () => JSON.stringify({ success: true, jobId: 'crawl_lease_1' }),
    } as Response);

    (createDb as jest.Mock)
      .mockImplementationOnce(() => makeSql([[
        {
          id: 'lease_1',
          merchant_id: '26e7ac4f-017e-4316-bf4f-9a1b37112510',
          capability_vault_entry_id: 'cap_1',
          subject_type: 'workspace',
          subject_ref: 'workbench_1',
          principal_id: 'principal_1',
          operator_id: 'operator_1',
          workbench_id: 'local_ws_1',
          workbench_label: 'Main repo',
          lease_token_hash: 'hash',
          status: 'active',
          metadata_json: JSON.stringify({}),
          expires_at: new Date('2099-04-16T12:30:00.000Z'),
          revoked_at: null,
          last_used_at: null,
          created_at: new Date('2026-04-16T12:00:00.000Z'),
          updated_at: new Date('2026-04-16T12:00:00.000Z'),
        },
      ]]))
      .mockImplementationOnce(() => makeSql([[
        {
          id: '26e7ac4f-017e-4316-bf4f-9a1b37112510',
          name: 'Test Merchant',
          email: 'test@agentpay.com',
          wallet_address: 'wallet_1',
          webhook_url: null,
          parent_merchant_id: null,
        },
      ]]))
      .mockImplementationOnce(() => makeSql([[
        {
          id: 'cap_1',
          merchant_id: '26e7ac4f-017e-4316-bf4f-9a1b37112510',
          capability_key: 'firecrawl_primary',
          capability_type: 'external_api',
          capability_scope: 'firecrawl',
          provider: 'firecrawl',
          subject_type: 'workspace',
          subject_ref: 'workbench_1',
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
        [{ count: '2' }],
        [],
        [],
        [],
      ]))
      .mockImplementationOnce(() => makeSql([[]]));

    const res = await capabilitiesRouter.fetch(
      new Request('http://agentpay.test/lease-execute', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          leaseToken: 'apcl_demo_token',
          workbenchId: 'local_ws_1',
          method: 'POST',
          path: '/v1/crawl',
          body: { url: 'https://example.com' },
        }),
      }),
      authEnv(),
      {} as never,
    );

    const body = await res.json() as Record<string, any>;
    expect(res.status).toBe(200);
    expect(body.status).toBe('completed');
    expect(body.provider).toBe('firecrawl');
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.firecrawl.dev/v1/crawl',
      expect.objectContaining({
        method: 'POST',
      }),
    );
  });

  it('reuses a pending onboarding flow for the same workbench and provider', async () => {
    (createDb as jest.Mock)
      .mockImplementationOnce(() => makeSql([[]]))
      .mockImplementationOnce(() => makeSql([[
        {
          id: 'action_session_reuse',
          title: 'Finish Databento setup in AgentPay',
          summary: 'Complete setup once and keep governed access for this workbench.',
          resume_url: 'https://host.example.com/resume',
          expires_at: new Date('2099-04-16T12:30:00.000Z'),
          display_payload_json: JSON.stringify({
            subjectType: 'workspace',
            subjectRef: 'workbench_1',
            onboardingUrl: 'http://agentpay.test/api/capabilities/onboarding-sessions/action_session_reuse/hosted?token=reuse-token',
            providers: [
              {
                provider: 'databento',
                label: 'Databento',
                capabilityKey: 'databento_primary',
              },
            ],
            intake: {
              partnershipStatus: 'preset_available',
            },
          }),
          metadata_json: JSON.stringify({
            partnershipStatus: 'preset_available',
          }),
        },
      ]]));

    const res = await capabilitiesRouter.fetch(
      new Request('http://agentpay.test/access-resolve', {
        method: 'POST',
        headers: authHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({
          provider: 'databento',
          subjectType: 'workspace',
          subjectRef: 'workbench_1',
        }),
      }),
      authEnv(),
      {} as never,
    );

    const body = await res.json() as Record<string, any>;
    expect(res.status).toBe(200);
    expect(body.status).toBe('auth_required');
    expect(body.reusedPendingAction).toBe(true);
    expect(body.actionSession.sessionId).toBe('action_session_reuse');
    expect(body.nextAction.displayPayload.onboardingUrl).toContain('/api/capabilities/onboarding-sessions/action_session_reuse/hosted?token=');
  });

  it('creates a provider request intake for unknown APIs', async () => {
    (createDb as jest.Mock)
      .mockImplementationOnce(() => makeSql([[
        {
          id: 'action_session_provider_request',
          merchant_id: '26e7ac4f-017e-4316-bf4f-9a1b37112510',
          action_type: 'auth_required',
          entity_type: 'capability_onboarding',
          entity_id: 'principal_1',
          title: 'Finish Requested API setup in AgentPay',
          summary: 'AgentPay can take Requested API from request to governed execution without a dashboard.',
          status: 'pending',
          audience: 'generic',
          auth_type: 'api_key',
          resume_url: 'https://host.example.com/resume',
          display_payload_json: JSON.stringify({}),
          result_payload_json: JSON.stringify({}),
          metadata_json: JSON.stringify({}),
          expires_at: new Date('2099-04-16T12:30:00.000Z'),
          completed_at: null,
          used_at: null,
          created_at: new Date('2026-04-16T12:00:00.000Z'),
          updated_at: new Date('2026-04-16T12:00:00.000Z'),
        },
      ]]))
      .mockImplementationOnce(() => makeSql([[
        {
          id: 'action_session_provider_request',
          merchant_id: '26e7ac4f-017e-4316-bf4f-9a1b37112510',
          action_type: 'auth_required',
          entity_type: 'capability_onboarding',
          entity_id: 'principal_1',
          title: 'Finish Requested API setup in AgentPay',
          summary: 'AgentPay can take Requested API from request to governed execution without a dashboard.',
          status: 'pending',
          audience: 'generic',
          auth_type: 'api_key',
          resume_url: 'https://host.example.com/resume',
          display_payload_json: JSON.stringify({
            onboardingUrl: 'http://agentpay.test/api/capabilities/onboarding-sessions/action_session_provider_request/hosted?token=provider-token',
          }),
          result_payload_json: JSON.stringify({}),
          metadata_json: JSON.stringify({ onboardingUrlIssued: true }),
          expires_at: new Date('2099-04-16T12:30:00.000Z'),
          completed_at: null,
          used_at: null,
          created_at: new Date('2026-04-16T12:00:00.000Z'),
          updated_at: new Date('2026-04-16T12:00:00.000Z'),
        },
      ]]));

    const res = await capabilitiesRouter.fetch(
      new Request('http://agentpay.test/provider-requests', {
        method: 'POST',
        headers: authHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({
          requestedProviderName: 'Requested API',
          requestedBaseUrl: 'https://api.requested.example.com',
          requestedDocsUrl: 'https://docs.requested.example.com',
          requestedAuthScheme: 'bearer',
          requestedCredentialKind: 'api_key',
          subjectType: 'merchant',
          subjectRef: 'merchant_1',
          principalId: 'principal_1',
          operatorId: 'operator_1',
          resumeUrl: 'https://host.example.com/resume',
        }),
      }),
      authEnv(),
      {} as never,
    );

    const body = await res.json() as Record<string, any>;
    expect(res.status).toBe(201);
    expect(body.partnershipStatus).toBe('delegated_auth_needed');
    expect(body.requestedProvider.label).toBe('Requested API');
    expect(body.nextAction.displayPayload.onboardingUrl).toContain('/api/capabilities/onboarding-sessions/action_session_provider_request/hosted?token=');
  });
});
