/**
 * AgentPay SDK — agent-centric entry point
 *
 * A lightweight wrapper around the AgentPay API that makes agent-first
 * payments the default flow.  Wraps the lower-level JS SDK clients with
 * convenient methods:
 *
 *   - createAgent()              — register a named agent with the platform
 *   - attachAgentToIntent()      — link an existing agent to a payment intent
 *   - payAsAgent()               — create an intent pre-linked to an agent
 *   - verifyWebhookSignature()   — verify an inbound AgentPay webhook
 *   - openReceiptUrl()           — return the public receipt URL for an intent
 *
 * Compatible with Node.js ≥18 (uses globalThis.fetch and node:crypto).
 *
 * @module sdk/agentpay
 */

import { createHmac, timingSafeEqual } from 'crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentPaySDKConfig {
  /** AgentPay API base URL (e.g. https://api.agentpay.gg or http://localhost:3001) */
  baseUrl: string;
  /** Merchant API key (sk_live_… or sk_test_…) */
  apiKey: string;
  /** Webhook secret for signature verification (WEBHOOK_SECRET) */
  webhookSecret?: string;
  /** Receipt page base URL (e.g. https://app.agentpay.gg) — defaults to baseUrl */
  receiptBaseUrl?: string;
}

export interface CreateAgentParams {
  displayName: string;
  publicKey?: string;
  riskScore?: number;
}

export interface AgentRecord {
  id: string;
  displayName: string;
  publicKey?: string | null;
  riskScore: number;
  merchantId?: string | null;
  createdAt: string;
}

export interface CreateIntentParams {
  amount: number;
  currency?: string;
  agentId?: string;
  protocol?: 'solana' | 'x402' | 'ap2' | 'acp';
  metadata?: Record<string, unknown>;
}

export interface IntentRecord {
  intentId: string;
  amount: number;
  currency: string;
  agentId?: string | null;
  protocol?: string | null;
  status: string;
  verificationToken: string;
  expiresAt: string;
  instructions?: {
    solanaPayUri?: string;
    recipientAddress?: string;
    memo?: string;
  };
}

export interface WebhookVerificationResult {
  valid: boolean;
  reason?: string;
}

// ---------------------------------------------------------------------------
// SDK class
// ---------------------------------------------------------------------------

export class AgentPaySDK {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly webhookSecret: string | undefined;
  private readonly receiptBaseUrl: string;

  constructor(config: AgentPaySDKConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.apiKey = config.apiKey;
    this.webhookSecret = config.webhookSecret;
    this.receiptBaseUrl = (config.receiptBaseUrl ?? config.baseUrl).replace(/\/$/, '');
  }

  // -------------------------------------------------------------------------
  // Agents
  // -------------------------------------------------------------------------

  /**
   * Register a new agent with the AgentPay platform.
   * The agent is linked to the authenticated merchant.
   */
  async createAgent(params: CreateAgentParams): Promise<AgentRecord> {
    const res = await this.post<{ success: boolean; agent: AgentRecord }>('/api/agents', params);
    return res.agent;
  }

  /**
   * Attach an existing agent to an existing payment intent.
   * Returns the updated intent.
   */
  async attachAgentToIntent(intentId: string, agentId: string): Promise<IntentRecord> {
    const res = await this.patch<{ success: boolean; intent: IntentRecord }>(
      `/api/intents/${intentId}/agent`,
      { agentId },
    );
    return res.intent;
  }

  // -------------------------------------------------------------------------
  // Payments
  // -------------------------------------------------------------------------

  /**
   * Create a payment intent pre-linked to an agent (agent-centric default).
   */
  async payAsAgent(agentId: string, params: Omit<CreateIntentParams, 'agentId'>): Promise<IntentRecord> {
    return this.createIntent({ ...params, agentId });
  }

