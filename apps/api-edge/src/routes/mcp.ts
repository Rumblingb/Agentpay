import { Hono } from 'hono';
import type { Context } from 'hono';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { Env, Variables } from '../types';
import { authenticateApiKey } from '../middleware/auth';
import { isMcpAccessToken, mintMcpAccessToken } from '../lib/mcpAccessTokens';
import {
  getHostedMcpPublicPricing,
  recordMcpUsageEvent,
} from '../lib/mcpBilling';
import {
  buildHostedMcpInvoiceSummary,
  createHostedMcpInvoiceCheckout,
} from '../lib/mcpInvoices';
import { recordProductSignalEvent } from '../lib/productSignals';
import { TOOLS, createAgentPayMcpServer } from '../../../../packages/mcp-server/src/index';

const router = new Hono<{ Bindings: Env; Variables: Variables }>();

function getPresentedToken(rawHeader?: string | null): string {
  if (!rawHeader) return '';
  if (rawHeader.startsWith('Bearer ')) return rawHeader.slice(7);
  if (rawHeader.startsWith('Bearer')) return rawHeader.slice(6).trim();
  return rawHeader;
}

type InspectedMcpRequest = {
  requestId: string | null;
  transportMethod: string | null;
  toolName: string | null;
};

async function inspectIncomingMcpRequest(request: Request): Promise<InspectedMcpRequest> {
  try {
    const body = await request.clone().json() as Record<string, unknown>;
    const id = body.id;
    const transportMethod = typeof body.method === 'string' ? body.method : null;
    const params = body.params as Record<string, unknown> | undefined;
    return {
      requestId: typeof id === 'string' || typeof id === 'number' ? String(id) : null,
      transportMethod,
      toolName: transportMethod === 'tools/call' && typeof params?.name === 'string'
        ? params.name
        : null,
    };
  } catch {
    return {
      requestId: null,
      transportMethod: null,
      toolName: null,
    };
  }
}

function scheduleBackground(
  c: Context<{ Bindings: Env; Variables: Variables }>,
  promise: Promise<unknown>,
) {
  if (typeof c.executionCtx?.waitUntil === 'function') {
    c.executionCtx.waitUntil(promise);
    return;
  }
  void promise.catch(() => {});
}

function buildMcpPricingPayload(env: Env) {
  return {
    ...getHostedMcpPublicPricing(),
    currentInvoiceEndpoint: new URL('/api/mcp/billing/current', env.API_BASE_URL).toString(),
    checkoutEndpoint: new URL('/api/mcp/billing/checkout', env.API_BASE_URL).toString(),
    setupEndpoint: new URL('/api/mcp/setup', env.API_BASE_URL).toString(),
    demoEndpoint: new URL('/api/mcp/demo', env.API_BASE_URL).toString(),
  };
}

