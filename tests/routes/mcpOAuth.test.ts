jest.mock('../../apps/api-edge/src/lib/db', () => ({
  createDb: jest.fn(),
}));

import { createDb } from '../../apps/api-edge/src/lib/db';
import { pbkdf2Hex } from '../../apps/api-edge/src/lib/pbkdf2';
import { sha256Hex } from '../../apps/api-edge/src/lib/approvalSessions';
import apiEdge from '../../apps/api-edge/src/index';

function makeSql(responses: unknown[]) {
  const queue = [...responses];
  const sql = (jest.fn(async () => queue.shift()) as unknown) as jest.Mock & {
    end: jest.Mock;
    begin: jest.Mock;
  };
  sql.mockImplementation(async () => queue.shift());
  sql.end = jest.fn().mockResolvedValue(undefined);
  sql.begin = jest.fn(async (callback: (inner: typeof sql) => unknown) => callback(sql));
  return sql;
}

function appEnv(extra: Record<string, unknown> = {}) {
  return {
    DATABASE_URL: 'postgres://agentpay:test@localhost:5432/agentpay',
    WEBHOOK_SECRET: 'w'.repeat(32),
    AGENTPAY_SIGNING_SECRET: 's'.repeat(32),
    VERIFICATION_SECRET: 'v'.repeat(32),
    ADMIN_SECRET_KEY: 'a'.repeat(32),
    CORS_ORIGIN: 'http://localhost:3000',
    API_BASE_URL: 'http://agentpay.test',
    FRONTEND_URL: 'http://agentpay.test',
    AGENTPAY_TEST_MODE: 'true',
    NODE_ENV: 'development',
    ...extra,
  } as never;
}

