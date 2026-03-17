import { HttpClient } from './http.js';
import {
  IntentExpiredError,
  VerificationFailedError,
  VerificationTimeoutError,
} from './errors.js';
import type {
  AgentPayConfig,
  AgentPassport,
  AgentPassportResponse,
  Certificate,
  CreateIntentResponse,
  DiscoverParams,
  DiscoverResponse,
  HireResponse,
  IntentMetadata,
  IntentStatusResponse,
  PaymentConfig,
  PaymentResult,
  ValidateCertificateResponse,
} from './types.js';

// ─── Public type exports ──────────────────────────────────────────────────────

export type {
  AgentPayConfig,
  AgentPassport,
  AgentPassportResponse,
  Certificate,
  CreateIntentResponse,
  DiscoverParams,
  DiscoverResponse,
  DiscoverSortBy,
  HireResponse,
  IntentMetadata,
  IntentStatus,
  IntentStatusResponse,
  PaymentConfig,
  PaymentResult,
  PaymentStatus,
  SplitEntry,
  ValidateCertificateResponse,
} from './types.js';

export {
  AgentPayError,
  IntentExpiredError,
  VerificationFailedError,
  VerificationTimeoutError,
} from './errors.js';

export { Agent } from './agent.js';

// ─── AgentPay SDK client ──────────────────────────────────────────────────────

/**
 * AgentPay SDK — payment infrastructure for AI agents.
 *
 * ```ts
 * import { AgentPay } from '@agentpay/sdk';
 *
 * const agentpay = new AgentPay({
 *   baseUrl: 'https://agentpay-api.apaybeta.workers.dev',
 *   apiKey: process.env.AGENTPAY_API_KEY!,
 * });
 *
 * // Create and pay in one call
 * const payment = await agentpay.pay({ amount: 5, purpose: 'Research task fee' });
 * console.log(payment.solanaPayUri); // open in any Solana wallet
 *
 * // Wait for on-chain confirmation
 * const result = await agentpay.verify(payment.intentId);
 * console.log(result.status); // 'verified'
 * ```
 */
export class AgentPay {
  private readonly client: HttpClient;

  constructor(private readonly config: AgentPayConfig) {
    this.client = new HttpClient(
      config.baseUrl,
      config.apiKey,
      config.timeoutMs,
    );
  }

  /**
   * Create a new payment intent.
   *
   * @param amount - Amount in USDC
   * @param currency - Currency code (default: "USDC")
   * @param metadata - Optional metadata to attach
   * @param purpose - Human-readable description (max 500 chars)
   */
  async createIntent(
    amount: number,
    currency = 'USDC',
    metadata?: IntentMetadata,
    purpose?: string,
  ): Promise<CreateIntentResponse> {
    return this.client.post<CreateIntentResponse>('/api/intents', {
      amount,
      currency,
      ...(metadata ? { metadata } : {}),
      ...(purpose ? { purpose } : {}),
    });
  }

  /**
   * Get the current status of a payment intent.
   *
   * @param intentId - ID of the intent to query
   */
  async getIntent(intentId: string): Promise<IntentStatusResponse> {
    return this.client.get<IntentStatusResponse>(
      `/api/v1/payment-intents/${intentId}`,
    );
  }

  /**
   * High-level helper: create an intent and return a PaymentResult with the
   * Solana Pay URI. For fully autonomous payments, follow up with verify().
   *
   * @param config - Payment configuration
   */
  async pay(config: PaymentConfig): Promise<PaymentResult> {
    const { amount, currency = 'USDC', recipient, metadata, purpose, splits } = config;

    const meta: IntentMetadata = {
      ...(metadata ?? {}),
      ...(recipient ? { recipient } : {}),
    };

    const intent = await this.client.post<CreateIntentResponse>('/api/intents', {
      amount,
      currency,
      ...(Object.keys(meta).length > 0 ? { metadata: meta } : {}),
      ...(purpose ? { purpose } : {}),
      ...(splits ? { splits } : {}),
    });

    const raw = intent as unknown as Record<string, unknown>;
    const solanaPayUri =
      (typeof raw.solanaPayUri === 'string' ? raw.solanaPayUri : undefined) ??
      (raw.instructions && typeof (raw.instructions as Record<string, unknown>).solanaPayUri === 'string'
        ? (raw.instructions as Record<string, unknown>).solanaPayUri as string
        : undefined) ??
      '';

    return {
      intentId: intent.intentId,
      verificationToken: typeof raw.verificationToken === 'string' ? raw.verificationToken : '',
      solanaPayUri,
      status: 'created',
      expiresAt: intent.expiresAt,
    };
  }

  /**
   * Verify that a payment intent has been confirmed on-chain.
   * Polls until verified, expired, failed, or timeout is exceeded.
   *
   * @param intentId - ID of the intent to verify
   * @param timeoutMs - Maximum polling duration in ms (default: 60_000)
   * @param pollIntervalMs - Polling interval in ms (default: 2_000)
   * @throws {IntentExpiredError} if the intent expires before verification
   * @throws {VerificationFailedError} if the intent reaches a failed state
   * @throws {VerificationTimeoutError} if the timeout is exceeded
   */
  async verify(
    intentId: string,
    timeoutMs = 60_000,
    pollIntervalMs = 2_000,
  ): Promise<IntentStatusResponse> {
    return waitForVerification(this.config, intentId, timeoutMs, pollIntervalMs);
  }

