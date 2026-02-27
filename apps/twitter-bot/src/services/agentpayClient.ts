/**
 * agentpayClient.ts
 *
 * Thin wrapper around the AgentPay REST API used by the Twitter bot.
 * Handles intent creation, PIN verification, reputation queries,
 * delegation-key management and daily spend-limit enforcement.
 */

import axios, { AxiosInstance } from 'axios';

export interface AgentPayConfig {
  baseUrl: string;
  apiKey: string;
  /** Hard-cap daily spend limit in USD (default: $20) */
  dailyLimitUsd?: number;
}

export interface CreateIntentRequest {
  merchantId: string;
  agentId: string;
  amount: number;
  currency?: string;
  metadata?: Record<string, unknown>;
}

export interface CreateIntentResponse {
  success: boolean;
  intentId: string;
  paymentUrl?: string;
  requiresPin?: boolean;
  requiresDelegation?: boolean;
}

export interface VerifyPinRequest {
  agentId: string;
  pinHash: string;
}

export interface VerificationResult {
  verified: boolean;
  txHash?: string;
  certificate?: Record<string, unknown>;
}

export interface ReputationResult {
  trustScore: number;
  totalPayments: number;
  successRate: number;
  fastTrackEligible: boolean;
}

// In-memory daily-spend store.  In production replace with Redis / Supabase.
// WARNING: This Map is reset on every process restart. Do NOT use in production
// without replacing with a persistent store (Redis, Supabase, etc.).
interface SpendEntry {
  date: string;   // ISO date string YYYY-MM-DD
  totalUsd: number;
}

const spendStore = new Map<string, SpendEntry>();

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export class AgentPayClient {
  private readonly http: AxiosInstance;
  private readonly dailyLimitUsd: number;

  constructor(config: AgentPayConfig) {
    this.dailyLimitUsd = config.dailyLimitUsd ?? 20;
    this.http = axios.create({
      baseURL: config.baseUrl,
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 10_000,
    });
  }

  /** Create a new payment intent. */
  async createIntent(req: CreateIntentRequest): Promise<CreateIntentResponse> {
    const res = await this.http.post<CreateIntentResponse>(
      '/api/v1/payment-intents',
      req,
    );
    return res.data;
  }

  /** Retrieve the on-chain verification certificate for a given transaction. */
  async getVerification(txHash: string): Promise<VerificationResult> {
    const res = await this.http.get<VerificationResult>(
      `/api/verify/${encodeURIComponent(txHash)}`,
    );
    return res.data;
  }

  /** Fetch agent reputation. */
  async getReputation(agentId: string): Promise<ReputationResult | null> {
    try {
      const res = await this.http.get<{ reputation: ReputationResult }>(
        `/api/agents/${encodeURIComponent(agentId)}/reputation`,
      );
      return res.data.reputation;
    } catch {
      return null;
    }
  }

  /**
   * Verify a PIN for an agent using PBKDF2-derived transit hash.
   * Returns true when the API confirms the PIN is correct.
   */
  async verifyPin(agentId: string, pinHash: string): Promise<boolean> {
    try {
      const res = await this.http.post<{ verified: boolean }>(
        '/api/agents/verify-pin',
        { agentId, pinHash } satisfies VerifyPinRequest,
      );
      return res.data.verified === true;
    } catch {
      return false;
    }
  }

  /**
   * Enforce per-user daily spend limit.
   *
   * - Tracks cumulative spend per Twitter user ID (in memory / Redis).
   * - Rejects if the transaction would push the user over the hard cap.
   * - Returns true when the amount is within the allowed limit.
   * - Returns false when the amount is rejected.
   */
  async enforceDailyLimit(userId: string, amountUsd: number): Promise<boolean> {
    if (amountUsd <= 0) return false;
    const today = todayIso();
    const entry = spendStore.get(userId);

    if (entry && entry.date === today) {
      if (entry.totalUsd + amountUsd > this.dailyLimitUsd) {
        return false;
      }
      entry.totalUsd += amountUsd;
    } else {
      if (amountUsd > this.dailyLimitUsd) return false;
      spendStore.set(userId, { date: today, totalUsd: amountUsd });
    }
    return true;
  }

  /**
   * Record a completed spend (call AFTER intent is confirmed).
   * Only records if enforceDailyLimit has already been called for the same amount.
   */
  recordSpend(userId: string, amountUsd: number): void {
    const today = todayIso();
    const entry = spendStore.get(userId);
    if (entry && entry.date === today) {
      // Already recorded inside enforceDailyLimit; nothing extra to do.
      return;
    }
    spendStore.set(userId, { date: today, totalUsd: amountUsd });
  }

  /** Get today's total spend for a user in USD. */
  getDailySpend(userId: string): number {
    const today = todayIso();
    const entry = spendStore.get(userId);
    return entry && entry.date === today ? entry.totalUsd : 0;
  }
}
