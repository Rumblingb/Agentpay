/**
 * Registry MCP tools — agent-first marketplace tool definitions.
 *
 * 6 tools exposed via the AgentPay MCP server:
 *   registry_search       — find MCP servers by query/category
 *   registry_server_info  — detail + connection config for one server
 *   registry_subscribe    — subscribe to a server (TOTP required)
 *   registry_installed    — list active subscriptions
 *   registry_publish      — publish a new server (TOTP required)
 *   registry_usage        — publisher usage/earnings stats
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
      'Search the AgentPay MCP server marketplace. Returns available servers with pricing, categories, and install counts.\n\n' +
      'Use this to discover MCP servers you can add to your harness (Claude Code, Codex, Cursor, etc.).\n\n' +
      'Free servers activate immediately after subscribing. Paid servers require a payment intent.\n\n' +
      'After finding a server: call registry_subscribe, then registry_server_info to get connection config.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        q: { type: 'string', description: 'Free-text search across name, description, category' },
        category: { type: 'string', description: 'Filter by category (e.g. search, utilities, finance, data)' },
        limit: { type: 'number', description: 'Results per page (default 20, max 100)' },
        offset: { type: 'number', description: 'Pagination offset' },
        featured: { type: 'boolean', description: 'Show only featured/curated servers' },
      },
      required: [],
    },
    annotations: { readOnlyHint: true },
  },

  {
    name: 'registry_server_info',
    description:
      'Get full details and harness connection config for a specific MCP server.\n\n' +
      'Returns ready-to-paste config for Claude Code (settings.json), Codex (config.toml), Cursor (mcp.json), and generic HTTP.\n\n' +
      'You must be subscribed to the server to get connection config.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        slug: { type: 'string', description: 'Server slug from registry_search results' },
      },
      required: ['slug'],
    },
    annotations: { readOnlyHint: true },
  },

  {
    name: 'registry_subscribe',
    description:
      'Subscribe to an MCP server from the marketplace.\n\n' +
      'Free servers activate immediately. Paid servers return a payment intent — use agentpay_create_payment_intent to pay.\n\n' +
      'After subscribing: call registry_server_info to get the harness connection config.\n\n' +
      'Requires TOTP authentication (totp_code). If not enrolled: call registry_enroll first.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        server_slug: { type: 'string', description: 'Server slug from registry_search' },
        totp_code: { type: 'string', description: '6-digit code from your authenticator app' },
      },
      required: ['server_slug', 'totp_code'],
    },
  },

  {
    name: 'registry_installed',
    description: 'List all MCP servers you are currently subscribed to, with usage counts and plan details.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
    annotations: { readOnlyHint: true },
  },

  {
    name: 'registry_publish',
    description:
      'Publish an MCP server to the AgentPay marketplace. No web UI or GitHub import required.\n\n' +
      'After calling this, you receive a domain verification challenge. Place the verification token at:\n' +
      '  - /.well-known/agentpay-publisher.json, OR\n' +
      '  - DNS TXT record _agentpay-verify.yourdomain.com\n\n' +
      'Then call the verify endpoint to go live. Free servers go active after domain verification.\n' +
      'Paid servers ($price > 0) require a $9 one-time listing fee.\n\n' +
      'Requires TOTP authentication.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Display name for the server (e.g. "Web Search")' },
        description: { type: 'string', description: 'What this server does. Be specific — this is what agents search.' },
        category: { type: 'string', description: 'Category slug (search, utilities, finance, data, payments, travel, etc.)' },
        endpoint_url: { type: 'string', description: 'HTTPS URL of the MCP server endpoint' },
        pricing_model: { type: 'string', enum: ['free', 'per_call', 'monthly'], description: 'How agents are billed' },
        price_per_call_usd: { type: 'number', description: 'Price per tool call in USD (for per_call pricing)' },
        price_monthly_usd: { type: 'number', description: 'Monthly subscription price in USD (for monthly pricing)' },
        free_tier_calls: { type: 'number', description: 'Free calls per month before billing (default 100)' },
        totp_code: { type: 'string', description: '6-digit code from your authenticator app' },
      },
      required: ['name', 'endpoint_url', 'totp_code'],
    },
  },

  {
    name: 'registry_usage',
    description: 'View usage stats and earnings for MCP servers you have published. Shows installs, call counts, and revenue share.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
    annotations: { readOnlyHint: true },
  },

  {
    name: 'registry_enroll',
    description:
      'Enroll TOTP authentication for registry actions (subscribe, publish).\n\n' +
      'Returns:\n' +
      '  - otpauth_uri: Scan with Google Authenticator / Authy\n' +
      '  - setup_url: Open in browser to see a QR code\n' +
      '  - setup_key: Manual entry key for authenticator apps\n\n' +
      'After scanning, confirm with registry_confirm_totp.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },

  {
    name: 'registry_confirm_totp',
    description: 'Confirm TOTP enrollment after scanning the QR code. Provide the 6-digit code from your authenticator app.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        totp_code: { type: 'string', description: '6-digit code from your authenticator app' },
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
      if (args.limit) params.set('limit', String(args.limit));
      if (args.offset) params.set('offset', String(args.offset));
      if (args.featured) params.set('featured', 'true');
      const data = await registryFetch(`${REGISTRY_BASE}/servers?${params.toString()}`, { method: 'GET' }, resolved);
      return json(data);
    }

    case 'registry_server_info': {
      const slug = String(args.slug);
      const [detail, config] = await Promise.all([
        registryFetch(`${REGISTRY_BASE}/servers/${slug}`, { method: 'GET' }, resolved),
        registryFetch(`${REGISTRY_BASE}/servers/${slug}/config`, { method: 'GET' }, resolved).catch(() => null),
      ]);
      return json({ ...(detail as object), connection_config: config });
    }

    case 'registry_subscribe': {
      const data = await registryFetch(`${REGISTRY_BASE}/subscriptions`, {
        method: 'POST',
        body: JSON.stringify({ server_slug: args.server_slug, totp_code: args.totp_code }),
      }, resolved);
      return json(data);
    }

    case 'registry_installed': {
      const data = await registryFetch(`${REGISTRY_BASE}/subscriptions`, { method: 'GET' }, resolved);
      return json(data);
    }

    case 'registry_publish': {
      const data = await registryFetch(`${REGISTRY_BASE}/servers`, {
        method: 'POST',
        body: JSON.stringify({
          name: args.name, description: args.description, category: args.category,
          endpoint_url: args.endpoint_url, pricing_model: args.pricing_model ?? 'free',
          price_per_call_usd: args.price_per_call_usd, price_monthly_usd: args.price_monthly_usd,
          free_tier_calls: args.free_tier_calls, totp_code: args.totp_code,
        }),
      }, resolved);
      return json(data);
    }

    case 'registry_usage': {
      const data = await registryFetch(`${REGISTRY_BASE}/usage`, { method: 'GET' }, resolved);
      return json(data);
    }

    case 'registry_enroll': {
      const data = await registryFetch(`${REGISTRY_BASE}/totp/enroll`, { method: 'POST', body: '{}' }, resolved);
      return json(data);
    }

    case 'registry_confirm_totp': {
      const data = await registryFetch(`${REGISTRY_BASE}/totp/confirm`, {
        method: 'POST',
        body: JSON.stringify({ totp_code: args.totp_code }),
      }, resolved);
      return json(data);
    }

    default:
      throw new Error(`Unknown registry tool: ${name}`);
  }
}
