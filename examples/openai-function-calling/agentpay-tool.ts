/**
 * AgentPay Tool for OpenAI Function Calling / Agents SDK
 * =========================================================
 * Provides OpenAI-compatible function definitions and handlers for AgentPay.
 * Works with:
 *   - OpenAI Chat Completions API (function_call)
 *   - OpenAI Assistants API (tools)
 *   - OpenAI Agents SDK (tool definitions)
 *
 * Usage:
 *   import { agentpayTools, handleAgentpayToolCall } from './agentpay-tool';
 *
 *   // With Chat Completions API
 *   const response = await openai.chat.completions.create({
 *     model: 'gpt-4o',
 *     messages,
 *     tools: agentpayTools,
 *   });
 *
 *   // In your tool call handler
 *   if (toolCall.function.name.startsWith('agentpay_')) {
 *     const result = await handleAgentpayToolCall(toolCall);
 *   }
 *
 * Install:
 *   npm install openai @agentpay/sdk
 */

import type { ChatCompletionTool } from 'openai/resources/chat/completions';

const AGENTPAY_BASE_URL = process.env.AGENTPAY_API_URL ?? 'https://api.agentpay.gg';
const AGENTPAY_API_KEY = process.env.AGENTPAY_API_KEY ?? '';

// ---------------------------------------------------------------------------
// OpenAI-format tool definitions
// ---------------------------------------------------------------------------

