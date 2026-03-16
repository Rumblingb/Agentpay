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
  /** Base URL of the AgentPay API (e.g. https://api.agentpay.gg) */
  baseUrl: string;
  /** API key for authentication */
  apiKey: string;
  /** Request timeout in milliseconds (default: 10000) */
  timeoutMs?: number;
}

/** Configuration for a payment request */
export interface PaymentConfig {
  /** Amount in USDC */
  amount: number;
  /** Currency (default: "USDC") */
  currency?: string;
  /** Optional recipient identifier or wallet address */
  recipient?: string;
  /** Optional metadata to attach to the payment */
  metadata?: IntentMetadata;
}

/** Result returned from the pay() method */
export interface PaymentResult {
  /** ID of the created payment intent */
  intentId: string;
  /** Verification token for this payment */
  verificationToken: string;
  /** Solana Pay URI for wallet-based payments */
  solanaPayUri: string;
  /** Current payment status */
  status: PaymentStatus;
  /** When this payment intent expires */
  expiresAt: string;
}

/** High-level payment status for the pay() lifecycle */
export type PaymentStatus = 'created' | 'pending' | 'confirmed' | 'verified' | 'failed' | 'expired';