  /**
   * Create a payment intent with optional agent and protocol bindings.
   */
  async createIntent(params: CreateIntentParams): Promise<IntentRecord> {
    const res = await this.post<IntentRecord & { success?: boolean }>('/api/intents', {
      amount: params.amount,
      currency: params.currency ?? 'USDC',
      ...(params.agentId ? { agentId: params.agentId } : {}),
      ...(params.protocol ? { protocol: params.protocol } : {}),
      ...(params.metadata ? { metadata: params.metadata } : {}),
    });
    return res;
  }

  // -------------------------------------------------------------------------
  // Receipts
  // -------------------------------------------------------------------------

  /**
   * Return the public Agent Receipt URL for a given intent.
   *
   * The receipt page shows agent identity, escrow state, Solana explorer link,
   * trust score, protocol, and a server-generated verification signature.
   */
  openReceiptUrl(intentId: string): string {
    return `${this.receiptBaseUrl}/receipt/${intentId}`;
  }

  // -------------------------------------------------------------------------
  // Webhook Signatures
  // -------------------------------------------------------------------------

  /**
   * Verify an inbound AgentPay webhook signature.
   *
   * @param signature  - Value of the `x-agentpay-signature` header
   * @param timestamp  - Value of the `x-agentpay-timestamp` header
   * @param rawBody    - Raw request body string
   */
  verifyWebhookSignature(
    signature: string,
    timestamp: string,
    rawBody: string,
  ): WebhookVerificationResult {
    if (!this.webhookSecret) {
      return { valid: false, reason: 'webhookSecret not configured in SDK' };
    }
    return _computeAndVerifySignature(signature, timestamp, rawBody, this.webhookSecret);
  }

  // -------------------------------------------------------------------------
  // Internal HTTP helpers
  // -------------------------------------------------------------------------

  private async post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: this.authHeaders(),
      body: JSON.stringify(body),
    });
    return this.handleResponse<T>(res);
  }

  private async patch<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'PATCH',
      headers: this.authHeaders(),
      body: JSON.stringify(body),
    });
    return this.handleResponse<T>(res);
  }

  private authHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.apiKey}`,
    };
  }

  private async handleResponse<T>(res: Response): Promise<T> {
    const text = await res.text();
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      data = { message: text };
    }
    if (!res.ok) {
      const msg = (data as any)?.error ?? (data as any)?.message ?? `HTTP ${res.status}`;
      throw new Error(`AgentPaySDK: ${msg}`);
    }
    return data as T;
  }
}

// ---------------------------------------------------------------------------
// Internal shared helper
// ---------------------------------------------------------------------------

function _computeAndVerifySignature(
  signature: string,
  timestamp: string,
  rawBody: string,
  webhookSecret: string,
): WebhookVerificationResult {
  const REPLAY_WINDOW_MS = 5 * 60 * 1000;
  const tsMs = Number(timestamp) * 1000;
  if (Number.isNaN(tsMs)) {
    return { valid: false, reason: 'Invalid timestamp' };
  }
  if (Math.abs(Date.now() - tsMs) > REPLAY_WINDOW_MS) {
    return { valid: false, reason: 'Timestamp outside replay window' };
  }

  const expected = createHmac('sha256', webhookSecret)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex');

  let isValid: boolean;
  try {
    isValid = timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    isValid = false;
  }

  return isValid ? { valid: true } : { valid: false, reason: 'Signature mismatch' };
}

// ---------------------------------------------------------------------------
// Standalone helpers
// ---------------------------------------------------------------------------

/**
 * Verify an AgentPay webhook signature outside of a class instance.
 *
 * @param signature     - `x-agentpay-signature` header value
 * @param timestamp     - `x-agentpay-timestamp` header value
 * @param rawBody       - Raw request body string
 * @param webhookSecret - WEBHOOK_SECRET value
 */
export function verifyWebhookSignature(
  signature: string,
  timestamp: string,
  rawBody: string,
  webhookSecret: string,
): WebhookVerificationResult {
  return _computeAndVerifySignature(signature, timestamp, rawBody, webhookSecret);
}

export default AgentPaySDK;
