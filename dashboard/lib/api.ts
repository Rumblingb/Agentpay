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

export interface RcmWorkspace {
  workspaceId: string;
  name: string;
  legalName: string | null;
  workspaceType: string;
  specialty: string | null;
  timezone: string | null;
  status: string;
  approvalPolicy: Record<string, unknown>;
  config: Record<string, unknown>;
  openWorkItems: number;
  humanReviewCount: number;
  amountAtRiskOpen: number;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface RcmWorkItem {
  workItemId: string;
  workspaceId: string;
  workspaceName: string;
  assignedAgentId: string | null;
  workType: string;
  title: string;
  payerName: string | null;
  coverageType: string | null;
  patientRef: string | null;
  providerRef: string | null;
  claimRef: string | null;
  sourceSystem: string | null;
  amountAtRisk: number | null;
  confidencePct: number | null;
  priority: string;
  status: string;
  requiresHumanReview: boolean;
  dueAt: string | null;
  submittedAt: string | null;
  completedAt: string | null;
  metadata: Record<string, unknown>;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface RcmException {
  exceptionId: string;
  workItemId: string;
  workspaceName: string;
  payerName: string | null;
  claimRef: string | null;
  priority: string;
  exceptionType: string;
  severity: string;
  reasonCode: string | null;
  summary: string;
  confidencePct: number | null;
  amountAtRisk: number | null;
  requiredContextFields: string[];
  recommendedHumanAction: string | null;
  assignedReviewer: string | null;
  slaAt: string | null;
  openedAt: string | null;
  payload: Record<string, unknown>;
}

export interface RcmOverview {
  stage: string;
  queue: {
    totalWorkItems: number;
    totalOpen: number;
    autoClosedCount: number;
    humanClosedCount: number;
    blockedCount: number;
    rejectedCount: number;
    humanReviewCount: number;
    openExceptionCount: number;
    highSeverityExceptionCount: number;
    amountAtRiskOpen: number;
    avgConfidencePct: number | null;
    autoClosedPct: number;
    humanInterventionPct: number;
  };
  workspaces: {
    count: number;
  };
  firstLane: {
    key: string;
    label: string;
    reason: string;
    totalItems: number;
    openItems: number;
    openExceptions: number;
  };
}

export interface RcmConnectorStatus {
  key: string;
  label: string;
  status: 'live' | 'simulation' | 'manual_fallback';
  mode: 'remote' | 'simulation' | 'manual';
  configured: boolean;
  capabilities: string[];
  notes: string;
}

export async function fetchRcmOverview(apiKey: string): Promise<RcmOverview> {
  const res = await fetch(`${API_BASE}/api/rcm/metrics/overview`, {
    headers: headers(apiKey),
  });
  if (!res.ok) throw new Error(`RCM overview fetch failed: ${res.status}`);
  return res.json();
}

export async function fetchRcmWorkspaces(apiKey: string): Promise<{ items: RcmWorkspace[]; count: number }> {
  const res = await fetch(`${API_BASE}/api/rcm/workspaces`, {
    headers: headers(apiKey),
  });
  if (!res.ok) throw new Error(`RCM workspaces fetch failed: ${res.status}`);
  return res.json();
}

export async function fetchRcmClaimStatusWorkItems(
  apiKey: string,
  limit = 8,
): Promise<{ items: RcmWorkItem[]; count: number }> {
  const res = await fetch(
    `${API_BASE}/api/rcm/lanes/claim-status/work-items?limit=${limit}`,
    { headers: headers(apiKey) },
  );
  if (!res.ok) throw new Error(`RCM claim-status fetch failed: ${res.status}`);
  return res.json();
}

export async function fetchRcmClaimStatusExceptions(
  apiKey: string,
  limit = 6,
): Promise<{ items: RcmException[]; count: number }> {
  const res = await fetch(
    `${API_BASE}/api/rcm/queues/claim-status-exceptions?limit=${limit}`,
    { headers: headers(apiKey) },
  );
  if (!res.ok) throw new Error(`RCM exception fetch failed: ${res.status}`);
  return res.json();
}

export async function fetchRcmClaimStatusConnectors(
  apiKey: string,
): Promise<{ connectors: RcmConnectorStatus[] }> {
  const res = await fetch(`${API_BASE}/api/rcm/connectors/claim-status`, {
    headers: headers(apiKey),
  });
  if (!res.ok) throw new Error(`RCM connector fetch failed: ${res.status}`);
  return res.json();
}