  /**
   * Retrieve an agent's AgentPassport — portable identity and trust record.
   *
   * @param agentId - The agent's unique identifier
   */
  async getPassport(agentId: string): Promise<AgentPassport> {
    const res = await this.client.get<AgentPassportResponse>(`/api/passport/${encodeURIComponent(agentId)}`);
    return res.passport;
  }

  /**
   * Discover agents on the AgentPay network.
   *
   * @param params - Search, filter, and sort parameters
   */
  async discover(params: DiscoverParams = {}): Promise<DiscoverResponse> {
    const qs = new URLSearchParams();
    if (params.q) qs.set('q', params.q);
    if (params.category) qs.set('category', params.category);
    if (params.minScore !== undefined) qs.set('minScore', String(params.minScore));
    if (params.sortBy) qs.set('sortBy', params.sortBy);
    if (params.limit !== undefined) qs.set('limit', String(params.limit));
    if (params.offset !== undefined) qs.set('offset', String(params.offset));
    const path = `/api/marketplace/discover${qs.toString() ? `?${qs}` : ''}`;
    return this.client.get<DiscoverResponse>(path);
  }

  /**
   * Hire an agent from the network with USDC escrow.
   *
   * @param agentId - ID of the agent to hire
   * @param amount - Amount in USDC
   * @param taskDescription - Description of the task
   * @param timeoutHours - Escrow timeout in hours (default: 72)
   */
  async hire(
    agentId: string,
    amount: number,
    taskDescription: string,
    timeoutHours = 72,
  ): Promise<HireResponse> {
    return this.client.post<HireResponse>('/api/marketplace/hire', {
      agentIdToHire: agentId,
      amountUsd: amount,
      taskDescription,
      timeoutHours,
    });
  }

  /**
   * Subscribe to the live marketplace SSE feed.
   * Returns an object with a close() method.
   * In Node.js, provide an EventSource polyfill (e.g. `eventsource` package).
   *
   * @param agentId - Optional agent ID to filter events
   * @param callback - Called for each event
   */
  subscribeFeed(
    agentId?: string,
    callback?: (event: Record<string, unknown>) => void,
  ): { close: () => void } {
    const url = `${this.config.baseUrl}/api/feed/stream${agentId ? `?agentId=${encodeURIComponent(agentId)}` : ''}`;
    const EventSourceCtor =
      typeof EventSource !== 'undefined'
        ? EventSource
        : (globalThis as Record<string, unknown>).EventSource as typeof EventSource | undefined;

    if (!EventSourceCtor) {
      throw new Error('EventSource not available. Install an SSE polyfill for Node.js (e.g. npm i eventsource).');
    }

    const es = new EventSourceCtor(url);
    if (callback) {
      es.onmessage = (e: MessageEvent) => {
        try { callback(JSON.parse(e.data as string) as Record<string, unknown>); }
        catch { callback({ raw: e.data as string }); }
      };
    }
    return { close: () => es.close() };
  }

  /** Register a one-time listener for a specific event type. */
  on(eventType: string, callback: (event: Record<string, unknown>) => void): { close: () => void } {
    return this.subscribeFeed(undefined, (event) => {
      if (event.type === eventType) callback(event);
    });
  }
}

// ─── Standalone function API ──────────────────────────────────────────────────

/**
 * Create a new payment intent (functional API).
 *
 * @example
 * ```ts
 * const intent = await createIntent(config, 5, { agentId: 'agent_abc' });
 * ```
 */
export async function createIntent(
  config: AgentPayConfig,
  amount: number,
  metadata?: IntentMetadata,
  purpose?: string,
): Promise<CreateIntentResponse> {
  const client = new HttpClient(config.baseUrl, config.apiKey, config.timeoutMs);
  return client.post<CreateIntentResponse>('/api/intents', {
    amount,
    ...(metadata ? { metadata } : {}),
    ...(purpose ? { purpose } : {}),
  });
}

/**
 * Retrieve the current status of a payment intent (functional API).
 */
export async function getIntentStatus(
  config: AgentPayConfig,
  intentId: string,
): Promise<IntentStatusResponse> {
  const client = new HttpClient(config.baseUrl, config.apiKey, config.timeoutMs);
  return client.get<IntentStatusResponse>(`/api/v1/payment-intents/${intentId}`);
}

/**
 * Poll until the intent reaches `verified` status or times out (functional API).
 *
 * @throws {IntentExpiredError} if the intent expires before verification
 * @throws {VerificationFailedError} if the intent reaches a failed state
 * @throws {VerificationTimeoutError} if the timeout is exceeded
 */
export async function waitForVerification(
  config: AgentPayConfig,
  intentId: string,
  timeoutMs = 60_000,
  pollIntervalMs = 2_000,
): Promise<IntentStatusResponse> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = await getIntentStatus(config, intentId);
    if (status.status === 'verified' || status.status === 'confirmed') return status;
    if (status.status === 'expired') throw new IntentExpiredError(intentId);
    if (status.status === 'failed') throw new VerificationFailedError(intentId);
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await sleep(Math.min(pollIntervalMs, remaining));
  }
  throw new VerificationTimeoutError(intentId, timeoutMs);
}

/**
 * Validate an agent certificate against the AgentPay certificate store.
 */
export async function validateCertificate(
  config: AgentPayConfig,
  certificate: Certificate,
): Promise<ValidateCertificateResponse> {
  const client = new HttpClient(config.baseUrl, config.apiKey, config.timeoutMs);
  return client.post<ValidateCertificateResponse>('/api/certificates/validate', certificate);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
