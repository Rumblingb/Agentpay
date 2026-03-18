/**
 * Meridian → AgentPay API client
 * Thin fetch wrapper over api.agentpay.so
 */

const BASE = process.env.EXPO_PUBLIC_API_URL ?? 'https://api.agentpay.so';

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  const text = await res.text();
  let data: unknown;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) throw new Error((data as any)?.error ?? `API ${res.status}`);
  return data as T;
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface CoordinationPlan {
  coordinationId: string;
  intent: string;
  detectedCapabilities: string[];
  primaryCapability: string | null;
  budget: number | null;
  steps: Array<{ step: number; capability: string; status: string; assignedAgent: Agent | null }>;
  candidateAgents: Agent[];
  createdAt: string;
}

export interface Agent {
  agentId: string;
  name: string;
  category: string;
  description: string;
  capabilities: string[];
  pricePerTaskUsd: number | null;
  trustScore: number;
  grade: string;
  verified: boolean;
  passportUrl: string;
}

export interface HireResult {
  jobId: string;
  hirerId: string;
  agentId: string;
  agreedPriceUsdc: number;
  breakdown: { platformFee: number; platformFeePct: string; agentPayout: number };
  status: string;
  expiresAt: string;
}

export interface JobStatus {
  intentId?: string;
  jobId?: string;
  status: string;
  agentId?: string;
  completedAt?: string;
  payout?: { agentId: string; agentPayout: number; platformFee: number; currency: string };
}

export interface WalletInfo {
  balanceUsdc: number;
  reservedUsdc: number;
  availableUsdc: number;
  updatedAt: string | null;
}

export interface Receipt {
  intentId: string;
  status: string;
  amount: number;
  currency: string;
  agentId: string | null;
  merchantId: string | null;
  verifiedAt: string | null;
  signature: string;
}

// ── API calls ────────────────────────────────────────────────────────────────

/** Parse intent + find matching agents */
export async function coordinateIntent(params: {
  intent: string;
  budget?: number;
  callerAgentId?: string;
}): Promise<{ coordinationId: string; plan: CoordinationPlan; nextSteps: string[] }> {
  return apiFetch('/api/foundation-agents/intent', {
    method: 'POST',
    body: JSON.stringify({ ...params, autoHire: false }),
  });
}

/** Hire the selected agent for a job */
export async function hireAgent(params: {
  hirerId: string;
  agentId: string;
  jobDescription: string;
  agreedPriceUsdc: number;
}): Promise<{ success: boolean } & HireResult> {
  return apiFetch('/api/marketplace/hire', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

/** Mark a job complete */
export async function completeJob(jobId: string, hirerId: string): Promise<JobStatus> {
  return apiFetch(`/api/marketplace/hire/${jobId}/complete`, {
    method: 'POST',
    body: JSON.stringify({ hirerId }),
  });
}

/** Get agent passport / trust profile */
export async function getPassport(agentId: string): Promise<{ passport: any }> {
  return apiFetch(`/api/passport/${agentId}`);
}

/** Get hosted wallet balance */
export async function getWallet(agentId: string): Promise<{ wallet: WalletInfo }> {
  return apiFetch(`/api/v1/agents/${agentId}/wallet`);
}

/** Get receipt for a completed intent */
export async function getReceipt(intentId: string): Promise<Receipt> {
  return apiFetch(`/api/receipt/${intentId}`);
}

/** Poll job status via payment-intent endpoint */
export async function getIntentStatus(intentId: string): Promise<{
  intentId: string;
  status: string;
  amount: number;
  currency: string;
  metadata: any;
}> {
  return apiFetch(`/api/v1/payment-intents/${intentId}`);
}

/** Discover agents (text search) */
export async function discoverAgents(params: {
  q?: string;
  category?: string;
  limit?: number;
}): Promise<{ agents: Agent[] }> {
  const qs = new URLSearchParams();
  if (params.q) qs.set('q', params.q);
  if (params.category) qs.set('category', params.category);
  qs.set('limit', String(params.limit ?? 10));
  return apiFetch(`/api/marketplace/discover?${qs}`);
}
