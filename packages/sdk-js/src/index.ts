/**
 * @agentpay/sdk — TypeScript SDK for AgentPay
 *
 * Usage:
 *   import AgentPay from '@agentpay/sdk';
 *   const client = new AgentPay({ apiKey: 'ap_live_...' });
 *   const payment = await client.payments.create({ amount: 100, recipientAddress: 'wallet123' });
 */

import { createHmac, timingSafeEqual } from 'crypto';

// ── Types ──────────────────────────────────────────────────────────────────

export interface AgentPayConfig {
  apiKey: string;
  environment?: 'production' | 'sandbox';
  baseUrl?: string;
  timeout?: number;
  maxRetries?: number;
}

export interface Payment {
  id: string;
  amountUsdc: number;
  recipientAddress: string;
  status: 'pending' | 'confirmed' | 'failed';
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export interface CreatePaymentParams {
  amount: number;
  recipientAddress: string;
  metadata?: Record<string, unknown>;
}

export interface ListPaymentsParams {
  limit?: number;
  offset?: number;
  status?: 'pending' | 'confirmed' | 'failed';
}

export interface Bot {
  botId: string;
  handle: string;
  walletAddress: string;
  spendingPolicy: {
    dailyMax: number;
    perTxMax: number;
    autoApproveUnder: number;
  };
}

export interface SpendingData {
  today: { spent: number; limit: number; percentUsed: number; transactions: number };
  last7Days: { date: string; amount: number }[];
  topMerchants: { name: string; totalSpent: number; transactionCount: number }[];
  policy: { dailyLimit: number; perTxLimit: number; autoApproveUnder: number };
  recentTransactions: Record<string, unknown>[];
  alerts: { type: string; message: string; timestamp: string }[];
}

export interface SpendingPolicyUpdate {
  dailySpendingLimit?: number;
  perTxLimit?: number;
  autoApproveUnder?: number;
}

// ── Errors ─────────────────────────────────────────────────────────────────

export class AgentPayError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public code?: string,
  ) {
    super(message);
    this.name = 'AgentPayError';
  }
}

export class RateLimitError extends AgentPayError {
  constructor(message = 'Rate limit exceeded. Please retry after a short delay.') {
    super(message, 429, 'RATE_LIMIT');
    this.name = 'RateLimitError';
  }
}

// ── HTTP Client ────────────────────────────────────────────────────────────

async function httpRequest(
  baseUrl: string,
  apiKey: string,
  method: string,
  path: string,
  body?: unknown,
  maxRetries = 3,
): Promise<unknown> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const res = await fetch(`${baseUrl}${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: body ? JSON.stringify(body) : undefined,
      });

      if (res.status === 429) {
        const delay = Math.pow(2, attempt) * 1000;
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }

      if (!res.ok) {
        const errorBody = await res.text();
        let parsed: { error?: string; message?: string } = {};
        try { parsed = JSON.parse(errorBody); } catch { /* ignore */ }
        throw new AgentPayError(
          parsed.message || parsed.error || `Request failed with status ${res.status}`,
          res.status,
          parsed.error,
        );
      }

      return res.json();
    } catch (err) {
      if (err instanceof AgentPayError) throw err;
      lastError = err as Error;
      if (attempt < maxRetries - 1) {
        await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 1000));
      }
    }
  }

  throw lastError || new Error('Request failed after retries');
}

// ── Resource Classes ───────────────────────────────────────────────────────

class Payments {
  constructor(private baseUrl: string, private apiKey: string, private maxRetries: number) {}

  async create(params: CreatePaymentParams): Promise<Payment> {
    const result = await httpRequest(this.baseUrl, this.apiKey, 'POST', '/api/intents', {
      amountUsdc: params.amount,
      recipientAddress: params.recipientAddress,
      metadata: params.metadata,
    }, this.maxRetries);
    return (result as { data: Payment }).data ?? (result as Payment);
  }

  async get(id: string): Promise<Payment> {
    const result = await httpRequest(this.baseUrl, this.apiKey, 'GET', `/api/intents/${id}`, undefined, this.maxRetries);
    return (result as { data: Payment }).data ?? (result as Payment);
  }

  async list(params?: ListPaymentsParams): Promise<Payment[]> {
    const query = new URLSearchParams();
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.offset) query.set('offset', String(params.offset));
    if (params?.status) query.set('status', params.status);
    const path = `/api/intents${query.toString() ? `?${query}` : ''}`;
    const result = await httpRequest(this.baseUrl, this.apiKey, 'GET', path, undefined, this.maxRetries);
    return (result as { data: Payment[] }).data ?? (result as Payment[]);
  }
}

class Bots {
  constructor(private baseUrl: string, private apiKey: string, private maxRetries: number) {}

  async register(params: { handle: string; displayName?: string; bio?: string }): Promise<Bot> {
    const result = await httpRequest(this.baseUrl, this.apiKey, 'POST', '/api/moltbook/bots/register', {
      handle: params.handle,
      display_name: params.displayName,
      bio: params.bio,
    }, this.maxRetries);
    return result as Bot;
  }

  async getSpending(handle: string): Promise<SpendingData> {
    const result = await httpRequest(this.baseUrl, this.apiKey, 'GET', `/api/moltbook/bots/${handle}/spending`, undefined, this.maxRetries);
    return (result as { data: SpendingData }).data;
  }

  async updatePolicy(handle: string, policy: SpendingPolicyUpdate): Promise<unknown> {
    return httpRequest(this.baseUrl, this.apiKey, 'PUT', `/api/moltbook/bots/${handle}/spending-policy`, policy, this.maxRetries);
  }

  async pause(handle: string): Promise<void> {
    await httpRequest(this.baseUrl, this.apiKey, 'POST', `/api/moltbook/bots/${handle}/pause`, {}, this.maxRetries);
  }

  async resume(handle: string): Promise<void> {
    await httpRequest(this.baseUrl, this.apiKey, 'POST', `/api/moltbook/bots/${handle}/resume`, {}, this.maxRetries);
  }
}

class Webhooks {
  verify(payload: string, signature: string, secret: string): boolean {
    // HMAC-SHA256 verification
    const expected = createHmac('sha256', secret).update(payload).digest('hex');
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  }
}

// ── Main SDK Class ─────────────────────────────────────────────────────────

export class AgentPay {
  public payments: Payments;
  public bots: Bots;
  public webhooks: Webhooks;

  constructor(config: AgentPayConfig) {
    const baseUrl =
      config.baseUrl ||
      (config.environment === 'sandbox'
        ? 'https://sandbox.agentpay.gg'
        : 'https://api.agentpay.gg');
    const maxRetries = config.maxRetries ?? 3;

    this.payments = new Payments(baseUrl, config.apiKey, maxRetries);
    this.bots = new Bots(baseUrl, config.apiKey, maxRetries);
    this.webhooks = new Webhooks();
  }
}

export default AgentPay;