function buildMcpSetupPayload(env: Env) {
  const endpoint = new URL('/api/mcp', env.API_BASE_URL).toString();
  const tokenEndpoint = new URL('/api/mcp/tokens', env.API_BASE_URL).toString();
  const protectedResourceMetadataUrl = new URL('/.well-known/oauth-protected-resource/api/mcp', env.API_BASE_URL).toString();
  const authorizationServerMetadataUrl = new URL('/.well-known/oauth-authorization-server', env.API_BASE_URL).toString();
  const authorizeEndpoint = new URL('/authorize', env.API_BASE_URL).toString();
  const oauthTokenEndpoint = new URL('/token', env.API_BASE_URL).toString();
  const registrationEndpoint = new URL('/register', env.API_BASE_URL).toString();
  const pricingEndpoint = new URL('/api/mcp/pricing', env.API_BASE_URL).toString();
  const demoEndpoint = new URL('/api/mcp/demo', env.API_BASE_URL).toString();
  const anthropicGuide = new URL('/docs/ANTHROPIC_CUSTOM_CONNECTOR_SETUP', env.FRONTEND_URL).toString();
  const openaiGuide = new URL('/docs/OPENAI_HOST_SETUP', env.FRONTEND_URL).toString();
  const genericGuide = new URL('/docs/GENERIC_AGENT_SETUP', env.FRONTEND_URL).toString();
  return {
    title: 'AgentPay host-native setup',
    runtime: 'remote-mcp',
    endpoint,
    tokenEndpoint,
    auth: {
      preferred: 'oauth_discovery',
      fallback: 'minted_bearer_token',
      protectedResourceMetadataUrl,
      authorizationServerMetadataUrl,
      authorizeEndpoint,
      tokenEndpoint: oauthTokenEndpoint,
      registrationEndpoint,
      preferredHumanStep: 'email_link',
      fallbackHumanStep: 'agentpay_email_plus_api_key',
    },
    pricingEndpoint,
    demoEndpoint,
    dashboardRole: 'admin_recovery_policy_only',
    hosts: [
      {
        host: 'openai',
        status: 'api_ready_workspace_manual',
        surfaces: ['remote_mcp', 'connector_surfaces', 'developer_mode'],
        guideUrl: openaiGuide,
        directoryVisibility: {
          availableNow: 'workspace_custom_app',
          requiresSubmission: 'public_chatgpt_app_directory',
        },
        setup: [
          'Add the /api/mcp endpoint as a remote MCP server.',
          'If the host supports MCP OAuth discovery, use AgentPay OAuth metadata and the hosted authorize flow.',
          'Prefer the no-key email-link path on the authorize screen.',
          'Otherwise mint a short-lived MCP token with POST /api/mcp/tokens using a long-lived AgentPay API key.',
          'Run one mandate or funding flow and keep any human step in-host through next_action.',
        ],
        manualConsoleSteps: [
          'Open ChatGPT workspace admin or developer mode app setup.',
          'Create a custom app or connector entry for AgentPay.',
          'Use the discovered OAuth flow if ChatGPT honors it; otherwise use the remote MCP endpoint and a short-lived MCP bearer token for founder testing.',
          'Package and submit an app for broader directory discovery once the setup path is stable.',
        ],
        currentLimits: [
          'The OpenAI API path is ready now.',
          'The no-key email-link path now exists on the hosted authorize screen.',
          'API key entry remains as fallback for environments without email delivery.',
        ],
      },
      {
        host: 'anthropic',
        status: 'ready_now_manual_connector',
        surfaces: ['remote_mcp', 'custom_connectors'],
        guideUrl: anthropicGuide,
        directoryVisibility: {
          availableNow: 'custom_connector',
          requiresSubmission: 'anthropic_mcp_directory',
        },
        setup: [
          'Configure AgentPay as a remote MCP server at /api/mcp.',
          'If Claude honors MCP OAuth discovery, use the hosted authorize flow.',
          'Prefer the no-key email-link path on the authorize screen.',
          'Otherwise mint a short-lived MCP token with POST /api/mcp/tokens using a long-lived AgentPay API key.',
          'Use the same next_action contract for approvals, auth, funding, and recovery.',
        ],
        manualConsoleSteps: [
          'Open Claude custom connectors.',
          'Add AgentPay as a remote MCP connector with the hosted endpoint.',
          'Use the hosted OAuth step if Claude surfaces it; otherwise paste the short-lived MCP token for founder testing.',
          'Submit the connector to Anthropic directory review after founder validation.',
        ],
        currentLimits: [
          'Anthropic is the cleanest immediate host path for AgentPay today.',
          'Directory presence still requires manual submission and review.',
        ],
      },
      {
        host: 'generic',
        status: 'ready_now_manual_mcp',
        surfaces: ['mcp_clients', 'open_source_agents', 'self_hosted_runtimes'],
        guideUrl: genericGuide,
        directoryVisibility: {
          availableNow: 'manual_mcp_configuration',
          requiresSubmission: 'none',
        },
        setup: [
          'Add the /api/mcp endpoint to any MCP-capable runtime or agent framework.',
          'Prefer discovered MCP OAuth when the runtime supports it.',
          'Use the no-key email-link path on the authorize screen when a human must connect authority.',
          'Otherwise mint a short-lived MCP token with POST /api/mcp/tokens using a long-lived AgentPay API key.',
          'Use the same result_or_next_action contract for approvals, funding, auth, verification, and completion.',
        ],
        manualConsoleSteps: [
          'Open the MCP or tools configuration for the target agent runtime.',
          'Add AgentPay as a streamable HTTP MCP server with the hosted endpoint.',
          'Pass the short-lived MCP token as a bearer credential for founder testing.',
          'Package the same configuration as a reusable skill, preset, or runtime adapter for your target agent stack.',
        ],
        currentLimits: [
          'This works now for MCP-capable open-source and self-hosted agents.',
          'Non-MCP runtimes still need an adapter layer or SDK wrapper.',
        ],
      },
    ],
    nextActionContract: {
      responsePattern: 'result_or_next_action',
      nextActionTypes: [
        'approval_required',
        'funding_required',
        'auth_required',
        'verification_required',
        'confirmation_required',
        'completed',
      ],
      principle: 'Keep the human inside the host whenever possible. The dashboard is optional and only for admin or recovery.',
    },
    billing: buildMcpPricingPayload(env),
  };
}

