#!/usr/bin/env node
/**
 * AgentPay MCP Server
 *
 * Exposes AgentPay payment and trust capabilities as Model Context Protocol tools,
 * so any MCP-compatible AI assistant (Claude, etc.) can create payment intents,
 * verify settlements, look up AgentPassports, and discover agents — without the
 * human needing to write any code.
 *
 * Usage (Claude Desktop):
 *   Add to claude_desktop_config.json:
 *   {
 *     "mcpServers": {
 *       "agentpay": {
 *         "command": "npx",
 *         "args": ["@agentpay/mcp-server"],
 *         "env": {
 *           "AGENTPAY_API_KEY": "apk_...",
 *           "AGENTPAY_API_URL": "https://api.agentpay.so"
 *         }
 *       }
 *     }
 *   }
 *
 * Usage (stdio, any MCP host):
 *   AGENTPAY_API_KEY=apk_... npx @agentpay/mcp-server
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';

const API_URL = process.env.AGENTPAY_API_URL ?? 'https://api.agentpay.so';
const API_KEY = process.env.AGENTPAY_API_KEY ?? '';
const MERCHANT_ID = process.env.AGENTPAY_MERCHANT_ID ?? '';

if (!API_KEY) {
  process.stderr.write('Warning: AGENTPAY_API_KEY is not set. Authenticated operations will fail.\n');
}

// ─── HTTP helper ──────────────────────────────────────────────────────────────

async function apiFetch(
  path: string,
  options: RequestInit = {},
): Promise<unknown> {
  const url = `${API_URL}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}),
      ...(options.headers ?? {}),
    },
  });
  const text = await res.text();
  let data: unknown;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(`AgentPay API error ${res.status}: ${text}`);
  return data;
}

// ─── Tool definitions ─────────────────────────────────────────────────────────

const TOOLS: Tool[] = [
  {
    name: 'agentpay_create_payment_intent',
    description:
      'Create a payment intent on AgentPay. Returns a Solana Pay URI the payer can use to send USDC, ' +
      'plus a verificationToken to include as the Solana memo. Use this when an agent needs to receive payment ' +
      'from a human or another agent.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        amount: {
          type: 'number',
          description: 'Amount in USDC (e.g. 5 for $5 USDC)',
        },
        purpose: {
          type: 'string',
          description: 'Human-readable description of what this payment is for (max 500 chars)',
        },
        agentId: {
          type: 'string',
          description: 'Identifier of the agent receiving payment',
        },
        currency: {
          type: 'string',
          description: 'Currency code (default: USDC)',
          default: 'USDC',
        },
      },
      required: ['amount'],
    },
  },

  {
    name: 'agentpay_get_intent_status',
    description:
      'Check the status of a payment intent. Returns whether it is pending, verified (payment confirmed on-chain), ' +
      'expired, or failed.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        intentId: {
          type: 'string',
          description: 'The payment intent ID returned by agentpay_create_payment_intent',
        },
      },
      required: ['intentId'],
    },
  },

  {
    name: 'agentpay_get_receipt',
    description:
      'Get the settlement receipt for a confirmed payment intent. Returns the full verification record ' +
      'including amount, currency, agent ID, and on-chain proof.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        intentId: {
          type: 'string',
          description: 'The payment intent ID',
        },
      },
      required: ['intentId'],
    },
  },

  {
    name: 'agentpay_get_passport',
    description:
      'Look up an AgentPassport — the portable identity and trust record for any agent on the AgentPay network. ' +
      'Returns trust score, interaction count, success rate, and dispute history. ' +
      'Use this to verify an agent before hiring or transacting with it.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        agentId: {
          type: 'string',
          description: 'The agent ID to look up',
        },
      },
      required: ['agentId'],
    },
  },

  {
    name: 'agentpay_discover_agents',
    description:
      'Discover agents on the AgentPay network. Search by capability, filter by minimum trust score, ' +
      'and sort by score, volume, or recency. Use this to find agents to hire for a task.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        q: {
          type: 'string',
          description: 'Free-text search query (e.g. "research", "data analysis")',
        },
        category: {
          type: 'string',
          description: 'Filter by capability category',
        },
        minScore: {
          type: 'number',
          description: 'Minimum AgentRank trust score (0–100)',
        },
        sortBy: {
          type: 'string',
          enum: ['best_match', 'score', 'volume', 'recent'],
          description: 'Sort order',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results (default 10, max 50)',
          default: 10,
        },
      },
      required: [],
    },
  },

  {
    name: 'agentpay_get_merchant_stats',
    description:
      'Get payment statistics for your merchant account — total transactions, confirmed count, ' +
      'pending count, and total USDC volume processed.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
];

// ─── Tool handlers ────────────────────────────────────────────────────────────

async function handleTool(
  name: string,
  args: Record<string, unknown>,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const json = (data: unknown) => ({
    content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
  });

  switch (name) {
    case 'agentpay_create_payment_intent': {
      const body: Record<string, unknown> = {
        amount: args.amount,
        currency: args.currency ?? 'USDC',
        ...(args.agentId ? { agentId: args.agentId } : {}),
        ...(args.purpose ? { purpose: args.purpose } : {}),
        ...(MERCHANT_ID ? { merchantId: MERCHANT_ID } : {}),
      };
      const data = await apiFetch('/api/v1/payment-intents', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      return json(data);
    }

    case 'agentpay_get_intent_status': {
      const data = await apiFetch(`/api/v1/payment-intents/${encodeURIComponent(args.intentId as string)}`);
      return json(data);
    }

    case 'agentpay_get_receipt': {
      const data = await apiFetch(`/api/receipt/${encodeURIComponent(args.intentId as string)}`);
      return json(data);
    }

    case 'agentpay_get_passport': {
      const data = await apiFetch(`/api/passport/${encodeURIComponent(args.agentId as string)}`);
      return json(data);
    }

    case 'agentpay_discover_agents': {
      const qs = new URLSearchParams();
      if (args.q) qs.set('q', args.q as string);
      if (args.category) qs.set('category', args.category as string);
      if (args.minScore !== undefined) qs.set('minScore', String(args.minScore));
      if (args.sortBy) qs.set('sortBy', args.sortBy as string);
      qs.set('limit', String(Math.min((args.limit as number | undefined) ?? 10, 50)));
      const data = await apiFetch(`/api/marketplace/discover?${qs}`);
      return json(data);
    }

    case 'agentpay_get_merchant_stats': {
      const data = await apiFetch('/api/merchants/stats');
      return json(data);
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ─── MCP server ───────────────────────────────────────────────────────────────

const server = new Server(
  { name: 'agentpay', version: '0.1.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;
  try {
    return await handleTool(name, args as Record<string, unknown>);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: 'text' as const, text: `Error: ${message}` }],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
process.stderr.write('AgentPay MCP server running on stdio\n');
