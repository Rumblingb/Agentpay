/**
 * Registry MCP tools — 10 tools for the agent-first MCP marketplace.
 * Supports both http and stdio transports.
 */

import type { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { AgentPayMcpRuntime } from './index.js';

const REGISTRY_BASE = '/api/registry';

export const REGISTRY_READ_ONLY_TOOL_NAMES = [
  'registry_search',
  'registry_server_info',
  'registry_installed',
  'registry_usage',
  'registry_payouts',
  'agentpay_choose_requirement',
  'agentpay_list_repo_leases',
] as const;

function json(data: unknown): CallToolResult {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

async function registryFetch(
  path: string,
  options: RequestInit,
  runtime: { apiUrl: string; apiKey: string; fetchImpl: typeof fetch },
): Promise<unknown> {
  const url = `${runtime.apiUrl}${path}`;
  const res = await runtime.fetchImpl(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(runtime.apiKey ? { Authorization: `Bearer ${runtime.apiKey}` } : {}),
      ...(options.headers ?? {}),
    },
  });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

export const REGISTRY_TOOLS: Tool[] = [
  {
    name: 'agentpay_choose_requirement',
    description:
      'Decide how an agent should satisfy a user requirement using the AgentPay agent-only marketplace. ' +
      'Searches MCP servers, agent providers, and governed capability paths, then returns the safest next step. ' +
      'Humans should be interrupted only for payment, repo selection, credential connection, or policy exceptions.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        userGoal: { type: 'string', description: 'Natural-language requirement from the user or agent plan.' },
        capability: { type: 'string', description: 'Optional capability hint such as search, code, data, finance, browser, or travel.' },
        maxMonthlyUsd: { type: 'number', description: 'Maximum recurring monthly budget in USD.' },
        maxPerActionUsd: { type: 'number', description: 'Maximum single-action budget in USD.' },
        preferredTransport: { type: 'string', enum: ['http', 'stdio'], description: 'Preferred MCP transport when a server is needed.' },
        requiresRepoAccess: { type: 'boolean', description: 'Set true when the task needs access to a code repository.' },
        principalId: { type: 'string', description: 'Optional human principal who owns payment/repo authority.' },
        operatorId: { type: 'string', description: 'Optional agent or operator requesting the choice.' },
      },
      required: ['userGoal'],
    },
    annotations: { readOnlyHint: true },
  },

  {
    name: 'registry_search',
    description:
      'Search the AgentPay MCP server marketplace. Returns available servers with pricing, transport type (http/stdio), and install counts.\n\n' +
      'Free servers: subscribe and use immediately, no TOTP needed.\n' +
      'Paid servers: require TOTP (call registry_enroll first).\n\n' +
      'After finding a server: call registry_subscribe, then registry_server_info for harness config.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        q: { type: 'string', description: 'Search across name, description, category' },
        category: { type: 'string', description: 'Filter by category (search, utilities, finance, data, payments, agents, etc.)' },
        transport: { type: 'string', enum: ['http', 'stdio'], description: 'Filter by transport type' },
        limit: { type: 'number', description: 'Results per page (default 20, max 100)' },
        offset: { type: 'number', description: 'Pagination offset' },
        featured: { type: 'boolean', description: 'Featured/curated servers only' },
      },
      required: [],
    },
    annotations: { readOnlyHint: true },
  },

  {
    name: 'agentpay_request_repo_access',
    description:
      'Request human repository selection for an agent task. Returns a nextAction with a hosted approval step. ' +
      'No repo lease, provider token, or write access is granted by this call.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        principalId: { type: 'string', description: 'Human principal who owns repository authority.' },
        operatorId: { type: 'string', description: 'Agent or operator requesting access.' },
        provider: { type: 'string', enum: ['github', 'gitlab'], description: 'Repository provider. Defaults to github.' },
        purpose: { type: 'string', description: 'Task-specific reason shown to the human.' },
        requestedRepos: { type: 'array', items: { type: 'string' }, description: 'Optional owner/repo candidates.' },
        requestedOperations: {
          type: 'array',
          items: { type: 'string', enum: ['read', 'contents_write', 'pull_request', 'issues', 'actions'] },
          description: 'Least-privilege operations requested for the task.',
        },
        resumeUrl: { type: 'string', description: 'Optional HTTPS/localhost return URL after human approval.' },
      },
      required: ['principalId', 'purpose'],
    },
  },

  {
    name: 'agentpay_list_repo_leases',
    description:
      'List scoped repository authority leases for this merchant. Read-only; leases contain repo names and approved operations, never provider tokens.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        status: { type: 'string', enum: ['active', 'revoked', 'all'], description: 'Lease status filter. Defaults to active.' },
      },
      required: [],
    },
    annotations: { readOnlyHint: true },
  },

  {
    name: 'agentpay_revoke_repo_lease',
    description: 'Revoke a repository authority lease immediately. Does not affect provider tokens outside AgentPay.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        leaseId: { type: 'string', description: 'Repo lease ID returned by agentpay_list_repo_leases.' },
      },
      required: ['leaseId'],
    },
  },

  {
    name: 'registry_server_info',
    description:
      'Get full details and ready-to-paste harness config for a specific MCP server.\n\n' +
      'For HTTP servers: returns URL-based config for Claude Code, Codex, Cursor.\n' +
      'For stdio servers: returns command-based config + install instructions.\n\n' +
      'You must be subscribed to see connection config.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        slug: { type: 'string', description: 'Server slug from registry_search' },
      },
      required: ['slug'],
    },
    annotations: { readOnlyHint: true },
  },

  {
    name: 'registry_subscribe',
    description:
      'Subscribe to an MCP server. Free servers activate immediately — no TOTP needed.\n\n' +
      'Paid servers require TOTP (call registry_enroll first if not enrolled).\n\n' +
      'After subscribing: call registry_server_info for harness connection config.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        server_slug: { type: 'string', description: 'Server slug from registry_search' },
        totp_code: { type: 'string', description: '6-digit code — only needed for paid servers' },
      },
      required: ['server_slug'],
    },
  },

  {
    name: 'registry_create_subscription_checkout',
    description:
      'Create a Stripe Checkout session for a paid MCP registry subscription that is in pending_payment. ' +
      'The subscription remains inactive until Stripe confirms payment by webhook.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        subscription_id: { type: 'string', description: 'Pending subscription ID returned by registry_subscribe.' },
      },
      required: ['subscription_id'],
    },
  },

  {
    name: 'registry_installed',
    description: 'List all MCP servers you are subscribed to, with usage counts and plan details.',
    inputSchema: { type: 'object' as const, properties: {}, required: [] },
    annotations: { readOnlyHint: true },
  },

  {
    name: 'registry_publish',
    description:
      'Publish an MCP server to the AgentPay marketplace. No web UI required.\n\n' +
      'Supported transports:\n' +
      '  - http: provide endpoint_url (must be https://). Requires domain verification after publishing.\n' +
      '    Cloudflare Workers (*.workers.dev): use /.well-known/agentpay-publisher.json method.\n' +
      '  - stdio: provide github_url + command + args. Goes active immediately, no verification needed.\n\n' +
      'Always requires TOTP authentication.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Display name (e.g. "Web Search")' },
        description: { type: 'string', description: 'What this server does — be specific' },
        category: { type: 'string', description: 'Category (search, utilities, finance, data, payments, agents, security, etc.)' },
        transport: { type: 'string', enum: ['http', 'stdio'], description: 'http for HTTP endpoints, stdio for local Python/Node servers' },
        endpoint_url: { type: 'string', description: 'HTTPS URL — required for http transport' },
        github_url: { type: 'string', description: 'GitHub repo URL — required for stdio transport' },
        command: { type: 'string', description: 'Executable for stdio transport (e.g. python3, node)' },
        command_args: { type: 'array', items: { type: 'string' }, description: 'Args for stdio command (e.g. ["server.py"])' },
        pricing_model: { type: 'string', enum: ['free', 'per_call', 'monthly'] },
        price_per_call_usd: { type: 'number' },
        price_monthly_usd: { type: 'number' },
        free_tier_calls: { type: 'number', description: 'Free calls/month before billing (default 100)' },
        totp_code: { type: 'string', description: '6-digit code from authenticator app' },
      },
      required: ['name', 'transport', 'totp_code'],
    },
  },

  {
    name: 'registry_verify_domain',
    description:
      'Verify domain ownership for an HTTP server after publishing.\n\n' +
      'First place your verification token at:\n' +
      '  Option A (preferred, works on *.workers.dev): /.well-known/agentpay-publisher.json → {"token":"<your_token>"}\n' +
      '  Option B: DNS TXT record _agentpay-verify.yourdomain.com = <your_token>\n\n' +
      'The verification_token is returned by registry_publish.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        slug: { type: 'string', description: 'Server slug returned by registry_publish' },
      },
      required: ['slug'],
    },
  },

  {
    name: 'registry_usage',
    description: 'Usage stats and earnings for MCP servers you have published. Shows installs, calls, and revenue.',
    inputSchema: { type: 'object' as const, properties: {}, required: [] },
    annotations: { readOnlyHint: true },
  },

  {
    name: 'registry_payouts',
    description: 'View your publisher payout history and current month pending earnings. Payouts are 70% of billed revenue, processed monthly.',
    inputSchema: { type: 'object' as const, properties: {}, required: [] },
    annotations: { readOnlyHint: true },
  },

  {
    name: 'registry_enroll',
    description:
      'Enroll TOTP for registry actions that require it (paid subscriptions, publishing).\n\n' +
      'Returns:\n' +
      '  - setup_url: open in browser to see a QR code to scan\n' +
      '  - setup_key: manually enter in Google Authenticator / Authy\n' +
      '  - otpauth_uri: the full otpauth:// URI\n\n' +
      'Free server subscriptions do NOT require TOTP. Only call this when you need to publish or subscribe to a paid server.',
    inputSchema: { type: 'object' as const, properties: {}, required: [] },
  },

  {
    name: 'registry_confirm_totp',
    description: 'Confirm TOTP enrollment after scanning the QR. Provide the 6-digit code from your authenticator app.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        totp_code: { type: 'string', description: '6-digit code from authenticator app' },
      },
      required: ['totp_code'],
    },
  },
];