function buildMcpDemoPayload(env: Env) {
  return {
    title: 'AgentPay host-native demo flow',
    outcome: 'Create authority once, complete a paid action, and return proof without dashboard runtime.',
    prerequisites: [
      'A merchant API key for AgentPay',
      'A host that can call remote MCP tools',
      'One principal or human owner who can approve or fund a step if required',
    ],
    steps: [
      {
        step: 1,
        action: 'Mint a short-lived remote MCP token',
        endpoint: new URL('/api/mcp/tokens', env.API_BASE_URL).toString(),
        method: 'POST',
        payload: {
          audience: 'anthropic',
          ttlSeconds: 1800,
        },
      },
      {
        step: 2,
        action: 'Connect the host to AgentPay remote MCP',
        endpoint: new URL('/api/mcp', env.API_BASE_URL).toString(),
        tools: [
          'agentpay_create_mandate',
          'agentpay_create_human_funding_request',
          'agentpay_get_mandate_history',
          'agentpay_list_funding_methods',
        ],
      },
      {
        step: 3,
        action: 'Create a governed mandate',
        tool: 'agentpay_create_mandate',
        arguments: {
          principalId: 'principal_demo',
          operatorId: 'agent_demo',
          objective: 'Fund and complete a governed external action',
          source: 'delegated_agent',
          mandate: {
            approvalMethod: 'auto_threshold',
          },
        },
      },
      {
        step: 4,
        action: 'If funding is required, create a host-native human funding request',
        tool: 'agentpay_create_human_funding_request',
        arguments: {
          amountInr: 499,
          description: 'Top up this governed action',
        },
        expectedResponse: 'next_action.type = funding_required',
      },
      {
        step: 5,
        action: 'Resume execution after the human step and return proof',
        tools: [
          'agentpay_execute_mandate',
          'agentpay_get_mandate_history',
          'agentpay_get_receipt',
        ],
      },
    ],
  };
}

router.get('/pricing', (c) => c.json(buildMcpPricingPayload(c.env)));

router.get('/setup', (c) => c.json(buildMcpSetupPayload(c.env)));

router.get('/demo', (c) => c.json(buildMcpDemoPayload(c.env)));

