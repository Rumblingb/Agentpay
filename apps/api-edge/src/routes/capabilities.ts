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
import { encryptPayload } from '../lib/rcmCredentialVault';
import { sha256Hex } from '../lib/approvalSessions';
import { createDb } from '../lib/db';

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

function isCapabilityAuthScheme(value: string): value is 'bearer' | 'x_api_key' | 'basic' {
  return value === 'bearer' || value === 'x_api_key' || value === 'basic';
}

function isCapabilityCredentialKind(value: string): value is 'api_key' | 'bearer_token' | 'basic_auth' {
  return value === 'api_key' || value === 'bearer_token' || value === 'basic_auth';
}

async function sendVaultOtpEmail(
  env: Env,
  to: string,
  otpCode: string,
  credentials: Array<{ label: string; provider: string }>,
): Promise<void> {
  if (!env.RESEND_API_KEY) {
    throw new Error('VAULT_OTP_EMAIL_NOT_CONFIGURED');
  }

  const providerList = credentials.map((cr) => `<li style="margin:4px 0;font-weight:500;">${cr.label}</li>`).join('');
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.RESEND_API_KEY}` },
    body: JSON.stringify({
      from: 'AgentPay <notifications@agentpay.so>',
      to: [to],
      subject: 'Your AgentPay vault code',
      html: `<!doctype html><html><body style="margin:0;padding:32px;background:#f8fafc;font-family:system-ui,sans-serif;color:#0f172a;">
        <div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:32px;">
          <h1 style="margin:0 0 8px;font-size:24px;letter-spacing:-0.5px;">Vault confirmation</h1>
          <p style="margin:0 0 16px;color:#475569;line-height:1.6;">Your agent wants to vault ${credentials.length} API key${credentials.length > 1 ? 's' : ''} for autonomous use:</p>
          <ul style="margin:0 0 24px;padding-left:20px;color:#0f172a;">${providerList}</ul>
          <p style="margin:0 0 12px;color:#475569;font-size:14px;">Your confirmation code:</p>
          <div style="background:#0f172a;border-radius:12px;padding:20px;text-align:center;margin-bottom:24px;">
            <span style="font-size:44px;font-weight:700;letter-spacing:10px;color:#fff;font-family:monospace;">${otpCode}</span>
          </div>
          <p style="margin:0;font-size:13px;color:#64748b;">Expires in 5 minutes. If you did not initiate this, ignore — no keys will be stored.</p>
        </div>
      </body></html>`,
    }),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`VAULT_OTP_EMAIL_REJECTED:${response.status}:${text.slice(0, 200)}`);
  }
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
        err.message === 'CAPABILITY_BASE_URL_INVALID'
        || err.message === 'CAPABILITY_BASE_URL_INSECURE'
        || err.message === 'CAPABILITY_TARGET_INSECURE'
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

// ---------------------------------------------------------------------------
// POST /vault-from-env — receive env-detected keys, store pending, send OTP
//
// Called by the MCP setup micro-agent. The agent reads keys from the developer's
// local environment, sends them here encrypted in transit. We store them
// encrypted at rest behind a 6-digit OTP gate — only committed after the
// developer confirms via agentpay_confirm_vault.
// ---------------------------------------------------------------------------

router.post('/vault-from-env', async (c) => {
  const merchant = c.get('merchant');
  let body: { credentials?: unknown };
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }

  const rawCreds = Array.isArray(body.credentials) ? body.credentials : null;
  if (!rawCreds || rawCreds.length === 0) {
    return c.json({ error: 'credentials array is required' }, 400);
  }

  type EnvCred = { provider: string; label: string; baseUrl: string; authScheme: string; credentialKind?: string; headerName?: string; keyValue: string };
  const credentials: EnvCred[] = [];
  for (const c_ of rawCreds as Record<string, unknown>[]) {
    if (!c_.provider || !c_.keyValue || !c_.baseUrl || !c_.authScheme) continue;
    credentials.push({
      provider: String(c_.provider),
      label: String(c_.label ?? c_.provider),
      baseUrl: String(c_.baseUrl),
      authScheme: String(c_.authScheme),
      credentialKind: typeof c_.credentialKind === 'string' ? c_.credentialKind : 'api_key',
      headerName: typeof c_.headerName === 'string' ? c_.headerName : undefined,
      keyValue: String(c_.keyValue),
    });
  }
  if (credentials.length === 0) {
    return c.json({ error: 'No valid credentials provided' }, 400);
  }

  const vaultKey = c.env.CAPABILITY_VAULT_ENCRYPTION_KEY ?? c.env.RCM_VAULT_ENCRYPTION_KEY;
  if (!vaultKey) return c.json({ error: 'Capability vault encryption is not configured' }, 503);

  // Generate 6-digit OTP
  const otpCode = String(Math.floor(100000 + crypto.getRandomValues(new Uint32Array(1))[0] % 900000));
  const otpHash = await sha256Hex(otpCode);
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

  // Encrypt the credential bundle — keys never sit unencrypted at rest
  const encryptedBundle = await encryptPayload(vaultKey, JSON.stringify(credentials));

  const sessionId = `vfs_${crypto.randomUUID().replace(/-/g, '')}`;
  const sql = createDb(c.env);
  try {
    await sql`
      INSERT INTO hosted_action_sessions
        (id, merchant_id, action_type, entity_type, entity_id, title, summary,
         status, display_payload_json, result_payload_json, metadata_json, expires_at)
      VALUES (
        ${sessionId},
        ${merchant.id},
        ${'verification_required'},
        ${'vault_setup'},
        ${sessionId},
        ${'API vault confirmation'},
        ${'Vault ' + credentials.map(cr => cr.label).join(', ')},
        ${'pending'},
        ${JSON.stringify({ kind: 'otp_verification', providerCount: credentials.length, providers: credentials.map(cr => cr.provider) })}::jsonb,
        ${JSON.stringify({ otp_hash: otpHash, encrypted_bundle: encryptedBundle, attempt_count: 0 })}::jsonb,
        ${JSON.stringify({ source: 'vault_from_env', merchantId: merchant.id })}::jsonb,
        ${expiresAt.toISOString()}::timestamptz
      )
    `;

    if (!merchant.email) {
      await sql`
        UPDATE hosted_action_sessions
        SET status = 'failed', updated_at = NOW()
        WHERE id = ${sessionId}
      `;
      return c.json({ error: 'Merchant email is required for vault confirmation' }, 409);
    }

    try {
      await sendVaultOtpEmail(c.env, merchant.email, otpCode, credentials);
    } catch (err) {
      await sql`
        UPDATE hosted_action_sessions
        SET status = 'failed', updated_at = NOW()
        WHERE id = ${sessionId}
      `;
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[capabilities] vault OTP email failed:', msg);
      if (msg === 'VAULT_OTP_EMAIL_NOT_CONFIGURED') {
        return c.json({ error: 'Vault confirmation email is not configured on this deployment' }, 503);
      }
      return c.json({ error: 'Failed to deliver vault confirmation code' }, 502);
    }

    const maskedVaultEmail = `${merchant.email.slice(0, 3)}***@${merchant.email.split('@')[1] ?? '***'}`;

    return c.json({
      session_id: sessionId,
      providers: credentials.map(cr => cr.provider),
      otp_sent_to: maskedVaultEmail,
      expires_at: expiresAt.toISOString(),
      _instruction: `A 6-digit code was sent to ${maskedVaultEmail}. Call agentpay_confirm_vault with this session_id and the code to complete vaulting.`,
    });

    // Send OTP email
    if (c.env.RESEND_API_KEY && merchant.email) {
      const providerList = credentials.map(cr => `<li style="margin:4px 0;font-weight:500;">${cr.label}</li>`).join('');
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${c.env.RESEND_API_KEY}` },
        body: JSON.stringify({
          from: 'AgentPay <notifications@agentpay.so>',
          to: [merchant.email],
          subject: 'Your AgentPay vault code',
          html: `<!doctype html><html><body style="margin:0;padding:32px;background:#f8fafc;font-family:system-ui,sans-serif;color:#0f172a;">
            <div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:32px;">
              <h1 style="margin:0 0 8px;font-size:24px;letter-spacing:-0.5px;">Vault confirmation</h1>
              <p style="margin:0 0 16px;color:#475569;line-height:1.6;">Your agent wants to vault ${credentials.length} API key${credentials.length > 1 ? 's' : ''} for autonomous use:</p>
              <ul style="margin:0 0 24px;padding-left:20px;color:#0f172a;">${providerList}</ul>
              <p style="margin:0 0 12px;color:#475569;font-size:14px;">Your confirmation code:</p>
              <div style="background:#0f172a;border-radius:12px;padding:20px;text-align:center;margin-bottom:24px;">
                <span style="font-size:44px;font-weight:700;letter-spacing:10px;color:#fff;font-family:monospace;">${otpCode}</span>
              </div>
              <p style="margin:0;font-size:13px;color:#64748b;">Expires in 5 minutes. If you did not initiate this, ignore — no keys will be stored.</p>
            </div>
          </body></html>`,
        }),
      }).catch(() => {});
    }

    const maskedEmail = merchant.email
      ? `${merchant.email.slice(0, 3)}***@${merchant.email.split('@')[1] ?? '***'}`
      : null;

    return c.json({
      session_id: sessionId,
      providers: credentials.map(cr => cr.provider),
      otp_sent_to: maskedEmail,
      expires_at: expiresAt.toISOString(),
      _instruction: `A 6-digit code was sent to ${maskedEmail ?? 'your registered email'}. Call agentpay_confirm_vault with this session_id and the code to complete vaulting.`,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[capabilities] vault-from-env error:', msg);
    return c.json({ error: 'Failed to create vault session' }, 500);
  } finally {
    sql.end().catch(() => {});
  }
});

