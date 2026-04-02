/**
 * Meridian → AgentPay API client
 * Thin fetch wrapper over api.agentpay.so
 */

import type { NearbyPlace, ProactiveCard, RouteData, TripContext } from '../../../packages/bro-trip/index';

const BASE    = process.env.EXPO_PUBLIC_API_URL ?? 'https://api.agentpay.so';
const BRO_KEY = process.env.EXPO_PUBLIC_BRO_KEY ?? '';

function requiresBroKey(path: string): boolean {
  return (
    path.startsWith('/api/concierge/') ||
    path.startsWith('/api/shared-travel/') ||
    path.startsWith('/api/trip-rooms/') ||
    path.startsWith('/api/support/')
  );
}

function missingBroKeyMessage(): string {
  return 'This Ace build needs an update before it can handle live trips. Please install the latest beta and try again.';
}

async function fetchWithTimeout(input: string, init: RequestInit = {}, timeoutMs = 30_000): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  if (!BRO_KEY && requiresBroKey(path)) {
    throw new Error(missingBroKeyMessage());
  }

  let res: Response;
  try {
    res = await fetchWithTimeout(`${BASE}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(BRO_KEY ? { 'x-bro-key': BRO_KEY } : {}),
        ...(init?.headers ?? {}),
      },
    }, 30_000);
  } catch (e: any) {
    if (e.name === 'AbortError' || e.name === 'TimeoutError') {
      throw new Error('Request timed out — hold to try again.');
    }
    throw new Error('Ace cannot reach the network right now. Try again in a moment.');
  }
  const text = await res.text();
  let data: unknown;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) {
    const serverMsg = (data as any)?.error ?? '';
    // Translate server errors into user-friendly messages
    if (res.status === 503) throw new Error('Service offline — try again in a moment.');
    if (res.status === 502 || res.status === 504 || res.status === 524) throw new Error('Ace is slow right now — try again.');
    if (res.status === 401 || res.status === 403) throw new Error('Not authorised — please restart the app.');
    throw new Error(serverMsg || `API error ${res.status}`);
  }
  return data as T;
}

// ── Types ─────────────────────────────────────────────────────────────────────

/** A family / travel companion sent to the Bro concierge in Phase 1 (no documents) */
export interface BroFamilyMember {
  id: string;
  name: string;
  relationship: 'adult' | 'child' | 'infant';
  dateOfBirth?: string;    // YYYY-MM-DD — used for child pricing and flight bookings
  railcard?: string;       // e.g. "senior", "16-25", "disabled"
  nationality?: string;
}

/** Travel preferences sent to Bro in Phase 1 — no identity or document data */
export interface BroTravelProfile {
  seatPreference?: string;
  classPreference?: string;
  railcardType?: string;
  indiaClassTier?: string;
  nationality?: string;
  subscriptionTier?: string;
  currentLat?: number;
  currentLon?: number;
  familyMembers?: BroFamilyMember[];
  sharedTravelUnit?: {
    id: string;
    name: string;
    type: 'couple' | 'family' | 'household';
    primaryPayerMemberId?: string | null;
    notes?: string;
    members: Array<{
      id: string;
      name: string;
      role: 'self' | 'partner' | 'adult' | 'child' | 'infant';
      state: 'self' | 'linked' | 'pending' | 'guest';
    }>;
  };
  // Phase 2 (full profile sent after biometric) may include additional fields
  [key: string]: unknown;
}

export interface SharedTravelInviteResult {
  ok: boolean;
  unitId: string;
  inviteId: string;
  inviteToken: string;
  status: 'pending';
  _note?: string;
}

export interface SharedTravelAcceptResult {
  ok: boolean;
  unitId: string;
  unitName: string;
  unitType: 'couple' | 'family' | 'household';
  inviterAgentId: string;
  inviterName?: string | null;
  role: 'partner' | 'adult' | 'child' | 'infant';
  linkedAgentId: string;
  status: 'accepted';
}

export interface SharedTravelRemoteUnit {
  unitId: string;
  ownerAgentId: string;
  unitName: string;
  unitType: 'couple' | 'family' | 'household';
  primaryPayerAgentId?: string | null;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

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
      description: 'Ace user — voice-first agentic commerce',
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

export interface ConciergeExecutionSnapshot {
  jobId: string;
  intentId: string;
  status: 'queued' | 'payment_pending' | 'fulfilment_pending' | 'confirmed' | 'failed' | 'rolled_back' | 'attention_required';
  bookingState: 'planned' | 'priced' | 'payment_pending' | 'payment_confirmed' | 'securing' | 'issued' | 'failed' | 'refunded';
  recoveryBucket: 'healthy' | 'awaiting_payment' | 'ready_for_dispatch' | 'stuck_securing' | 'fulfilment_failed' | 'issued' | 'refunded' | 'failed';
  summary: string;
  shouldEscalate: boolean;
  recommendedAction: 'none' | 'retry_dispatch' | 'escalate_manual';
  recoveryReason: string;
  manualReviewRequired: boolean;
  asyncExecution: boolean;
  pendingFulfilment: boolean;
  paymentConfirmed: boolean;
  fulfilmentFailed: boolean;
  retryCount: number;
  quoteExpiresAt: string | null;
  paymentConfirmedAt: string | null;
  dispatchStartedAt: string | null;
  rerouteOfferActionLabel: string | null;
  updatedAt: string | null;
}

export async function getConciergeExecution(jobId: string): Promise<ConciergeExecutionSnapshot> {
  return apiFetch(`/api/concierge/executions/${jobId}`);
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
  tripContext?: TripContext;
  shareToken?: string;
  journeyId?: string;
  legIndex?: number;
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
  dataSource?:
    | 'darwin_live'
    | 'national_rail_scheduled'
    | 'irctc_live'
    | 'estimated'
    | 'eu_live'
    | 'eu_scheduled'
    | 'global_rail_live'
    | 'global_rail_scheduled'
    | 'bus_live'
    | 'bus_scheduled';
  /** TfL final-leg (only present when arriving at a London terminus) */
  finalLegSummary?: string;
  /** Route payload for navigate flows and non-London final legs */
  routeData?: RouteData;
  /** Nearby place results for discovery and restaurant flows */
  nearbyPlaces?: NearbyPlace[];
  /** Flight details - present for search_flights / book_flight tools */
  flightDetails?: {
    origin: string;
    destination: string;
    departureAt: string;
    arrivalAt: string;
    carrier: string;
    flightNumber: string;
    totalAmount: number;
    currency: string;
    stops: number;
    durationMinutes: number;
    cabinClass: string;
    offerId: string;
    offerExpiresAt: string;
    isReturn: boolean;
    /** Set after Phase 2 booking completes */
    pnr?: string;
  };
  /** Hotel details — present for book_hotel tool */
  hotelDetails?: {
    city: string;
    checkIn: string;
    checkOut: string;
    bestOption: {
      name: string;
      stars: number;
      ratePerNight: number;
      totalCost: number;
      currency: string;
      area: string;
      isLive: boolean;
      bookingUrl?: string;
    };
    allOptions?: Array<{
      name: string;
      stars: number;
      ratePerNight: number;
      totalCost: number;
      currency: string;
      area: string;
      isLive: boolean;
      bookingUrl?: string;
    }>;
  };
  tripContext?: TripContext;
  /** Shared ID linking all legs of a multi-modal journey */
  journeyId?: string;
  /** Zero-based position of this leg in a multi-modal journey */
  legIndex?: number;
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
  /** Shared ID linking all legs of a multi-modal journey — present when plan.length > 1 */
  journeyId?: string;
  tripContext?: TripContext;
  proactiveCards?: ProactiveCard[];
  /** Frequent route detected from trip history — shown as idle suggestion */
  usualRoute?: { origin: string; destination: string; count: number; typicalFareGbp?: number };
}

function isAsyncEligibleConciergePlan(plan: ConciergePlanItem[]): boolean {
  return plan.length === 1
    && (plan[0]?.toolName === 'book_train' || plan[0]?.toolName === 'book_train_india');
}

/** Phase 1: plan — Claude decides what to do, returns price. No hire yet. */
export async function conciergeIntent(params: {
  transcript: string;
  hirerId: string;
  travelProfile?: BroTravelProfile;
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
  travelProfile?: BroTravelProfile;
  plan: ConciergePlanItem[];
}): Promise<ConciergeResponse> {
  if (isAsyncEligibleConciergePlan(params.plan)) {
    try {
      return await apiFetch('/api/concierge/confirm', {
        method: 'POST',
        body: JSON.stringify(params),
      });
    } catch (e: any) {
      const msg = String(e?.message ?? '');
      if (!msg.includes('ASYNC_CONFIRM_UNAVAILABLE') && !msg.includes('API error 404')) {
        throw e;
      }
    }
  }

  return apiFetch('/api/concierge/intent', {
    method: 'POST',
    body: JSON.stringify({ ...params, confirmed: true }),
  });
}

/** Create a Stripe Checkout Session — returns a hosted URL, no native SDK needed */
export async function createCheckoutSession(params: {
  jobId: string;
  journeyId?: string;
  amountFiat: number;
  currencyCode?: string;
  description?: string;
}): Promise<{ url: string; sessionId: string }> {
  return apiFetch('/api/marketplace/checkout-session', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export async function createUpiPaymentLink(params: {
  jobId: string;
  journeyId?: string;
  amountInr: number;
  description?: string;
  customerName?: string;
  customerPhone?: string;
  customerEmail?: string;
}): Promise<{ shortUrl: string; paymentLinkId: string; upiQrString: string }> {
  return apiFetch('/api/marketplace/upi-payment-link', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export async function reportIssue(params: {
  intentId: string;
  bookingRef?: string | null;
  description: string;
  hirerId: string;
}): Promise<void> {
  await apiFetch('/api/support/issue', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export async function registerJobWatch(jobId: string, pushToken: string): Promise<void> {
  await apiFetch('/api/concierge/watch', {
    method: 'POST',
    body: JSON.stringify({ jobId, pushToken }),
  }).catch(() => {}); // fire-and-forget — never block receipt display
}

export async function fetchFxRate(from: string, to: string): Promise<number | null> {
  const query = new URLSearchParams({ from, to });
  const response = await apiFetch<{ rate?: number }>(`/api/concierge/fx-rate?${query.toString()}`);
  return typeof response.rate === 'number' ? response.rate : null;
}

export async function logClientTelemetry(params: {
  event: string;
  screen: string;
  severity?: 'info' | 'warning' | 'error';
  message?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await apiFetch('/api/concierge/telemetry', {
    method: 'POST',
    body: JSON.stringify(params),
  }).catch(() => {});
}

export async function createSharedTravelInvite(params: {
  agentId: string;
  agentKey: string;
  unitName: string;
  unitType: 'couple' | 'family' | 'household';
  inviteeContact: string;
  inviteeName?: string;
  role?: 'partner' | 'adult' | 'child' | 'infant';
  notes?: string;
  primaryPayerAgentId?: string | null;
}): Promise<SharedTravelInviteResult> {
  return apiFetch('/api/shared-travel/invite', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export async function acceptSharedTravelInvite(params: {
  inviteToken: string;
  agentId: string;
  agentKey: string;
  acceptedName?: string;
}): Promise<SharedTravelAcceptResult> {
  return apiFetch(`/api/shared-travel/accept/${encodeURIComponent(params.inviteToken)}`, {
    method: 'POST',
    body: JSON.stringify({
      agentId: params.agentId,
      agentKey: params.agentKey,
      acceptedName: params.acceptedName,
    }),
  });
}

export async function listSharedTravelUnits(params: {
  agentId: string;
  agentKey: string;
}): Promise<{ units: SharedTravelRemoteUnit[] }> {
  return apiFetch(`/api/shared-travel/units/${encodeURIComponent(params.agentId)}`, {
    headers: {
      'x-agent-key': params.agentKey,
    },
  });
}