router.get('/info', (c) => {
  const endpoint = new URL('/api/mcp', c.env.API_BASE_URL).toString();
  const tokenEndpoint = new URL('/api/mcp/tokens', c.env.API_BASE_URL).toString();
  const protectedResourceMetadataUrl = new URL('/.well-known/oauth-protected-resource/api/mcp', c.env.API_BASE_URL).toString();
  const authorizationServerMetadataUrl = new URL('/.well-known/oauth-authorization-server', c.env.API_BASE_URL).toString();
  const authorizeEndpoint = new URL('/authorize', c.env.API_BASE_URL).toString();
  const oauthTokenEndpoint = new URL('/token', c.env.API_BASE_URL).toString();
  const registrationEndpoint = new URL('/register', c.env.API_BASE_URL).toString();
  const pricingUrl = new URL('/pricing', c.env.FRONTEND_URL).toString();

  return c.json({
    name: 'agentpay',
    version: '0.1.0',
    endpoint,
    transport: 'streamable-http',
    runtime: 'remote-mcp',
    auth: {
      type: 'oauth_or_bearer',
      bearer: {
        header: 'Authorization',
        scheme: 'Bearer',
        note: 'Fallback path: use an AgentPay API key directly, or mint a short-lived remote MCP token from the token endpoint.',
        tokenEndpoint,
      },
      oauth: {
        protectedResourceMetadataUrl,
        authorizationServerMetadataUrl,
        authorizeEndpoint,
        tokenEndpoint: oauthTokenEndpoint,
        registrationEndpoint,
        pkceRequired: true,
        preferredHumanStep: 'email_link',
        fallbackHumanStep: 'agentpay_email_plus_api_key',
      },
    },
    links: {
      pricingEndpoint: new URL('/api/mcp/pricing', c.env.API_BASE_URL).toString(),
      setupEndpoint: new URL('/api/mcp/setup', c.env.API_BASE_URL).toString(),
      demoEndpoint: new URL('/api/mcp/demo', c.env.API_BASE_URL).toString(),
    },
    hostCompatibility: {
      openai: 'remote_mcp',
      anthropic: 'remote_mcp',
      generic: 'remote_mcp',
    },
    toolCount: TOOLS.length,
    toolFamilies: [
      'payments',
      'mandates',
      'identity',
      'funding',
      'capabilities',
      'actions',
      'passport',
      'discovery',
    ],
    actionModel: {
      responsePattern: 'result_or_next_action',
      preferredHumanSurface: 'host_native',
      fallbackSurface: 'short_lived_secure_step',
      nextActionTypes: [
        'approval_required',
        'funding_required',
        'auth_required',
        'verification_required',
        'confirmation_required',
        'completed',
      ],
    },
    billing: {
      ...buildMcpPricingPayload(c.env),
      pricingUrl,
    },
  });
});

router.get('/health', (c) => c.json({
  status: 'ok',
  runtime: 'remote-mcp',
  endpoint: new URL('/api/mcp', c.env.API_BASE_URL).toString(),
  transport: 'streamable-http',
  auth: 'oauth_or_bearer',
  toolCount: TOOLS.length,
}));

router.get('/', (c) => c.json({
  name: 'agentpay',
  runtime: 'remote-mcp',
  transport: 'streamable-http',
  endpoint: new URL('/api/mcp', c.env.API_BASE_URL).toString(),
  infoEndpoint: new URL('/api/mcp/info', c.env.API_BASE_URL).toString(),
  healthEndpoint: new URL('/api/mcp/health', c.env.API_BASE_URL).toString(),
  auth: {
    type: 'oauth_or_bearer',
    tokenEndpoint: new URL('/api/mcp/tokens', c.env.API_BASE_URL).toString(),
    protectedResourceMetadataUrl: new URL('/.well-known/oauth-protected-resource/api/mcp', c.env.API_BASE_URL).toString(),
    authorizationServerMetadataUrl: new URL('/.well-known/oauth-authorization-server', c.env.API_BASE_URL).toString(),
    note: 'POST JSON-RPC requests to this endpoint with Authorization bearer auth, or let the host discover AgentPay MCP OAuth.',
  },
  status: 'auth_required_for_transport',
}));

router.on('HEAD', '/', (c) => new Response(null, {
  status: 200,
  headers: {
    'x-agentpay-runtime': 'remote-mcp',
    'x-agentpay-auth': 'bearer',
  },
}));

