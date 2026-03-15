import { requestJson } from './http';
import {
  RegisterRequest,
  RegisterResponse,
  Profile,
  Payment,
  PaymentCreateRequest,
  PaymentListOptions,
  PaymentListResponse,
  PaymentVerificationResult,
  Stats,
} from './types';
import { readEnv } from './env';
import {
  AgentPayError,
  AuthError,
  PaymentError,
  VerificationError,
  NotFoundError,
} from './errors';

export type AgentPayClientOpts = { apiKey: string; baseUrl?: string };

export class AgentPayClient {
  public apiKey: string;
  public baseUrl: string;

  constructor(opts: { auth: { apiKey: string }; baseUrl?: string }) {
    const apiKey = opts?.auth?.apiKey ?? '';
    if (!apiKey) throw new AuthError('apiKey is required');
    this.apiKey = apiKey;
    this.baseUrl = opts.baseUrl ?? process.env.AGENTPAY_BASE_URL ?? '';
  }

  static fromEnv(): AgentPayClient {
    const { apiKey, baseUrl } = readEnv();
    return new AgentPayClient({ auth: { apiKey }, baseUrl });
  }

  // Static register: unauthenticated merchant registration
  static async register(req: RegisterRequest, baseUrl?: string): Promise<RegisterResponse> {
    // one-time API key handling warning
    // Consumers must persist the returned apiKey securely; SDK will not cache it.
    console.warn('AgentPayClient.register: returned apiKey is one-time; persist it securely.');
    const url = (baseUrl ?? process.env.AGENTPAY_BASE_URL ?? '').replace(/\/$/, '') + '/api/merchants/register';
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req),
      });
      const text = await res.text();
      const json = text ? JSON.parse(text) : undefined;
      if (!res.ok) {
        const msg = (json && (json.error || json.message)) || text || `HTTP ${res.status}`;
        if (res.status === 400) throw new Error(`Validation error: ${msg}`);
        throw new Error(msg);
      }
      // Backend returns { success, merchantId, apiKey, message }
      return json as RegisterResponse;
    } catch (err: any) {
      throw new AgentPayError(err?.message ?? String(err));
    }
  }

  async getProfile(): Promise<Profile> {
    return await requestJson<Profile>({ apiKey: this.apiKey, baseUrl: this.baseUrl, path: '/api/merchants/profile', method: 'GET' });
  }

  async pay(req: PaymentCreateRequest): Promise<Payment> {
    // Backend requires recipientAddress and amountUsdc; returns { transactionId, paymentId, amount, recipientAddress, instructions }
    const raw = await requestJson<any>({ apiKey: this.apiKey, baseUrl: this.baseUrl, path: '/api/merchants/payments', method: 'POST', body: req, context: 'payment' });
    // Normalize response into Payment shape when possible
    // Backend returns transactionId and paymentId; amount field is 'amount' (amountUsdc)
    const payment: Payment = {
      id: raw.transactionId,
      paymentId: raw.paymentId,
      amountUsdc: raw.amount ?? raw.amountUsdc,
      recipientAddress: raw.recipientAddress,
      payerAddress: raw.payerAddress ?? null,
      transactionHash: raw.transactionHash ?? null,
      status: 'pending',
      createdAt: new Date().toISOString(),
    } as Payment;
    return payment;
  }

  async getPayment(id: string): Promise<Payment> {
    return await requestJson<Payment>({ apiKey: this.apiKey, baseUrl: this.baseUrl, path: `/api/merchants/payments/${encodeURIComponent(id)}`, method: 'GET' });
  }

  async listPayments(opts?: PaymentListOptions): Promise<PaymentListResponse> {
    const qs: string[] = [];
    if (opts?.limit) qs.push(`limit=${encodeURIComponent(String(opts.limit))}`);
    if (opts?.offset) qs.push(`offset=${encodeURIComponent(String(opts.offset))}`);
    const path = '/api/merchants/payments' + (qs.length ? `?${qs.join('&')}` : '');
    const raw = await requestJson<any>({ apiKey: this.apiKey, baseUrl: this.baseUrl, path, method: 'GET' });
    // Backend returns { success: true, transactions, stats: {...}, pagination: { limit, offset } }
    const transactions = Array.isArray(raw.transactions) ? raw.transactions : [];
    const stats = raw.stats ? raw.stats : undefined;
    const pagination = raw.pagination ? raw.pagination : undefined;
    return { transactions, stats, pagination } as PaymentListResponse;
  }

  async verifyPayment(id: string, txHash: string): Promise<PaymentVerificationResult> {
    const raw = await requestJson<any>({ apiKey: this.apiKey, baseUrl: this.baseUrl, path: `/api/merchants/payments/${encodeURIComponent(id)}/verify`, method: 'POST', body: { txHash }, context: 'verification' });
    // Backend currently returns { status: "beta" } (deferred). Map conservatively.
    const status = raw?.status ?? raw;
    const verified = status === 'confirmed' || status === 'released';
    return { id, txHash, verified, status, raw } as PaymentVerificationResult;
  }

  async getStats(): Promise<Stats> {
    const raw = await requestJson<any>({ apiKey: this.apiKey, baseUrl: this.baseUrl, path: '/api/merchants/stats', method: 'GET' });
    // Backend returns { success: true, totalTransactions, confirmedCount, pendingCount, failedCount, totalConfirmedUsdc }
    return {
      totalTransactions: raw?.totalTransactions,
      confirmedCount: raw?.confirmedCount,
      pendingCount: raw?.pendingCount,
      failedCount: raw?.failedCount,
      totalConfirmedUsdc: raw?.totalConfirmedUsdc,
    } as Stats;
  }
}

export default AgentPayClient;