async function pkceChallenge(verifier: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

describe('MCP OAuth surfaces', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    (createDb as jest.Mock).mockReset();
  });

  it('publishes protected resource and authorization server metadata', async () => {
    const protectedRes = await apiEdge.fetch(
      new Request('http://agentpay.test/.well-known/oauth-protected-resource/api/mcp'),
      appEnv(),
      {} as never,
    );
    const authServer = await apiEdge.fetch(
      new Request('http://agentpay.test/.well-known/oauth-authorization-server'),
      appEnv(),
      {} as never,
    );

    await expect(protectedRes.json()).resolves.toEqual(expect.objectContaining({
      resource: 'http://agentpay.test/api/mcp',
      authorization_servers: ['http://agentpay.test/.well-known/oauth-authorization-server'],
      scopes_supported: ['remote_mcp'],
    }));
    await expect(authServer.json()).resolves.toEqual(expect.objectContaining({
      issuer: 'http://agentpay.test',
      authorization_endpoint: 'http://agentpay.test/authorize',
      token_endpoint: 'http://agentpay.test/token',
      registration_endpoint: 'http://agentpay.test/register',
      code_challenge_methods_supported: ['S256'],
    }));
  });

  it('supports OAuth client registration for host connectors', async () => {
    (createDb as jest.Mock).mockReturnValue(makeSql([[]]));

    const res = await apiEdge.fetch(
      new Request('http://agentpay.test/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          client_name: 'ChatGPT Connector',
          redirect_uris: ['https://chatgpt.com/connector/oauth/callback'],
          token_endpoint_auth_method: 'none',
        }),
      }),
      appEnv(),
      {} as never,
    );
    const body = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(201);
    expect(String(body.client_id)).toContain('apcli_');
    expect(body.token_endpoint_auth_method).toBe('none');
    expect(body.redirect_uris).toEqual(['https://chatgpt.com/connector/oauth/callback']);
  });

  it('issues an authorization code after founder login', async () => {
    const verifier = 'verifier-1234567890';
    const challenge = await pkceChallenge(verifier);
    const apiKeyHash = await pbkdf2Hex('sk_live_founder', 'salt-1');

    (createDb as jest.Mock)
      .mockImplementationOnce(() => makeSql([[
        {
          client_id: 'apcli_demo',
          client_secret_hash: null,
          client_name: 'ChatGPT Connector',
          redirect_uris_json: ['https://chatgpt.com/connector/oauth/callback'],
          token_endpoint_auth_method: 'none',
          grant_types_json: ['authorization_code'],
          response_types_json: ['code'],
          scope: 'remote_mcp',
          metadata: {},
        },
      ]]))
      .mockImplementationOnce(() => makeSql([[
        {
          id: '26e7ac4f-017e-4316-bf4f-9a1b37112510',
          name: 'Test Merchant',
          email: 'test@agentpay.com',
          walletAddress: null,
          webhookUrl: null,
          apiKeyHash,
          apiKeySalt: 'salt-1',
          parentMerchantId: null,
        },
      ]]))
      .mockImplementationOnce(() => makeSql([[]]));

    const form = new URLSearchParams({
      client_id: 'apcli_demo',
      redirect_uri: 'https://chatgpt.com/connector/oauth/callback',
      scope: 'remote_mcp',
      state: 'state-1',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      email: 'test@agentpay.com',
      api_key: 'sk_live_founder',
    });
    const res = await apiEdge.fetch(
      new Request('http://agentpay.test/authorize', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
      }),
      appEnv(),
      {} as never,
    );

    expect(res.status).toBe(302);
    const location = res.headers.get('location') ?? '';
    expect(location).toContain('https://chatgpt.com/connector/oauth/callback');
    expect(location).toContain('code=');
    expect(location).toContain('state=state-1');
  });

  it('requests a no-key email-link OAuth attempt in test mode', async () => {
    const verifier = 'verifier-email-link';
    const challenge = await pkceChallenge(verifier);

    (createDb as jest.Mock)
      .mockImplementationOnce(() => makeSql([[
        {
          client_id: 'apcli_demo',
          client_secret_hash: null,
          client_name: 'Claude Connector',
          redirect_uris_json: ['https://claude.ai/oauth/callback'],
          token_endpoint_auth_method: 'none',
          grant_types_json: ['authorization_code'],
          response_types_json: ['code'],
          scope: 'remote_mcp',
          metadata: {},
        },
      ]]))
      .mockImplementationOnce(() => makeSql([[
        {
          id: '26e7ac4f-017e-4316-bf4f-9a1b37112510',
          name: 'Test Merchant',
          email: 'test@agentpay.com',
          walletAddress: null,
          webhookUrl: null,
          parentMerchantId: null,
          keyPrefix: '1f25e3e0',
        },
      ], []]));

    const form = new URLSearchParams({
      client_id: 'apcli_demo',
      redirect_uri: 'https://claude.ai/oauth/callback',
      scope: 'remote_mcp',
      state: 'state-email',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      email: 'test@agentpay.com',
    });
    const res = await apiEdge.fetch(
      new Request('http://agentpay.test/authorize/email-link', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
      }),
      appEnv(),
      {} as never,
    );

    const body = await res.text();
    expect(res.status).toBe(200);
    expect(body).toContain('Test-mode link:');
    expect(body).toContain('/authorize/email-link?attempt=');
    expect(body).toContain('without asking you to find an API key');
  });

  it('confirms an email-link attempt and redirects with an authorization code', async () => {
    const attemptToken = 'apoel_test_token';
    const attemptTokenHash = await sha256Hex(attemptToken);

    (createDb as jest.Mock)
      .mockImplementationOnce(() => makeSql([[
        {
          id: 'attempt_1',
          attempt_token_hash: attemptTokenHash,
          client_id: 'apcli_demo',
          client_name: 'ChatGPT Connector',
          merchant_id: '26e7ac4f-017e-4316-bf4f-9a1b37112510',
          merchant_email: 'test@agentpay.com',
          merchant_key_prefix: '1f25e3e0',
          redirect_uri: 'https://chatgpt.com/connector/oauth/callback',
          scope: 'remote_mcp',
          state: 'state-2',
          resource: 'http://agentpay.test/api/mcp',
          audience: 'openai',
          code_challenge: 'challenge_1',
          code_challenge_method: 'S256',
          delivery_channel: 'email_link',
          expires_at: new Date('2099-04-16T22:00:00.000Z'),
          verified_at: null,
          used_at: null,
          created_at: new Date('2099-04-16T21:45:00.000Z'),
        },
      ]]));

    const reviewRes = await apiEdge.fetch(
      new Request(`http://agentpay.test/authorize/email-link?attempt=attempt_1&token=${attemptToken}`),
      appEnv(),
      {} as never,
    );
    const reviewBody = await reviewRes.text();
    expect(reviewRes.status).toBe(200);
    expect(reviewBody).toContain('Continue to ChatGPT Connector');

    (createDb as jest.Mock)
      .mockImplementationOnce(() => makeSql([[
        {
          id: 'attempt_1',
          attempt_token_hash: attemptTokenHash,
          client_id: 'apcli_demo',
          client_name: 'ChatGPT Connector',
          merchant_id: '26e7ac4f-017e-4316-bf4f-9a1b37112510',
          merchant_email: 'test@agentpay.com',
          merchant_key_prefix: '1f25e3e0',
          redirect_uri: 'https://chatgpt.com/connector/oauth/callback',
          scope: 'remote_mcp',
          state: 'state-2',
          resource: 'http://agentpay.test/api/mcp',
          audience: 'openai',
          code_challenge: 'challenge_1',
          code_challenge_method: 'S256',
          delivery_channel: 'email_link',
          expires_at: new Date('2099-04-16T22:00:00.000Z'),
          verified_at: null,
          used_at: null,
          created_at: new Date('2099-04-16T21:45:00.000Z'),
        },
      ], [{ id: 'attempt_1' }], []]));

    const confirmForm = new URLSearchParams({
      attempt: 'attempt_1',
      token: attemptToken,
    });
    const confirmRes = await apiEdge.fetch(
      new Request('http://agentpay.test/authorize/email-link/confirm', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: confirmForm.toString(),
      }),
      appEnv(),
      {} as never,
    );

    expect(confirmRes.status).toBe(302);
    const location = confirmRes.headers.get('location') ?? '';
    expect(location).toContain('https://chatgpt.com/connector/oauth/callback');
    expect(location).toContain('code=');
    expect(location).toContain('state=state-2');
  });

  it('exchanges an authorization code for a short-lived MCP access token', async () => {
    const verifier = 'verifier-abcdef';
    const challenge = await pkceChallenge(verifier);
    const code = 'apcode_test';
    const codeHash = await sha256Hex(code);

    (createDb as jest.Mock)
      .mockImplementationOnce(() => makeSql([[
        {
          client_id: 'apcli_demo',
          client_secret_hash: null,
          client_name: 'ChatGPT Connector',
          redirect_uris_json: ['https://chatgpt.com/connector/oauth/callback'],
          token_endpoint_auth_method: 'none',
          grant_types_json: ['authorization_code'],
          response_types_json: ['code'],
          scope: 'remote_mcp',
          metadata: {},
        },
      ]]))
      .mockImplementationOnce(() => makeSql([[
        {
          id: 'code_row_1',
          code_hash: codeHash,
          client_id: 'apcli_demo',
          merchant_id: '26e7ac4f-017e-4316-bf4f-9a1b37112510',
          merchant_email: 'test@agentpay.com',
          merchant_key_prefix: '1f25e3e0',
          redirect_uri: 'https://chatgpt.com/connector/oauth/callback',
          scope: 'remote_mcp',
          resource: 'http://agentpay.test/api/mcp',
          audience: 'openai',
          code_challenge: challenge,
          code_challenge_method: 'S256',
          expires_at: new Date('2099-04-16T22:00:00.000Z'),
          used_at: null,
        },
      ], []]));

    const form = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: 'apcli_demo',
      redirect_uri: 'https://chatgpt.com/connector/oauth/callback',
      code,
      code_verifier: verifier,
    });
    const res = await apiEdge.fetch(
      new Request('http://agentpay.test/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
      }),
      appEnv(),
      {} as never,
    );
    const body = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(String(body.access_token)).toContain('apmcp_v1.');
    expect(body.token_type).toBe('Bearer');
    expect(body.scope).toBe('remote_mcp');
    expect(body.audience).toBe('openai');
  });
});
