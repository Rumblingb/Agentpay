import { HttpClient } from './http.js';
import {
  IntentExpiredError,
  VerificationFailedError,
  VerificationTimeoutError,
} from './errors.js';
import type {
  AgentPayConfig,
  AgentPayAgentConfig,
  AgentIntentStatusResponse,
  Certificate,
  CreateIntentResponse,
  CreateAgentIntentResponse,
  IntentMetadata,
  IntentStatusResponse,
  ValidateCertificateResponse,
} from './types.js';

export type {
  AgentPayConfig,
  AgentPayAgentConfig,
  AgentIntentInstructions,
  AgentIntentStatusResponse,
  Certificate,
  CreateAgentIntentResponse,
  CreateIntentResponse,
  CryptoInstructions,
  FiatInstructions,
  IntentMetadata,
  IntentStatus,
  IntentStatusResponse,
  ValidateCertificateResponse,
} from './types.js';

export {
  AgentPayError,
  IntentExpiredError,
  VerificationFailedError,
  VerificationTimeoutError,
} from './errors.js';

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

/**
 * Create a new agent-initiated payment intent without a merchant API key.
 * Agents use this to initiate payments by specifying the merchant ID they want to pay.
 *
 * @param config - Agent SDK configuration (no API key required)
 * @param merchantId - UUID of the merchant to pay
 * @param agentId - Identifier of the paying agent (wallet address or arbitrary ID)
 * @param amount - Amount in the given currency (e.g. USDC)
 * @param currency - Payment currency, defaults to 'USDC'
 * @param metadata - Optional key/value metadata to attach to the intent
 */
export async function createAgentIntent(
  config: AgentPayAgentConfig,
  merchantId: string,
  agentId: string,
  amount: number,
  currency = 'USDC',
  metadata?: IntentMetadata,
): Promise<CreateAgentIntentResponse> {
  const client = new HttpClient(config.baseUrl, undefined, config.timeoutMs);
  return client.post<CreateAgentIntentResponse>('/api/v1/payment-intents', {
    merchantId,
    agentId,
    amount,
    currency,
    ...(metadata ? { metadata } : {}),
  });
}

/**
 * Retrieve the current status of an agent-initiated payment intent.
 * This is a public endpoint — no API key required.
 *
 * @param config - Agent SDK configuration
 * @param intentId - ID of the intent to query
 */
export async function getAgentIntentStatus(
  config: AgentPayAgentConfig,
  intentId: string,
): Promise<AgentIntentStatusResponse> {
  const client = new HttpClient(config.baseUrl, undefined, config.timeoutMs);
  return client.get<AgentIntentStatusResponse>(`/api/v1/payment-intents/${intentId}`);
}

/**
 * Poll until an agent intent reaches `verified` status or times out.
 *
 * @param config - Agent SDK configuration
 * @param intentId - ID of the intent to watch
 * @param timeoutMs - Maximum time to wait in milliseconds (default: 60_000)
 * @param pollIntervalMs - Polling interval in milliseconds (default: 2_000)
 * @throws {IntentExpiredError} if the intent expires before verification
 * @throws {VerificationFailedError} if the intent reaches a failed state
 * @throws {VerificationTimeoutError} if the timeout is exceeded
 */
export async function waitForAgentVerification(
  config: AgentPayAgentConfig,
  intentId: string,
  timeoutMs = 60_000,
  pollIntervalMs = 2_000,
): Promise<AgentIntentStatusResponse> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const status = await getAgentIntentStatus(config, intentId);

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
