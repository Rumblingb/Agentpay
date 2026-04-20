import type { Env, MerchantContext } from '../types';
import { createDb, type Sql } from './db';
import {
  countCapabilityUsage,
  getCapability,
  getCapabilityMetadata,
  listCapabilities,
  logCapabilityAccess,
  recordCapabilityUsageEvent,
  retrieveCapabilitySecret,
} from './capabilityVault';
import {
  assertSafeCapabilityTarget,
  normalizeAllowedCapabilityHosts,
  normalizeCapabilityBaseUrl,
} from './networkPolicy';

export type CapabilityProviderCatalogEntry = {
  provider: string;
  label: string;
  category: 'data' | 'browser' | 'search' | 'mapping' | 'ai' | 'events' | 'generic';
  defaultBaseUrl: string;
  allowedHosts: string[];
  authScheme: 'bearer' | 'x_api_key' | 'basic';
  credentialKind: 'api_key' | 'bearer_token' | 'basic_auth';
  freeCalls: number;
  paidUnitPriceUsdMicros: number;
  description: string;
  partnershipStatus: 'flagship' | 'preset_available' | 'partner_target' | 'generic';
  docsUrl: string | null;
  setupHint: string;
  approvalHeadline: string;
  proofHeadline: string;
};

const PROVIDER_CATALOG: Record<string, CapabilityProviderCatalogEntry> = {
  firecrawl: {
    provider: 'firecrawl',
    label: 'Firecrawl',
    category: 'browser',
    defaultBaseUrl: 'https://api.firecrawl.dev',
    allowedHosts: ['api.firecrawl.dev'],
    authScheme: 'bearer',
    credentialKind: 'api_key',
    freeCalls: 5,
    paidUnitPriceUsdMicros: 20_000,
    description: 'Web extraction and crawl API. First 5 pulls are free, then each call is billable.',
    partnershipStatus: 'flagship',
    docsUrl: 'https://www.firecrawl.dev',
    setupHint: 'Best for showing one-time credential vaulting and repeated governed crawl execution from the same workbench.',
    approvalHeadline: 'Connect Firecrawl once, then let agents crawl under your spend policy.',
    proofHeadline: 'Agent crawls, pauses only when policy requires, then resumes without re-entering the key.',
  },
  browserbase: {
    provider: 'browserbase',
    label: 'Browserbase',
    category: 'browser',
    defaultBaseUrl: 'https://api.browserbase.com',
    allowedHosts: ['api.browserbase.com'],
    authScheme: 'x_api_key',
    credentialKind: 'api_key',
    freeCalls: 3,
    paidUnitPriceUsdMicros: 50_000,
    description: 'Hosted browser session runtime with a small free tier and explicit paid execution beyond it.',
    partnershipStatus: 'flagship',
    docsUrl: 'https://www.browserbase.com',
    setupHint: 'Best for proving that agent runtime access can be governed without shipping raw browser credentials into the local project.',
    approvalHeadline: 'Grant Browserbase access once and keep browser automation under policy.',
    proofHeadline: 'Agent reuses the same governed browser path on later runs without another setup step.',
  },
  perplexity: {
    provider: 'perplexity',
    label: 'Perplexity',
    category: 'search',
    defaultBaseUrl: 'https://api.perplexity.ai',
    allowedHosts: ['api.perplexity.ai'],
    authScheme: 'bearer',
    credentialKind: 'api_key',
    freeCalls: 10,
    paidUnitPriceUsdMicros: 15_000,
    description: 'Live AI search with citations. First 10 calls free, then metered.',
    partnershipStatus: 'preset_available',
    docsUrl: 'https://docs.perplexity.ai',
    setupHint: 'Useful for research-heavy agents that need a clean human approval path once usage crosses policy.',
    approvalHeadline: 'Approve live search once and keep citation-backed retrieval governed.',
    proofHeadline: 'Agent can move from free calls to paid search with exact-call resume.',
  },
  tavily: {
    provider: 'tavily',
    label: 'Tavily',
    category: 'search',
    defaultBaseUrl: 'https://api.tavily.com',
    allowedHosts: ['api.tavily.com'],
    authScheme: 'bearer',
    credentialKind: 'api_key',
    freeCalls: 10,
    paidUnitPriceUsdMicros: 10_000,
    description: 'AI-optimised web search API. First 10 calls free.',
    partnershipStatus: 'preset_available',
    docsUrl: 'https://docs.tavily.com',
    setupHint: 'Good fallback search preset when the host needs structured web research with a light approval path.',
    approvalHeadline: 'Connect Tavily once for governed agent search.',
    proofHeadline: 'Agent continues research after approval without asking for the key again.',
  },
  exa: {
    provider: 'exa',
    label: 'Exa',
    category: 'search',
    defaultBaseUrl: 'https://api.exa.ai',
    allowedHosts: ['api.exa.ai'],
    authScheme: 'bearer',
    credentialKind: 'api_key',
    freeCalls: 10,
    paidUnitPriceUsdMicros: 12_000,
    description: 'Neural web search with full content retrieval. First 10 calls free.',
    partnershipStatus: 'flagship',
    docsUrl: 'https://docs.exa.ai',
    setupHint: 'Strong flagship path for search + content retrieval demos where the same workbench should be able to reuse governed access later.',
    approvalHeadline: 'Authorize Exa once and keep retrieval under AgentPay guardrails.',
    proofHeadline: 'Agent can resume the exact search or content pull after the paid step clears.',
  },
  openai: {
    provider: 'openai',
    label: 'OpenAI',
    category: 'ai',
    defaultBaseUrl: 'https://api.openai.com',
    allowedHosts: ['api.openai.com'],
    authScheme: 'bearer',
    credentialKind: 'api_key',
    freeCalls: 5,
    paidUnitPriceUsdMicros: 50_000,
    description: 'OpenAI API. First 5 calls free, then usage-based.',
    partnershipStatus: 'partner_target',
    docsUrl: 'https://platform.openai.com/docs',
    setupHint: 'High-value host distribution target where delegated auth would remove the last setup step.',
    approvalHeadline: 'Keep model access governed without exposing the raw OpenAI key to the agent.',
    proofHeadline: 'AgentPay owns the authority and continuity seam even before delegated auth arrives.',
  },
  google_maps: {
    provider: 'google_maps',
    label: 'Google Maps',
    category: 'mapping',
    defaultBaseUrl: 'https://maps.googleapis.com',
    allowedHosts: ['maps.googleapis.com'],
    authScheme: 'x_api_key',
    credentialKind: 'api_key',
    freeCalls: 20,
    paidUnitPriceUsdMicros: 5_000,
    description: 'Geocoding, directions, and places. First 20 calls free.',
    partnershipStatus: 'preset_available',
    docsUrl: 'https://developers.google.com/maps',
    setupHint: 'Useful when a host needs deterministic mapping and location APIs with simple policy limits.',
    approvalHeadline: 'Connect Maps once and keep location queries inside your spend policy.',
    proofHeadline: 'Agent can route, geocode, and place-search without raw key reuse across projects.',
  },
  aviationstack: {
    provider: 'aviationstack',
    label: 'Aviationstack',
    category: 'data',
    defaultBaseUrl: 'https://api.aviationstack.com',
    allowedHosts: ['api.aviationstack.com'],
    authScheme: 'x_api_key',
    credentialKind: 'api_key',
    freeCalls: 10,
    paidUnitPriceUsdMicros: 8_000,
    description: 'Real-time flight status and aviation data.',
    partnershipStatus: 'preset_available',
    docsUrl: 'https://aviationstack.com',
    setupHint: 'Good example of a narrower data provider that still benefits from one-time vaulting and policy enforcement.',
    approvalHeadline: 'Authorize flight data once and let the agent keep continuity.',
    proofHeadline: 'Agent continues the travel workflow without rebuilding its data call after approval.',
  },
  databento: {
    provider: 'databento',
    label: 'Databento',
    category: 'data',
    defaultBaseUrl: 'https://hist.databento.com/v0',
    allowedHosts: ['hist.databento.com'],
    authScheme: 'bearer',
    credentialKind: 'api_key',
    freeCalls: 3,
    paidUnitPriceUsdMicros: 75_000,
    description: 'Historical and reference market data via the Databento HTTP API, with governed paid execution once free calls are exhausted.',
    partnershipStatus: 'flagship',
    docsUrl: 'https://databento.com/docs',
    setupHint: 'Best proof path for a high-value paid data API where exact-call resume matters immediately.',
    approvalHeadline: 'Connect Databento once and let the agent keep working under explicit spend control.',
    proofHeadline: 'Agent requests market data, hits a paid step, gets approval, and resumes the exact query automatically.',
  },
  ticketmaster: {
    provider: 'ticketmaster',
    label: 'Ticketmaster',
    category: 'events',
    defaultBaseUrl: 'https://app.ticketmaster.com',
    allowedHosts: ['app.ticketmaster.com'],
    authScheme: 'x_api_key',
    credentialKind: 'api_key',
    freeCalls: 20,
    paidUnitPriceUsdMicros: 5_000,
    description: 'Events, concerts, and live experiences discovery.',
    partnershipStatus: 'partner_target',
    docsUrl: 'https://developer.ticketmaster.com',
    setupHint: 'A good partner target because reduced setup friction should drive more completed discovery and booking flows.',
    approvalHeadline: 'Authorize event discovery once and keep bookings governed.',
    proofHeadline: 'AgentPay removes the setup friction between search, approval, and execution.',
  },
  serper: {
    provider: 'serper',
    label: 'Serper',
    category: 'search',
    defaultBaseUrl: 'https://google.serper.dev',
    allowedHosts: ['google.serper.dev'],
    authScheme: 'x_api_key',
    credentialKind: 'api_key',
    freeCalls: 10,
    paidUnitPriceUsdMicros: 8_000,
    description: 'Google Search API with structured results.',
    partnershipStatus: 'preset_available',
    docsUrl: 'https://serper.dev',
    setupHint: 'Useful when the host needs structured search quickly and the human wants key reuse handled safely.',
    approvalHeadline: 'Connect Serper once and keep search access reusable but revocable.',
    proofHeadline: 'Agent can come back later from the same workbench without another credential step.',
  },
  generic_rest_api: {
    provider: 'generic_rest_api',
    label: 'Generic REST API',
    category: 'generic',
    defaultBaseUrl: '',
    allowedHosts: [],
    authScheme: 'bearer',
    credentialKind: 'api_key',
    freeCalls: 3,
    paidUnitPriceUsdMicros: 25_000,
    description: 'Any REST API with credential vaulting and quota gating.',
    partnershipStatus: 'generic',
    docsUrl: null,
    setupHint: 'Fallback path when no first-class preset exists yet. AgentPay should still own the setup, policy, and continuity seam.',
    approvalHeadline: 'Connect an unsupported API once and keep the secret out of agent context.',
    proofHeadline: 'Even without a partnership, AgentPay can own the human step and exact-call continuity.',
  },
};

