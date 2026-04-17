import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { authenticateApiKey } from '../middleware/auth';
import { isMcpAccessToken } from '../lib/mcpAccessTokens';
import {
  createCapabilityConnectSession,
  getCapability,
  getCapabilityMetadata,
  getCapabilityConnectSession,
  peekCapabilityConnectSession,
  revokeCapability,
  submitCapabilityConnectSession,
} from '../lib/capabilityVault';
import {
  executeCapabilityProxy,
  getCapabilityProviderDefaults,
  getCapabilityProviderCatalog,
  listCapabilityBrokerRecords,
} from '../lib/capabilityBroker';
import {
  buildCapabilityUsageInvoiceSummary,
  createCapabilityUsageInvoiceCheckout,
} from '../lib/mcpInvoices';
import { recordProductSignalEvent } from '../lib/productSignals';
import {
  buildHostedActionResumeRedirect,
  createHostedActionSession,
  isSafeHostedActionResumeUrl,
  syncHostedActionSession,
} from '../lib/hostedActionSessions';
import {
  normalizeAllowedCapabilityHosts,
  normalizeCapabilityBaseUrl,
} from '../lib/networkPolicy';

const router = new Hono<{ Bindings: Env; Variables: Variables }>();

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function htmlEscape(value: string | null | undefined): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function secureHtml(html: string) {
  return new Response(html, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      pragma: 'no-cache',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    },
  });
}

