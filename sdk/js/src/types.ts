/** Metadata attached to a payment intent */
export type IntentMetadata = Record<string, unknown>;

/** Response from POST /api/intents */
export interface CreateIntentResponse {
  intentId: string;
  amount: number;
  currency: string;
  status: IntentStatus;
  expiresAt: string;
  metadata?: IntentMetadata;
}

/** Status values for a payment intent */
export type IntentStatus = 'pending' | 'verified' | 'expired' | 'failed';

/** Response from GET /api/intents/:intentId/status */
export interface IntentStatusResponse {
  intentId: string;
  status: IntentStatus;
  amount: number;
  currency: string;
  expiresAt: string;
  verifiedAt?: string;
  metadata?: IntentMetadata;
}

/** Certificate object for validation */
export interface Certificate {
  /** Base64-encoded or PEM certificate string */
  certificate: string;
  /** Algorithm used (e.g. "RS256") */
  algorithm?: string;
  [key: string]: unknown;
}

/** Response from POST /api/certificates/validate */
export interface ValidateCertificateResponse {
  valid: boolean;
  subject?: string;
  issuer?: string;
  expiresAt?: string;
  error?: string;
}

/** Configuration options for the AgentPay SDK client */
export interface AgentPayConfig {
  /** Base URL of the AgentPay API (e.g. https://api.agentpay.io) */
  baseUrl: string;
  /** API key for authentication */
  apiKey: string;
  /** Request timeout in milliseconds (default: 10000) */
  timeoutMs?: number;
}