router.get('/billing/current', authenticateApiKey, async (c) => {
  const merchant = c.get('merchant');
  const presentedToken = getPresentedToken(c.req.header('authorization') ?? c.req.header('x-api-key'));
  const audience = c.get('mcpAudience') ?? 'generic';
  const authType = isMcpAccessToken(presentedToken) ? 'mcp_token' : 'api_key';
  const summary = await buildHostedMcpInvoiceSummary(c.env, merchant);

  scheduleBackground(c, recordProductSignalEvent(c.env, {
    merchantId: merchant.id,
    audience,
    authType,
    surface: 'billing',
    signalType: 'hosted_mcp_invoice_viewed',
    entityType: 'merchant',
    entityId: merchant.id,
    estimatedRevenueMicros: Math.max(Math.round(summary.outstandingUsd * 1_000_000), 0),
    metadata: {
      planCode: summary.planCode,
      outstandingUsd: summary.outstandingUsd,
    },
  }));

  return c.json({
    ...summary,
    payable: summary.outstandingUsd > 0,
    collection: {
      method: 'stripe_checkout',
      available: Boolean(c.env.STRIPE_SECRET_KEY) && summary.outstandingUsd > 0,
    },
  });
});

router.post('/billing/checkout', authenticateApiKey, async (c) => {
  const merchant = c.get('merchant');
  const presentedToken = getPresentedToken(c.req.header('authorization') ?? c.req.header('x-api-key'));
  const audience = c.get('mcpAudience') ?? 'generic';
  const authType = isMcpAccessToken(presentedToken) ? 'mcp_token' : 'api_key';
  const summary = await buildHostedMcpInvoiceSummary(c.env, merchant);

  if (summary.outstandingUsd <= 0) {
    return c.json({
      ...summary,
      payable: false,
      message: 'No hosted MCP charges are currently outstanding.',
    });
  }

  try {
    const checkout = await createHostedMcpInvoiceCheckout(c.env, merchant, summary, {
      audience,
      authType,
    });
    if (!checkout) {
      return c.json({ error: 'Hosted MCP checkout is not configured on this deployment' }, 503);
    }

    scheduleBackground(c, recordProductSignalEvent(c.env, {
      merchantId: merchant.id,
      audience,
      authType,
      surface: 'billing',
      signalType: 'hosted_mcp_checkout_created',
      status: 'pending',
      entityType: 'merchant_invoice',
      entityId: checkout.invoiceId,
      estimatedRevenueMicros: Math.max(Math.round(summary.outstandingUsd * 1_000_000), 0),
      metadata: {
        checkoutSessionId: checkout.checkoutSessionId,
        planCode: summary.planCode,
      },
    }));

    return c.json({
      ...summary,
      payable: true,
      invoiceId: checkout.invoiceId,
      checkoutUrl: checkout.checkoutUrl,
      checkoutSessionId: checkout.checkoutSessionId,
    }, 201);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[mcp] billing checkout error:', msg);
    return c.json({ error: 'Failed to create hosted MCP checkout session' }, 500);
  }
});

router.post('/tokens', authenticateApiKey, async (c) => {
  const merchant = c.get('merchant');
  const signingSecret = c.env.AGENTPAY_SIGNING_SECRET;
  const presentedToken = getPresentedToken(c.req.header('authorization') ?? c.req.header('x-api-key'));

  if (!signingSecret || !presentedToken) {
    return c.json({ error: 'MCP token minting is unavailable' }, 503);
  }
  if (isMcpAccessToken(presentedToken)) {
    return c.json({ error: 'Present a long-lived AgentPay API key to mint a fresh MCP token' }, 400);
  }

  let body: Record<string, unknown> = {};
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }

  const audience = body.audience === 'openai' || body.audience === 'anthropic'
    ? body.audience
    : 'generic';
  const ttlSeconds = typeof body.ttlSeconds === 'number' ? body.ttlSeconds : undefined;

  const minted = await mintMcpAccessToken({
    merchant,
    apiKey: presentedToken,
    signingSecret,
    ttlSeconds,
    audience,
  });

  const response = c.json({
    tokenType: 'Bearer',
    accessToken: minted.accessToken,
    expiresAt: minted.expiresAt,
    endpoint: new URL('/api/mcp', c.env.API_BASE_URL).toString(),
    audience: minted.claims.audience,
    scope: minted.claims.scope,
    billing: {
      pricingVersion: getHostedMcpPublicPricing().pricingVersion,
      defaultPlan: getHostedMcpPublicPricing().defaultPlan,
    },
  });

  scheduleBackground(c, recordMcpUsageEvent(c.env, {
    merchant,
    audience,
    authType: 'api_key',
    eventType: 'token_mint',
    metadata: {
      ttlSeconds: ttlSeconds ?? null,
    },
  }));
  scheduleBackground(c, recordProductSignalEvent(c.env, {
    merchantId: merchant.id,
    audience,
    authType: 'api_key',
    surface: 'mcp',
    signalType: 'mcp_token_minted',
    status: 'ok',
    entityType: 'merchant',
    entityId: merchant.id,
    metadata: {
      ttlSeconds: ttlSeconds ?? null,
    },
  }));

  return response;
});

