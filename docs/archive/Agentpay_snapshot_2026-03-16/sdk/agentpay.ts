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
 * NOTE — package boundary
 * -----------------------
 * This file (`sdk/agentpay.ts`) is the **monorepo server-side helper**.
 * It is used from within the `src/` server code and is NOT published to npm.
 *
 * External consumers should install the published npm package instead:
 *
 *   npm install @agentpay/sdk
 *
 * The published package lives in `sdk/js/` and has its own versioning,
 * build step, and exports.  The two have different API surfaces.
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
// Agent Interact — one-call orchestration (POST /api/v1/agents/interact)
// ---------------------------------------------------------------------------

/** Request shape for agentpay.interact() */
export interface InteractParams {
  /** ID of the calling / initiating agent */
  fromAgentId: string;
  /** ID of the target / counterparty agent */
  toAgentId: string;
  /** Nature of the interaction */
  interactionType: 'payment' | 'task' | 'query' | 'delegation' | 'custom';
  /** Optional service category (e.g. "web-scraping") */
  service?: string;
  /** Reported outcome — defaults to "success" */
  outcome?: 'success' | 'failure' | 'pending';
  /**
   * Transaction amount.
   * Required when `createIntent` is true — omitting it with createIntent=true
   * will result in a 400 Validation Error (hard fail).
   */
  amount?: number;
  /** Currency code — defaults to "USDC" */
  currency?: string;
  /** When true, fetch toAgent trust score from the reputation graph */
  trustCheck?: boolean;
  /**
   * When true, create a coordination intent via IntentCoordinatorAgent.
   * `amount` must also be provided; missing it is a 400 hard fail.
   */
  createIntent?: boolean;
  /** Arbitrary caller-supplied metadata */
  metadata?: Record<string, unknown>;
}

export interface InteractAgentInfo {
  agentId: string;
  /**
   * identityFound: a record for this agent exists in the system.
   * Does NOT imply any cryptographic verification has occurred.
   */
  identityFound: boolean;
  /**
   * identityVerified: the agent has at least one active, non-expired
   * verification credential — a stronger trust signal than identityFound.
   */
  identityVerified: boolean;
  trustLevel: string;
  /** Only present when trustCheck was true in the request */
  trustScore?: number | null;
}

export interface InteractTrustEvent {
  category: string;
  agentId: string;
  /** Counterparty agent in this interaction */
  counterpartyId: string;
  delta: number;
  score: number;
  grade: string;
  /** Rich metadata — includes interactionType, service, outcome, etc. */
  metadata: Record<string, unknown>;
}

/** Structured response from agentpay.interact() */
export interface InteractResult {
  success: boolean;
  interactionId: string;
  fromAgent: InteractAgentInfo;
  toAgent: InteractAgentInfo;
  interaction: {
    type: string;
    service: string | null;
    outcome: string;
    amount?: number;
    currency?: string;
    /** Whether a trust score lookup was performed */
    trustCheckPerformed: boolean;
    /** Whether a coordination intent was successfully created */
    intentCreated: boolean;
    metadata: Record<string, unknown> | null;
  };
  intent: object | null;
  emittedEvents: InteractTrustEvent[];
  warnings: string[];
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
   * One-call integration path for external agent ecosystems.
   *
   * Orchestrates identity verification, trust lookup, interaction recording,
   * trust event emission, and optional intent coordination in a single request.
   *
   * Recommended as the **fastest integration path** for Clawbot, AutoGPT,
   * LangGraph, CrewAI, and custom agents connecting to AgentPay.
   *
   * @example
   * const result = await agentpay.interact({
   *   fromAgentId: 'agent-abc',
   *   toAgentId:   'agent-xyz',
   *   interactionType: 'task',
   *   outcome: 'success',
   *   trustCheck: true,
   * });
   */
  async interact(params: InteractParams): Promise<InteractResult> {
    return this.post<InteractResult>('/api/v1/agents/interact', params);
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
