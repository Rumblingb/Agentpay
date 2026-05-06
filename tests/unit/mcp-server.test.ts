import { READ_ONLY_TOOL_NAMES, SAFE_TOOLS, TOOLS, createAgentPayMcpServer, handleTool } from '../../packages/mcp-server/src/index';

describe('MCP mandate contract', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('exposes one unique mandate tool family and no legacy ace route references', () => {
    const toolNames = TOOLS.map((tool) => tool.name);
    const mandateTools = toolNames.filter((name) => name.includes('_mandate'));

    expect(new Set(toolNames).size).toBe(toolNames.length);
    expect(mandateTools).toEqual([
      'agentpay_create_mandate',
      'agentpay_get_mandate',
      'agentpay_get_mandate_journey_status',
      'agentpay_get_mandate_history',
      'agentpay_approve_mandate',
      'agentpay_execute_mandate',
      'agentpay_cancel_mandate',
    ]);
    expect(TOOLS.some((tool) => JSON.stringify(tool).includes('/api/ace/intents'))).toBe(false);
    expect(TOOLS.find((tool) => tool.name === 'agentpay_create_mandate')?.description).toContain('/api/mandates');
    expect(TOOLS.find((tool) => tool.name === 'agentpay_get_mandate_journey_status')?.description).toContain('If no journey session exists yet');
  });

  it('exposes a canonical identity bundle family on /api/foundation-agents/identity', () => {
    const toolNames = TOOLS.map((tool) => tool.name);
    const identityTools = toolNames.filter((name) => name.includes('identity'));

    expect(identityTools).toEqual([
      'agentpay_get_identity_bundle',
      'agentpay_verify_identity_bundle',
      'agentpay_provision_identity_inbox',
      'agentpay_send_identity_inbox_message',
      'agentpay_list_identity_inbox_messages',
      'agentpay_start_identity_phone_verification',
      'agentpay_confirm_identity_phone_verification',
      'agentpay_link_identity_bundles',
      'agentpay_verify_identity_credential',
    ]);
    expect(TOOLS.find((tool) => tool.name === 'agentpay_get_identity_bundle')?.description).toContain('/api/foundation-agents/identity');
    expect(TOOLS.find((tool) => tool.name === 'agentpay_verify_identity_bundle')?.description).toContain('/api/foundation-agents/identity');
    expect(TOOLS.find((tool) => tool.name === 'agentpay_provision_identity_inbox')?.description).toContain('/api/foundation-agents/identity');
    expect(TOOLS.find((tool) => tool.name === 'agentpay_send_identity_inbox_message')?.description).toContain('/api/foundation-agents/identity');
    expect(TOOLS.find((tool) => tool.name === 'agentpay_list_identity_inbox_messages')?.description).toContain('/api/foundation-agents/identity');
    expect(TOOLS.find((tool) => tool.name === 'agentpay_start_identity_phone_verification')?.description).toContain('/api/foundation-agents/identity');
    expect(TOOLS.find((tool) => tool.name === 'agentpay_confirm_identity_phone_verification')?.description).toContain('/api/foundation-agents/identity');
    expect(TOOLS.find((tool) => tool.name === 'agentpay_link_identity_bundles')?.description).toContain('/api/foundation-agents/identity');
    expect(TOOLS.find((tool) => tool.name === 'agentpay_verify_identity_credential')?.description).toContain('/api/foundation-agents/identity');
  });

  it('exposes Stripe funding tools only for the supported /api/payments contract', () => {
    const toolNames = TOOLS.map((tool) => tool.name);

    expect(toolNames).toEqual(expect.arrayContaining([
      'agentpay_buy_api',
      'agentpay_read_authority_bootstrap',
      'agentpay_update_authority_bootstrap',
      'agentpay_get_terminal_control_plane',
      'agentpay_execute_with_workbench_lease',
      'agentpay_list_workbench_leases',
      'agentpay_revoke_workbench_lease',
      'agentpay_execute_with_resume_token',
      'agentpay_scan_for_leaked_secrets',
      'agentpay_create_funding_setup_intent',
      'agentpay_confirm_funding_setup',
      'agentpay_list_funding_methods',
      'agentpay_create_human_funding_request',
      'agentpay_list_capability_providers',
      'agentpay_request_capability_connect',
      'agentpay_get_capability_connect_session',
      'agentpay_list_capabilities',
      'agentpay_get_capability',
      'agentpay_execute_capability',
      'agentpay_get_action_session',
    ]));
    expect(TOOLS.find((tool) => tool.name === 'agentpay_buy_api')?.description).toContain('/api/capabilities/access-resolve');
    expect(TOOLS.find((tool) => tool.name === 'agentpay_execute_with_resume_token')?.description).toContain('/api/capabilities/execution-attempts/:attemptId');
    expect(TOOLS.find((tool) => tool.name === 'agentpay_scan_for_leaked_secrets')?.description).toContain('Never echoes raw secrets');
    expect(TOOLS.find((tool) => tool.name === 'agentpay_create_funding_setup_intent')?.description).toContain('/api/payments/setup-intent');
    expect(TOOLS.find((tool) => tool.name === 'agentpay_confirm_funding_setup')?.description).toContain('/api/payments/confirm-setup');
    expect(TOOLS.find((tool) => tool.name === 'agentpay_list_funding_methods')?.description).toContain('/api/payments/methods/:principalId');
    expect(TOOLS.find((tool) => tool.name === 'agentpay_create_human_funding_request')?.description).toContain('/api/payments/funding-request');
    expect(TOOLS.find((tool) => tool.name === 'agentpay_request_capability_connect')?.description).toContain('/api/capabilities/connect-sessions');
    expect(TOOLS.find((tool) => tool.name === 'agentpay_get_capability_connect_session')?.description).toContain('/api/capabilities/connect-sessions/:sessionId');
    expect(TOOLS.find((tool) => tool.name === 'agentpay_execute_capability')?.description).toContain('/api/capabilities/:capabilityId/execute');
    expect(TOOLS.find((tool) => tool.name === 'agentpay_get_action_session')?.description).toContain('/api/actions/:sessionId');
  });

  it('marks the read-only inventory and safe MCP surface explicitly', async () => {
    expect(READ_ONLY_TOOL_NAMES.has('agentpay_get_merchant_stats')).toBe(true);
    expect(READ_ONLY_TOOL_NAMES.has('agentpay_create_mandate')).toBe(false);
    expect(SAFE_TOOLS.every((tool) => READ_ONLY_TOOL_NAMES.has(tool.name))).toBe(true);
    expect(SAFE_TOOLS.find((tool) => tool.name === 'agentpay_create_mandate')).toBeUndefined();
    expect(TOOLS.find((tool) => tool.name === 'agentpay_get_merchant_stats')).toEqual(
      expect.objectContaining({
        annotations: expect.objectContaining({ readOnlyHint: true }),
      }),
    );

    const server = createAgentPayMcpServer(undefined, { tools: SAFE_TOOLS, serverName: 'agentpay-read-only' });
    const listHandler = (server as any)._requestHandlers.get('tools/list');
    const callHandler = (server as any)._requestHandlers.get('tools/call');

    await expect(listHandler({
      method: 'tools/list',
      params: {},
    })).resolves.toEqual({ tools: SAFE_TOOLS });
    await expect(callHandler({
      method: 'tools/call',
      params: {
        name: 'agentpay_create_mandate',
        arguments: {},
      },
    })).resolves.toEqual(expect.objectContaining({
      isError: true,
      content: [expect.objectContaining({
        text: expect.stringContaining('not available on this AgentPay MCP surface'),
      })],
    }));

    await server.close();
  });

  it('creates and plans mandates through /api/mandates only', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch' as any)
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ intentId: 'mandate_123', status: 'created' }),
      } as any)
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ intentId: 'mandate_123', status: 'planned' }),
      } as any);

    const result = await handleTool('agentpay_create_mandate', {
      principalId: 'principal_1',
      operatorId: 'operator_1',
      objective: 'book a train',
      source: 'delegated_agent',
      constraints: { budgetMax: 120 },
      mandate: { approvalMethod: 'auto_threshold' },
    });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(String(fetchSpy.mock.calls[0][0])).toContain('/api/mandates');
    expect(String(fetchSpy.mock.calls[1][0])).toContain('/api/mandates/mandate_123/plan');
    expect(result.content[0].text).toContain('mandate_123');
    expect(result.content[0].text).toContain('planned');
  });

  it('parses UPI payment requests through /api/payments/upi/parse', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({
        scheme: 'upi',
        payeeVpa: 'merchant@upi',
        payeeName: 'Demo Store',
        amount: '499.00',
        currency: 'INR',
      }),
    } as any);

    await handleTool('agentpay_parse_upi_payment_request', {
      upiUrl: 'upi://pay?pa=merchant@upi&pn=Demo%20Store&am=499.00&cu=INR',
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).toContain('/api/payments/upi/parse');
    expect(fetchSpy.mock.calls[0][1]).toMatchObject({
      method: 'POST',
    });
    expect(JSON.parse(fetchSpy.mock.calls[0][1]?.body as string)).toEqual({
      upiUrl: 'upi://pay?pa=merchant@upi&pn=Demo%20Store&am=499.00&cu=INR',
    });
  });

  it('fetches the identity bundle through /api/foundation-agents/identity with get_identity', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({
        agentId: 'agent_001',
        verified: true,
        trustLevel: 'verified',
      }),
    } as any);

    await handleTool('agentpay_get_identity_bundle', {
      agentId: 'agent_001',
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).toContain('/api/foundation-agents/identity');
    expect(fetchSpy.mock.calls[0][1]).toMatchObject({
      method: 'POST',
    });
    expect(JSON.parse(fetchSpy.mock.calls[0][1]?.body as string)).toEqual({
      action: 'get_identity',
      agentId: 'agent_001',
    });
  });

  it('verifies an identity bundle through /api/foundation-agents/identity with verify', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({
        success: true,
        credential: { credentialId: 'cred_1' },
      }),
    } as any);

    await handleTool('agentpay_verify_identity_bundle', {
      agentId: 'agent_001',
      claimedEnvironment: { platform: 'openai', runtime: 'mcp' },
      proofs: [{ type: 'oauth', value: 'token' }],
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).toContain('/api/foundation-agents/identity');
    expect(JSON.parse(fetchSpy.mock.calls[0][1]?.body as string)).toEqual({
      action: 'verify',
      agentId: 'agent_001',
      claimedEnvironment: { platform: 'openai', runtime: 'mcp' },
      proofs: [{ type: 'oauth', value: 'token' }],
    });
  });

  it('provisions an identity inbox through /api/foundation-agents/identity with provision_inbox', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({
        success: true,
        inbox: { inboxId: 'agent_001@agentmail.test' },
      }),
    } as any);

    await handleTool('agentpay_provision_identity_inbox', {
      agentId: 'agent_001',
      username: 'agent_001',
      displayName: 'Agent One',
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).toContain('/api/foundation-agents/identity');
    expect(JSON.parse(fetchSpy.mock.calls[0][1]?.body as string)).toEqual({
      action: 'provision_inbox',
      agentId: 'agent_001',
      username: 'agent_001',
      displayName: 'Agent One',
    });
  });

  it('sends an inbox message through /api/foundation-agents/identity with send_inbox_message', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({
        success: true,
        message: { messageId: 'msg_1' },
      }),
    } as any);

    await handleTool('agentpay_send_identity_inbox_message', {
      agentId: 'agent_001',
      to: ['traveler@example.com'],
      subject: 'Welcome aboard',
      text: 'Your trip is handled.',
      labels: ['outreach'],
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).toContain('/api/foundation-agents/identity');
    expect(JSON.parse(fetchSpy.mock.calls[0][1]?.body as string)).toEqual({
      action: 'send_inbox_message',
      agentId: 'agent_001',
      to: ['traveler@example.com'],
      subject: 'Welcome aboard',
      text: 'Your trip is handled.',
      labels: ['outreach'],
    });
  });

  it('lists inbox messages through /api/foundation-agents/identity with list_inbox_messages', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({
        success: true,
        messages: [],
      }),
    } as any);

    await handleTool('agentpay_list_identity_inbox_messages', {
      agentId: 'agent_001',
      limit: 10,
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).toContain('/api/foundation-agents/identity');
    expect(JSON.parse(fetchSpy.mock.calls[0][1]?.body as string)).toEqual({
      action: 'list_inbox_messages',
      agentId: 'agent_001',
      limit: 10,
    });
  });

  it('starts phone verification through /api/foundation-agents/identity with start_phone_verification', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({
        success: true,
        verificationId: 'verif_1',
        status: 'pending',
      }),
    } as any);

    await handleTool('agentpay_start_identity_phone_verification', {
      agentId: 'agent_001',
      phone: '+447700900123',
      channel: 'sms',
      principalId: 'principal_001',
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).toContain('/api/foundation-agents/identity');
    expect(JSON.parse(fetchSpy.mock.calls[0][1]?.body as string)).toEqual({
      action: 'start_phone_verification',
      agentId: 'agent_001',
      phone: '+447700900123',
      channel: 'sms',
      principalId: 'principal_001',
    });
  });

  it('confirms phone verification through /api/foundation-agents/identity with confirm_phone_verification', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({
        success: true,
        verified: true,
      }),
    } as any);

    await handleTool('agentpay_confirm_identity_phone_verification', {
      agentId: 'agent_001',
      verificationId: 'verif_1',
      code: '123456',
      phone: '+447700900123',
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).toContain('/api/foundation-agents/identity');
    expect(JSON.parse(fetchSpy.mock.calls[0][1]?.body as string)).toEqual({
      action: 'confirm_phone_verification',
      agentId: 'agent_001',
      challengeId: 'verif_1',
      code: '123456',
      phone: '+447700900123',
    });
  });

  it('creates a funding setup intent through /api/payments/setup-intent', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({
        clientSecret: 'seti_secret_1',
        setupIntentId: 'seti_1',
        customerId: 'cus_1',
      }),
    } as any);

    await handleTool('agentpay_create_funding_setup_intent', {
      principalId: 'principal_001',
      currency: 'GBP',
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).toContain('/api/payments/setup-intent');
    expect(fetchSpy.mock.calls[0][1]).toMatchObject({
      method: 'POST',
    });
    expect(JSON.parse(fetchSpy.mock.calls[0][1]?.body as string)).toEqual({
      principalId: 'principal_001',
      currency: 'GBP',
    });
  });

  it('confirms a funding setup through /api/payments/confirm-setup', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({
        paymentMethodId: 'pm_1',
        setupIntentId: 'seti_1',
        isDefault: true,
      }),
    } as any);

    await handleTool('agentpay_confirm_funding_setup', {
      principalId: 'principal_001',
      setupIntentId: 'seti_1',
      paymentMethodId: 'pm_1',
      setDefault: true,
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).toContain('/api/payments/confirm-setup');
    expect(fetchSpy.mock.calls[0][1]).toMatchObject({
      method: 'POST',
    });
    expect(JSON.parse(fetchSpy.mock.calls[0][1]?.body as string)).toEqual({
      principalId: 'principal_001',
      setupIntentId: 'seti_1',
      paymentMethodId: 'pm_1',
      setDefault: true,
    });
  });

  it('lists saved funding methods through /api/payments/methods/:principalId', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({
        principalId: 'principal_001',
        methods: [],
      }),
    } as any);

    await handleTool('agentpay_list_funding_methods', {
      principalId: 'principal_001',
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).toContain('/api/payments/methods/principal_001');
  });

  it('creates a host-native human funding request through /api/payments/funding-request', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({
        requestId: 'fundreq_1',
        status: 'requires_human_funding',
        nextAction: {
          type: 'funding_required',
        },
      }),
    } as any);

    await handleTool('agentpay_create_human_funding_request', {
      amountInr: 499,
      description: 'Top up this purchase',
      customerPhone: '+919999999999',
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).toContain('/api/payments/funding-request');
    expect(fetchSpy.mock.calls[0][1]).toMatchObject({
      method: 'POST',
    });
    expect(JSON.parse(fetchSpy.mock.calls[0][1]?.body as string)).toEqual({
      rail: 'upi',
      amountInr: 499,
      description: 'Top up this purchase',
      customerPhone: '+919999999999',
    });
  });

  it('defaults to a card funding request when amount and currency are provided', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({
        requestId: 'fundreq_2',
        status: 'requires_human_funding',
        nextAction: {
          type: 'funding_required',
        },
      }),
    } as any);

    await handleTool('agentpay_create_human_funding_request', {
      amount: 49,
      currency: 'GBP',
      description: 'Fund this card-first purchase',
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).toContain('/api/payments/funding-request');
    expect(JSON.parse(fetchSpy.mock.calls[0][1]?.body as string)).toEqual({
      rail: 'card',
      amount: 49,
      currency: 'GBP',
      description: 'Fund this card-first purchase',
    });
  });

  it('requests a secure capability connect session through /api/capabilities/connect-sessions', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({
        status: 'auth_required',
        capabilityId: 'cap_1',
      }),
    } as any);

    await handleTool('agentpay_request_capability_connect', {
      provider: 'firecrawl',
      capabilityKey: 'firecrawl_primary',
      subjectType: 'merchant',
      subjectRef: 'merchant_1',
      baseUrl: 'https://api.firecrawl.dev',
      allowedHosts: ['api.firecrawl.dev'],
      authScheme: 'bearer',
      credentialKind: 'api_key',
      freeCalls: 5,
      paidUnitPriceUsdMicros: 20000,
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).toContain('/api/capabilities/connect-sessions');
    expect(fetchSpy.mock.calls[0][1]).toMatchObject({ method: 'POST' });
    expect(JSON.parse(fetchSpy.mock.calls[0][1]?.body as string)).toEqual({
      provider: 'firecrawl',
      capabilityKey: 'firecrawl_primary',
      subjectType: 'merchant',
      subjectRef: 'merchant_1',
      baseUrl: 'https://api.firecrawl.dev',
      allowedHosts: ['api.firecrawl.dev'],
      authScheme: 'bearer',
      credentialKind: 'api_key',
      freeCalls: 5,
      paidUnitPriceUsdMicros: 20000,
    });
  });

  it('executes governed external capability calls through /api/capabilities/:capabilityId/execute', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({
        status: 'completed',
        capabilityId: 'cap_1',
      }),
    } as any);

    await handleTool('agentpay_execute_capability', {
      capabilityId: 'cap_1',
      method: 'POST',
      path: '/v1/scrape',
      body: { url: 'https://example.com' },
      allowPaidUsage: true,
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).toContain('/api/capabilities/cap_1/execute');
    expect(fetchSpy.mock.calls[0][1]).toMatchObject({ method: 'POST' });
    expect(JSON.parse(fetchSpy.mock.calls[0][1]?.body as string)).toEqual({
      method: 'POST',
      path: '/v1/scrape',
      body: { url: 'https://example.com' },
      allowPaidUsage: true,
    });
  });

  it('buys API access from a capability need and executes the initial call through an opaque lease', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch' as any)
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({
          status: 'ready',
          capability: { id: 'cap_browserbase', provider: 'browserbase' },
          workbenchLease: {
            leaseId: 'lease_1',
            token: 'apcl_lease_token',
            workbenchId: 'ws_1',
            executeEndpoint: '/api/capabilities/lease-execute',
          },
        }),
      } as any)
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({
          status: 'funding_required',
          executionAttempt: {
            attemptId: 'attempt_1',
            statusUrl: 'https://api.agentpay.so/api/capabilities/execution-attempts/attempt_1',
          },
          nextAction: { type: 'funding_required' },
        }),
      } as any);

    const result = await handleTool('agentpay_buy_api', {
      capability: 'web_scraping_high_stealth',
      priority: 'latency',
      subjectRef: 'repo_ws_1',
      principalId: 'principal_1',
      operatorId: 'dev_agent',
      workbenchId: 'ws_1',
      customerPhone: '+447700900123',
      maxBudgetUsd: 0.5,
      initialCall: {
        method: 'POST',
        path: '/v1/sessions',
        body: { projectId: 'proj_1' },
        requestId: 'req_1',
      },
    });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(String(fetchSpy.mock.calls[0][0])).toContain('/api/capabilities/access-resolve');
    expect(JSON.parse(fetchSpy.mock.calls[0][1]?.body as string)).toMatchObject({
      capability: 'web_scraping_high_stealth',
      provider: 'browserbase',
      subjectType: 'workspace',
      subjectRef: 'repo_ws_1',
      issueWorkbenchLease: true,
      notificationChannel: 'phone',
    });
    expect(String(fetchSpy.mock.calls[1][0])).toContain('/api/capabilities/lease-execute');
    expect(JSON.parse(fetchSpy.mock.calls[1][1]?.body as string)).toMatchObject({
      leaseToken: 'apcl_lease_token',
      workbenchId: 'ws_1',
      path: '/v1/sessions',
      principalId: 'principal_1',
      customerPhone: '+447700900123',
    });
    expect(result.content[0].text).toContain('capresume_attempt_1');
    expect(result.content[0].text).not.toContain('sk_live');
  });

  it('returns setup resume tokens when buy-api needs human provider auth', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({
        status: 'auth_required',
        actionSession: {
          sessionId: 'action_setup_1',
          status: 'pending',
        },
        nextAction: {
          type: 'auth_required',
          displayPayload: {
            onboardingUrl: 'https://api.agentpay.so/api/capabilities/onboarding-sessions/action_setup_1/hosted',
          },
        },
      }),
    } as any);

    const result = await handleTool('agentpay_buy_api', {
      capability: 'market_data',
      subjectRef: 'quant_ws_1',
      principalId: 'principal_1',
      workbenchId: 'quant_ws_1',
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).toContain('/api/capabilities/access-resolve');
    expect(JSON.parse(fetchSpy.mock.calls[0][1]?.body as string)).toMatchObject({
      provider: 'databento',
      subjectRef: 'quant_ws_1',
    });
    expect(result.content[0].text).toContain('apsetup_action_setup_1');
    expect(result.content[0].text).toContain('agentpay_execute_with_resume_token');
  });

  it('checks resumable exact-call execution attempts with capresume tokens', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({
        attempt: { id: 'attempt_1', status: 'completed' },
        resultOrNextAction: { status: 'completed', proof: { resumedServerSide: true } },
      }),
    } as any);

    const result = await handleTool('agentpay_execute_with_resume_token', {
      resumeToken: 'capresume_attempt_1',
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).toContain('/api/capabilities/execution-attempts/attempt_1');
    expect(result.content[0].text).toContain('resumedServerSide');
  });

  it('detects leaked secrets without returning raw key material to the agent', async () => {
    const openAiKey = `sk-proj-${'a'.repeat(30)}`;
    const anthropicKey = `sk-ant-api03-${'b'.repeat(30)}`;
    const stripeMasterKey = `sk_live_${'c'.repeat(24)}`;

    const result = await handleTool('agentpay_scan_for_leaked_secrets', {
      text: `The user pasted ${openAiKey}, ${anthropicKey}, and ${stripeMasterKey} into chat.`,
      source: 'unit_test_chat',
    });

    const output = result.content[0].text;
    expect(output).toContain('leak_detected');
    expect(output).toContain('openai');
    expect(output).toContain('anthropic');
    expect(output).toContain('kill_agent_session');
    expect(output).toContain('stripe_live_master_key');
    expect(output).toContain('rawSecretsReturned');
    expect(output).not.toContain(openAiKey);
    expect(output).not.toContain(anthropicKey);
    expect(output).not.toContain(stripeMasterKey);
  });

  it('can start Leak Guard vaulting for detected leaked keys without echoing them in the result', async () => {
    const openAiKey = `sk-proj-${'c'.repeat(30)}`;
    const fetchSpy = jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({
        status: 'leak_detected',
        action: 'scrubbed_and_queued_for_rotation',
        vaultSession: {
          session_id: 'lgr_1',
          providers: ['openai'],
          resumeToken: 'apsetup_lgr_1',
        },
        rawSecretsReturned: false,
      }),
    } as any);

    const result = await handleTool('agentpay_scan_for_leaked_secrets', {
      text: `bad paste: ${openAiKey}`,
      autoVault: true,
      subjectRef: 'workspace_1',
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).toContain('/api/capabilities/leak-guard/events');
    const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
    expect(body).toMatchObject({
      mode: 'vault',
      subjectRef: 'workspace_1',
    });
    expect(body.text).toBe(openAiKey.startsWith('sk-proj-') ? `bad paste: ${openAiKey}` : body.text);
    expect(result.content[0].text).toContain('lgr_1');
    expect(result.content[0].text).not.toContain(openAiKey);
  });

  it('fetches a capability connect session through /api/capabilities/connect-sessions/:sessionId', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({
        session: { id: 'connect_1', status: 'pending' },
      }),
    } as any);

    await handleTool('agentpay_get_capability_connect_session', {
      sessionId: 'connect_1',
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).toContain('/api/capabilities/connect-sessions/connect_1');
  });

  it('fetches a hosted action session through /api/actions/:sessionId', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({
        sessionId: 'action_1',
        status: 'pending',
      }),
    } as any);

    await handleTool('agentpay_get_action_session', {
      sessionId: 'action_1',
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).toContain('/api/actions/action_1');
  });

  it('uses request-scoped MCP auth when a runtime apiKey is injected', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({
        principalId: 'principal_001',
        methods: [],
      }),
    } as any);

    await handleTool(
      'agentpay_list_funding_methods',
      { principalId: 'principal_001' },
      {
        apiUrl: 'https://runtime.agentpay.test',
        apiKey: 'apmcp_v1.test.token',
      },
    );

    expect(String(fetchSpy.mock.calls[0][0])).toContain('https://runtime.agentpay.test/api/payments/methods/principal_001');
    expect(fetchSpy.mock.calls[0][1]?.headers).toMatchObject({
      Authorization: 'Bearer apmcp_v1.test.token',
    });
  });

  it('links identity bundles through /api/foundation-agents/identity with link', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({
        success: true,
        link: { linkId: 'link_1' },
      }),
    } as any);

    await handleTool('agentpay_link_identity_bundles', {
      primaryAgentId: 'agent_001',
      linkedAgentIds: ['agent_002', 'agent_003'],
      proofs: [{ type: 'signature', value: 'proof' }],
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).toContain('/api/foundation-agents/identity');
    expect(JSON.parse(fetchSpy.mock.calls[0][1]?.body as string)).toEqual({
      action: 'link',
      primaryAgentId: 'agent_001',
      linkedAgentIds: ['agent_002', 'agent_003'],
      proofs: [{ type: 'signature', value: 'proof' }],
    });
  });

  it('verifies an issued identity credential through /api/foundation-agents/identity with verify_credential', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({
        valid: true,
        reason: null,
      }),
    } as any);

    await handleTool('agentpay_verify_identity_credential', {
      credentialId: 'cred_1',
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).toContain('/api/foundation-agents/identity');
    expect(JSON.parse(fetchSpy.mock.calls[0][1]?.body as string)).toEqual({
      action: 'verify_credential',
      credentialId: 'cred_1',
    });
  });

  it('approves mandates through /api/mandates with token and device metadata', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ status: 'approved' }),
    } as any);

    await handleTool('agentpay_approve_mandate', {
      intentId: 'mandate_456',
      approvalToken: 'approval_tok_1',
      deviceId: 'device_1',
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).toContain('/api/mandates/mandate_456/approve');
    expect(fetchSpy.mock.calls[0][1]).toMatchObject({
      method: 'POST',
    });
    expect(JSON.parse(fetchSpy.mock.calls[0][1]?.body as string)).toEqual({
      approvalToken: 'approval_tok_1',
      deviceId: 'device_1',
    });
  });

  it('executes mandates through /api/mandates with execution metadata', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ status: 'executing' }),
    } as any);

    await handleTool('agentpay_execute_mandate', {
      intentId: 'mandate_789',
      jobId: 'job_1',
      actorId: 'agent_1',
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).toContain('/api/mandates/mandate_789/execute');
    expect(fetchSpy.mock.calls[0][1]).toMatchObject({
      method: 'POST',
    });
    expect(JSON.parse(fetchSpy.mock.calls[0][1]?.body as string)).toEqual({
      jobId: 'job_1',
      actorId: 'agent_1',
    });
  });

  it('fetches mandate history through /api/mandates history endpoint', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ intentId: 'mandate_321', events: [] }),
    } as any);

    await handleTool('agentpay_get_mandate_history', {
      intentId: 'mandate_321',
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).toContain('/api/mandates/mandate_321/history');
  });

  it('cancels mandates through /api/mandates with cancellation metadata', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ status: 'cancelled' }),
    } as any);

    await handleTool('agentpay_cancel_mandate', {
      intentId: 'mandate_900',
      actorId: 'principal_1',
      reason: 'User revoked authority',
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).toContain('/api/mandates/mandate_900/cancel');
    expect(fetchSpy.mock.calls[0][1]).toMatchObject({
      method: 'POST',
    });
    expect(JSON.parse(fetchSpy.mock.calls[0][1]?.body as string)).toEqual({
      actorId: 'principal_1',
      reason: 'User revoked authority',
    });
  });
});
