import { HttpClient } from './http.js';
import {
  IntentExpiredError,
  VerificationFailedError,
  VerificationTimeoutError,
} from './errors.js';
import type {
  AgentPayConfig,
  Certificate,
  CreateIntentResponse,
  IntentMetadata,
  IntentStatusResponse,
  PaymentConfig,
  PaymentResult,
  ValidateCertificateResponse,
} from './types.js';

export type {
  AgentPayConfig,
  Certificate,
  CreateIntentResponse,
  IntentMetadata,
  IntentStatus,
  IntentStatusResponse,
  PaymentConfig,
  PaymentResult,
  PaymentStatus,
  ValidateCertificateResponse,
} from './types.js';

export {
  AgentPayError,
  IntentExpiredError,
  VerificationFailedError,
  VerificationTimeoutError,
} from './errors.js';

/**
 * Class-based AgentPay SDK client.
 *
 * Allows AI agents to create and execute payments with minimal code:
 *
 * ```ts
 * const agentpay = new AgentPay({ apiKey: process.env.AGENTPAY_API_KEY });
 * const payment = await agentpay.pay({ amount: 1, currency: 'USDC' });
 * console.log(payment.status);
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
   */
  async createIntent(
    amount: number,
    currency = 'USDC',
    metadata?: IntentMetadata,
  ): Promise<CreateIntentResponse> {
    return this.client.post<CreateIntentResponse>('/api/intents', {
      amount,
      currency,
      ...(metadata ? { metadata } : {}),
    });
  }

  /**
   * Get the current status of a payment intent.
   *
   * @param intentId - ID of the intent to query
   */
  async getIntent(intentId: string): Promise<IntentStatusResponse> {
    return this.client.get<IntentStatusResponse>(
      `/api/intents/${intentId}/status`,
    );
  }

  /**
   * High-level helper: create an intent and return a PaymentResult with the
   * Solana Pay URI. For fully autonomous payments, follow up with verify().
   *
   * @param config - Payment configuration (amount, currency, recipient, metadata)
   */
  async pay(config: PaymentConfig): Promise<PaymentResult> {
    const { amount, currency = 'USDC', recipient, metadata } = config;

    const meta: IntentMetadata = {
      ...(metadata ?? {}),
      ...(recipient ? { recipient } : {}),
    };

    const intent = await this.createIntent(
      amount,
      currency,
      Object.keys(meta).length > 0 ? meta : undefined,
    );

    // Extract the Solana Pay URI from the instructions if present
    const solanaPayUri =
      (intent as any).instructions?.solanaPayUri ??
      (intent as any).solanaPayUri ??
      '';

    return {
      intentId: intent.intentId,
      verificationToken: (intent as any).verificationToken ?? '',
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
   */
  async verify(
    intentId: string,
    timeoutMs = 60_000,
    pollIntervalMs = 2_000,
  ): Promise<IntentStatusResponse> {
    return waitForVerification(this.config, intentId, timeoutMs, pollIntervalMs);
  }

  /**
   * Discover agents on the AgentPay marketplace.
   *
   * @param params.q        - Free-text search query
   * @param params.category - Filter by agent category
   * @param params.minScore - Minimum AgentRank score
   * @param params.sortBy   - Sort mode: 'best_match' | 'cheapest' | 'fastest' | 'score'
   * @param params.limit    - Max results to return (default 20)
   */
  async discover(params: {
    q?: string;
    category?: string;
    minScore?: number;
    sortBy?: 'best_match' | 'cheapest' | 'fastest' | 'score' | 'volume' | 'recent';
    limit?: number;
    offset?: number;
  } = {}): Promise<any> {
    const qs = new URLSearchParams();
    if (params.q) qs.set('q', params.q);
    if (params.category) qs.set('category', params.category);
    if (params.minScore !== undefined) qs.set('minScore', String(params.minScore));
    if (params.sortBy) qs.set('sortBy', params.sortBy);
    if (params.limit !== undefined) qs.set('limit', String(params.limit));
    if (params.offset !== undefined) qs.set('offset', String(params.offset));
    const path = `/api/marketplace/discover${qs.toString() ? `?${qs}` : ''}`;
    return this.client.get<any>(path);
  }

  /**
   * Hire an agent from the marketplace with USDC escrow.
   *
   * @param agentId         - ID of the agent to hire
   * @param amount          - Amount in USDC
   * @param taskDescription - Description of the task
   * @param timeoutHours    - Escrow timeout in hours (default: 72)
   */
  async hire(
    agentId: string,
    amount: number,
    taskDescription: string,
    timeoutHours = 72,
  ): Promise<any> {
    return this.client.post<any>('/api/marketplace/hire', {
      agentIdToHire: agentId,
      amountUsd: amount,
      taskDescription,
      timeoutHours,
    });
  }

  /**
   * Subscribe to the live marketplace SSE feed.
   *
   * Returns an EventSource-compatible object. Call .close() to unsubscribe.
   * Only available in browser environments — in Node.js use a polyfill.
   *
   * @param agentId - Optional agent ID to filter events
   * @param callback - Called for each marketplace event
   */
  subscribeFeed(
    agentId?: string,
    callback?: (event: any) => void,
  ): { close: () => void } {
    const url = `${this.config.baseUrl}/api/feed/stream${agentId ? `?agentId=${encodeURIComponent(agentId)}` : ''}`;

    // Use EventSource in browser; in Node.js caller provides a polyfill
    const EventSourceCtor =
      typeof EventSource !== 'undefined'
        ? EventSource
        : (globalThis as any).EventSource;

    if (!EventSourceCtor) {
      throw new Error('EventSource not available. Install an SSE polyfill (e.g. eventsource) for Node.js.');
    }

    const es = new EventSourceCtor(url) as EventSource;

    if (callback) {
      es.onmessage = (e: MessageEvent) => {
        try {
          callback(JSON.parse(e.data));
        } catch {
          callback(e.data);
        }
      };
    }

    return { close: () => es.close() };
  }

  /** Register a one-time listener for a specific event type on the feed. */
  on(eventType: string, callback: (event: any) => void): { close: () => void } {
    const subscription = this.subscribeFeed(undefined, (event) => {
      if (event && event.type === eventType) {
        callback(event);
      }
    });
    return subscription;
  }
}

/**
 * Create a new payment intent.
 *
 * @param config - SDK configuration (baseUrl, apiKey, timeoutMs)
 * @param amount - Amount to charge (in the currency's smallest unit, e.g. cents)
 * @param metadata - Optional key/value metadata to attach to the intent
 */
export async function createIntent(
  config: AgentPayConfig,
  amount: number,
  metadata?: IntentMetadata,
): Promise<CreateIntentResponse> {
  const client = new HttpClient(
    config.baseUrl,
    config.apiKey,
    config.timeoutMs,
  );
  return client.post<CreateIntentResponse>('/api/intents', {
    amount,
    ...(metadata ? { metadata } : {}),
  });
}

/**
 * Retrieve the current status of a payment intent.
 *
 * @param config - SDK configuration
 * @param intentId - ID of the intent to query
 */
export async function getIntentStatus(
  config: AgentPayConfig,
  intentId: string,
): Promise<IntentStatusResponse> {
  const client = new HttpClient(
    config.baseUrl,
    config.apiKey,
    config.timeoutMs,
  );
  return client.get<IntentStatusResponse>(`/api/intents/${intentId}/status`);
}

/**
 * Poll until the intent reaches `verified` status or times out.
 *
 * @param config - SDK configuration
 * @param intentId - ID of the intent to watch
 * @param timeoutMs - Maximum time to wait in milliseconds (default: 60_000)
 * @param pollIntervalMs - Polling interval in milliseconds (default: 2_000)
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

    if (status.status === 'verified') {
      return status;
    }
    if (status.status === 'expired') {
      throw new IntentExpiredError(intentId);
    }
    if (status.status === 'failed') {
      throw new VerificationFailedError(intentId);
    }

    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await sleep(Math.min(pollIntervalMs, remaining));
  }

  throw new VerificationTimeoutError(intentId, timeoutMs);
}

/**
 * Validate an agent certificate against the AgentPay certificate store.
 *
 * @param config - SDK configuration
 * @param certificate - Certificate object to validate
 */
export async function validateCertificate(
  config: AgentPayConfig,
  certificate: Certificate,
): Promise<ValidateCertificateResponse> {
  const client = new HttpClient(
    config.baseUrl,
    config.apiKey,
    config.timeoutMs,
  );
  return client.post<ValidateCertificateResponse>(
    '/api/certificates/validate',
    certificate,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

