/**
 * @agentpayxyz/moltclaw
 *
 * AgentPay plugin for MoltClaw runtimes.
 * Drop-in tool bundle — registers payment, verification, agent identity,
 * and multi-protocol (x402 / AP2 / ACP) tools into any MoltClaw agent.
 *
 * Usage:
 *   import { createAgentPayTools } from '@agentpayxyz/moltclaw';
 *
 *   const tools = createAgentPayTools({ apiKey: 'apk_...' });
 *   moltclaw.registerTools(tools);
 */

const BASE_URL = 'https://api.agentpay.so';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentPayMoltClawConfig {
  /** AgentPay merchant API key (apk_...) — required for payment creation */
  apiKey?: string;
  /** Agent ID for agent-native flows (agt_...) */
  agentId?: string;
  /** Agent Key for agent-native flows (agk_...) */
  agentKey?: string;
  /** Override API base URL (for testing) */
  baseUrl?: string;
}

export interface MoltClawTool {
  id: string;
  title: string;
  description: string;
  schema: Record<string, unknown>;
  handler: (payload: Record<string, unknown>) => Promise<unknown>;
}

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

async function apiFetch(
  path: string,
  opts: { method?: string; body?: unknown; apiKey?: string; baseUrl?: string } = {},
): Promise<unknown> {
  const url = `${opts.baseUrl ?? BASE_URL}${path}`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.apiKey) headers['X-Api-Key'] = opts.apiKey;

  const res = await fetch(url, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  return res.json();
}

// ---------------------------------------------------------------------------
// Tool factory
// ---------------------------------------------------------------------------

