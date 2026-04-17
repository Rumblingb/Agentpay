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
import { assertSafeCapabilityTarget } from './networkPolicy';

export type CapabilityProviderCatalogEntry = {
  provider: string;
  label: string;
  defaultBaseUrl: string;
  allowedHosts: string[];
  authScheme: 'bearer' | 'x_api_key' | 'basic';
  credentialKind: 'api_key' | 'bearer_token' | 'basic_auth';
  freeCalls: number;
  paidUnitPriceUsdMicros: number;
  description: string;
};

const PROVIDER_CATALOG: Record<string, CapabilityProviderCatalogEntry> = {
  firecrawl: {
    provider: 'firecrawl',
    label: 'Firecrawl',
    defaultBaseUrl: 'https://api.firecrawl.dev',
    allowedHosts: ['api.firecrawl.dev'],
    authScheme: 'bearer',
    credentialKind: 'api_key',
    freeCalls: 5,
    paidUnitPriceUsdMicros: 20_000,
    description: 'Web extraction and crawl API. First 5 pulls are free, then each call is billable.',
  },
  browserbase: {
    provider: 'browserbase',
    label: 'Browserbase',
    defaultBaseUrl: 'https://www.browserbase.com',
    allowedHosts: ['www.browserbase.com', 'api.browserbase.com'],
    authScheme: 'x_api_key',
    credentialKind: 'api_key',
    freeCalls: 3,
    paidUnitPriceUsdMicros: 50_000,
    description: 'Hosted browser session runtime with a small free tier and explicit paid execution beyond it.',
  },
  generic_rest_api: {
    provider: 'generic_rest_api',
    label: 'Generic REST API',
    defaultBaseUrl: '',
    allowedHosts: [],
    authScheme: 'bearer',
    credentialKind: 'api_key',
    freeCalls: 3,
    paidUnitPriceUsdMicros: 25_000,
    description: 'Allow-listed external REST API with credential vaulting and quota gating.',
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

    const baseUrl = policy.baseUrl || providerInfo.defaultBaseUrl;
    if (!baseUrl) throw new Error('CAPABILITY_BASE_URL_REQUIRED');
    const requestedPath = typeof input.path === 'string' && input.path.trim() ? input.path.trim() : '/';
    if (/^[a-z][a-z0-9+\-.]*:/i.test(requestedPath) || requestedPath.startsWith('//')) {
      throw new Error('CAPABILITY_PATH_MUST_BE_RELATIVE');
    }
    const target = new URL(requestedPath.startsWith('/') ? requestedPath : `/${requestedPath}`, `${baseUrl}/`);
    for (const [key, value] of Object.entries(input.query ?? {})) {
      target.searchParams.set(key, value);
    }

    const allowedHosts = policy.allowedHosts.length ? policy.allowedHosts : providerInfo.allowedHosts;
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
