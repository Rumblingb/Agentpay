jest.mock('../../apps/api-edge/src/lib/db', () => ({
  createDb: jest.fn(),
}));

import { createDb } from '../../apps/api-edge/src/lib/db';
import { pbkdf2Hex } from '../../apps/api-edge/src/lib/pbkdf2';
import apiEdge from '../../apps/api-edge/src/index';

function makeSql(responses: unknown[]) {
  const queue = [...responses];
  const sql = (jest.fn(async () => queue.shift()) as unknown) as jest.Mock & {
    end: jest.Mock;
  };
  sql.mockImplementation(async () => queue.shift());
  sql.end = jest.fn().mockResolvedValue(undefined);
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

function authHeaders(extra: Record<string, string> = {}) {
  return {
    authorization: 'Bearer sk_test_sim',
    ...extra,
  };
}

async function makeAuthenticatedMerchantRows(apiKey = 'sk_test_sim') {
  return [{
    id: '26e7ac4f-017e-4316-bf4f-9a1b37112510',
    name: 'Test Merchant',
    email: 'test@agentpay.com',
    walletAddress: '9B5X2Fwc4PQHqbXkhmr8vgYKHjgP7V8HBzMgMTf8H',
    webhookUrl: null,
    createdAt: new Date('2026-04-01T00:00:00.000Z'),
    apiKeySalt: 'unit-test-salt',
    apiKeyHash: await pbkdf2Hex(apiKey, 'unit-test-salt'),
    parentMerchantId: null,
  }];
}

describe('hosted remote MCP surface', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    (createDb as jest.Mock).mockReset();
  });

  it('publishes a public MCP discovery document', async () => {
    const res = await apiEdge.fetch(
      new Request('http://agentpay.test/api/mcp/info'),
      appEnv(),
      {} as never,
    );

    await expect(res.json()).resolves.toEqual(expect.objectContaining({
      name: 'agentpay',
      runtime: 'remote-mcp',
      endpoint: 'http://agentpay.test/api/mcp',
      readOnlyEndpoint: 'http://agentpay.test/api/mcp/read-only',
      recommendedEntryPoint: 'http://agentpay.test/api/mcp/read-only',
      transport: 'streamable-http',
      auth: expect.objectContaining({
        type: 'oauth_or_bearer',
        bearer: expect.objectContaining({
          header: 'Authorization',
          tokenEndpoint: 'http://agentpay.test/api/mcp/tokens',
        }),
        oauth: expect.objectContaining({
          protectedResourceMetadataUrl: 'http://agentpay.test/.well-known/oauth-protected-resource/api/mcp',
          authorizationServerMetadataUrl: 'http://agentpay.test/.well-known/oauth-authorization-server',
          tokenEndpoint: 'http://agentpay.test/token',
        }),
      }),
      hostCompatibility: expect.objectContaining({
        openai: 'remote_mcp',
        anthropic: 'remote_mcp',
        generic: 'remote_mcp',
      }),
      actionModel: expect.objectContaining({
        responsePattern: 'result_or_next_action',
        preferredHumanSurface: 'host_native',
      }),
      links: {
        pricingEndpoint: 'http://agentpay.test/api/mcp/pricing',
        setupEndpoint: 'http://agentpay.test/api/mcp/setup',
        demoEndpoint: 'http://agentpay.test/api/mcp/demo',
      },
      billing: expect.objectContaining({
        model: 'monthly_plus_metered',
        pricingVersion: expect.any(String),
        pricingUrl: 'http://agentpay.test/pricing',
      }),
      toolCount: expect.any(Number),
      readOnlyToolCount: expect.any(Number),
    }));
    expect(res.status).toBe(200);
  });

  it('publishes canonical hosted MCP pricing separately from discovery', async () => {
    const res = await apiEdge.fetch(
      new Request('http://agentpay.test/api/mcp/pricing'),
      appEnv(),
      {} as never,
    );
    const body = await res.json() as Record<string, unknown>;

    expect(body.model).toBe('monthly_plus_metered');
    expect(body.pricingVersion).toEqual(expect.any(String));
    expect(body.defaultPlan).toBe('launch');
    expect(Array.isArray(body.plans)).toBe(true);
    expect(body.fundedActions).toEqual(expect.objectContaining({
      feeBps: expect.any(Number),
    }));
    expect(body.collectionPolicy).toEqual(expect.objectContaining({
      minimumCollectableUsd: 5,
      behavior: 'accrue_until_threshold',
    }));
    expect(body.currentInvoiceEndpoint).toBe('http://agentpay.test/api/mcp/billing/current');
    expect(body.checkoutEndpoint).toBe('http://agentpay.test/api/mcp/billing/checkout');
    expect(body.setupEndpoint).toBe('http://agentpay.test/api/mcp/setup');
    expect(body.demoEndpoint).toBe('http://agentpay.test/api/mcp/demo');
    expect(res.status).toBe(200);
  });

  it('publishes a host-native setup and demo surface', async () => {
    const setupRes = await apiEdge.fetch(
      new Request('http://agentpay.test/api/mcp/setup'),
      appEnv(),
      {} as never,
    );
    const demoRes = await apiEdge.fetch(
      new Request('http://agentpay.test/api/mcp/demo'),
      appEnv(),
      {} as never,
    );
    const setupBody = await setupRes.json() as Record<string, unknown>;
    const demoBody = await demoRes.json() as Record<string, unknown>;

    expect(setupBody.title).toBe('AgentPay host-native setup');
    expect(setupBody.runtime).toBe('remote-mcp');
    expect(setupBody.endpoint).toBe('http://agentpay.test/api/mcp');
    expect(setupBody.readOnlyEndpoint).toBe('http://agentpay.test/api/mcp/read-only');
    expect(setupBody.recommendedStartingEndpoint).toBe('http://agentpay.test/api/mcp/read-only');
    expect(setupBody.tokenEndpoint).toBe('http://agentpay.test/api/mcp/tokens');
    expect(setupBody.auth).toEqual(expect.objectContaining({
      preferred: 'oauth_discovery',
      fallback: 'minted_bearer_token',
      protectedResourceMetadataUrl: 'http://agentpay.test/.well-known/oauth-protected-resource/api/mcp',
      authorizationServerMetadataUrl: 'http://agentpay.test/.well-known/oauth-authorization-server',
      authorizeEndpoint: 'http://agentpay.test/authorize',
      tokenEndpoint: 'http://agentpay.test/token',
      registrationEndpoint: 'http://agentpay.test/register',
    }));
    expect(setupBody.pricingEndpoint).toBe('http://agentpay.test/api/mcp/pricing');
    expect(setupBody.demoEndpoint).toBe('http://agentpay.test/api/mcp/demo');
    expect(Array.isArray(setupBody.hosts)).toBe(true);
    expect(setupBody.toolSurfaces).toEqual(expect.objectContaining({
      readOnly: expect.objectContaining({
        endpoint: 'http://agentpay.test/api/mcp/read-only',
      }),
      full: expect.objectContaining({
        endpoint: 'http://agentpay.test/api/mcp',
      }),
    }));
    const openaiHost = (setupBody.hosts as Array<Record<string, unknown>>).find((host) => host.host === 'openai');
    const anthropicHost = (setupBody.hosts as Array<Record<string, unknown>>).find((host) => host.host === 'anthropic');
    const genericHost = (setupBody.hosts as Array<Record<string, unknown>>).find((host) => host.host === 'generic');
    expect(openaiHost).toEqual(expect.objectContaining({
      status: 'api_ready_workspace_manual',
      guideUrl: 'http://agentpay.test/docs/OPENAI_HOST_SETUP',
    }));
    expect(anthropicHost).toEqual(expect.objectContaining({
      status: 'ready_now_manual_connector',
      guideUrl: 'http://agentpay.test/docs/ANTHROPIC_CUSTOM_CONNECTOR_SETUP',
    }));
    expect(genericHost).toEqual(expect.objectContaining({
      status: 'ready_now_manual_mcp',
      guideUrl: 'http://agentpay.test/docs/GENERIC_AGENT_SETUP',
    }));
    expect(setupBody.nextActionContract).toEqual(expect.objectContaining({
      responsePattern: 'result_or_next_action',
    }));
    expect(setupBody.agentCreatorGuardrail).toEqual(expect.any(Object));
    expect((setupBody.agentCreatorGuardrail as Record<string, unknown>).purpose).toEqual(expect.any(String));
    expect(Array.isArray((setupBody.agentCreatorGuardrail as Record<string, unknown>).instruction)).toBe(true);
    expect((setupBody.agentCreatorGuardrail as Record<string, unknown>).escalateOnlyFor).toEqual(
      expect.arrayContaining(['approval_required', 'funding_required', 'auth_required']),
    );
    expect((setupBody.agentCreatorGuardrail as Record<string, unknown>).neverDo).toEqual(
      expect.arrayContaining(['invent authority that was not granted']),
    );
    expect(demoBody.title).toBe('AgentPay host-native demo flow');
    expect(Array.isArray(demoBody.steps)).toBe(true);
    expect(setupRes.status).toBe(200);
    expect(demoRes.status).toBe(200);
  });

  it('publishes MCP-specific readiness for connector setup flows', async () => {
    const res = await apiEdge.fetch(
      new Request('http://agentpay.test/api/mcp/health'),
      appEnv(),
      {} as never,
    );

    await expect(res.json()).resolves.toEqual({
      status: 'ok',
      runtime: 'remote-mcp',
      endpoint: 'http://agentpay.test/api/mcp',
      readOnlyEndpoint: 'http://agentpay.test/api/mcp/read-only',
      transport: 'streamable-http',
      auth: 'oauth_or_bearer',
      toolCount: expect.any(Number),
      readOnlyToolCount: expect.any(Number),
    });
    expect(res.status).toBe(200);
  });

  it('publishes a public MCP probe response on the transport endpoint root', async () => {
    const res = await apiEdge.fetch(
      new Request('http://agentpay.test/api/mcp'),
      appEnv(),
      {} as never,
    );

    await expect(res.json()).resolves.toEqual(expect.objectContaining({
      name: 'agentpay',
      runtime: 'remote-mcp',
      transport: 'streamable-http',
      status: 'auth_required_for_transport',
      auth: expect.objectContaining({
        type: 'oauth_or_bearer',
        tokenEndpoint: 'http://agentpay.test/api/mcp/tokens',
        protectedResourceMetadataUrl: 'http://agentpay.test/.well-known/oauth-protected-resource/api/mcp',
        authorizationServerMetadataUrl: 'http://agentpay.test/.well-known/oauth-authorization-server',
      }),
    }));
    expect(res.status).toBe(200);
  });

  it('publishes a public probe response on the read-only MCP endpoint root', async () => {
    const res = await apiEdge.fetch(
      new Request('http://agentpay.test/api/mcp/read-only'),
      appEnv(),
      {} as never,
    );

    await expect(res.json()).resolves.toEqual(expect.objectContaining({
      name: 'agentpay-read-only',
      endpoint: 'http://agentpay.test/api/mcp/read-only',
      safeForDiscovery: true,
      readOnlyToolCount: expect.any(Number),
    }));
    expect(res.status).toBe(200);
  });

  it('returns hosted MCP invoice history', async () => {
    (createDb as jest.Mock).mockReturnValue(makeSql([[
      {
        id: 'inv_hosted_1',
        invoice_type: 'hosted_mcp',
        status: 'paid',
        fee_amount: '39.00',
        currency: 'USD',
        period_start: new Date('2026-04-01T00:00:00.000Z'),
        period_end: new Date('2026-05-01T00:00:00.000Z'),
        reference_key: 'hosted_mcp:2026-04-01:inv_hosted_1',
        external_checkout_url: 'https://checkout.stripe.test/hosted',
        external_checkout_session_id: 'cs_hosted_1',
        paid_at: new Date('2026-04-16T14:00:00.000Z'),
        created_at: new Date('2026-04-16T13:00:00.000Z'),
        updated_at: new Date('2026-04-16T14:00:00.000Z'),
        line_items_json: { pricingVersion: '2026-04-16' },
      },
    ]]));

    const res = await apiEdge.fetch(
      new Request('http://agentpay.test/api/mcp/billing/history', {
        headers: authHeaders(),
      }),
      appEnv(),
      {} as never,
    );

    const body = await res.json() as Record<string, unknown>;
    expect(res.status).toBe(200);
    expect(body.invoiceType).toBe('hosted_mcp');
    expect(Array.isArray(body.invoices)).toBe(true);
    expect((body.invoices as Array<Record<string, unknown>>)[0]).toEqual(expect.objectContaining({
      invoiceId: 'inv_hosted_1',
      status: 'paid',
      checkoutSessionId: 'cs_hosted_1',
    }));
  });

  it('accrues hosted MCP balances below the collection threshold', async () => {
    const merchantRows = await makeAuthenticatedMerchantRows();
    (createDb as jest.Mock)
      .mockImplementationOnce(() => makeSql([
        merchantRows,
      ]))
      .mockImplementationOnce(() => makeSql([[
        { hosted_mcp_plan_code: 'builder' },
      ]]))
      .mockImplementationOnce(() => makeSql([
        [
          {
            tool_calls: 11000,
            token_mints: 30,
          },
        ],
        [
          {
            already_invoiced_usd: '39.00',
          },
        ],
      ]));

    const res = await apiEdge.fetch(
      new Request('http://agentpay.test/api/mcp/billing/current', {
        headers: authHeaders(),
      }),
      appEnv({ AGENTPAY_TEST_MODE: 'false' }),
      {} as never,
    );

    const body = await res.json() as Record<string, unknown>;
    expect(res.status).toBe(200);
    expect(body.outstandingUsd).toBe(0.4);
    expect(body.payable).toBe(false);
    expect((body.collection as Record<string, unknown>).available).toBe(false);
    expect((body.collection as Record<string, unknown>).accrualActive).toBe(true);
  });

  it('lists tools through the hosted MCP endpoint', async () => {
    const res = await apiEdge.fetch(
      new Request('http://agentpay.test/api/mcp', {
        method: 'POST',
        headers: authHeaders({
          'content-type': 'application/json',
          'mcp-protocol-version': '2025-03-26',
        }),
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'list-tools-1',
          method: 'tools/list',
          params: {},
        }),
      }),
      appEnv(),
      {} as never,
    );

    const body = await res.json() as Record<string, unknown>;
    const result = body.result as Record<string, unknown>;
    const tools = result.tools as Array<Record<string, unknown>>;

    expect(res.status).toBe(200);
    expect(body.jsonrpc).toBe('2.0');
    expect(body.id).toBe('list-tools-1');
    expect(Array.isArray(tools)).toBe(true);
    expect(tools.some((tool) => tool.name === 'agentpay_create_mandate')).toBe(true);
    expect(tools.some((tool) => tool.name === 'agentpay_provision_identity_inbox')).toBe(true);
  });

  it('routes hosted MCP tool calls through the deployed API contract', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({
        principalId: 'principal_001',
        methods: [{ paymentMethodId: 'pm_default', brand: 'visa', last4: '4242' }],
      }),
    } as any);

    const res = await apiEdge.fetch(
      new Request('http://agentpay.test/api/mcp', {
        method: 'POST',
        headers: authHeaders({
          'content-type': 'application/json',
          'mcp-protocol-version': '2025-03-26',
        }),
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'tool-call-1',
          method: 'tools/call',
          params: {
            name: 'agentpay_list_funding_methods',
            arguments: { principalId: 'principal_001' },
          },
        }),
      }),
      appEnv(),
      {} as never,
    );

    const body = await res.json() as Record<string, unknown>;
    const result = body.result as Record<string, unknown>;
    const content = result.content as Array<Record<string, unknown>>;

    expect(res.status).toBe(200);
    expect(String(fetchSpy.mock.calls[0][0])).toContain('/api/payments/methods/principal_001');
    expect(fetchSpy.mock.calls[0][1]?.headers).toMatchObject({
      Authorization: 'Bearer sk_test_sim',
    });
    expect(content[0].type).toBe('text');
    expect(String(content[0].text)).toContain('principal_001');
  });

  it('routes host-native funding actions through the MCP contract', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({
        requestId: 'fundreq_1',
        status: 'requires_human_funding',
        nextAction: {
          type: 'funding_required',
          displayPayload: {
            kind: 'upi_qr',
            shortUrl: 'https://rzp.io/i/demo',
          },
        },
      }),
    } as any);

    const res = await apiEdge.fetch(
      new Request('http://agentpay.test/api/mcp', {
        method: 'POST',
        headers: authHeaders({
          'content-type': 'application/json',
          'mcp-protocol-version': '2025-03-26',
        }),
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'tool-call-1b',
          method: 'tools/call',
          params: {
            name: 'agentpay_create_human_funding_request',
            arguments: {
              amountInr: 499,
              description: 'Top up this purchase',
            },
          },
        }),
      }),
      appEnv(),
      {} as never,
    );

    const body = await res.json() as Record<string, unknown>;
    const result = body.result as Record<string, unknown>;
    const content = result.content as Array<Record<string, unknown>>;

    expect(res.status).toBe(200);
    expect(String(fetchSpy.mock.calls[0][0])).toContain('/api/payments/funding-request');
    expect(JSON.parse(fetchSpy.mock.calls[0][1]?.body as string)).toEqual({
      rail: 'upi',
      amountInr: 499,
      description: 'Top up this purchase',
    });
    expect(String(content[0].text)).toContain('requires_human_funding');
    expect(String(content[0].text)).toContain('upi_qr');
  });

  it('routes card-first funding actions through the MCP contract', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({
        requestId: 'fundreq_2',
        status: 'requires_human_funding',
        nextAction: {
          type: 'funding_required',
          displayPayload: {
            kind: 'stripe_checkout',
            checkoutUrl: 'https://checkout.stripe.com/c/pay/demo',
          },
        },
      }),
    } as any);

    const res = await apiEdge.fetch(
      new Request('http://agentpay.test/api/mcp', {
        method: 'POST',
        headers: authHeaders({
          'content-type': 'application/json',
          'mcp-protocol-version': '2025-03-26',
        }),
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'tool-call-1bb',
          method: 'tools/call',
          params: {
            name: 'agentpay_create_human_funding_request',
            arguments: {
              amount: 49,
              currency: 'GBP',
              description: 'Fund this purchase',
            },
          },
        }),
      }),
      appEnv(),
      {} as never,
    );

    const body = await res.json() as Record<string, unknown>;
    const result = body.result as Record<string, unknown>;
    const content = result.content as Array<Record<string, unknown>>;

    expect(res.status).toBe(200);
    expect(String(fetchSpy.mock.calls[0][0])).toContain('/api/payments/funding-request');
    expect(JSON.parse(fetchSpy.mock.calls[0][1]?.body as string)).toEqual({
      rail: 'card',
      amount: 49,
      currency: 'GBP',
      description: 'Fund this purchase',
    });
    expect(String(content[0].text)).toContain('requires_human_funding');
    expect(String(content[0].text)).toContain('stripe_checkout');
  });

  it('routes secure capability connect actions through the MCP contract', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({
        status: 'auth_required',
        capabilityId: 'cap_1',
        nextAction: {
          type: 'auth_required',
        },
      }),
    } as any);

    const res = await apiEdge.fetch(
      new Request('http://agentpay.test/api/mcp', {
        method: 'POST',
        headers: authHeaders({
          'content-type': 'application/json',
          'mcp-protocol-version': '2025-03-26',
        }),
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'tool-call-1c',
          method: 'tools/call',
          params: {
            name: 'agentpay_request_capability_connect',
            arguments: {
              provider: 'firecrawl',
              capabilityKey: 'firecrawl_primary',
              subjectType: 'merchant',
              subjectRef: 'merchant_1',
              baseUrl: 'https://api.firecrawl.dev',
              allowedHosts: ['api.firecrawl.dev'],
              authScheme: 'bearer',
              credentialKind: 'api_key',
            },
          },
        }),
      }),
      appEnv(),
      {} as never,
    );

    const body = await res.json() as Record<string, unknown>;
    const result = body.result as Record<string, unknown>;
    const content = result.content as Array<Record<string, unknown>>;

    expect(res.status).toBe(200);
    expect(String(fetchSpy.mock.calls[0][0])).toContain('/api/capabilities/connect-sessions');
    expect(JSON.parse(fetchSpy.mock.calls[0][1]?.body as string)).toEqual({
      provider: 'firecrawl',
      capabilityKey: 'firecrawl_primary',
      subjectType: 'merchant',
      subjectRef: 'merchant_1',
      baseUrl: 'https://api.firecrawl.dev',
      allowedHosts: ['api.firecrawl.dev'],
      authScheme: 'bearer',
      credentialKind: 'api_key',
    });
    expect(String(content[0].text)).toContain('auth_required');
    expect(String(content[0].text)).toContain('cap_1');
  });

  it('mints a short-lived MCP bearer token without forcing dashboard login', async () => {
    const res = await apiEdge.fetch(
      new Request('http://agentpay.test/api/mcp/tokens', {
        method: 'POST',
        headers: authHeaders({
          'content-type': 'application/json',
        }),
        body: JSON.stringify({
          audience: 'openai',
          ttlSeconds: 1800,
        }),
      }),
      appEnv(),
      {} as never,
    );

    const body = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(String(body.tokenType)).toBe('Bearer');
    expect(String(body.accessToken)).toContain('apmcp_v1.');
    expect(body.endpoint).toBe('http://agentpay.test/api/mcp');
    expect(body.audience).toBe('openai');
    expect(body.scope).toBe('remote_mcp');
  });

  it('accepts minted MCP access tokens on the hosted MCP route and forwards them downstream', async () => {
    const mintedRes = await apiEdge.fetch(
      new Request('http://agentpay.test/api/mcp/tokens', {
        method: 'POST',
        headers: authHeaders({
          'content-type': 'application/json',
        }),
        body: JSON.stringify({
          audience: 'anthropic',
          ttlSeconds: 1200,
        }),
      }),
      appEnv(),
      {} as never,
    );
    const mintedBody = await mintedRes.json() as Record<string, unknown>;
    const accessToken = String(mintedBody.accessToken);

    const fetchSpy = jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({
        principalId: 'principal_001',
        methods: [{ paymentMethodId: 'pm_default', brand: 'visa', last4: '4242' }],
      }),
    } as any);

    const res = await apiEdge.fetch(
      new Request('http://agentpay.test/api/mcp', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${accessToken}`,
          'content-type': 'application/json',
          'mcp-protocol-version': '2025-03-26',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'tool-call-2',
          method: 'tools/call',
          params: {
            name: 'agentpay_list_funding_methods',
            arguments: { principalId: 'principal_001' },
          },
        }),
      }),
      appEnv(),
      {} as never,
    );

    expect(res.status).toBe(200);
    expect(fetchSpy.mock.calls[0][1]?.headers).toMatchObject({
      Authorization: `Bearer ${accessToken}`,
    });
  });

  it('returns the current hosted MCP invoice summary for the authenticated merchant', async () => {
    const authRows = await makeAuthenticatedMerchantRows();

    (createDb as jest.Mock)
      .mockImplementationOnce(() => makeSql([
        authRows,
      ]))
      .mockImplementationOnce(() => makeSql([
        [{ hosted_mcp_plan_code: 'builder' }],
      ]))
      .mockImplementationOnce(() => makeSql([
        [{ tool_calls: 12500, token_mints: 34 }],
        [{ already_invoiced_usd: '39' }],
      ]));

    const res = await apiEdge.fetch(
      new Request('http://agentpay.test/api/mcp/billing/current', {
        headers: authHeaders(),
      }),
      appEnv({ AGENTPAY_TEST_MODE: 'false' }),
      {} as never,
    );

    const body = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.planCode).toBe('builder');
    expect(body.outstandingUsd).toBe(1);
    expect(body.payable).toBe(false);
    expect(body.collection).toEqual({
      method: 'stripe_checkout',
      available: false,
      minimumCollectableUsd: 5,
      accrualActive: true,
    });
  });

  it('creates a Stripe checkout session for outstanding hosted MCP charges', async () => {
    const authRows = await makeAuthenticatedMerchantRows();

    (createDb as jest.Mock)
      .mockImplementationOnce(() => makeSql([
        authRows,
      ]))
      .mockImplementationOnce(() => makeSql([
        [{ hosted_mcp_plan_code: 'builder' }],
      ]))
      .mockImplementationOnce(() => makeSql([
        [{ tool_calls: 0, token_mints: 0 }],
        [{ already_invoiced_usd: '0' }],
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
        json: async () => ({ id: 'cus_hosted_1' }),
      } as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'cs_hosted_1', url: 'https://checkout.stripe.test/session' }),
      } as any);

    const res = await apiEdge.fetch(
      new Request('http://agentpay.test/api/mcp/billing/checkout', {
        method: 'POST',
        headers: authHeaders(),
      }),
      appEnv({ AGENTPAY_TEST_MODE: 'false', STRIPE_SECRET_KEY: 'sk_test_hosted' }),
      {} as never,
    );

    const body = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(201);
    expect(body.invoiceId).toBeDefined();
    expect(body.checkoutSessionId).toBe('cs_hosted_1');
    expect(body.checkoutUrl).toBe('https://checkout.stripe.test/session');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(String(fetchSpy.mock.calls[0][0])).toContain('https://api.stripe.com/v1/customers');
    expect(String(fetchSpy.mock.calls[1][0])).toContain('https://api.stripe.com/v1/checkout/sessions');
  });
});