// ---------------------------------------------------------------------------
// POST /vault-from-env/:sessionId/confirm — validate OTP, commit vault entries
// ---------------------------------------------------------------------------

router.post('/vault-from-env/:sessionId/confirm', async (c) => {
  const merchant = c.get('merchant');
  const sessionId = c.req.param('sessionId');
  let body: { otp?: unknown };
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }

  const otp = typeof body.otp === 'string' ? body.otp.trim() : null;
  if (!otp || !/^\d{6}$/.test(otp)) {
    return c.json({ error: 'otp must be a 6-digit code' }, 400);
  }

  const vaultKey = c.env.CAPABILITY_VAULT_ENCRYPTION_KEY ?? c.env.RCM_VAULT_ENCRYPTION_KEY;
  if (!vaultKey) return c.json({ error: 'Capability vault encryption is not configured' }, 503);

  const sql = createDb(c.env);
  try {
    type SessionRow = { id: string; merchant_id: string; status: string; result_payload_json: unknown; expires_at: Date };
    const rows = await sql<SessionRow[]>`
      SELECT id, merchant_id, status, result_payload_json, expires_at
      FROM hosted_action_sessions
      WHERE id = ${sessionId}
        AND entity_type = 'vault_setup'
      LIMIT 1
    `;
    const session = rows[0];
    if (!session) return c.json({ error: 'Vault session not found' }, 404);
    if (session.merchant_id !== merchant.id) return c.json({ error: 'Vault session not found' }, 404);
    if (session.status !== 'pending') return c.json({ error: 'Vault session already used or expired' }, 410);
    if (new Date(session.expires_at).getTime() < Date.now()) {
      return c.json({ error: 'Vault session expired' }, 410);
    }

    const resultPayload = (session.result_payload_json ?? {}) as Record<string, unknown>;
    const storedHash = typeof resultPayload.otp_hash === 'string' ? resultPayload.otp_hash : null;
    const encryptedBundle = typeof resultPayload.encrypted_bundle === 'string' ? resultPayload.encrypted_bundle : null;
    const attemptCount = typeof resultPayload.attempt_count === 'number' ? resultPayload.attempt_count : 0;

    if (attemptCount >= 3) {
      await sql`UPDATE hosted_action_sessions SET status = 'failed', updated_at = NOW() WHERE id = ${sessionId}`;
      return c.json({ error: 'Too many attempts. Restart the vault flow.' }, 429);
    }

    const submittedHash = await sha256Hex(otp);
    if (!storedHash || submittedHash !== storedHash) {
      await sql`
        UPDATE hosted_action_sessions
        SET result_payload_json = result_payload_json || ${JSON.stringify({ attempt_count: attemptCount + 1 })}::jsonb,
            updated_at = NOW()
        WHERE id = ${sessionId}
      `;
      return c.json({ error: 'Invalid code', attempts_remaining: 3 - (attemptCount + 1) }, 400);
    }

    if (!encryptedBundle) return c.json({ error: 'Vault session data corrupted' }, 500);

    // Decrypt credentials
    let credentials: Array<{ provider: string; label: string; baseUrl: string; authScheme: string; credentialKind: string; headerName?: string; keyValue: string }>;
    try {
      const { decryptPayload } = await import('../lib/rcmCredentialVault');
      const decrypted = await decryptPayload(vaultKey, encryptedBundle);
      credentials = JSON.parse(decrypted) as typeof credentials;
    } catch {
      return c.json({ error: 'Failed to decrypt vault data' }, 500);
    }

    // Vault each credential — direct insert, status active
    const vaulted: Array<{ provider: string; capabilityId: string; capabilityKey: string }> = [];
    for (const cred of credentials) {
      const capabilityKey = `${cred.provider}_primary`;
      const normalizedBaseUrl = normalizeCapabilityBaseUrl(cred.baseUrl, c.env);
      if (!isCapabilityAuthScheme(cred.authScheme)) {
        return c.json({ error: `Unsupported auth scheme for ${cred.provider}` }, 400);
      }
      if (!isCapabilityCredentialKind(cred.credentialKind)) {
        return c.json({ error: `Unsupported credential kind for ${cred.provider}` }, 400);
      }

      const providerDefaults = getCapabilityProviderDefaults(cred.provider);
      const allowedHosts = normalizeAllowedCapabilityHosts(
        providerDefaults?.allowedHosts?.length
          ? providerDefaults.allowedHosts
          : [new URL(normalizedBaseUrl).host],
        c.env,
      );
      const capabilityId = crypto.randomUUID();
      const secretPayload = cred.credentialKind === 'bearer_token'
        ? { token: cred.keyValue }
        : cred.credentialKind === 'basic_auth'
          ? { headerValue: cred.keyValue }
          : { apiKey: cred.keyValue };
      const freeCalls = providerDefaults?.freeCalls ?? 5;
      const paidUnitPriceUsdMicros = providerDefaults?.paidUnitPriceUsdMicros ?? 25_000;
      const encryptedSecret = await encryptPayload(vaultKey, JSON.stringify(secretPayload));
      const metadata = {
        authScheme: cred.authScheme,
        credentialKind: cred.credentialKind,
        baseUrl: normalizedBaseUrl,
        allowedHosts,
        headerName: cred.headerName ?? null,
        scopes: [],
        freeCalls,
        paidUnitPriceUsdMicros,
      };

      const insertedRows = await sql<Array<{ id: string; capability_key: string }>>`
        INSERT INTO capability_vault_entries
          (id, merchant_id, capability_key, capability_type, capability_scope, provider,
           subject_type, subject_ref, status, secret_payload_json, metadata, expires_at)
        VALUES (
          ${capabilityId}::uuid,
          ${merchant.id}::uuid,
          ${capabilityKey},
          ${'external_api'},
          ${cred.provider},
          ${cred.provider},
          ${'merchant'},
          ${merchant.id},
          ${'active'},
          ${JSON.stringify({ encryption: 'aes-256-gcm', encryptedBlob: encryptedSecret })}::jsonb,
          ${JSON.stringify(metadata)}::jsonb,
          ${null}
        )
        ON CONFLICT (merchant_id, capability_key)
        DO UPDATE SET
          status = 'active',
          secret_payload_json = EXCLUDED.secret_payload_json,
          metadata = EXCLUDED.metadata,
          revoked_at = NULL,
          updated_at = NOW()
        RETURNING id, capability_key
      `;

      const inserted = insertedRows[0];
      vaulted.push({
        provider: cred.provider,
        capabilityId: inserted.id,
        capabilityKey: inserted.capability_key,
      });
    }

    // Mark session complete
    await sql`
      UPDATE hosted_action_sessions
      SET status = 'completed', completed_at = NOW(), updated_at = NOW()
      WHERE id = ${sessionId}
    `;

    return c.json({
      vaulted,
      _instruction: 'Keys are now vaulted. Use agentpay_execute_capability with the capabilityId to call each API. The agent never sees the raw keys.',
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[capabilities] vault-from-env confirm error:', msg);
    return c.json({ error: 'Failed to confirm vault' }, 500);
  } finally {
    sql.end().catch(() => {});
  }
});

export { router as capabilitiesRouter };