export function createAgentPayTools(config: AgentPayMoltClawConfig = {}): MoltClawTool[] {
  const { apiKey, agentId, agentKey, baseUrl } = config;
  const fetch = (path: string, opts: Parameters<typeof apiFetch>[1] = {}) =>
    apiFetch(path, { ...opts, apiKey, baseUrl });

  return [
    // -------------------------------------------------------------------------
    // 1. Create Payment Intent (merchant-authenticated)
    // -------------------------------------------------------------------------
    {
      id: 'agentpay_create_payment',
      title: 'Create Payment Intent',
      description:
        'Create an AgentPay Solana USDC payment intent. Returns a Solana Pay URI and intentId.',
      schema: {
        type: 'object',
        properties: {
          merchantId:       { type: 'string',  description: 'Merchant UUID' },
          agentId:          { type: 'string',  description: 'Agent identifier' },
          amount:           { type: 'number',  description: 'Amount in USDC' },
          purpose:          { type: 'string',  description: 'Payment purpose/memo' },
          idempotencyKey:   { type: 'string',  description: 'Optional idempotency key' },
        },
        required: ['merchantId', 'agentId', 'amount'],
      },
      handler: async (p) =>
        fetch('/api/v1/payment-intents', { method: 'POST', body: p }),
    },

    // -------------------------------------------------------------------------
    // 2. Agent-native Payment (no merchantId — uses agentKey)
    // -------------------------------------------------------------------------
    {
      id: 'agentpay_agent_pay',
      title: 'Agent-Native Payment',
      description:
        'Create a payment as a registered agent without a merchant account. Uses agentId + agentKey from config.',
      schema: {
        type: 'object',
        properties: {
          recipientAddress: { type: 'string', description: 'Solana wallet address of recipient' },
          amount:           { type: 'number', description: 'Amount in USDC' },
          purpose:          { type: 'string', description: 'Payment purpose' },
        },
        required: ['recipientAddress', 'amount'],
      },
      handler: async (p) => {
        if (!agentId || !agentKey) throw new Error('agentId and agentKey required in config for agent-native payments');
        return fetch('/api/v1/agents/pay', { method: 'POST', body: { agentId, agentKey, ...p } });
      },
    },

    // -------------------------------------------------------------------------
    // 3. Verify Payment
    // -------------------------------------------------------------------------
    {
      id: 'agentpay_verify_payment',
      title: 'Verify Payment',
      description: 'Check whether an AgentPay intent is confirmed/verified on-chain.',
      schema: {
        type: 'object',
        properties: {
          intentId: { type: 'string', description: 'The payment intentId to verify' },
        },
        required: ['intentId'],
      },
      handler: async (p) => fetch(`/api/verify/${encodeURIComponent(p.intentId as string)}`),
    },

    // -------------------------------------------------------------------------
    // 4. Get Receipt
    // -------------------------------------------------------------------------
    {
      id: 'agentpay_get_receipt',
      title: 'Get Payment Receipt',
      description: 'Fetch the machine-readable receipt for a completed payment.',
      schema: {
        type: 'object',
        properties: {
          intentId: { type: 'string', description: 'The intentId to fetch a receipt for' },
        },
        required: ['intentId'],
      },
      handler: async (p) => fetch(`/api/receipt/${encodeURIComponent(p.intentId as string)}`),
    },

    // -------------------------------------------------------------------------
    // 5. Get AgentPassport (trust score)
    // -------------------------------------------------------------------------
    {
      id: 'agentpay_get_passport',
      title: 'Get Agent Passport',
      description: 'Look up the trust score, AgentRank, and identity record for any agent.',
      schema: {
        type: 'object',
        properties: {
          agentId: { type: 'string', description: 'The agentId to look up' },
        },
        required: ['agentId'],
      },
      handler: async (p) => fetch(`/api/passport/${encodeURIComponent(p.agentId as string)}`),
    },

    // -------------------------------------------------------------------------
    // 6. Register Agent
    // -------------------------------------------------------------------------
    {
      id: 'agentpay_register_agent',
      title: 'Register Agent',
      description: 'Self-register an AI agent on the AgentPay network. Returns agentId and agentKey (shown once).',
      schema: {
        type: 'object',
        properties: {
          name:         { type: 'string', description: 'Agent display name' },
          category:     { type: 'string', description: 'Agent category (e.g. research, writing, code)' },
          description:  { type: 'string', description: 'What this agent does' },
          capabilities: { type: 'array', items: { type: 'string' }, description: 'List of capability tags' },
        },
      },
      handler: async (p) => fetch('/api/v1/agents/register', { method: 'POST', body: p }),
    },

    // -------------------------------------------------------------------------
    // 7. AP2 — Agent-to-Agent payment request
    // -------------------------------------------------------------------------
    {
      id: 'agentpay_ap2_request',
      title: 'AP2 Payment Request',
      description: 'Initiate an AP2 (Agent Payment Protocol v2) agent-to-agent micropayment.',
      schema: {
        type: 'object',
        properties: {
          payerId:         { type: 'string', description: 'Paying agent ID' },
          payeeId:         { type: 'string', description: 'Receiving agent ID' },
          amountUsdc:      { type: 'number', description: 'Amount in USDC' },
          taskDescription: { type: 'string', description: 'Description of the task being paid for' },
          ttlSeconds:      { type: 'number', description: 'Time to live in seconds (default 300)' },
        },
        required: ['payerId', 'payeeId', 'amountUsdc', 'taskDescription'],
      },
      handler: async (p) => fetch('/api/ap2/request', { method: 'POST', body: p }),
    },

    // -------------------------------------------------------------------------
    // 8. x402 — Verify a payment proof for a 402-gated resource
    // -------------------------------------------------------------------------
    {
      id: 'agentpay_x402_verify',
      title: 'x402 Verify Payment Proof',
      description: 'Verify a payment proof before granting access to an x402-gated resource.',
      schema: {
        type: 'object',
        properties: {
          paymentId:        { type: 'string', description: 'Payment intent ID to verify' },
          requiredAmountUsd:{ type: 'number', description: 'Minimum amount required in USD' },
        },
        required: ['paymentId'],
      },
      handler: async (p) => fetch('/api/x402/verify', { method: 'POST', body: p }),
    },

    // -------------------------------------------------------------------------
    // 9. Marketplace discover
    // -------------------------------------------------------------------------
    {
      id: 'agentpay_discover_agents',
      title: 'Discover Agents',
      description: 'Search the AgentPay marketplace for agents by category, price, or trust score.',
      schema: {
        type: 'object',
        properties: {
          category:    { type: 'string', description: 'Filter by category' },
          minScore:    { type: 'number', description: 'Minimum AgentRank score (0–1000)' },
          maxPriceUsd: { type: 'number', description: 'Maximum price per task in USD' },
          limit:       { type: 'number', description: 'Number of results (default 20)' },
        },
      },
      handler: async (p) => {
        const qs = new URLSearchParams();
        if (p.category)    qs.set('category',    String(p.category));
        if (p.minScore)    qs.set('minScore',    String(p.minScore));
        if (p.maxPriceUsd) qs.set('maxPriceUsd', String(p.maxPriceUsd));
        if (p.limit)       qs.set('limit',       String(p.limit));
        const q = qs.toString();
        return fetch(`/api/marketplace/discover${q ? `?${q}` : ''}`);
      },
    },
  ];
}

export default { createAgentPayTools };