export async function handleRegistryTool(
  name: string,
  args: Record<string, unknown>,
  runtime: AgentPayMcpRuntime,
): Promise<CallToolResult> {
  const resolved = {
    apiUrl: runtime.apiUrl ?? 'https://api.agentpay.so',
    apiKey: runtime.apiKey ?? '',
    fetchImpl: runtime.fetchImpl ?? globalThis.fetch.bind(globalThis),
  };

  switch (name) {
    case 'agentpay_choose_requirement': {
      const userGoal = String(args.userGoal ?? '').trim();
      if (!userGoal) {
        return json({
          error: 'userGoal_required',
          message: 'Provide the user requirement so AgentPay can choose a safe marketplace path.',
        });
      }

      const capability = typeof args.capability === 'string' && args.capability.trim()
        ? args.capability.trim()
        : undefined;
      const maxMonthlyUsd = typeof args.maxMonthlyUsd === 'number' && Number.isFinite(args.maxMonthlyUsd)
        ? args.maxMonthlyUsd
        : undefined;
      const maxPerActionUsd = typeof args.maxPerActionUsd === 'number' && Number.isFinite(args.maxPerActionUsd)
        ? args.maxPerActionUsd
        : undefined;
      const preferredTransport = args.preferredTransport === 'http' || args.preferredTransport === 'stdio'
        ? args.preferredTransport
        : undefined;
      const goalText = userGoal.toLowerCase();
      const requiresRepoAccess = args.requiresRepoAccess === true ||
        /\b(github|gitlab|repo|repository|pull request|pr\b|commit|branch|codebase)\b/.test(goalText);
      const likelyPaymentTask = /\b(pay|payment|charge|fund|invoice|subscription|purchase|buy|hire|escrow|payout)\b/.test(goalText);

      const searchParams = new URLSearchParams();
      searchParams.set('q', capability ?? userGoal);
      searchParams.set('limit', '5');
      if (preferredTransport) searchParams.set('transport', preferredTransport);

      const [registryResult, agentResult, providerResult] = await Promise.all([
        registryFetch(`${REGISTRY_BASE}/servers?${searchParams.toString()}`, { method: 'GET' }, resolved).catch((error) => ({
          success: false,
          error: error instanceof Error ? error.message : String(error),
        })),
        registryFetch('/api/agents/match', {
          method: 'POST',
          body: JSON.stringify({
            intent: userGoal,
            capability,
            maxPriceUsd: maxPerActionUsd,
            limit: 5,
          }),
        }, resolved).catch((error) => ({
          success: false,
          error: error instanceof Error ? error.message : String(error),
        })),
        registryFetch('/api/capabilities/providers/catalog', { method: 'GET' }, resolved).catch((error) => ({
          success: false,
          error: error instanceof Error ? error.message : String(error),
        })),
      ]);

      const registryServers = Array.isArray((registryResult as { servers?: unknown }).servers)
        ? (registryResult as { servers: Array<Record<string, unknown>> }).servers
        : [];
      const agentMatches = Array.isArray((agentResult as { agents?: unknown }).agents)
        ? (agentResult as { agents: Array<Record<string, unknown>> }).agents
        : [];
      const providerCatalog = Array.isArray((providerResult as { providers?: unknown }).providers)
        ? (providerResult as { providers: Array<Record<string, unknown>> }).providers
        : [];

      const affordableServers = registryServers.filter((server) => {
        const pricingModel = String(server.pricing_model ?? 'free');
        const monthly = Number(server.price_monthly_usd ?? 0);
        if (pricingModel === 'free') return true;
        if (maxMonthlyUsd === undefined) return true;
        return monthly > 0 && monthly <= maxMonthlyUsd;
      });
      const topServer = affordableServers[0] ?? registryServers[0] ?? null;
      const topAgent = agentMatches[0] ?? null;
      const topProvider = providerCatalog.find((provider) => {
        const haystack = [
          provider.provider,
          provider.name,
          provider.label,
          provider.description,
          provider.category,
        ].filter(Boolean).join(' ').toLowerCase();
        return capability
          ? haystack.includes(capability.toLowerCase())
          : goalText.split(/\s+/).some((word) => word.length > 3 && haystack.includes(word));
      }) ?? providerCatalog[0] ?? null;

      let recommendedPath = 'none_available';
      let nextTool: string | null = null;
      let needsCustomer = false;
      const customerReasons: string[] = [];

      if (requiresRepoAccess) {
        recommendedPath = 'repo_authority';
        nextTool = 'agentpay_request_repo_access';
        needsCustomer = true;
        customerReasons.push('repo_selection_required');
      } else if (topServer) {
        recommendedPath = 'mcp_server';
        nextTool = 'registry_subscribe';
        const pricingModel = String(topServer.pricing_model ?? 'free');
        if (pricingModel !== 'free') {
          needsCustomer = true;
          customerReasons.push('payment_required');
        }
      } else if (topAgent) {
        recommendedPath = 'agent_marketplace';
        nextTool = 'agentpay_hire_agent';
        const price = Number(topAgent.pricePerTaskUsd ?? 0);
        if (price > 0) {
          needsCustomer = true;
          customerReasons.push('payment_required');
        }
      } else if (topProvider) {
        recommendedPath = 'governed_capability';
        nextTool = 'agentpay_request_capability_connect';
        needsCustomer = true;
        customerReasons.push('credential_connection_required');
      } else if (likelyPaymentTask) {
        recommendedPath = 'payment_or_mandate';
        nextTool = 'agentpay_create_mandate';
        needsCustomer = true;
        customerReasons.push('payment_required');
      }

      return json({
        success: true,
        marketplaceAccess: 'agent_only',
        userGoal,
        recommendedPath,
        nextTool,
        needsCustomer,
        customerReasons,
        humanInteractionPolicy: {
          interruptOnlyFor: [
            'payment_required',
            'repo_selection_required',
            'credential_connection_required',
            'policy_exception',
            'ambiguous_money_outcome',
          ],
          neverAskHumanFor: [
            'browsing marketplace results',
            'comparing free MCP servers',
            'reading public agent profiles',
            'using already-approved authority',
          ],
        },
        recommendation: {
          mcpServer: topServer,
          agent: topAgent,
          capabilityProvider: topProvider,
        },
        candidates: {
          mcpServers: registryServers,
          agents: agentMatches,
          capabilityProviders: providerCatalog.slice(0, 5),
        },
        failSafe: {
          money: 'No paid subscription, hire, or funded action should become active until AgentPay has confirmed payment or an existing authority policy explicitly allows it.',
          repo: 'Repo access should use an opaque, revocable lease scoped to selected repos and actions; raw GitHub tokens must never be shown to the agent.',
        },
      });
    }

    case 'registry_search': {
      const params = new URLSearchParams();
      if (args.q) params.set('q', String(args.q));
      if (args.category) params.set('category', String(args.category));
      if (args.transport) params.set('transport', String(args.transport));
      if (args.limit) params.set('limit', String(args.limit));
      if (args.offset) params.set('offset', String(args.offset));
      if (args.featured) params.set('featured', 'true');
      return json(await registryFetch(`${REGISTRY_BASE}/servers?${params.toString()}`, { method: 'GET' }, resolved));
    }

    case 'agentpay_request_repo_access':
      return json(await registryFetch('/api/repos/access-requests', {
        method: 'POST',
        body: JSON.stringify({
          principalId: args.principalId,
          operatorId: args.operatorId,
          provider: args.provider ?? 'github',
          purpose: args.purpose,
          requestedRepos: args.requestedRepos,
          requestedOperations: args.requestedOperations,
          resumeUrl: args.resumeUrl,
        }),
      }, resolved));

    case 'agentpay_list_repo_leases': {
      const params = new URLSearchParams();
      if (args.status) params.set('status', String(args.status));
      return json(await registryFetch(`/api/repos/leases?${params.toString()}`, { method: 'GET' }, resolved));
    }

    case 'agentpay_revoke_repo_lease':
      return json(await registryFetch(`/api/repos/leases/${args.leaseId}/revoke`, {
        method: 'POST',
        body: '{}',
      }, resolved));

    case 'registry_server_info': {
      const slug = String(args.slug);
      const [detail, config] = await Promise.all([
        registryFetch(`${REGISTRY_BASE}/servers/${slug}`, { method: 'GET' }, resolved),
        registryFetch(`${REGISTRY_BASE}/servers/${slug}/config`, { method: 'GET' }, resolved).catch(() => null),
      ]);
      return json({ ...(detail as object), connection_config: config });
    }

    case 'registry_subscribe':
      return json(await registryFetch(`${REGISTRY_BASE}/subscriptions`, {
        method: 'POST',
        body: JSON.stringify({ server_slug: args.server_slug, totp_code: args.totp_code }),
      }, resolved));

    case 'registry_create_subscription_checkout':
      return json(await registryFetch(`${REGISTRY_BASE}/subscriptions/${args.subscription_id}/checkout`, {
        method: 'POST',
        body: '{}',
      }, resolved));

    case 'registry_installed':
      return json(await registryFetch(`${REGISTRY_BASE}/subscriptions`, { method: 'GET' }, resolved));

    case 'registry_publish':
      return json(await registryFetch(`${REGISTRY_BASE}/servers`, {
        method: 'POST',
        body: JSON.stringify({
          name: args.name, description: args.description, category: args.category,
          transport: args.transport ?? 'http',
          endpoint_url: args.endpoint_url, github_url: args.github_url,
          command: args.command, command_args: args.command_args,
          pricing_model: args.pricing_model ?? 'free',
          price_per_call_usd: args.price_per_call_usd, price_monthly_usd: args.price_monthly_usd,
          free_tier_calls: args.free_tier_calls, totp_code: args.totp_code,
        }),
      }, resolved));

    case 'registry_verify_domain':
      return json(await registryFetch(`${REGISTRY_BASE}/servers/${args.slug}/verify`, { method: 'POST', body: '{}' }, resolved));

    case 'registry_usage':
      return json(await registryFetch(`${REGISTRY_BASE}/usage`, { method: 'GET' }, resolved));

    case 'registry_payouts':
      return json(await registryFetch(`${REGISTRY_BASE}/payouts`, { method: 'GET' }, resolved));

    case 'registry_enroll':
      return json(await registryFetch(`${REGISTRY_BASE}/totp/enroll`, { method: 'POST', body: '{}' }, resolved));

    case 'registry_confirm_totp':
      return json(await registryFetch(`${REGISTRY_BASE}/totp/confirm`, {
        method: 'POST',
        body: JSON.stringify({ totp_code: args.totp_code }),
      }, resolved));

    default:
      throw new Error(`Unknown registry tool: ${name}`);
  }
}
