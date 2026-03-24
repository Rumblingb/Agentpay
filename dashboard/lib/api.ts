/**
 * Backend API client.
 * Calls the AgentPay backend with the merchant's API key.
 */

// AGENTPAY_API_BASE_URL is a server-side-only variable (no NEXT_PUBLIC_ prefix).
// It must NOT be replaced with a NEXT_PUBLIC_ variable here — this module is
// imported exclusively by BFF API routes, and exposing the backend origin in a
// NEXT_PUBLIC_ variable would leak it into client-side bundles.
export const API_BASE =
  process.env.AGENTPAY_API_BASE_URL ||
  'http://localhost:8787';

export interface MerchantProfile {
  id: string;
  name: string;
  email: string;
  walletAddress: string;
  webhookUrl?: string | null;
  createdAt: string | null;
}

export interface PaymentStats {
  totalTransactions: number;
  confirmedCount: number;
  pendingCount: number;
  failedCount: number;
  totalConfirmedUsdc: number;
}

export interface Payment {
  id: string;
  paymentId: string;
  merchantId: string;
  amountUsdc: number;
  recipientAddress: string;
  status: 'pending' | 'confirmed' | 'failed' | 'expired';
  transactionHash?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WebhookSubscription {
  id: string;
  merchantId: string;
  url: string;
  events: string[];
  active: boolean;
  createdAt: string;
}

export interface WebhookDelivery {
  id: string;
  subscriptionId: string;
  event: string;
  status: 'pending' | 'delivered' | 'failed';
  attempts: number;
  responseCode?: number;
  createdAt: string;
}

function headers(apiKey: string) {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
}

export async function fetchProfile(apiKey: string): Promise<MerchantProfile> {
  const res = await fetch(`${API_BASE}/api/merchants/profile`, {
    headers: headers(apiKey),
  });
  if (!res.ok) throw new Error(`Profile fetch failed: ${res.status}`);
  return res.json();
}

export async function fetchStats(apiKey: string): Promise<PaymentStats> {
  const res = await fetch(`${API_BASE}/api/merchants/stats`, {
    headers: headers(apiKey),
  });
  if (!res.ok) throw new Error(`Stats fetch failed: ${res.status}`);
  const data = await res.json();
  return data;
}

export async function fetchPayments(
  apiKey: string,
  limit = 50,
  offset = 0,
): Promise<{ transactions: Payment[]; stats: PaymentStats }> {
  const res = await fetch(
    `${API_BASE}/api/merchants/payments?limit=${limit}&offset=${offset}`,
    { headers: headers(apiKey) },
  );
  if (!res.ok) throw new Error(`Payments fetch failed: ${res.status}`);
  return res.json();
}

export async function rotateApiKey(apiKey: string): Promise<{ apiKey: string }> {
  const res = await fetch(`${API_BASE}/api/merchants/rotate-key`, {
    method: 'POST',
    headers: headers(apiKey),
  });
  if (!res.ok) throw new Error(`Key rotation failed: ${res.status}`);
  return res.json();
}

export async function updateWebhookUrl(
  apiKey: string,
  webhookUrl: string | null,
): Promise<{ success: boolean; message: string }> {
  const res = await fetch(`${API_BASE}/api/merchants/profile/webhook`, {
    method: 'PATCH',
    headers: headers(apiKey),
    body: JSON.stringify({ webhookUrl }),
  });
  if (!res.ok) throw new Error(`Webhook update failed: ${res.status}`);
  return res.json();
}
