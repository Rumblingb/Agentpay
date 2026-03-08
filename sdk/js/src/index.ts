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