router.post('/', authenticateApiKey, async (c) => {
  const merchant = c.get('merchant');
  const presentedToken = getPresentedToken(c.req.header('authorization') ?? c.req.header('x-api-key'));
  const audience = c.get('mcpAudience') ?? 'generic';
  const authType = isMcpAccessToken(presentedToken) ? 'mcp_token' : 'api_key';
  const headers = new Headers(c.req.raw.headers);
  if (!headers.has('accept')) {
    headers.set('accept', 'application/json, text/event-stream');
  }
  const request = new Request(c.req.raw, { headers });
  const inspected = await inspectIncomingMcpRequest(request);
  const server = createAgentPayMcpServer({
    apiUrl: c.env.API_BASE_URL,
    apiKey: presentedToken,
    onToolResult: async ({ toolName, data }) => {
      if (typeof data !== 'object' || !data || Array.isArray(data)) return;
      const nextAction = (data as Record<string, unknown>).nextAction;
      if (typeof nextAction !== 'object' || !nextAction || Array.isArray(nextAction)) return;
      if (typeof (nextAction as Record<string, unknown>).type !== 'string') return;

      await recordProductSignalEvent(c.env, {
        merchantId: merchant.id,
        audience,
        authType,
        surface: 'mcp',
        signalType: 'mcp_next_action_returned',
        status: 'requires_human_step',
        requestId: inspected.requestId,
        entityType: 'tool',
        entityId: toolName,
        metadata: {
          nextActionType: (nextAction as Record<string, unknown>).type,
          sessionId: (nextAction as Record<string, unknown>).sessionId ?? null,
        },
      });
    },
  });
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  await server.connect(transport);

  try {
    const response = await transport.handleRequest(request);
    const eventType = inspected.transportMethod === 'tools/call'
      ? 'tool_call'
      : inspected.transportMethod === 'tools/list'
        ? 'tools_list'
        : 'transport_request';

    scheduleBackground(c, recordMcpUsageEvent(c.env, {
      merchant,
      audience,
      authType,
      eventType,
      requestId: inspected.requestId,
      toolName: inspected.toolName,
      statusCode: response.status,
      metadata: {
        transportMethod: inspected.transportMethod,
      },
    }));
    scheduleBackground(c, recordProductSignalEvent(c.env, {
      merchantId: merchant.id,
      audience,
      authType,
      surface: 'mcp',
      signalType: eventType === 'tool_call'
        ? 'mcp_tool_call_completed'
        : eventType === 'tools_list'
          ? 'mcp_tools_list_completed'
          : 'mcp_transport_request_completed',
      status: response.status >= 200 && response.status < 400 ? 'ok' : 'error',
      requestId: inspected.requestId,
      entityType: inspected.toolName ? 'tool' : null,
      entityId: inspected.toolName,
      metadata: {
        transportMethod: inspected.transportMethod,
      },
    }));

    return response;
  } finally {
    const closePromise = server.close().catch(() => {});
    if (typeof c.executionCtx?.waitUntil === 'function') {
      c.executionCtx.waitUntil(closePromise);
    } else {
      await closePromise;
    }
  }
});

export { router as mcpRouter };
