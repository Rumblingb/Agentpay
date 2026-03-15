// Minimal public types for PR1. Conservative shapes; TODOs kept where backend parity must be verified.

export type RegisterRequest = {
  name: string;
  email: string;
  walletAddress: string;
  webhookUrl?: string | null;
};

export type RegisterResponse = {
  success: true;
  merchantId: string;
  apiKey: string;
  message: string;
};

export type Profile = {
  merchantId: string;
  email: string;
  name?: string;
  createdAt?: string;
};

export type Payment = {
  id: string; // transaction id (UUID) - canonical identifier used in method args
  paymentId: string; // payment id (UUID) for payment-level grouping
  ref?: string; // x402 display reference (optional)
  amountUsdc: number;
  recipientAddress: string;
  payerAddress?: string | null;
  transactionHash?: string | null;
  status: 'pending' | 'confirmed' | 'failed' | 'released' | string;
  confirmationDepth?: number;
  requiredDepth?: number;
  expiresAt?: string;
  createdAt: string;
  metadata?: Record<string, string>;
};

export type PaymentCreateRequest = {
  amountUsdc: number;
  recipientAddress: string;
  agentId?: string; // optional UUID
  protocol?: 'solana' | 'x402' | 'ap2' | 'acp';
  metadata?: Record<string, string>;
  expiryMinutes?: number;
};

export type PaymentListOptions = {
  limit?: number;
  offset?: number;
};

export type PaymentListResponse = {
  transactions: Payment[];
  stats?: {
    totalTransactions?: number;
    confirmedCount?: number;
    pendingCount?: number;
    failedCount?: number;
    totalConfirmedUsdc?: number;
  };
  pagination?: { limit: number; offset: number };
};

export type PaymentProof = {
  type?: string;
  payload?: any;
  signature?: string;
  algorithm?: string;
  metadata?: Record<string, any>;
};

export type PaymentVerificationResult = {
  id?: string;
  txHash?: string;
  // authoritative boolean when provided by server; SDK may fallback to status mapping
  verified: boolean;
  status?: string;
  verifiedAt?: string;
  confirmationDepth?: number;
  requiredDepth?: number;
  proof?: PaymentProof | null;
  raw?: any;
};

export type Stats = {
  totalTransactions?: number;
  confirmedCount?: number;
  pendingCount?: number;
  failedCount?: number;
  totalConfirmedUsdc?: number;
};
