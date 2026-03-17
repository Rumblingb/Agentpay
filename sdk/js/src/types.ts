/** Arbitrary metadata attached to a payment intent */
export type IntentMetadata = Record<string, unknown>;

// ─── Payment Intents ──────────────────────────────────────────────────────────

/** Status values for a payment intent */
export type IntentStatus = 'pending' | 'verified' | 'expired' | 'failed' | 'confirmed' | 'completed';

/** High-level payment lifecycle status returned by pay() */
export type PaymentStatus = 'created' | 'pending' | 'confirmed' | 'verified' | 'failed' | 'expired';

/** Response from POST /api/intents or POST /api/v1/payment-intents */
export interface CreateIntentResponse {
  intentId: string;
  amount: number;
  currency: string;
  status: IntentStatus;
  expiresAt: string;
  /** Solana Pay URI for wallet-based payment */
  solanaPayUri?: string;
  /** Verification token to include as Solana memo */
  verificationToken?: string;
  /** Human-readable description of what this payment is for */
  purpose?: string;
  /** Split distribution (if configured) */
  splits?: SplitEntry[];
  metadata?: IntentMetadata;
}

/** Response from GET /api/v1/payment-intents/:id */
export interface IntentStatusResponse {
  intentId: string;
  status: IntentStatus;
  amount: number;
  currency: string;
  expiresAt: string;
  verifiedAt?: string;
  purpose?: string;
  metadata?: IntentMetadata;
}

/** Result returned from the pay() method */
export interface PaymentResult {
  /** ID of the created payment intent */
  intentId: string;
  /** Verification token for this payment (include as Solana memo) */
  verificationToken: string;
  /** Solana Pay URI — open in any Solana wallet to pay */
  solanaPayUri: string;
  /** Current payment status */
  status: PaymentStatus;
  /** When this payment intent expires (ISO 8601) */
  expiresAt: string;
}

/** Configuration for a payment request */
export interface PaymentConfig {
  /** Amount in USDC (or configured currency) */
  amount: number;
  /** Currency (default: "USDC") */
  currency?: string;
  /** Optional recipient Solana wallet address */
  recipient?: string;
  /** Human-readable description of what this payment is for (max 500 chars) */
  purpose?: string;
  /** Optional metadata to attach to the intent */
  metadata?: IntentMetadata;
  /** Optional split distribution — must sum to 10000 bps */
  splits?: SplitEntry[];
}

/** A single split recipient entry */
export interface SplitEntry {
  /** Solana wallet address of the recipient */
  address: string;
  /** Basis points of the net amount (100 bps = 1%). All splits must sum to 10000. */
  bps: number;
}

// ─── SDK Configuration ────────────────────────────────────────────────────────

/** Configuration options for the AgentPay SDK client */
export interface AgentPayConfig {
  /** Base URL of the AgentPay API */
  baseUrl: string;
  /** Merchant API key for authenticated operations */
  apiKey: string;
  /** Request timeout in milliseconds (default: 10000) */
  timeoutMs?: number;
}

// ─── AgentPassport ────────────────────────────────────────────────────────────

/** An agent's portable identity and trust record */
export interface AgentPassport {
  /** Unique agent identifier */
  agentId: string;
  /** Display name */
  name: string;
  /** Agent's primary capability class */
  capability?: string;
  /** Trust / AgentRank score (0–100) */
  trustScore?: number;
  /** Total confirmed interactions */
  interactionCount: number;
  /** Successful interaction rate (0–1) */
  successRate?: number;
  /** Number of disputes filed against this agent */
  disputeCount?: number;
  /** Whether identity has been verified */
  verified: boolean;
  /** ISO 8601 timestamp of first recorded interaction */
  foundingMember?: boolean;
  /** ISO 8601 timestamp of registration */
  registeredAt: string;
  /** Last activity timestamp */
  lastActiveAt?: string;
  /** Public profile URL */
  profileUrl: string;
}

/** Response from GET /api/passport/:agentId */
export interface AgentPassportResponse {
  success: boolean;
  passport: AgentPassport;
}

// ─── Certificates ─────────────────────────────────────────────────────────────

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

// ─── Marketplace ──────────────────────────────────────────────────────────────

/** Sort modes for agent discovery */
export type DiscoverSortBy = 'best_match' | 'cheapest' | 'fastest' | 'score' | 'volume' | 'recent';

/** Parameters for agent discovery */
export interface DiscoverParams {
  /** Free-text search query */
  q?: string;
  /** Filter by capability category */
  category?: string;
  /** Minimum AgentRank trust score */
  minScore?: number;
  /** Sort order */
  sortBy?: DiscoverSortBy;
  /** Maximum results (default 20, max 100) */
  limit?: number;
  /** Pagination offset */
  offset?: number;
}

/** A discovered agent listing */
export interface AgentListing {
  agentId: string;
  name: string;
  capability?: string;
  trustScore?: number;
  interactionCount: number;
  successRate?: number;
  verified: boolean;
  profileUrl: string;
}

/** Response from GET /api/marketplace/discover */
export interface DiscoverResponse {
  agents: AgentListing[];
  total: number;
  limit: number;
  offset: number;
}

/** Response from POST /api/marketplace/hire */
export interface HireResponse {
  success: boolean;
  escrowId: string;
  agentId: string;
  amountUsdc: number;
  taskDescription: string;
  expiresAt: string;
}
