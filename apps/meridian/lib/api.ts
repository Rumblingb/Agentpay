/**
 * Meridian → AgentPay API client
 * Thin fetch wrapper over api.agentpay.so
 */

const BASE = process.env.EXPO_PUBLIC_API_URL ?? 'https://api.agentpay.so';

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...init,
      signal: init?.signal ?? AbortSignal.timeout(30_000),
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
    });
  } catch (e: any) {
    if (e.name === 'AbortError' || e.name === 'TimeoutError') {
      throw new Error('Request timed out — hold to try again.');
    }
    throw new Error('No connection — check your internet and try again.');
  }
  const text = await res.text();
  let data: unknown;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) {
    const serverMsg = (data as any)?.error ?? '';
    // Translate server errors into user-friendly messages
    if (res.status === 503) throw new Error('Service offline — try again in a moment.');
    if (res.status === 502 || res.status === 504 || res.status === 524) throw new Error('Bro is slow right now — try again.');
    if (res.status === 401 || res.status === 403) throw new Error('Not authorised — please restart the app.');
    throw new Error(serverMsg || `API error ${res.status}`);
  }
  return data as T;
}

// ── Types ─────────────────────────────────────────────────────────────────────

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

export interface RegisteredAgent {
  agentId: string;
  agentKey: string;
  passportUrl: string;
}

// ── API calls ─────────────────────────────────────────────────────────────────

/** Auto-register a new Meridian user as an AgentPay agent */
export async function registerAgent(params: {
  name: string;
  category?: string;
}): Promise<RegisteredAgent> {
  return apiFetch('/api/v1/agents/register', {
    method: 'POST',
    body: JSON.stringify({
      name: params.name,
      category: params.category ?? 'human_user',
      description: 'Bro user — voice-first agentic commerce',
      capabilities: ['hire', 'commission'],
      metadata: { source: 'bro_app', version: '1.0.0' },
    }),
  });
}

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
  stripePaymentIntentId?: string;
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

/** Match agents by intent (POST) */
export async function matchAgents(params: {
  intent: string;
  capability?: string;
  maxPriceUsd?: number;
  limit?: number;
}): Promise<{ agents: Agent[]; matched: number }> {
  return apiFetch('/api/agents/match', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

// ── Concierge ─────────────────────────────────────────────────────────────────

export interface ConciergeAction {
  toolName: string;
  displayName: string;
  agentId: string;
  agentName: string;
  jobId: string;
  agreedPriceUsdc: number;
  input: Record<string, unknown>;
  status: 'hired' | 'failed';
}

export interface ConciergePlanItem {
  toolName: string;
  toolUseId: string;
  agentId: string;
  agentName: string;
  displayName: string;
  estimatedPriceUsdc: number;
  input: Record<string, unknown>;
  /** Where the schedule data came from — shown as a source badge in the confirm card */
  dataSource?: 'darwin_live' | 'national_rail_scheduled' | 'irctc_live' | 'estimated';
}

export interface ConciergeResponse {
  narration: string;
  actions: ConciergeAction[];
  /** True when biometric confirmation is required before hire fires */
  needsBiometric?: boolean;
  /** Plan returned in phase 1 — pass back in phase 2 with confirmed: true */
  plan?: ConciergePlanItem[];
  estimatedPriceUsdc?: number;
  /** Fiat display amount — shown to user, never USDC */
  fiatAmount?: number;
  currencySymbol?: string;
  currencyCode?: string;
}

/** Phase 1: plan — Claude decides what to do, returns price. No hire yet. */
export async function conciergeIntent(params: {
  transcript: string;
  hirerId: string;
  travelProfile?: Record<string, unknown>;
}): Promise<ConciergeResponse> {
  return apiFetch('/api/concierge/intent', {
    method: 'POST',
    body: JSON.stringify({ ...params, confirmed: false }),
  });
}

/** Phase 2: execute — fires after biometric confirmation. Passes the plan back. */
export async function conciergeConfirm(params: {
  transcript: string;
  hirerId: string;
  travelProfile?: Record<string, unknown>;
  plan: ConciergePlanItem[];
}): Promise<ConciergeResponse> {
  return apiFetch('/api/concierge/intent', {
    method: 'POST',
    body: JSON.stringify({ ...params, confirmed: true }),
  });
}

/** Create a Stripe PaymentIntent for the given USDC amount (1 USDC ≈ £1) */
export async function createStripeSession(params: {
  amountUsdc: number;
  description?: string;
}): Promise<{ clientSecret: string; paymentIntentId: string; amountPence: number; amountGbp: string }> {
  return apiFetch('/api/marketplace/stripe-session', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}