function connectPage(input: {
  provider: string | null;
  capabilityKey: string;
  sessionId: string;
  sessionToken: string;
  expiresAt: string;
  fields: Array<Record<string, unknown>>;
  error?: string | null;
}) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Connect capability</title>
    <style>
      body { font-family: ui-sans-serif, system-ui, sans-serif; background: #f8fafc; color: #0f172a; margin: 0; }
      .wrap { max-width: 560px; margin: 48px auto; padding: 24px; }
      .card { background: #fff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 24px; box-shadow: 0 8px 24px rgba(15,23,42,0.06); }
      h1 { margin: 0 0 8px; font-size: 24px; }
      p { color: #475569; line-height: 1.5; }
      label { display: block; font-size: 14px; font-weight: 600; margin: 16px 0 6px; }
      input { width: 100%; box-sizing: border-box; padding: 12px 14px; border-radius: 10px; border: 1px solid #cbd5e1; font-size: 14px; }
      button { margin-top: 20px; width: 100%; border: none; border-radius: 10px; background: #0f172a; color: #fff; padding: 12px 16px; font-size: 15px; font-weight: 600; cursor: pointer; }
      .meta { margin: 16px 0; padding: 12px; border-radius: 10px; background: #f8fafc; border: 1px solid #e2e8f0; font-size: 13px; color: #334155; }
      .error { margin-top: 12px; color: #b91c1c; font-size: 14px; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="card">
        <h1>Connect ${htmlEscape(input.provider ?? 'capability')}</h1>
        <p>Provide the credential once. AgentPay will vault it securely and return only a capability reference to the agent.</p>
        <div class="meta">
          <div><strong>Capability:</strong> ${htmlEscape(input.capabilityKey)}</div>
          <div><strong>Expires:</strong> ${htmlEscape(input.expiresAt)}</div>
        </div>
        <form method="post" action="/api/capabilities/connect-sessions/${htmlEscape(input.sessionId)}/hosted">
          <input type="hidden" name="sessionToken" value="${htmlEscape(input.sessionToken)}" />
          ${input.fields.map((field) => {
            const key = typeof field.key === 'string' ? field.key : 'secret';
            const label = typeof field.label === 'string' ? field.label : key;
            const secret = field.secret === true;
            const autocomplete = typeof field.autocomplete === 'string' ? field.autocomplete : 'off';
            return `<label for="${htmlEscape(key)}">${htmlEscape(label)}</label>
            <input id="${htmlEscape(key)}" name="${htmlEscape(key)}" type="${secret ? 'password' : 'text'}" autocomplete="${htmlEscape(autocomplete)}" required />`;
          }).join('')}
          <button type="submit">Connect securely</button>
        </form>
        ${input.error ? `<div class="error">${htmlEscape(input.error)}</div>` : ''}
      </div>
    </div>
  </body>
</html>`;
}

router.post('/connect-sessions/:sessionId/submit', async (c) => {
  let body: {
    sessionToken?: unknown;
    secretPayload?: unknown;
    expiresAt?: unknown;
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const sessionId = c.req.param('sessionId');
  const sessionToken = asString(body.sessionToken);
  if (!sessionToken) {
    return c.json({ error: 'sessionToken is required' }, 400);
  }
  if (typeof body.secretPayload !== 'object' || body.secretPayload === null || Array.isArray(body.secretPayload)) {
    return c.json({ error: 'secretPayload must be an object' }, 400);
  }

  try {
    const pendingSession = await peekCapabilityConnectSession(c.env, {
      sessionId,
      sessionToken,
    });
    const capability = await submitCapabilityConnectSession(c.env, {
      sessionId,
      sessionToken,
      secretPayload: body.secretPayload as Record<string, unknown>,
      expiresAt: asString(body.expiresAt),
    });
    const hostedActionSessionId = typeof pendingSession.session.metadata.hostedActionSessionId === 'string'
      ? pendingSession.session.metadata.hostedActionSessionId
      : null;
    const actionSession = hostedActionSessionId
      ? await syncHostedActionSession(c.env, {
          sessionId: hostedActionSessionId,
          status: 'completed',
          resultPayload: {
            connectedCapabilityId: capability.id,
            connectedCapabilityKey: capability.capabilityKey,
            provider: capability.provider,
          },
          metadata: {
            connectedFrom: 'capability_connect_submit',
            capabilityConnectSessionId: pendingSession.session.id,
          },
        }).catch(() => null)
      : null;
    return c.json({
      status: 'connected',
      capabilityId: capability.id,
      capabilityKey: capability.capabilityKey,
      provider: capability.provider,
      actionSession: actionSession ? {
        sessionId: actionSession.sessionId,
        status: actionSession.status,
      } : null,
    }, 201);
  } catch (err) {
    if (err instanceof Error) {
      if (err.message === 'CAPABILITY_CONNECT_SESSION_NOT_FOUND') {
        return c.json({ error: 'Capability connect session not found' }, 404);
      }
      if (err.message === 'CAPABILITY_CONNECT_SESSION_EXPIRED') {
        return c.json({ error: 'Capability connect session has expired' }, 410);
      }
      if (err.message === 'CAPABILITY_CONNECT_SESSION_NOT_PENDING') {
        return c.json({ error: 'Capability connect session is no longer pending' }, 409);
      }
      if (err.message === 'CAPABILITY_CONNECT_SESSION_TOKEN_INVALID') {
        return c.json({ error: 'Capability connect session token is invalid' }, 403);
      }
      if (err.message === 'CAPABILITY_VAULT_ENCRYPTION_KEY_NOT_CONFIGURED') {
        return c.json({ error: 'Capability vault encryption is not configured' }, 503);
      }
      if (
        err.message === 'CAPABILITY_BASE_URL_INVALID'
        || err.message === 'CAPABILITY_BASE_URL_INSECURE'
        || err.message === 'CAPABILITY_ALLOWED_HOST_INVALID'
      ) {
        return c.json({ error: 'Capability connect session configuration is invalid' }, 400);
      }
      if (err.message === 'CAPABILITY_HOST_BLOCKED') {
        return c.json({ error: 'Capability connect session target is not allowed' }, 403);
      }
    }
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[capabilities] submit connect session failed:', msg);
    return c.json({ error: 'Failed to submit capability connect session' }, 500);
  }
});

router.get('/connect-sessions/:sessionId/hosted', async (c) => {
  const sessionId = c.req.param('sessionId');
  const sessionToken = asString(c.req.query('token'));
  if (!sessionToken) {
    return c.text('Missing connect session token.', 400);
  }

  try {
    const pending = await peekCapabilityConnectSession(c.env, {
      sessionId,
      sessionToken,
    });
    const fields = Array.isArray(pending.session.connectionPayload.fields)
      ? pending.session.connectionPayload.fields.filter((value): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value))
      : [{ key: 'apiKey', label: 'API key', secret: true }];
    return secureHtml(connectPage({
      provider: pending.capability.provider,
      capabilityKey: pending.capability.capabilityKey,
      sessionId,
      sessionToken,
      expiresAt: pending.session.expiresAt,
      fields,
    }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === 'CAPABILITY_CONNECT_SESSION_NOT_FOUND') return c.text('Capability connect session not found.', 404);
    if (message === 'CAPABILITY_CONNECT_SESSION_EXPIRED') return c.text('Capability connect session has expired.', 410);
    if (message === 'CAPABILITY_CONNECT_SESSION_NOT_PENDING') return c.text('Capability connect session is no longer pending.', 409);
    if (message === 'CAPABILITY_CONNECT_SESSION_TOKEN_INVALID') return c.text('Capability connect session token is invalid.', 403);
    return c.text('Failed to load capability connect step.', 500);
  }
});

router.post('/connect-sessions/:sessionId/hosted', async (c) => {
  const sessionId = c.req.param('sessionId');
  const form = await c.req.formData();
  const sessionToken = asString(form.get('sessionToken'));
  if (!sessionToken) {
    return c.text('Missing connect session token.', 400);
  }

  try {
    const pending = await peekCapabilityConnectSession(c.env, {
      sessionId,
      sessionToken,
    });
    const fields = Array.isArray(pending.session.connectionPayload.fields)
      ? pending.session.connectionPayload.fields.filter((value): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value))
      : [{ key: 'apiKey', label: 'API key', secret: true }];

    const secretPayload: Record<string, unknown> = {};
    for (const field of fields) {
      const key = typeof field.key === 'string' ? field.key : null;
      if (!key) continue;
      const value = asString(form.get(key));
      if (!value) {
        return secureHtml(connectPage({
          provider: pending.capability.provider,
          capabilityKey: pending.capability.capabilityKey,
          sessionId,
          sessionToken,
          expiresAt: pending.session.expiresAt,
          fields,
          error: `${typeof field.label === 'string' ? field.label : key} is required.`,
        }));
      }
      secretPayload[key] = value;
    }

    const capability = await submitCapabilityConnectSession(c.env, {
      sessionId,
      sessionToken,
      secretPayload,
    });

    const hostedActionSessionId = typeof pending.session.metadata.hostedActionSessionId === 'string'
      ? pending.session.metadata.hostedActionSessionId
      : null;
    if (hostedActionSessionId) {
      const actionSession = await syncHostedActionSession(c.env, {
        sessionId: hostedActionSessionId,
        status: 'completed',
        resultPayload: {
          connectedCapabilityId: capability.id,
          connectedCapabilityKey: capability.capabilityKey,
          provider: capability.provider,
        },
        metadata: {
          connectedFrom: 'capability_connect_hosted_form',
          capabilityConnectSessionId: pending.session.id,
        },
      });
      return buildHostedActionResumeRedirect(actionSession, {
        fallbackText: 'AgentPay recorded this connected capability. Return to your host and resume the task.',
      });
    }

    return c.text('Capability connected. Return to your host and resume the task.', 200);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === 'CAPABILITY_CONNECT_SESSION_NOT_FOUND') return c.text('Capability connect session not found.', 404);
    if (message === 'CAPABILITY_CONNECT_SESSION_EXPIRED') return c.text('Capability connect session has expired.', 410);
    if (message === 'CAPABILITY_CONNECT_SESSION_NOT_PENDING') return c.text('Capability connect session is no longer pending.', 409);
    if (message === 'CAPABILITY_CONNECT_SESSION_TOKEN_INVALID') return c.text('Capability connect session token is invalid.', 403);
    console.error('[capabilities] hosted connect failed:', message);
    return c.text('Failed to connect this capability.', 500);
  }
});

router.use('*', authenticateApiKey);

router.get('/providers/catalog', (c) => {
  return c.json({
    providers: getCapabilityProviderCatalog(),
  });
});

router.get('/billing/current', async (c) => {
  const merchant = c.get('merchant');
  const presentedToken = c.req.header('authorization') ?? c.req.header('x-api-key') ?? '';
  const audience = c.get('mcpAudience') ?? 'generic';
  const authType = isMcpAccessToken(presentedToken.startsWith('Bearer ') ? presentedToken.slice(7) : presentedToken) ? 'mcp_token' : 'api_key';
  const summary = await buildCapabilityUsageInvoiceSummary(c.env, merchant);

  void recordProductSignalEvent(c.env, {
    merchantId: merchant.id,
    audience,
    authType,
    surface: 'billing',
    signalType: 'capability_invoice_viewed',
    entityType: 'merchant',
    entityId: merchant.id,
    estimatedRevenueMicros: Math.max(Math.round(summary.outstandingUsd * 1_000_000), 0),
    estimatedCostMicros: Math.max(Math.round(summary.subtotalUsd * 1_000_000), 0),
    metadata: {
      billableCalls: summary.usage.billableCalls,
      outstandingUsd: summary.outstandingUsd,
    },
  });

  return c.json({
    ...summary,
    payable: summary.outstandingUsd > 0,
    collection: {
      method: 'stripe_checkout',
      available: Boolean(c.env.STRIPE_SECRET_KEY) && summary.outstandingUsd > 0,
    },
  });
});

router.post('/billing/checkout', async (c) => {
  const merchant = c.get('merchant');
  const presentedToken = c.req.header('authorization') ?? c.req.header('x-api-key') ?? '';
  const audience = c.get('mcpAudience') ?? 'generic';
  const authType = isMcpAccessToken(presentedToken.startsWith('Bearer ') ? presentedToken.slice(7) : presentedToken) ? 'mcp_token' : 'api_key';
  const summary = await buildCapabilityUsageInvoiceSummary(c.env, merchant);

  if (summary.outstandingUsd <= 0) {
    return c.json({
      ...summary,
      payable: false,
      message: 'No governed capability usage charges are currently outstanding.',
    });
  }

  try {
    const checkout = await createCapabilityUsageInvoiceCheckout(c.env, merchant, summary, {
      audience,
      authType,
    });
    if (!checkout) {
      return c.json({ error: 'Capability usage checkout is not configured on this deployment' }, 503);
    }

    void recordProductSignalEvent(c.env, {
      merchantId: merchant.id,
      audience,
      authType,
      surface: 'billing',
      signalType: 'capability_checkout_created',
      status: 'pending',
      entityType: 'merchant_invoice',
      entityId: checkout.invoiceId,
      estimatedRevenueMicros: Math.max(Math.round(summary.outstandingUsd * 1_000_000), 0),
      estimatedCostMicros: Math.max(Math.round(summary.subtotalUsd * 1_000_000), 0),
      metadata: {
        checkoutSessionId: checkout.checkoutSessionId,
      },
    });

    return c.json({
      ...summary,
      payable: true,
      invoiceId: checkout.invoiceId,
      checkoutUrl: checkout.checkoutUrl,
      checkoutSessionId: checkout.checkoutSessionId,
    }, 201);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[capabilities] billing checkout failed:', msg);
    return c.json({ error: 'Failed to create capability usage checkout session' }, 500);
  }
});

router.post('/connect-sessions', async (c) => {
  const merchant = c.get('merchant');
  const presentedToken = c.req.header('authorization') ?? c.req.header('x-api-key') ?? '';
  const audience = c.get('mcpAudience') ?? 'generic';
  const authType = isMcpAccessToken(presentedToken.startsWith('Bearer ') ? presentedToken.slice(7) : presentedToken) ? 'mcp_token' : 'api_key';
  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const provider = asString(body.provider);
  const capabilityKey = asString(body.capabilityKey);
  const subjectType = asString(body.subjectType);
  const subjectRef = asString(body.subjectRef);
  const providerDefaults = provider ? getCapabilityProviderDefaults(provider) : null;
  const baseUrl = asString(body.baseUrl) ?? providerDefaults?.defaultBaseUrl ?? null;
  const authScheme = asString(body.authScheme) ?? providerDefaults?.authScheme ?? null;
  const credentialKind = asString(body.credentialKind) ?? providerDefaults?.credentialKind ?? null;
  const resumeUrl = asString(body.resumeUrl);

  if (!provider || !capabilityKey || !subjectType || !subjectRef || !baseUrl || !authScheme || !credentialKind) {
    return c.json({
      error: 'provider, capabilityKey, subjectType, subjectRef, baseUrl, authScheme, and credentialKind are required or must be implied by the provider preset',
    }, 400);
  }

  const allowedHosts = Array.isArray(body.allowedHosts)
    ? body.allowedHosts.filter((value): value is string => typeof value === 'string')
    : (providerDefaults?.allowedHosts ?? []);
  if (!allowedHosts.length) {
    return c.json({ error: 'allowedHosts must include at least one host' }, 400);
  }
  if (resumeUrl && !isSafeHostedActionResumeUrl(resumeUrl)) {
    return c.json({ error: 'resumeUrl must be a valid https URL or localhost URL' }, 400);
  }

  try {
    const normalizedBaseUrl = normalizeCapabilityBaseUrl(baseUrl, c.env);
    const normalizedAllowedHosts = normalizeAllowedCapabilityHosts(allowedHosts, c.env);
    const actionSession = await createHostedActionSession(c.env, {
      merchant,
      actionType: 'auth_required',
      entityType: 'capability_connect',
      entityId: capabilityKey,
      title: `Connect ${provider}`,
      summary: `Securely connect ${provider} for ${capabilityKey}. AgentPay will vault the credential and return only a capability reference.`,
      audience,
      authType,
      resumeUrl,
      displayPayload: {
        kind: 'capability_connect',
        provider,
        capabilityKey,
      },
      metadata: {
        provider,
        capabilityKey,
      },
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    });
    const created = await createCapabilityConnectSession(c.env, {
      merchant,
      provider,
      capabilityKey,
      subjectType: subjectType as 'merchant' | 'principal' | 'agent' | 'workspace',
      subjectRef,
      baseUrl: normalizedBaseUrl,
      allowedHosts: normalizedAllowedHosts,
      authScheme: authScheme as 'bearer' | 'x_api_key' | 'basic',
      credentialKind: credentialKind as 'api_key' | 'bearer_token' | 'basic_auth',
      headerName: asString(body.headerName),
      scopes: Array.isArray(body.scopes) ? body.scopes.filter((value): value is string => typeof value === 'string') : [],
      freeCalls: typeof body.freeCalls === 'number' ? body.freeCalls : providerDefaults?.freeCalls,
      paidUnitPriceUsdMicros: typeof body.paidUnitPriceUsdMicros === 'number' ? body.paidUnitPriceUsdMicros : providerDefaults?.paidUnitPriceUsdMicros,
      redirectUrl: asString(body.redirectUrl),
      callbackUrl: asString(body.callbackUrl),
      metadata: {
        ...(typeof body.metadata === 'object' && body.metadata && !Array.isArray(body.metadata)
          ? body.metadata as Record<string, unknown>
          : {}),
        hostedActionSessionId: actionSession.session.sessionId,
      },
      expiresAt: asString(body.expiresAt) ?? undefined,
    });
    const connectUrl = new URL(`/api/capabilities/connect-sessions/${created.session.id}/hosted`, c.env.API_BASE_URL);
    connectUrl.searchParams.set('token', created.sessionToken);
    const hydratedActionSession = await syncHostedActionSession(c.env, {
      sessionId: actionSession.session.sessionId,
      displayPayload: {
        kind: 'capability_connect',
        provider,
        capabilityKey,
        submitEndpoint: new URL(`/api/capabilities/connect-sessions/${created.session.id}/submit`, c.env.API_BASE_URL).toString(),
        connectUrl: connectUrl.toString(),
        sessionToken: created.sessionToken,
        fields: created.session.connectionPayload.fields ?? [{ key: 'apiKey', label: 'API key', secret: true }],
        allowedHosts: normalizedAllowedHosts,
        baseUrl: normalizedBaseUrl,
        actionSessionId: actionSession.session.sessionId,
        actionStatusUrl: actionSession.statusUrl,
      },
      metadata: {
        capabilityConnectSessionId: created.session.id,
      },
    }).catch(() => actionSession.session);

    void recordProductSignalEvent(c.env, {
      merchantId: merchant.id,
      audience,
      authType,
      surface: 'capabilities',
      signalType: 'capability_connect_requested',
      status: 'auth_required',
      entityType: 'capability_connect_session',
      entityId: created.session.id,
      metadata: {
        provider,
        capabilityKey,
        subjectType,
      },
    });

    return c.json({
      status: 'auth_required',
      capabilityId: created.capability.id,
      capabilityKey: created.capability.capabilityKey,
      actionSession: {
        sessionId: hydratedActionSession.sessionId,
        status: hydratedActionSession.status,
        statusUrl: actionSession.statusUrl,
      },
      nextAction: {
        type: 'auth_required',
        sessionId: created.session.id,
        title: `Connect ${provider}`,
        summary: `A human must securely connect ${provider} for ${capabilityKey}. AgentPay will vault the credential and return only a capability reference to agents.`,
        expiresAt: created.session.expiresAt,
        displayPayload: {
          kind: 'capability_connect',
          provider,
          capabilityKey,
          submitEndpoint: new URL(`/api/capabilities/connect-sessions/${created.session.id}/submit`, c.env.API_BASE_URL).toString(),
          connectUrl: connectUrl.toString(),
          sessionToken: created.sessionToken,
          fields: created.session.connectionPayload.fields ?? [{ key: 'apiKey', label: 'API key', secret: true }],
          allowedHosts: normalizedAllowedHosts,
          baseUrl: normalizedBaseUrl,
          actionSessionId: hydratedActionSession.sessionId,
          actionStatusUrl: actionSession.statusUrl,
        },
      },
    }, 201);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[capabilities] create connect session failed:', msg);
    if (
      msg === 'CAPABILITY_BASE_URL_INVALID'
      || msg === 'CAPABILITY_BASE_URL_INSECURE'
      || msg === 'CAPABILITY_ALLOWED_HOST_INVALID'
    ) {
      return c.json({ error: 'Capability connect session configuration is invalid' }, 400);
    }
    if (msg === 'CAPABILITY_HOST_BLOCKED') {
      return c.json({ error: 'Capability connect session target is not allowed' }, 403);
    }
    return c.json({ error: 'Failed to create capability connect session' }, 500);
  }
});

router.get('/connect-sessions/:sessionId', async (c) => {
  const merchant = c.get('merchant');
  const session = await getCapabilityConnectSession(c.env, merchant.id, c.req.param('sessionId'));
  if (!session) return c.json({ error: 'Capability connect session not found' }, 404);
  return c.json(session);
});

router.get('/', async (c) => {
  const merchant = c.get('merchant');
  const capabilities = await listCapabilityBrokerRecords(c.env, merchant.id);
  return c.json({ capabilities });
});

router.get('/:capabilityId', async (c) => {
  const merchant = c.get('merchant');
  const capability = await getCapability(c.env, merchant.id, c.req.param('capabilityId'));
  if (!capability) return c.json({ error: 'Capability not found' }, 404);
  return c.json({
    capability,
    policy: getCapabilityMetadata(capability),
  });
});

router.post('/:capabilityId/execute', async (c) => {
  const merchant = c.get('merchant');
  const presentedToken = c.req.header('authorization') ?? c.req.header('x-api-key') ?? '';
  const audience = c.get('mcpAudience') ?? 'generic';
  const authType = isMcpAccessToken(presentedToken.startsWith('Bearer ') ? presentedToken.slice(7) : presentedToken) ? 'mcp_token' : 'api_key';
  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  try {
    const result = await executeCapabilityProxy(c.env, merchant, {
      capabilityId: c.req.param('capabilityId'),
      method: asString(body.method) ?? 'GET',
      path: asString(body.path) ?? '/',
      query: typeof body.query === 'object' && body.query && !Array.isArray(body.query)
        ? Object.fromEntries(Object.entries(body.query).filter(([, value]) => typeof value === 'string')) as Record<string, string>
        : undefined,
      headers: typeof body.headers === 'object' && body.headers && !Array.isArray(body.headers)
        ? Object.fromEntries(Object.entries(body.headers).filter(([, value]) => typeof value === 'string')) as Record<string, string>
        : undefined,
      body: body.body,
      allowPaidUsage: body.allowPaidUsage === true,
      requestId: asString(body.requestId),
    });
    void recordProductSignalEvent(c.env, {
      merchantId: merchant.id,
      audience,
      authType,
      surface: 'capabilities',
      signalType: result.status === 'approval_required'
        ? 'capability_next_action_returned'
        : 'capability_execution_completed',
      status: result.status,
      requestId: asString(body.requestId),
      entityType: 'capability',
      entityId: c.req.param('capabilityId'),
      estimatedCostMicros: Math.max(Math.round(result.usage.unitPriceUsd * 1_000_000), 0),
      metadata: {
        provider: result.provider,
        billable: result.usage.billable,
        usedCalls: result.usage.usedCalls,
        freeCalls: result.usage.freeCalls,
        nextActionType: result.status === 'approval_required' ? result.nextAction.type : null,
      },
    });
    return c.json(result);
  } catch (err) {
    if (err instanceof Error) {
      if (err.message === 'CAPABILITY_NOT_FOUND') {
        return c.json({ error: 'Capability not found' }, 404);
      }
      if (err.message === 'CAPABILITY_BASE_URL_REQUIRED') {
        return c.json({ error: 'Capability base URL is not configured' }, 409);
      }
      if (err.message === 'CAPABILITY_PATH_MUST_BE_RELATIVE') {
        return c.json({ error: 'Capability path must be relative to the connected base URL' }, 400);
      }
      if (
        err.message === 'CAPABILITY_TARGET_INSECURE'
        || err.message === 'CAPABILITY_TARGET_INVALID'
      ) {
        return c.json({ error: 'Capability target is invalid' }, 400);
      }
      if (err.message === 'CAPABILITY_HOST_NOT_ALLOWED') {
        return c.json({ error: 'Target host is not allowed for this capability' }, 403);
      }
      if (err.message === 'CAPABILITY_HOST_BLOCKED') {
        return c.json({ error: 'Capability target is blocked by network policy' }, 403);
      }
    }
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[capabilities] execute failed:', msg);
    return c.json({ error: 'Failed to execute capability' }, 500);
  }
});

router.post('/:capabilityId/revoke', async (c) => {
  const merchant = c.get('merchant');
  await revokeCapability(c.env, merchant.id, c.req.param('capabilityId'));
  return c.json({ revoked: true });
});

export { router as capabilitiesRouter };