export type CapabilityExecutionResult =
  | {
      status: 'completed';
      capabilityId: string;
      provider: string;
      usage: {
        usedCalls: number;
        freeCalls: number;
        billable: boolean;
        unitPriceUsd: number;
      };
      upstream: {
        url: string;
        status: number;
        body: unknown;
      };
    }
  | {
      status: 'approval_required';
      capabilityId: string;
      provider: string;
      usage: {
        usedCalls: number;
        freeCalls: number;
        billable: boolean;
        unitPriceUsd: number;
      };
      nextAction: {
        type: 'approval_required';
        title: string;
        summary: string;
        amount: {
          currency: 'USD';
          value: string;
        };
        displayPayload: Record<string, unknown>;
      };
    };

function normalizeProvider(provider: string): CapabilityProviderCatalogEntry {
  return PROVIDER_CATALOG[provider] ?? PROVIDER_CATALOG.generic_rest_api;
}

function usdMicrosToString(value: number): string {
  return (value / 1_000_000).toFixed(4).replace(/0+$/, '').replace(/\.$/, '.0');
}

function parseResponseBody(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function buildHeaders(
  authScheme: 'bearer' | 'x_api_key' | 'basic',
  secretPayload: Record<string, unknown>,
  existing: Record<string, string>,
  headerName?: string | null,
): Record<string, string> {
  const headers = { ...existing };
  delete headers.authorization;
  delete headers.Authorization;
  delete headers['x-api-key'];
  delete headers['X-API-Key'];

  if (authScheme === 'basic') {
    const username = typeof secretPayload.username === 'string' ? secretPayload.username : '';
    const password = typeof secretPayload.password === 'string' ? secretPayload.password : '';
    headers.Authorization = `Basic ${btoa(`${username}:${password}`)}`;
    return headers;
  }

  const secretValue = typeof secretPayload.apiKey === 'string'
    ? secretPayload.apiKey
    : typeof secretPayload.token === 'string'
      ? secretPayload.token
      : typeof secretPayload.headerValue === 'string'
        ? secretPayload.headerValue
        : '';

  if (authScheme === 'x_api_key') {
    headers[headerName?.trim() || 'x-api-key'] = secretValue;
    return headers;
  }

  headers.Authorization = `Bearer ${secretValue}`;
  return headers;
}

export function getCapabilityProviderCatalog(): CapabilityProviderCatalogEntry[] {
  return Object.values(PROVIDER_CATALOG);
}

export function getCapabilityProviderDefaults(provider: string): CapabilityProviderCatalogEntry | null {
  return PROVIDER_CATALOG[provider] ?? null;
}

export async function listCapabilityBrokerRecords(env: Env, merchantId: string) {
  const capabilities = await listCapabilities(env, merchantId);
  return capabilities.map((capability) => ({
    ...capability,
    policy: getCapabilityMetadata(capability),
  }));
}

export async function executeCapabilityProxy(
  env: Env,
  merchant: MerchantContext,
  input: {
    capabilityId: string;
    method?: string;
    path?: string;
    query?: Record<string, string>;
    headers?: Record<string, string>;
    body?: unknown;
    allowPaidUsage?: boolean;
    requestId?: string | null;
  },
): Promise<CapabilityExecutionResult> {
  const capabilityWithSecret = await retrieveCapabilitySecret(env, merchant.id, input.capabilityId);
  if (!capabilityWithSecret) {
    throw new Error('CAPABILITY_NOT_FOUND');
  }

  const { capability, secretPayload } = capabilityWithSecret;
  const policy = getCapabilityMetadata(capability);
  const providerInfo = normalizeProvider(capability.provider ?? 'generic_rest_api');
  const sql = createDb(env);

  try {
    const usedCalls = await countCapabilityUsage(sql, capability.id);
    const billable = usedCalls >= policy.freeCalls;
    const unitPriceMicros = policy.paidUnitPriceUsdMicros || providerInfo.paidUnitPriceUsdMicros;

    if (billable && !input.allowPaidUsage) {
      await logCapabilityAccess(sql, {
        merchantId: merchant.id,
        capabilityId: capability.id,
        capabilityKey: capability.capabilityKey,
        action: 'proxy_gate',
        outcome: 'requires_approval',
        actorType: 'merchant',
        actorRef: merchant.id,
        requestId: input.requestId ?? null,
        reasonCode: 'free_tier_exhausted',
        metadata: {
          provider: capability.provider,
          usedCalls,
          freeCalls: policy.freeCalls,
          unitPriceMicros,
        },
      });
      await recordCapabilityUsageEvent(sql, {
        merchantId: merchant.id,
        capabilityId: capability.id,
        capabilityKey: capability.capabilityKey,
        eventType: 'proxy_call',
        requestId: input.requestId ?? null,
        toolName: 'external_capability_proxy',
        statusCode: 402,
        unitPriceMicros,
        estimatedAmountMicros: unitPriceMicros,
        metadata: {
          outcome: 'approval_required',
          usedCalls,
          freeCalls: policy.freeCalls,
        },
      });

      return {
        status: 'approval_required',
        capabilityId: capability.id,
        provider: capability.provider ?? providerInfo.provider,
        usage: {
          usedCalls,
          freeCalls: policy.freeCalls,
          billable: true,
          unitPriceUsd: unitPriceMicros / 1_000_000,
        },
        nextAction: {
          type: 'approval_required',
          title: `Approve paid ${providerInfo.label} usage`,
          summary: `The free tier is exhausted for ${capability.capabilityKey}. Re-run with paid usage enabled to spend $${usdMicrosToString(unitPriceMicros)} on this call.`,
          amount: {
            currency: 'USD',
            value: usdMicrosToString(unitPriceMicros),
          },
          displayPayload: {
            kind: 'paid_usage_gate',
            provider: providerInfo.provider,
            capabilityId: capability.id,
            capabilityKey: capability.capabilityKey,
            rerunHint: 'Repeat the same tool call with allowPaidUsage=true after the human approves.',
          },
        },
      };
    }

    const baseUrl = normalizeCapabilityBaseUrl(policy.baseUrl || providerInfo.defaultBaseUrl, env);
    if (!baseUrl) throw new Error('CAPABILITY_BASE_URL_REQUIRED');
    const requestedPath = typeof input.path === 'string' && input.path.trim() ? input.path.trim() : '/';
    if (/^[a-z][a-z0-9+\-.]*:/i.test(requestedPath) || requestedPath.startsWith('//')) {
      throw new Error('CAPABILITY_PATH_MUST_BE_RELATIVE');
    }
    const target = new URL(requestedPath.startsWith('/') ? requestedPath : `/${requestedPath}`, `${baseUrl}/`);
    for (const [key, value] of Object.entries(input.query ?? {})) {
      target.searchParams.set(key, value);
    }

    const allowedHosts = normalizeAllowedCapabilityHosts(
      policy.allowedHosts.length ? policy.allowedHosts : providerInfo.allowedHosts,
      env,
    );
    assertSafeCapabilityTarget(target, allowedHosts, env);

    const headers = buildHeaders(policy.authScheme, secretPayload, input.headers ?? {}, policy.headerName);
    const response = await fetch(target.toString(), {
      method: (input.method ?? 'GET').toUpperCase(),
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: input.body === undefined ? undefined : JSON.stringify(input.body),
    });
    const text = await response.text();
    const parsedBody = parseResponseBody(text);
    const estimatedAmountMicros = billable ? unitPriceMicros : 0;

    await sql`
      UPDATE capability_vault_entries
      SET last_used_at = NOW(),
          updated_at = NOW()
      WHERE id = ${capability.id}::uuid
    `;
    await logCapabilityAccess(sql, {
      merchantId: merchant.id,
      capabilityId: capability.id,
      capabilityKey: capability.capabilityKey,
      action: 'proxy_call',
      outcome: response.ok ? 'allowed' : 'error',
      actorType: 'merchant',
      actorRef: merchant.id,
      requestId: input.requestId ?? null,
      metadata: {
        provider: capability.provider,
        url: target.toString(),
        statusCode: response.status,
      },
    });
    await recordCapabilityUsageEvent(sql, {
      merchantId: merchant.id,
      capabilityId: capability.id,
      capabilityKey: capability.capabilityKey,
      eventType: 'proxy_call',
      requestId: input.requestId ?? null,
      toolName: 'external_capability_proxy',
      statusCode: response.status,
      unitPriceMicros,
      estimatedAmountMicros,
      metadata: {
        provider: capability.provider,
        billable,
        url: target.toString(),
      },
    });

    return {
      status: 'completed',
      capabilityId: capability.id,
      provider: capability.provider ?? providerInfo.provider,
      usage: {
        usedCalls: usedCalls + 1,
        freeCalls: policy.freeCalls,
        billable,
        unitPriceUsd: unitPriceMicros / 1_000_000,
      },
      upstream: {
        url: target.toString(),
        status: response.status,
        body: parsedBody,
      },
    };
  } finally {
    await sql.end().catch(() => {});
  }
}