export const agentpayTools: ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'agentpay_create_payment',
      description:
        'Create a payment request via AgentPay. Supports Solana USDC and Stripe fiat. ' +
        'Returns a payment intent ID and a URL to complete the payment.',
      parameters: {
        type: 'object',
        properties: {
          amount_usd: {
            type: 'number',
            description: 'Payment amount in USD (e.g. 5.00 for $5)',
          },
          recipient_id: {
            type: 'string',
            description: 'Recipient agent ID, wallet address, or email',
          },
          memo: {
            type: 'string',
            description: 'Optional description or memo for the payment',
          },
          method: {
            type: 'string',
            enum: ['solana', 'stripe'],
            description: "Payment method. Default: 'solana'",
          },
        },
        required: ['amount_usd', 'recipient_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'agentpay_verify_payment',
      description: 'Verify the status and details of an existing AgentPay payment intent.',
      parameters: {
        type: 'object',
        properties: {
          payment_id: {
            type: 'string',
            description: 'The payment intent ID returned by agentpay_create_payment',
          },
        },
        required: ['payment_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'agentpay_check_agent_rank',
      description:
        'Get the AgentRank trust score (0-1000) for any agent. Higher is more trustworthy. ' +
        'Use this before sending funds to an unknown agent.',
      parameters: {
        type: 'object',
        properties: {
          agent_id: {
            type: 'string',
            description: 'The agent ID to look up',
          },
        },
        required: ['agent_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'agentpay_create_escrow',
      description:
        'Create a protected escrow transaction. Funds are locked until you approve work completion. ' +
        'Use for any task where you want to verify output before paying.',
      parameters: {
        type: 'object',
        properties: {
          amount_usd: {
            type: 'number',
            description: 'Escrow amount in USD',
          },
          payee_id: {
            type: 'string',
            description: 'The agent ID or address of the service provider',
          },
          task_description: {
            type: 'string',
            description: 'Clear description of what the payee must deliver',
          },
        },
        required: ['amount_usd', 'payee_id', 'task_description'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'agentpay_approve_escrow',
      description: 'Approve an escrow after verifying the task is complete. Releases funds to payee.',
      parameters: {
        type: 'object',
        properties: {
          escrow_id: {
            type: 'string',
            description: 'The escrow ID returned by agentpay_create_escrow',
          },
        },
        required: ['escrow_id'],
      },
    },
  },
];

// ---------------------------------------------------------------------------
// Tool call handler
// ---------------------------------------------------------------------------

interface ToolCallArgs {
  name: string;
  arguments: string;
}

async function agentpayFetch(path: string, method = 'GET', body?: unknown): Promise<unknown> {
  const res = await fetch(`${AGENTPAY_BASE_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${AGENTPAY_API_KEY}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`AgentPay ${method} ${path} → ${res.status}: ${text}`);
  }
  return res.json();
}

export async function handleAgentpayToolCall(toolCall: ToolCallArgs): Promise<string> {
  const args = JSON.parse(toolCall.arguments) as Record<string, unknown>;

  try {
    switch (toolCall.name) {
      case 'agentpay_create_payment': {
        const result = (await agentpayFetch('/api/v1/payment-intents', 'POST', {
          amount: Math.round((args['amount_usd'] as number) * 100),
          recipient: args['recipient_id'],
          memo: args['memo'] ?? 'OpenAI agent payment',
          method: args['method'] ?? 'solana',
        })) as Record<string, unknown>;
        return JSON.stringify({
          success: true,
          payment_id: result['id'],
          status: result['status'],
          payment_url: result['payment_url'],
        });
      }

      case 'agentpay_verify_payment': {
        const result = (await agentpayFetch(`/api/verify/${args['payment_id']}`)) as Record<string, unknown>;
        return JSON.stringify({ success: true, status: result['status'], details: result });
      }

      case 'agentpay_check_agent_rank': {
        const result = (await agentpayFetch(`/api/agentrank/${args['agent_id']}`)) as Record<string, unknown>;
        return JSON.stringify({
          success: true,
          agent_id: args['agent_id'],
          score: result['score'] ?? result['agentRank'],
          tier: result['tier'],
          recommendation: (result['score'] as number) > 700 ? 'trusted' : (result['score'] as number) > 400 ? 'moderate' : 'caution',
        });
      }

      case 'agentpay_create_escrow': {
        const result = (await agentpayFetch('/api/escrow/create', 'POST', {
          payeeAgentId: args['payee_id'],
          amount: args['amount_usd'],
          taskDescription: args['task_description'],
        })) as Record<string, unknown>;
        return JSON.stringify({ success: true, escrow_id: result['id'], status: result['status'] });
      }

      case 'agentpay_approve_escrow': {
        const result = (await agentpayFetch(`/api/escrow/${args['escrow_id']}/approve`, 'POST')) as Record<string, unknown>;
        return JSON.stringify({ success: true, escrow_id: args['escrow_id'], status: result['status'] });
      }

      default:
        return JSON.stringify({ error: `Unknown tool: ${toolCall.name}` });
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return JSON.stringify({ error: message });
  }
}

// ---------------------------------------------------------------------------
// Example: OpenAI Agents SDK usage
// ---------------------------------------------------------------------------

export const openAiAgentsTool = {
  name: 'agentpay',
  description: 'Process payments, verify transactions, check trust scores, and manage escrow',
  parameters: {
    type: 'object' as const,
    properties: {
      action: {
        type: 'string',
        enum: ['create_payment', 'verify_payment', 'check_rank', 'create_escrow', 'approve_escrow'],
      },
      amount_usd: { type: 'number' },
      recipient_id: { type: 'string' },
      payment_id: { type: 'string' },
      agent_id: { type: 'string' },
      escrow_id: { type: 'string' },
      memo: { type: 'string' },
    },
    required: ['action'],
  },
  execute: async (params: Record<string, unknown>) => {
    const toolCallName = `agentpay_${params['action']}`;
    return handleAgentpayToolCall({
      name: toolCallName,
      arguments: JSON.stringify(params),
    });
  },
};

// ---------------------------------------------------------------------------
// Standalone test — uncomment to run
// ---------------------------------------------------------------------------
// (async () => {
//   const result = await handleAgentpayToolCall({
//     name: 'agentpay_check_agent_rank',
//     arguments: JSON.stringify({ agent_id: 'agent-001' }),
//   });
//   console.log('Result:', result);
// })();
