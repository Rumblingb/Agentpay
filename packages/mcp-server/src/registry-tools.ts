/**
 * Registry MCP tools — 10 tools for the agent-first MCP marketplace.
 * Supports both http and stdio transports.
 */

import type { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { AgentPayMcpRuntime } from './index.js';

const REGISTRY_BASE = '/api/registry';

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
