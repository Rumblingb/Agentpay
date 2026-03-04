/**
 * Lightweight AgentPay API client for the Twitter bot.
 */

export interface AgentPayConfig {
  baseUrl: string;
  apiKey: string;
  /** Base URL of the dashboard (defaults to baseUrl if not provided) */
  dashboardUrl?: string;
}

export interface TipIntentResult {
  success: boolean;
  transactionId: string;
  paymentId: string;
  amount: number;
  recipientAddress: string;
}

export interface VerifyTipResult {
  success: boolean;
  valid: boolean;
  transactionId?: string;
  error?: string;
}

export interface StreamerTipIntent {
  success: boolean;
  tipId: string;
  sessionUrl?: string;
  qrCodeUrl?: string;
}

export class AgentPayClient {
  constructor(private readonly config: AgentPayConfig) {}

  async createTipIntent(
    streamerId: string,
    amount: number,
    currency: 'USDC' | 'USD' = 'USDC',
    memo?: string
  ): Promise<StreamerTipIntent> {
    const res = await fetch(`${this.config.baseUrl}/api/streamers/${streamerId}/tip-intent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({ amount, currency, memo }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Unknown error' })) as { error?: string };
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    return res.json() as Promise<StreamerTipIntent>;
  }

  async verifyTip(txHash: string): Promise<VerifyTipResult> {
    const res = await fetch(`${this.config.baseUrl}/api/v1/verify-payment`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({ transactionSignature: txHash }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Unknown error' })) as { error?: string };
      return { success: false, valid: false, error: err.error || `HTTP ${res.status}` };
    }
    const data = await res.json() as { success: boolean; data?: { transactionId?: string } };
    return { success: true, valid: data.success, transactionId: data.data?.transactionId };
  }

  getOverlayUrl(streamerId: string): string {
    const base = this.config.dashboardUrl ?? this.config.baseUrl;
    return `${base}/overlay/${streamerId}`;
  }

  getTipPageUrl(streamerId: string): string {
    const base = this.config.dashboardUrl ?? this.config.baseUrl;
    return `${base}/tip/${streamerId}`;
  }
}
