import { Hono } from 'hono';
import type { Env, MerchantContext, Variables } from '../types';
import { authenticateApiKey } from '../middleware/auth';
import { isMcpAccessToken } from '../lib/mcpAccessTokens';
import {
  type CapabilitySubjectType,
  createCapabilityConnectSession,
  findSubjectCapabilityAccess,
  getCapability,
  getCapabilityMetadata,
  getCapabilityConnectSession,
  peekCapabilityConnectSession,
  revokeCapability,
  submitCapabilityConnectSession,
  upsertCapabilityVaultCredential,
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
import { getInternalAppFetcher } from '../lib/internalAppFetch';
import {
  normalizeAllowedCapabilityHosts,
  normalizeCapabilityBaseUrl,
} from '../lib/networkPolicy';
import { encryptPayload } from '../lib/rcmCredentialVault';
import { sha256Hex } from '../lib/approvalSessions';
import { createDb, parseJsonb } from '../lib/db';
import { getAuthorityProfile, upsertAuthorityProfile } from '../lib/authorityProfiles';
import {
  attachHostedActionSessionToExecutionAttempt,
  completeCapabilityExecutionAttempt,
  createCapabilityExecutionAttempt,
  getCapabilityExecutionAttempt,
} from '../lib/capabilityExecutionAttempts';
import {
  createCapabilityAccessLease,
  resolveCapabilityAccessLease,
  touchCapabilityAccessLease,
} from '../lib/capabilityAccessLeases';

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

function isCapabilitySubjectType(value: string): value is CapabilitySubjectType {
  return value === 'merchant' || value === 'principal' || value === 'agent' || value === 'workspace';
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function asStringRecord(value: unknown): Record<string, string> | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  return Object.fromEntries(
    Object.entries(record).filter(([, entry]) => typeof entry === 'string'),
  ) as Record<string, string>;
}

function buildExecutionAttemptStatusUrl(env: Env, attemptId: string): string {
  return new URL(`/api/capabilities/execution-attempts/${attemptId}`, env.API_BASE_URL).toString();
}

async function readJsonResponse(response: Response): Promise<Record<string, any> | null> {
  try {
    return await response.json() as Record<string, any>;
  } catch {
    return null;
  }
}

async function loadMerchantContextById(env: Env, merchantId: string): Promise<MerchantContext | null> {
  const sql = createDb(env);
  try {
    const rows = await sql<Array<{
      id: string;
      name: string;
      email: string;
      wallet_address: string | null;
      webhook_url: string | null;
      parent_merchant_id: string | null;
    }>>`
      SELECT id, name, email, wallet_address, webhook_url, parent_merchant_id
      FROM merchants
      WHERE id = ${merchantId}::uuid
        AND is_active = true
      LIMIT 1
    `;
    const merchant = rows[0];
    if (!merchant) return null;
    return {
      id: merchant.id,
      name: merchant.name,
      email: merchant.email,
      walletAddress: merchant.wallet_address,
      webhookUrl: merchant.webhook_url ?? null,
      parentMerchantId: merchant.parent_merchant_id ?? null,
    };
  } finally {
    await sql.end().catch(() => {});
  }
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

type CapabilityCredentialField = {
  key: string;
  label: string;
  secret: boolean;
  autocomplete?: string;
  placeholder?: string;
};

type HostedOnboardingProvider = {
  provider: string;
  label: string;
  capabilityKey: string;
  baseUrl: string;
  allowedHosts: string[];
  authScheme: 'bearer' | 'x_api_key' | 'basic';
  credentialKind: 'api_key' | 'bearer_token' | 'basic_auth';
  headerName: string | null;
  freeCalls: number;
  paidUnitPriceUsdMicros: number;
  description: string;
  required: boolean;
  fields: CapabilityCredentialField[];
};

type OnboardingSessionRecord = {
  id: string;
  merchant_id: string;
  status: 'pending' | 'completed' | 'failed' | 'expired';
  title: string;
  summary: string | null;
  resume_url: string | null;
  display_payload_json: unknown;
  metadata_json: unknown;
  result_payload_json: unknown;
  expires_at: Date;
};

function buildCredentialFields(
  credentialKind: 'api_key' | 'bearer_token' | 'basic_auth',
  label: string,
): CapabilityCredentialField[] {
  if (credentialKind === 'basic_auth') {
    return [
      { key: 'username', label: `${label} username`, secret: false, autocomplete: 'username' },
      { key: 'password', label: `${label} password`, secret: true, autocomplete: 'current-password' },
    ];
  }

  return [{
    key: credentialKind === 'bearer_token' ? 'token' : 'apiKey',
    label: credentialKind === 'bearer_token' ? `${label} bearer token` : `${label} API key`,
    secret: true,
    autocomplete: 'off',
    placeholder: credentialKind === 'bearer_token' ? 'Paste token' : 'Paste API key',
  }];
}

function parsePositiveNumber(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function parseCheckboxValue(value: FormDataEntryValue | null): boolean {
  if (typeof value !== 'string') return false;
  return value === 'on' || value === 'true' || value === '1';
}

function buildProviderFieldName(provider: string, fieldKey: string): string {
  return `${provider}__${fieldKey}`;
}

function buildOnboardingPage(input: {
  sessionId: string;
  sessionToken: string;
  title: string;
  summary: string | null;
  expiresAt: string;
  contactEmail: string | null;
  contactName: string | null;
  preferredFundingRail: string | null;
  autoApproveUsd: string | null;
  perActionUsd: string | null;
  dailyUsd: string | null;
  monthlyUsd: string | null;
  otpEveryPaidAction: boolean;
  walletStatus: string | null;
  providers: HostedOnboardingProvider[];
  error?: string | null;
}) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Finish AgentPay setup</title>
    <style>
      body { font-family: ui-sans-serif, system-ui, sans-serif; background: linear-gradient(180deg, #eff6ff 0%, #f8fafc 100%); color: #0f172a; margin: 0; }
      .wrap { max-width: 860px; margin: 32px auto 64px; padding: 24px; }
      .card { background: rgba(255,255,255,0.96); border: 1px solid #dbeafe; border-radius: 20px; padding: 28px; box-shadow: 0 18px 48px rgba(15,23,42,0.08); }
      h1 { margin: 0 0 10px; font-size: 30px; letter-spacing: -0.04em; }
      h2 { margin: 0 0 8px; font-size: 20px; letter-spacing: -0.02em; }
      p { color: #475569; line-height: 1.6; }
      .meta { margin: 18px 0 24px; display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; }
      .meta-box, .section, .provider { background: #fff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 18px; }
      .section-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 14px; }
      .provider-grid { display: grid; gap: 16px; margin-top: 18px; }
      label { display: block; font-size: 13px; font-weight: 700; margin: 14px 0 6px; color: #0f172a; }
      input, select { width: 100%; box-sizing: border-box; padding: 12px 14px; border-radius: 12px; border: 1px solid #cbd5e1; font-size: 14px; background: #fff; }
      .inline-check { display: flex; gap: 10px; align-items: center; margin-top: 16px; padding: 12px 14px; border-radius: 12px; border: 1px solid #cbd5e1; background: #f8fafc; }
      .inline-check input { width: auto; margin: 0; }
      .pill { display: inline-block; padding: 6px 10px; border-radius: 999px; background: #dbeafe; color: #1d4ed8; font-size: 12px; font-weight: 700; margin-bottom: 10px; }
      .small { font-size: 13px; color: #64748b; }
      .submit { margin-top: 24px; width: 100%; border: none; border-radius: 14px; background: #0f172a; color: #fff; padding: 14px 18px; font-size: 16px; font-weight: 700; cursor: pointer; }
      .error { margin: 0 0 18px; padding: 14px 16px; border-radius: 14px; background: #fef2f2; border: 1px solid #fecaca; color: #b91c1c; }
      .host-list { margin: 10px 0 0; padding-left: 20px; color: #475569; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="card">
        <div class="pill">One secure setup</div>
        <h1>${htmlEscape(input.title)}</h1>
        <p>${htmlEscape(input.summary ?? 'Set your spending rules once, connect the APIs your agent needs, and let AgentPay handle secure vaulting and governed execution from there.')}</p>
        ${input.error ? `<div class="error">${htmlEscape(input.error)}</div>` : ''}
        <div class="meta">
          <div class="meta-box"><strong>Expires</strong><div class="small">${htmlEscape(input.expiresAt)}</div></div>
          <div class="meta-box"><strong>Funding status</strong><div class="small">${htmlEscape(input.walletStatus === 'ready' ? 'Saved card already available for faster approvals.' : 'No saved payment method on file yet. AgentPay will ask when paid usage first needs it.')}</div></div>
          <div class="meta-box"><strong>Promise</strong><div class="small">Keys stay in AgentPay's vault. Agents only receive governed capability access.</div></div>
        </div>
        <form method="post" action="/api/capabilities/onboarding-sessions/${htmlEscape(input.sessionId)}/hosted">
          <input type="hidden" name="sessionToken" value="${htmlEscape(input.sessionToken)}" />
          <div class="section">
            <h2>Who is in control</h2>
            <div class="section-grid">
              <div>
                <label for="contactName">Name</label>
                <input id="contactName" name="contactName" type="text" value="${htmlEscape(input.contactName)}" autocomplete="name" />
              </div>
              <div>
                <label for="contactEmail">Email</label>
                <input id="contactEmail" name="contactEmail" type="email" value="${htmlEscape(input.contactEmail)}" autocomplete="email" />
              </div>
              <div>
                <label for="preferredFundingRail">Preferred funding rail</label>
                <select id="preferredFundingRail" name="preferredFundingRail">
                  <option value="card"${input.preferredFundingRail === 'card' || !input.preferredFundingRail ? ' selected' : ''}>Card</option>
                  <option value="upi"${input.preferredFundingRail === 'upi' ? ' selected' : ''}>UPI</option>
                </select>
              </div>
            </div>
          </div>
          <div class="section" style="margin-top: 16px;">
            <h2>How much freedom the agent has</h2>
            <div class="section-grid">
              <div>
                <label for="autoApproveUsd">Auto-approve below (USD)</label>
                <input id="autoApproveUsd" name="autoApproveUsd" type="number" min="0" step="0.01" value="${htmlEscape(input.autoApproveUsd)}" />
              </div>
              <div>
                <label for="perActionUsd">Single action limit (USD)</label>
                <input id="perActionUsd" name="perActionUsd" type="number" min="0" step="0.01" value="${htmlEscape(input.perActionUsd)}" />
              </div>
              <div>
                <label for="dailyUsd">Daily spend limit (USD)</label>
                <input id="dailyUsd" name="dailyUsd" type="number" min="0" step="0.01" value="${htmlEscape(input.dailyUsd)}" />
              </div>
              <div>
                <label for="monthlyUsd">Monthly spend limit (USD)</label>
                <input id="monthlyUsd" name="monthlyUsd" type="number" min="0" step="0.01" value="${htmlEscape(input.monthlyUsd)}" />
              </div>
            </div>
            <label class="inline-check" for="otpEveryPaidAction">
              <input id="otpEveryPaidAction" name="otpEveryPaidAction" type="checkbox"${input.otpEveryPaidAction ? ' checked' : ''} />
              <span>Ask for OTP on every paid action, even when the amount is within the approved budget.</span>
            </label>
          </div>
          <div class="section" style="margin-top: 16px;">
            <h2>Connect the APIs your agent can use</h2>
            <p class="small">Provide each credential once here. AgentPay stores it in the vault, applies your limits, and keeps the raw secret out of agent context forever.</p>
            <div class="provider-grid">
              ${input.providers.map((provider) => `
                <div class="provider">
                  <div class="pill">${htmlEscape(provider.label)}</div>
                  <div class="small">${htmlEscape(provider.description)}</div>
                  <div class="small" style="margin-top:8px;"><strong>Capability key:</strong> ${htmlEscape(provider.capabilityKey)}</div>
                  <div class="small"><strong>Base URL:</strong> ${htmlEscape(provider.baseUrl)}</div>
                  <ul class="host-list">${provider.allowedHosts.map((host) => `<li>${htmlEscape(host)}</li>`).join('')}</ul>
                  ${provider.fields.map((field) => {
                    const fieldName = buildProviderFieldName(provider.provider, field.key);
                    return `<label for="${htmlEscape(fieldName)}">${htmlEscape(field.label)}</label>
                    <input id="${htmlEscape(fieldName)}" name="${htmlEscape(fieldName)}" type="${field.secret ? 'password' : 'text'}" autocomplete="${htmlEscape(field.autocomplete ?? 'off')}" placeholder="${htmlEscape(field.placeholder ?? '')}"${provider.required ? ' required' : ''} />`;
                  }).join('')}
                </div>
              `).join('')}
            </div>
          </div>
          <button class="submit" type="submit">Finish secure setup</button>
        </form>
      </div>
    </div>
  </body>
</html>`;
}

async function getCapabilityOnboardingSession(
  env: Env,
  sessionId: string,
): Promise<{
  session: OnboardingSessionRecord;
  displayPayload: Record<string, unknown>;
  metadata: Record<string, unknown>;
  resultPayload: Record<string, unknown>;
} | null> {
  const sql = createDb(env);
  try {
    const rows = await sql<OnboardingSessionRecord[]>`
      SELECT id, merchant_id, status, title, summary, resume_url, display_payload_json, metadata_json, result_payload_json, expires_at
      FROM hosted_action_sessions
      WHERE id = ${sessionId}
        AND entity_type = 'capability_onboarding'
      LIMIT 1
    `;
    const session = rows[0];
    if (!session) return null;
    return {
      session,
      displayPayload: parseJsonb<Record<string, unknown>>(session.display_payload_json, {}),
      metadata: parseJsonb<Record<string, unknown>>(session.metadata_json, {}),
      resultPayload: parseJsonb<Record<string, unknown>>(session.result_payload_json, {}),
    };
  } finally {
    await sql.end().catch(() => {});
  }
}

async function listPendingHostedActions(
  env: Env,
  merchantId: string,
): Promise<Array<{
  sessionId: string;
  actionType: string;
  entityType: string | null;
  entityId: string | null;
  title: string;
  summary: string | null;
  resumeUrl: string | null;
  expiresAt: string;
}>> {
  const sql = createDb(env);
  try {
    const rows = await sql<Array<{
      id: string;
      action_type: string;
      entity_type: string | null;
      entity_id: string | null;
      title: string;
      summary: string | null;
      resume_url: string | null;
      expires_at: Date;
    }>>`
      SELECT id, action_type, entity_type, entity_id, title, summary, resume_url, expires_at
      FROM hosted_action_sessions
      WHERE merchant_id = ${merchantId}::uuid
        AND status = 'pending'
      ORDER BY created_at DESC
      LIMIT 10
    `;
    return rows.map((row) => ({
      sessionId: row.id,
      actionType: row.action_type,
      entityType: row.entity_type,
      entityId: row.entity_id,
      title: row.title,
      summary: row.summary,
      resumeUrl: row.resume_url,
      expiresAt: row.expires_at.toISOString(),
    }));
  } catch {
    return [];
  } finally {
    await sql.end().catch(() => {});
  }
}

type PendingCapabilityOnboardingAction = {
  sessionId: string;
  title: string;
  summary: string | null;
  resumeUrl: string | null;
  expiresAt: string;
  onboardingUrl: string | null;
  partnershipStatus: string | null;
  providerLabel: string | null;
  capabilityKey: string | null;
};

async function findReusablePendingOnboardingAction(
  env: Env,
  input: {
    merchantId: string;
    subjectType: CapabilitySubjectType;
    subjectRef: string;
    provider: string;
    capabilityKey: string;
  },
): Promise<PendingCapabilityOnboardingAction | null> {
  const sql = createDb(env);
  try {
    const rows = await sql<Array<{
      id: string;
      title: string;
      summary: string | null;
      resume_url: string | null;
      expires_at: Date;
      display_payload_json: unknown;
      metadata_json: unknown;
    }>>`
      SELECT id, title, summary, resume_url, expires_at, display_payload_json, metadata_json
      FROM hosted_action_sessions
      WHERE merchant_id = ${input.merchantId}::uuid
        AND status = 'pending'
        AND entity_type = 'capability_onboarding'
      ORDER BY created_at DESC
      LIMIT 20
    `;

    for (const row of rows) {
      const displayPayload = parseJsonb<Record<string, unknown>>(row.display_payload_json, {});
      if (asString(displayPayload.subjectType) !== input.subjectType) continue;
      if (asString(displayPayload.subjectRef) !== input.subjectRef) continue;

      const providers = Array.isArray(displayPayload.providers)
        ? displayPayload.providers.filter((value): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value))
        : [];
      const matchedProvider = providers.find((provider) => {
        const providerName = asString(provider.provider);
        const providerCapabilityKey = asString(provider.capabilityKey);
        return providerName === input.provider || providerCapabilityKey === input.capabilityKey;
      });
      if (!matchedProvider) continue;

      const metadata = parseJsonb<Record<string, unknown>>(row.metadata_json, {});
      const intake = asRecord(displayPayload.intake);
      return {
        sessionId: row.id,
        title: row.title,
        summary: row.summary,
        resumeUrl: row.resume_url,
        expiresAt: row.expires_at.toISOString(),
        onboardingUrl: asString(displayPayload.onboardingUrl),
        partnershipStatus: asString(intake?.partnershipStatus) ?? asString(metadata.partnershipStatus),
        providerLabel: asString(matchedProvider.label) ?? asString(intake?.requestedProviderName),
        capabilityKey: asString(matchedProvider.capabilityKey),
      };
    }

    return null;
  } catch {
    return null;
  } finally {
    await sql.end().catch(() => {});
  }
}

function buildRequestedProviderLabel(
  body: Record<string, unknown>,
  providerDefaults: ReturnType<typeof getCapabilityProviderDefaults>,
): string {
  return asString(body.requestedProviderName) ?? providerDefaults?.label ?? 'Requested API';
}

function buildRequestedCapabilityKey(
  body: Record<string, unknown>,
  providerLabel: string,
): string {
  return asString(body.capabilityKey)
    ?? `${providerLabel.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'requested_api'}_primary`;
}

function buildRequestedProviderInput(
  body: Record<string, unknown>,
  env: Env,
): HostedOnboardingProvider {
  const requestedBaseUrl = asString(body.requestedBaseUrl);
  const requestedAuthScheme = asString(body.requestedAuthScheme);
  const requestedCredentialKind = asString(body.requestedCredentialKind);
  const requestedProviderKey = asString(body.provider);
  const normalizedProvider = requestedProviderKey ?? 'generic_rest_api';
  const providerDefaults = getCapabilityProviderDefaults(normalizedProvider);
  const providerLabel = buildRequestedProviderLabel(body, providerDefaults);
  let fallbackAllowedHosts: string[] | undefined;
  if (requestedBaseUrl) {
    try {
      fallbackAllowedHosts = [new URL(requestedBaseUrl).host];
    } catch {
      fallbackAllowedHosts = undefined;
    }
  }

  return buildOnboardingProviderFromInput({
    provider: normalizedProvider,
    label: providerLabel,
    capabilityKey: buildRequestedCapabilityKey(body, providerLabel),
    baseUrl: requestedBaseUrl ?? providerDefaults?.defaultBaseUrl,
    allowedHosts: Array.isArray(body.allowedHosts)
      ? body.allowedHosts
      : (fallbackAllowedHosts ?? providerDefaults?.allowedHosts),
    authScheme: requestedAuthScheme ?? providerDefaults?.authScheme ?? 'bearer',
    credentialKind: requestedCredentialKind ?? providerDefaults?.credentialKind ?? 'api_key',
    freeCalls: typeof body.freeCalls === 'number' ? body.freeCalls : providerDefaults?.freeCalls ?? 0,
    paidUnitPriceUsdMicros: typeof body.paidUnitPriceUsdMicros === 'number'
      ? body.paidUnitPriceUsdMicros
      : providerDefaults?.paidUnitPriceUsdMicros ?? 25_000,
    description: asString(body.description) ?? `AgentPay intake for ${providerLabel}. If delegated auth is unavailable, AgentPay will vault the credential once and keep the secret out of agent context.`,
    required: true,
  }, env, new Set<string>());
}

function buildOnboardingProviderFromInput(
  providerInput: Record<string, unknown>,
  env: Env,
  seenCapabilityKeys: Set<string>,
): HostedOnboardingProvider {
  const provider = asString(providerInput.provider);
  if (!provider) {
    throw new Error('PROVIDER_INPUT_MISSING_PROVIDER');
  }

  const defaults = getCapabilityProviderDefaults(provider);
  const baseUrl = asString(providerInput.baseUrl) ?? defaults?.defaultBaseUrl ?? null;
  const authScheme = asString(providerInput.authScheme) ?? defaults?.authScheme ?? null;
  const credentialKind = asString(providerInput.credentialKind) ?? defaults?.credentialKind ?? null;
  const capabilityKey = asString(providerInput.capabilityKey) ?? `${provider}_primary`;
  const allowedHosts = Array.isArray(providerInput.allowedHosts)
    ? providerInput.allowedHosts.filter((value): value is string => typeof value === 'string')
    : (defaults?.allowedHosts ?? []);
  if (!baseUrl || !authScheme || !credentialKind || !capabilityKey || !allowedHosts.length) {
    throw new Error(`PROVIDER_INPUT_INVALID:${provider}`);
  }
  if (!isCapabilityAuthScheme(authScheme) || !isCapabilityCredentialKind(credentialKind)) {
    throw new Error(`PROVIDER_INPUT_UNSUPPORTED_AUTH:${provider}`);
  }
  if (seenCapabilityKeys.has(capabilityKey)) {
    throw new Error(`PROVIDER_INPUT_DUPLICATE_CAPABILITY_KEY:${capabilityKey}`);
  }
  seenCapabilityKeys.add(capabilityKey);

  return {
    provider,
    label: asString(providerInput.label) ?? defaults?.label ?? provider,
    capabilityKey,
    baseUrl: normalizeCapabilityBaseUrl(baseUrl, env),
    allowedHosts: normalizeAllowedCapabilityHosts(allowedHosts, env),
    authScheme,
    credentialKind,
    headerName: asString(providerInput.headerName),
    freeCalls: typeof providerInput.freeCalls === 'number' ? providerInput.freeCalls : (defaults?.freeCalls ?? 0),
    paidUnitPriceUsdMicros: typeof providerInput.paidUnitPriceUsdMicros === 'number'
      ? providerInput.paidUnitPriceUsdMicros
      : (defaults?.paidUnitPriceUsdMicros ?? 0),
    description: asString(providerInput.description) ?? defaults?.description ?? 'Securely vaulted capability access.',
    required: providerInput.required !== false,
    fields: buildCredentialFields(credentialKind, asString(providerInput.label) ?? defaults?.label ?? provider),
  };
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

router.get('/onboarding-sessions/:sessionId/hosted', async (c) => {
  const sessionId = c.req.param('sessionId');
  const sessionToken = asString(c.req.query('token'));
  if (!sessionToken) {
    return c.text('Missing onboarding session token.', 400);
  }

  try {
    const stored = await getCapabilityOnboardingSession(c.env, sessionId);
    if (!stored) return c.text('Onboarding session not found.', 404);
    if (stored.session.status !== 'pending') return c.text('This onboarding session is no longer pending.', 409);
    if (new Date(stored.session.expires_at).getTime() < Date.now()) return c.text('Onboarding session has expired.', 410);

    const expectedHash = typeof stored.metadata.sessionTokenHash === 'string' ? stored.metadata.sessionTokenHash : null;
    const providedHash = await sha256Hex(sessionToken);
    if (!expectedHash || providedHash !== expectedHash) {
      return c.text('Onboarding session token is invalid.', 403);
    }

    const providers = Array.isArray(stored.displayPayload.providers)
      ? stored.displayPayload.providers.filter((value): value is HostedOnboardingProvider => typeof value === 'object' && value !== null && !Array.isArray(value))
      : [];
    const limits = asRecord(stored.displayPayload.limits) ?? {};
    const autonomyPolicy = asRecord(stored.displayPayload.autonomyPolicy) ?? {};

    return secureHtml(buildOnboardingPage({
      sessionId,
      sessionToken,
      title: stored.session.title,
      summary: stored.session.summary,
      expiresAt: stored.session.expires_at.toISOString(),
      contactEmail: asString(stored.displayPayload.contactEmail),
      contactName: asString(stored.displayPayload.contactName),
      preferredFundingRail: asString(stored.displayPayload.preferredFundingRail),
      autoApproveUsd: typeof autonomyPolicy.autoApproveUsd === 'number' ? String(autonomyPolicy.autoApproveUsd) : null,
      perActionUsd: typeof limits.perActionUsd === 'number' ? String(limits.perActionUsd) : null,
      dailyUsd: typeof limits.dailyUsd === 'number' ? String(limits.dailyUsd) : null,
      monthlyUsd: typeof limits.monthlyUsd === 'number' ? String(limits.monthlyUsd) : null,
      otpEveryPaidAction: autonomyPolicy.otpEveryPaidAction === true,
      walletStatus: asString(stored.displayPayload.walletStatus),
      providers,
    }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[capabilities] load onboarding page failed:', msg);
    return c.text('Failed to load onboarding step.', 500);
  }
});

router.post('/onboarding-sessions/:sessionId/hosted', async (c) => {
  const sessionId = c.req.param('sessionId');
  const form = await c.req.formData();
  const sessionToken = asString(form.get('sessionToken'));
  if (!sessionToken) {
    return c.text('Missing onboarding session token.', 400);
  }

  try {
    const stored = await getCapabilityOnboardingSession(c.env, sessionId);
    if (!stored) return c.text('Onboarding session not found.', 404);
    if (stored.session.status !== 'pending') return c.text('This onboarding session is no longer pending.', 409);
    if (new Date(stored.session.expires_at).getTime() < Date.now()) return c.text('Onboarding session has expired.', 410);

    const expectedHash = typeof stored.metadata.sessionTokenHash === 'string' ? stored.metadata.sessionTokenHash : null;
    const providedHash = await sha256Hex(sessionToken);
    if (!expectedHash || providedHash !== expectedHash) {
      return c.text('Onboarding session token is invalid.', 403);
    }

    const providers = Array.isArray(stored.displayPayload.providers)
      ? stored.displayPayload.providers.filter((value): value is HostedOnboardingProvider => typeof value === 'object' && value !== null && !Array.isArray(value))
      : [];
    const contactEmail = asString(form.get('contactEmail')) ?? asString(stored.displayPayload.contactEmail);
    const contactName = asString(form.get('contactName')) ?? asString(stored.displayPayload.contactName);
    const preferredFundingRail = asString(form.get('preferredFundingRail')) ?? asString(stored.displayPayload.preferredFundingRail);
    const autoApproveUsd = parsePositiveNumber(asString(form.get('autoApproveUsd')));
    const perActionUsd = parsePositiveNumber(asString(form.get('perActionUsd')));
    const dailyUsd = parsePositiveNumber(asString(form.get('dailyUsd')));
    const monthlyUsd = parsePositiveNumber(asString(form.get('monthlyUsd')));
    const otpEveryPaidAction = parseCheckboxValue(form.get('otpEveryPaidAction'));
    const walletStatus = asString(stored.displayPayload.walletStatus);

    const capabilityInputs: Array<{
      provider: HostedOnboardingProvider;
      secretPayload: Record<string, unknown>;
    }> = [];

    for (const provider of providers) {
      const secretPayload: Record<string, unknown> = {};
      let hasAnyValue = false;
      for (const field of provider.fields) {
        const fieldValue = asString(form.get(buildProviderFieldName(provider.provider, field.key)));
        if (fieldValue) {
          secretPayload[field.key] = fieldValue;
          hasAnyValue = true;
        }
      }

      if (!hasAnyValue && !provider.required) {
        continue;
      }

      for (const field of provider.fields) {
        if (!asString(secretPayload[field.key])) {
          return secureHtml(buildOnboardingPage({
            sessionId,
            sessionToken,
            title: stored.session.title,
            summary: stored.session.summary,
            expiresAt: stored.session.expires_at.toISOString(),
            contactEmail,
            contactName,
            preferredFundingRail,
            autoApproveUsd: autoApproveUsd === null ? null : String(autoApproveUsd),
            perActionUsd: perActionUsd === null ? null : String(perActionUsd),
            dailyUsd: dailyUsd === null ? null : String(dailyUsd),
            monthlyUsd: monthlyUsd === null ? null : String(monthlyUsd),
            otpEveryPaidAction,
            walletStatus,
            providers,
            error: `${provider.label} requires ${field.label.toLowerCase()}.`,
          }));
        }
      }

      capabilityInputs.push({ provider, secretPayload });
    }

    const subjectTypeValue = asString(stored.displayPayload.subjectType);
    const subjectType = subjectTypeValue && isCapabilitySubjectType(subjectTypeValue) ? subjectTypeValue : null;
    const subjectRef = asString(stored.displayPayload.subjectRef);
    if (!subjectType || !subjectRef) {
      return c.text('Onboarding session is missing subject context.', 500);
    }

    const principalId = asString(stored.displayPayload.principalId);
    const operatorId = asString(stored.displayPayload.operatorId);
    const merchantId = stored.session.merchant_id;

    const authorityProfile = principalId
      ? await upsertAuthorityProfile(c.env, {
          merchantId,
          principalId,
          operatorId,
          walletStatus: walletStatus === 'ready' ? 'ready' : 'missing',
          preferredFundingRail,
          contactEmail,
          contactName,
          autonomyPolicy: {
            autoApproveUsd: autoApproveUsd ?? 0,
            otpEveryPaidAction,
            setupSource: 'hosted_onboarding',
          },
          limits: {
            perActionUsd: perActionUsd ?? 0,
            dailyUsd: dailyUsd ?? 0,
            monthlyUsd: monthlyUsd ?? 0,
          },
          metadata: {
            source: 'capability_onboarding_hosted',
            providers: providers.map((provider) => provider.provider),
          },
        })
      : null;

    const connectedCapabilities = [];
    for (const input of capabilityInputs) {
      const capability = await upsertCapabilityVaultCredential(c.env, {
        merchantId,
        capabilityKey: input.provider.capabilityKey,
        provider: input.provider.provider,
        subjectType,
        subjectRef,
        secretPayload: input.secretPayload,
        authScheme: input.provider.authScheme,
        credentialKind: input.provider.credentialKind,
        baseUrl: input.provider.baseUrl,
        allowedHosts: input.provider.allowedHosts,
        headerName: input.provider.headerName,
        freeCalls: input.provider.freeCalls,
        paidUnitPriceUsdMicros: input.provider.paidUnitPriceUsdMicros,
        metadata: {
          connectedFrom: 'hosted_onboarding',
          providerLabel: input.provider.label,
        },
      });
      connectedCapabilities.push({
        capabilityId: capability.id,
        capabilityKey: capability.capabilityKey,
        provider: capability.provider,
      });
    }

    const actionSession = await syncHostedActionSession(c.env, {
      sessionId,
      status: 'completed',
      resultPayload: {
        authorityProfileId: authorityProfile?.id ?? null,
        connectedCapabilities,
        funding: {
          walletStatus: walletStatus ?? 'missing',
          preferredFundingRail,
        },
      },
      displayPayload: {
        ...stored.displayPayload,
        contactEmail,
        contactName,
        preferredFundingRail,
        autonomyPolicy: {
          autoApproveUsd: autoApproveUsd ?? 0,
          otpEveryPaidAction,
        },
        limits: {
          perActionUsd: perActionUsd ?? 0,
          dailyUsd: dailyUsd ?? 0,
          monthlyUsd: monthlyUsd ?? 0,
        },
      },
      metadata: {
        completedFrom: 'capability_onboarding_hosted',
        connectedCount: connectedCapabilities.length,
      },
    });

    return buildHostedActionResumeRedirect(actionSession, {
      fallbackText: 'AgentPay finished onboarding. Return to your host and keep going.',
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[capabilities] submit onboarding page failed:', msg);
    return c.text('Failed to finish onboarding.', 500);
  }
});

router.use('*', async (c, next) => {
  if (c.req.path === '/lease-execute') {
    await next();
    return;
  }
  return authenticateApiKey(c, next);
});

router.get('/providers/catalog', (c) => {
  return c.json({
    providers: getCapabilityProviderCatalog(),
  });
});

router.get('/terminal/control-plane', async (c) => {
  const merchant = c.get('merchant');
  const principalId = asString(c.req.query('principalId'));
  const capabilities = await listCapabilityBrokerRecords(c.env, merchant.id);
  const billing = await buildCapabilityUsageInvoiceSummary(c.env, merchant);
  const pendingActions = await listPendingHostedActions(c.env, merchant.id);
  const authorityProfile = principalId
    ? await getAuthorityProfile(c.env, merchant.id, principalId).catch(() => null)
    : null;

  const suggestedToolCalls = [
    {
      tool: 'agentpay_resolve_provider_access',
      endpoint: '/api/capabilities/access-resolve',
      purpose: 'Resolve "my agent needs this API" into existing governed access, a reusable pending setup, or a new AgentPay onboarding flow. Can also issue an opaque workbench lease for local reuse.',
    },
    {
      tool: 'agentpay_execute_with_workbench_lease',
      endpoint: '/api/capabilities/lease-execute',
      purpose: 'Execute a capability from the same workbench using an opaque lease token instead of storing raw provider secrets locally.',
    },
    {
      tool: 'agentpay_create_onboarding_session',
      endpoint: '/api/capabilities/onboarding-sessions',
      purpose: 'Collect guardrails, funding preference, and one or more provider credentials in a single terminal-driven flow.',
    },
    {
      tool: 'agentpay_request_provider_access',
      endpoint: '/api/capabilities/provider-requests',
      purpose: 'Turn "my agent needs this API" into either a preset onboarding flow or a generic AgentPay provider intake.',
    },
    {
      tool: 'agentpay_execute_capability',
      endpoint: '/api/capabilities/:capabilityId/execute',
      purpose: 'Run the governed capability call and let AgentPay pause, fund, and resume automatically when needed.',
    },
  ];

  return c.json({
    surface: 'terminal_native_control_plane',
    stance: {
      runtime: 'host_and_terminal_only',
      dashboard: 'non_canonical',
      promise: 'Agents and humans should be able to complete setup, authority, funding, execution, and proof through tool calls and hosted human steps only when required.',
    },
    merchant: {
      id: merchant.id,
      email: merchant.email,
      name: merchant.name,
    },
    authorityProfile,
    billing: {
      ...billing,
      outstandingUsd: billing.outstandingUsd,
      payable: billing.outstandingUsd > 0,
    },
    capabilities,
    pendingActions,
    providerCatalog: getCapabilityProviderCatalog(),
    suggestedToolCalls,
  });
});

router.post('/access-resolve', async (c) => {
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

  const subjectTypeValue = asString(body.subjectType);
  const subjectType = subjectTypeValue && isCapabilitySubjectType(subjectTypeValue) ? subjectTypeValue : null;
  const subjectRef = asString(body.subjectRef);
  const resumeUrl = asString(body.resumeUrl);
  const principalId = asString(body.principalId);
  const operatorId = asString(body.operatorId);
  if (!subjectType || !subjectRef) {
    return c.json({ error: 'subjectType and subjectRef are required' }, 400);
  }
  if (resumeUrl && !isSafeHostedActionResumeUrl(resumeUrl)) {
    return c.json({ error: 'resumeUrl must be a valid https URL or localhost URL' }, 400);
  }

  const requestedProviderName = asString(body.requestedProviderName);
  const requestedProviderKey = asString(body.provider);
  if (!requestedProviderName && !requestedProviderKey) {
    return c.json({ error: 'requestedProviderName or provider is required' }, 400);
  }

  let requestedProvider: HostedOnboardingProvider;
  try {
    requestedProvider = buildRequestedProviderInput(body, c.env);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.startsWith('PROVIDER_INPUT_INVALID:') || msg === 'CAPABILITY_BASE_URL_INVALID' || msg === 'CAPABILITY_BASE_URL_INSECURE') {
      return c.json({ error: 'requestedBaseUrl and auth details are required for unknown providers' }, 400);
    }
    if (msg === 'CAPABILITY_HOST_BLOCKED') {
      return c.json({ error: 'Requested provider host is blocked by AgentPay network policy' }, 403);
    }
    return c.json({ error: 'Failed to normalize provider request' }, 500);
  }

  const existingCapability = await findSubjectCapabilityAccess(c.env, {
    merchantId: merchant.id,
    subjectType,
    subjectRef,
    provider: requestedProvider.provider,
    capabilityKey: requestedProvider.capabilityKey,
    statuses: ['active'],
  }).catch(() => null);
  const authorityProfile = principalId
    ? await getAuthorityProfile(c.env, merchant.id, principalId).catch(() => null)
    : null;

  if (existingCapability) {
    const policy = getCapabilityMetadata(existingCapability);
    const issueWorkbenchLease = body.issueWorkbenchLease === true;
    const workbenchId = asString(body.workbenchId);
    const workbenchLabel = asString(body.workbenchLabel);
    if (issueWorkbenchLease && !workbenchId) {
      return c.json({ error: 'workbenchId is required when issueWorkbenchLease=true' }, 400);
    }
    const leaseTtlMinutes = typeof body.leaseTtlMinutes === 'number' && Number.isFinite(body.leaseTtlMinutes)
      ? Math.max(Math.min(Math.round(body.leaseTtlMinutes), 24 * 60), 5)
      : 12 * 60;
    const workbenchLease = issueWorkbenchLease && workbenchId
      ? await createCapabilityAccessLease(c.env, {
          merchantId: merchant.id,
          capabilityId: existingCapability.id,
          subjectType,
          subjectRef,
          principalId,
          operatorId,
          workbenchId,
          workbenchLabel,
          metadata: {
            source: 'access_resolve',
            provider: existingCapability.provider,
            capabilityKey: existingCapability.capabilityKey,
          },
          expiresAt: new Date(Date.now() + leaseTtlMinutes * 60 * 1000),
        }).catch(() => null)
      : null;
    return c.json({
      status: 'ready',
      reusedExistingAccess: true,
      continuity: {
        mode: 'persistent_governed_access',
        scope: {
          subjectType,
          subjectRef,
        },
        promise: 'The same workbench can reuse this governed capability without re-entering the credential.',
      },
      authorityProfile,
      capability: {
        id: existingCapability.id,
        capabilityKey: existingCapability.capabilityKey,
        provider: existingCapability.provider,
        status: existingCapability.status,
        baseUrl: policy.baseUrl,
        allowedHosts: policy.allowedHosts,
        freeCalls: policy.freeCalls,
        paidUnitPriceUsdMicros: policy.paidUnitPriceUsdMicros,
      },
      workbenchLease: workbenchLease ? {
        leaseId: workbenchLease.lease.id,
        token: workbenchLease.leaseToken,
        workbenchId: workbenchLease.lease.workbenchId,
        workbenchLabel: workbenchLease.lease.workbenchLabel,
        expiresAt: workbenchLease.lease.expiresAt,
        executeEndpoint: '/api/capabilities/lease-execute',
        storageAdvice: 'Persist this opaque lease in the local workbench if needed, but never store raw provider secrets locally.',
      } : null,
      nextAction: null,
      execute: {
        endpoint: `/api/capabilities/${existingCapability.id}/execute`,
        method: 'POST',
      },
    });
  }

  const pendingOnboarding = await findReusablePendingOnboardingAction(c.env, {
    merchantId: merchant.id,
    subjectType,
    subjectRef,
    provider: requestedProvider.provider,
    capabilityKey: requestedProvider.capabilityKey,
  });
  if (pendingOnboarding) {
    return c.json({
      status: 'auth_required',
      reusedPendingAction: true,
      continuity: {
        mode: 'resume_existing_setup',
        scope: {
          subjectType,
          subjectRef,
        },
        promise: 'A setup flow is already in progress for this workbench, so AgentPay is reusing it instead of asking again.',
      },
      authorityProfile,
      actionSession: {
        sessionId: pendingOnboarding.sessionId,
        status: 'pending',
        statusUrl: new URL(`/api/actions/${pendingOnboarding.sessionId}`, c.env.API_BASE_URL).toString(),
      },
      requestedProvider: {
        provider: requestedProvider.provider,
        label: pendingOnboarding.providerLabel ?? requestedProvider.label,
        capabilityKey: pendingOnboarding.capabilityKey ?? requestedProvider.capabilityKey,
        baseUrl: requestedProvider.baseUrl,
        allowedHosts: requestedProvider.allowedHosts,
      },
      nextAction: {
        type: 'auth_required',
        title: pendingOnboarding.title,
        summary: pendingOnboarding.summary ?? 'Finish the existing AgentPay setup once and the workbench will keep governed access for future runs.',
        displayPayload: {
          kind: 'capability_onboarding',
          onboardingUrl: pendingOnboarding.onboardingUrl,
          partnershipStatus: pendingOnboarding.partnershipStatus,
          reusedPendingAction: true,
          expiresAt: pendingOnboarding.expiresAt,
        },
      },
    });
  }

  try {
    const created = await createProviderAccessAction({
      env: c.env,
      merchant,
      audience,
      authType,
      body,
      subjectType,
      subjectRef,
      principalId,
      operatorId,
      resumeUrl,
    });
    return c.json({
      ...created,
      continuity: {
        mode: 'new_setup_required',
        scope: {
          subjectType,
          subjectRef,
        },
        promise: 'Once this setup is completed, the workbench can keep governed access and reuse it on future runs.',
      },
      authorityProfile,
    }, 201);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.startsWith('PROVIDER_INPUT_INVALID:') || msg === 'CAPABILITY_BASE_URL_INVALID' || msg === 'CAPABILITY_BASE_URL_INSECURE') {
      return c.json({ error: 'requestedBaseUrl and auth details are required for unknown providers' }, 400);
    }
    if (msg === 'CAPABILITY_HOST_BLOCKED') {
      return c.json({ error: 'Requested provider host is blocked by AgentPay network policy' }, 403);
    }
    return c.json({ error: 'Failed to resolve provider access' }, 500);
  }
});

router.post('/onboarding-sessions', async (c) => {
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

  const subjectTypeValue = asString(body.subjectType);
  const subjectType = subjectTypeValue && isCapabilitySubjectType(subjectTypeValue) ? subjectTypeValue : null;
  const subjectRef = asString(body.subjectRef);
  const principalId = asString(body.principalId);
  const operatorId = asString(body.operatorId);
  const resumeUrl = asString(body.resumeUrl);
  if (!subjectType || !subjectRef) {
    return c.json({ error: 'subjectType and subjectRef are required' }, 400);
  }
  if (resumeUrl && !isSafeHostedActionResumeUrl(resumeUrl)) {
    return c.json({ error: 'resumeUrl must be a valid https URL or localhost URL' }, 400);
  }

  const rawProviders = Array.isArray(body.providers) ? body.providers : null;
  if (!rawProviders || rawProviders.length === 0) {
    return c.json({ error: 'providers must be a non-empty array' }, 400);
  }

  const providers: HostedOnboardingProvider[] = [];
  const seenCapabilityKeys = new Set<string>();
  for (const rawProvider of rawProviders) {
    const providerBody = asRecord(rawProvider);
    try {
      if (!providerBody) {
        return c.json({ error: 'Each provider entry must be an object' }, 400);
      }
      providers.push(buildOnboardingProviderFromInput(providerBody, c.env, seenCapabilityKeys));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === 'PROVIDER_INPUT_MISSING_PROVIDER') {
        return c.json({ error: 'Each provider entry must include provider' }, 400);
      }
      if (msg.startsWith('PROVIDER_INPUT_INVALID:')) {
        return c.json({ error: `Provider ${msg.split(':')[1]} is missing baseUrl, allowedHosts, authScheme, or credentialKind` }, 400);
      }
      if (msg.startsWith('PROVIDER_INPUT_UNSUPPORTED_AUTH:')) {
        return c.json({ error: `Provider ${msg.split(':')[1]} has unsupported auth settings` }, 400);
      }
      if (msg.startsWith('PROVIDER_INPUT_DUPLICATE_CAPABILITY_KEY:')) {
        return c.json({ error: `Duplicate capabilityKey ${msg.split(':')[1]} is not allowed` }, 400);
      }
      if (
        msg === 'CAPABILITY_BASE_URL_INVALID'
        || msg === 'CAPABILITY_BASE_URL_INSECURE'
        || msg === 'CAPABILITY_ALLOWED_HOST_INVALID'
      ) {
        const providerName = asString(providerBody?.provider) ?? 'requested provider';
        return c.json({ error: `Provider ${providerName} has invalid network policy settings` }, 400);
      }
      if (msg === 'CAPABILITY_HOST_BLOCKED') {
        const providerName = asString(providerBody?.provider) ?? 'requested provider';
        return c.json({ error: `Provider ${providerName} targets a blocked host` }, 403);
      }
      throw err;
    }
  }

  let walletStatus = 'missing';
  if (principalId) {
    const sql = createDb(c.env);
    try {
      const rows = await sql<Array<{ stripe_pm_id: string }>>`
        SELECT stripe_pm_id
        FROM principal_payment_methods
        WHERE principal_id = ${principalId}
        ORDER BY is_default DESC, created_at DESC
        LIMIT 1
      `;
      if (rows[0]?.stripe_pm_id) walletStatus = 'ready';
    } catch {
      walletStatus = 'missing';
    } finally {
      await sql.end().catch(() => {});
    }
  }

  try {
    const sessionToken = crypto.randomUUID();
    const sessionTokenHash = await sha256Hex(sessionToken);
    const actionSession = await createHostedActionSession(c.env, {
      merchant,
      actionType: 'auth_required',
      entityType: 'capability_onboarding',
      entityId: principalId ?? subjectRef,
      title: 'Finish your AgentPay setup',
      summary: 'Set your guardrails, connect your APIs once, and let AgentPay keep execution governed and secure across every host.',
      audience,
      authType,
      resumeUrl,
      displayPayload: {
        subjectType,
        subjectRef,
        principalId,
        operatorId,
        contactEmail: asString(body.contactEmail),
        contactName: asString(body.contactName),
        preferredFundingRail: asString(body.preferredFundingRail) ?? 'card',
        autonomyPolicy: typeof body.autonomyPolicy === 'object' && body.autonomyPolicy && !Array.isArray(body.autonomyPolicy)
          ? body.autonomyPolicy
          : {},
        limits: typeof body.limits === 'object' && body.limits && !Array.isArray(body.limits)
          ? body.limits
          : {},
        walletStatus,
        providers,
      },
      metadata: {
        sessionTokenHash,
        principalId,
        operatorId,
        providerCount: providers.length,
      },
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    });

    const onboardingUrl = new URL(`/api/capabilities/onboarding-sessions/${actionSession.session.sessionId}/hosted`, c.env.API_BASE_URL);
    onboardingUrl.searchParams.set('token', sessionToken);
    const hydrated = await syncHostedActionSession(c.env, {
      sessionId: actionSession.session.sessionId,
      displayPayload: {
        ...actionSession.session.displayPayload,
        onboardingUrl: onboardingUrl.toString(),
        actionSessionId: actionSession.session.sessionId,
        actionStatusUrl: actionSession.statusUrl,
      },
      metadata: {
        onboardingUrlIssued: true,
      },
    }).catch(() => actionSession.session);

    void recordProductSignalEvent(c.env, {
      merchantId: merchant.id,
      audience,
      authType,
      surface: 'capabilities',
      signalType: 'capability_onboarding_requested',
      status: 'auth_required',
      entityType: 'hosted_action_session',
      entityId: actionSession.session.sessionId,
      metadata: {
        principalId,
        providerCount: providers.length,
        walletStatus,
      },
    });

    return c.json({
      status: 'auth_required',
      actionSession: {
        sessionId: hydrated.sessionId,
        status: hydrated.status,
        statusUrl: actionSession.statusUrl,
      },
      nextAction: {
        type: 'auth_required',
        sessionId: hydrated.sessionId,
        title: 'Finish your AgentPay setup',
        summary: 'A human needs to complete secure setup once. AgentPay will store API credentials in the vault, apply guardrails, and keep raw secrets out of agent context.',
        expiresAt: hydrated.expiresAt.toISOString(),
        displayPayload: {
          kind: 'capability_onboarding',
          onboardingUrl: onboardingUrl.toString(),
          providers: providers.map((provider) => ({
            provider: provider.provider,
            label: provider.label,
            capabilityKey: provider.capabilityKey,
            description: provider.description,
            allowedHosts: provider.allowedHosts,
            baseUrl: provider.baseUrl,
          })),
          walletStatus,
          preferredFundingRail: asString(body.preferredFundingRail) ?? 'card',
          actionSessionId: hydrated.sessionId,
          actionStatusUrl: actionSession.statusUrl,
        },
      },
    }, 201);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[capabilities] create onboarding session failed:', msg);
    return c.json({ error: 'Failed to create onboarding session' }, 500);
  }
});

async function createProviderAccessAction(
  input: {
    env: Env;
    merchant: Variables['merchant'];
    audience: string;
    authType: string;
    body: Record<string, unknown>;
    subjectType: CapabilitySubjectType;
    subjectRef: string;
    principalId: string | null;
    operatorId: string | null;
    resumeUrl: string | null;
  },
): Promise<{
  status: 'auth_required';
  partnershipStatus: string;
  actionSession: {
    sessionId: string;
    status: string;
    statusUrl: string;
  };
  requestedProvider: {
    provider: string;
    label: string;
    capabilityKey: string;
    docsUrl: string | null;
    baseUrl: string;
    allowedHosts: string[];
  };
  nextAction: {
    type: 'auth_required';
    title: string;
    summary: string;
    displayPayload: Record<string, unknown>;
  };
}> {
  const requestedDocsUrl = asString(input.body.requestedDocsUrl);
  const requestedProviderKey = asString(input.body.provider);
  const provider = buildRequestedProviderInput(input.body, input.env);
  const normalizedProvider = requestedProviderKey ?? 'generic_rest_api';
  const partnershipStatus = normalizedProvider === 'generic_rest_api'
    ? 'delegated_auth_needed'
    : 'preset_available';
  const providerLabel = buildRequestedProviderLabel(input.body, getCapabilityProviderDefaults(provider.provider));
  const walletStatus = 'missing';
  const sessionToken = crypto.randomUUID();
  const sessionTokenHash = await sha256Hex(sessionToken);
  const actionSession = await createHostedActionSession(input.env, {
    merchant: input.merchant,
    actionType: 'auth_required',
    entityType: 'capability_onboarding',
    entityId: input.principalId ?? input.subjectRef,
    title: `Finish ${provider.label} setup in AgentPay`,
    summary: `AgentPay can take ${provider.label} from request to governed execution without a dashboard. The only remaining dependency is delegated auth or partnership support from the provider.`,
    audience: input.audience,
    authType: input.authType,
    resumeUrl: input.resumeUrl,
    displayPayload: {
      subjectType: input.subjectType,
      subjectRef: input.subjectRef,
      principalId: input.principalId,
      operatorId: input.operatorId,
      contactEmail: asString(input.body.contactEmail),
      contactName: asString(input.body.contactName),
      preferredFundingRail: asString(input.body.preferredFundingRail) ?? 'card',
      autonomyPolicy: typeof input.body.autonomyPolicy === 'object' && input.body.autonomyPolicy && !Array.isArray(input.body.autonomyPolicy) ? input.body.autonomyPolicy : {},
      limits: typeof input.body.limits === 'object' && input.body.limits && !Array.isArray(input.body.limits) ? input.body.limits : {},
      walletStatus,
      providers: [provider],
      intake: {
        requestedProviderName: providerLabel,
        requestedDocsUrl,
        partnershipStatus,
      },
    },
    metadata: {
      sessionTokenHash,
      providerRequest: true,
      requestedProviderName: providerLabel,
      requestedDocsUrl,
      partnershipStatus,
    },
    expiresAt: new Date(Date.now() + 30 * 60 * 1000),
  });

  const onboardingUrl = new URL(`/api/capabilities/onboarding-sessions/${actionSession.session.sessionId}/hosted`, input.env.API_BASE_URL);
  onboardingUrl.searchParams.set('token', sessionToken);
  const hydrated = await syncHostedActionSession(input.env, {
    sessionId: actionSession.session.sessionId,
    displayPayload: {
      onboardingUrl: onboardingUrl.toString(),
      actionSessionId: actionSession.session.sessionId,
      actionStatusUrl: actionSession.statusUrl,
    },
    metadata: {
      onboardingUrlIssued: true,
    },
  }).catch(() => actionSession.session);

  return {
    status: 'auth_required',
    partnershipStatus,
    actionSession: {
      sessionId: hydrated.sessionId,
      status: hydrated.status,
      statusUrl: actionSession.statusUrl,
    },
    requestedProvider: {
      provider: provider.provider,
      label: provider.label,
      capabilityKey: provider.capabilityKey,
      docsUrl: requestedDocsUrl,
      baseUrl: provider.baseUrl,
      allowedHosts: provider.allowedHosts,
    },
    nextAction: {
      type: 'auth_required',
      title: `Finish ${provider.label} setup`,
      summary: 'A human needs to connect the provider once in AgentPay. After that, agents can request governed execution through tool calls only.',
      displayPayload: {
        kind: 'capability_onboarding',
        onboardingUrl: onboardingUrl.toString(),
        partnershipStatus,
        requestedProviderName: providerLabel,
      },
    },
  };
}

router.post('/provider-requests', async (c) => {
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

  const requestedProviderName = asString(body.requestedProviderName);
  const requestedProviderKey = asString(body.provider);
  const subjectTypeValue = asString(body.subjectType);
  const subjectType = subjectTypeValue && isCapabilitySubjectType(subjectTypeValue) ? subjectTypeValue : null;
  const subjectRef = asString(body.subjectRef);
  const resumeUrl = asString(body.resumeUrl);
  if (!subjectType || !subjectRef) {
    return c.json({ error: 'subjectType and subjectRef are required' }, 400);
  }
  if (!requestedProviderName && !requestedProviderKey) {
    return c.json({ error: 'requestedProviderName or provider is required' }, 400);
  }
  if (resumeUrl && !isSafeHostedActionResumeUrl(resumeUrl)) {
    return c.json({ error: 'resumeUrl must be a valid https URL or localhost URL' }, 400);
  }

  try {
    const created = await createProviderAccessAction({
      env: c.env,
      merchant,
      audience,
      authType,
      body,
      subjectType,
      subjectRef,
      principalId: asString(body.principalId),
      operatorId: asString(body.operatorId),
      resumeUrl,
    });
    return c.json(created, 201);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.startsWith('PROVIDER_INPUT_INVALID:') || msg === 'CAPABILITY_BASE_URL_INVALID' || msg === 'CAPABILITY_BASE_URL_INSECURE') {
      return c.json({ error: 'requestedBaseUrl and auth details are required for unknown providers' }, 400);
    }
    if (msg === 'CAPABILITY_HOST_BLOCKED') {
      return c.json({ error: 'Requested provider host is blocked by AgentPay network policy' }, 403);
    }
    return c.json({ error: 'Failed to normalize provider request' }, 500);
  }
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

router.get('/execution-attempts/:attemptId', async (c) => {
  const merchant = c.get('merchant');
  const attempt = await getCapabilityExecutionAttempt(c.env, merchant.id, c.req.param('attemptId'));
  if (!attempt) {
    return c.json({ error: 'Capability execution attempt not found' }, 404);
  }

  return c.json({
    attempt,
    resultOrNextAction: attempt.status === 'completed'
      ? (attempt.resultPayload.executionResult ?? attempt.resultPayload)
      : attempt.nextAction,
  });
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

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
    },
  });
}

async function executeCapabilityRequest(input: {
  env: Env;
  executionCtx: ExecutionContext | undefined;
  merchant: MerchantContext;
  capabilityId: string;
  body: Record<string, unknown>;
  audience: string;
  authType: string;
  authorizationHeader?: string | null;
  xApiKeyHeader?: string | null;
  leaseContext?: {
    leaseId: string;
    workbenchId: string;
  } | null;
}): Promise<Response> {
  try {
    const result = await executeCapabilityProxy(input.env, input.merchant, {
      capabilityId: input.capabilityId,
      method: asString(input.body.method) ?? 'GET',
      path: asString(input.body.path) ?? '/',
      query: asStringRecord(input.body.query),
      headers: asStringRecord(input.body.headers),
      body: input.body.body,
      allowPaidUsage: input.body.allowPaidUsage === true,
      requestId: asString(input.body.requestId),
    });

    if (result.status === 'approval_required') {
      const internalFetcher = getInternalAppFetcher();
      const hasInternalBridgeAuth = Boolean(input.authorizationHeader || input.xApiKeyHeader || input.env.ADMIN_SECRET_KEY);
      if (!internalFetcher || !hasInternalBridgeAuth) {
        void recordProductSignalEvent(input.env, {
          merchantId: input.merchant.id,
          audience: input.audience,
          authType: input.authType,
          surface: 'capabilities',
          signalType: 'capability_next_action_returned',
          status: result.status,
          requestId: asString(input.body.requestId),
          entityType: 'capability',
          entityId: input.capabilityId,
          estimatedCostMicros: Math.max(Math.round(result.usage.unitPriceUsd * 1_000_000), 0),
          metadata: {
            provider: result.provider,
            billable: result.usage.billable,
            usedCalls: result.usage.usedCalls,
            freeCalls: result.usage.freeCalls,
            nextActionType: result.nextAction.type,
            orchestrationFallback: !internalFetcher ? 'internal_fetcher_unavailable' : 'internal_auth_bridge_unavailable',
          },
        });
        return jsonResponse(result);
      }

      const principalId = asString(input.body.principalId);
      const operatorId = asString(input.body.operatorId);
      const customerEmail = asString(input.body.customerEmail);
      const customerName = asString(input.body.customerName);
      const customerPhone = asString(input.body.customerPhone);
      const preferredRail = asString(input.body.rail);
      const resumeUrl = asString(input.body.resumeUrl);
      const hostContext = asRecord(input.body.hostContext) ?? {};
      const guardrailContext = asRecord(input.body.guardrailContext) ?? {};
      const autonomyPolicy = asRecord(input.body.autonomyPolicy) ?? {};
      const limits = asRecord(input.body.limits) ?? {};
      const idempotencyKey = asString(input.body.idempotencyKey);

      const authorityProfile = principalId
        ? await upsertAuthorityProfile(input.env, {
            merchantId: input.merchant.id,
            principalId,
            operatorId,
            walletStatus: 'missing',
            preferredFundingRail: preferredRail,
            contactEmail: customerEmail,
            contactName: customerName,
            autonomyPolicy,
            limits,
            metadata: {
              source: input.leaseContext ? 'capability_execute_gate_workbench_lease' : 'capability_execute_gate',
              capabilityId: result.capabilityId,
              provider: result.provider,
              customerPhone,
              workbenchId: input.leaseContext?.workbenchId ?? null,
            },
          })
        : null;

      const executionAttemptRecord = await createCapabilityExecutionAttempt(input.env, {
        merchantId: input.merchant.id,
        capabilityId: result.capabilityId,
        authorityProfileId: authorityProfile?.id ?? null,
        principalId,
        operatorId,
        idempotencyKey,
        blockedReason: 'paid_usage_requires_human_step',
        method: asString(input.body.method) ?? 'GET',
        path: asString(input.body.path) ?? '/',
        query: asStringRecord(input.body.query),
        headers: asStringRecord(input.body.headers),
        body: input.body.body,
        requestId: asString(input.body.requestId),
        hostContext: {
          ...hostContext,
          resumeUrl,
          audience: input.audience,
          authType: input.authType,
          workbenchLease: input.leaseContext
            ? {
                leaseId: input.leaseContext.leaseId,
                workbenchId: input.leaseContext.workbenchId,
              }
            : null,
        },
        guardrailContext: {
          ...guardrailContext,
          limits,
        },
        authorityContext: authorityProfile
          ? {
              authorityProfileId: authorityProfile.id,
              principalId: authorityProfile.principalId,
              walletStatus: authorityProfile.walletStatus,
              autonomyPolicy: authorityProfile.autonomyPolicy,
              limits: authorityProfile.limits,
            }
          : {
              principalId,
              operatorId,
              autonomyPolicy,
              limits,
            },
        nextAction: result.nextAction,
        metadata: {
          provider: result.provider,
          capabilityKey: (result.nextAction.displayPayload as Record<string, unknown> | undefined)?.capabilityKey ?? null,
          leaseId: input.leaseContext?.leaseId ?? null,
        },
        lockedUnitPriceMicros: Math.max(Math.round(result.usage.unitPriceUsd * 1_000_000), 0),
        lockedCurrency: 'USD',
        usedCallsSnapshot: result.usage.usedCalls,
        freeCallsSnapshot: result.usage.freeCalls,
      });

      const existingAttempt = executionAttemptRecord.attempt;
      const executionStatusUrl = buildExecutionAttemptStatusUrl(input.env, existingAttempt.id);
      if (executionAttemptRecord.reused) {
        if (existingAttempt.status === 'completed' && existingAttempt.resultPayload.executionResult) {
          return jsonResponse(existingAttempt.resultPayload.executionResult as Record<string, unknown>);
        }
        return jsonResponse({
          status: (existingAttempt.nextAction.type as string | undefined) ?? existingAttempt.status,
          capabilityId: result.capabilityId,
          provider: result.provider,
          usage: result.usage,
          executionAttempt: {
            attemptId: existingAttempt.id,
            status: existingAttempt.status,
            statusUrl: executionStatusUrl,
            hostedActionSessionId: existingAttempt.hostedActionSessionId,
          },
          nextAction: {
            ...existingAttempt.nextAction,
            executionAttemptId: existingAttempt.id,
            executionStatusUrl,
          },
        });
      }

      const internalHeaders = new Headers({
        'content-type': 'application/json',
      });
      if (input.authorizationHeader) internalHeaders.set('authorization', input.authorizationHeader);
      if (input.xApiKeyHeader) internalHeaders.set('x-api-key', input.xApiKeyHeader);
      if (!input.authorizationHeader && !input.xApiKeyHeader && input.env.ADMIN_SECRET_KEY) {
        internalHeaders.set('x-admin-key', input.env.ADMIN_SECRET_KEY);
        internalHeaders.set('x-merchant-id', input.merchant.id);
      }

      let humanStepResponse: Response | null = null;
      let humanStepBody: Record<string, any> | null = null;

      if (principalId) {
        humanStepResponse = await internalFetcher(
          new Request('http://internal/api/payments/charge-saved', {
            method: 'POST',
            headers: internalHeaders,
            body: JSON.stringify({
              principalId,
              amount: result.usage.unitPriceUsd,
              currency: 'USD',
              description: `Approve paid ${result.provider} usage for ${result.capabilityId}`,
              end_user_email: customerEmail,
              capabilityExecutionAttemptId: existingAttempt.id,
              authorityProfileId: authorityProfile?.id ?? null,
            }),
          }),
          input.env,
          input.executionCtx,
        );
        humanStepBody = await readJsonResponse(humanStepResponse);
      }

      const requiresFundingRequest = !humanStepResponse || humanStepResponse.status >= 400;
      if (requiresFundingRequest) {
        humanStepResponse = await internalFetcher(
          new Request('http://internal/api/payments/funding-request', {
            method: 'POST',
            headers: internalHeaders,
            body: JSON.stringify({
              rail: preferredRail,
              amount: result.usage.unitPriceUsd,
              currency: 'USD',
              description: `Fund paid ${result.provider} capability execution for ${result.capabilityId}`,
              requestId: asString(input.body.requestId) ?? `capexec_${existingAttempt.id}`,
              customerName,
              customerPhone,
              customerEmail,
              resumeUrl,
              principalId,
              capabilityExecutionAttemptId: existingAttempt.id,
              authorityProfileId: authorityProfile?.id ?? null,
            }),
          }),
          input.env,
          input.executionCtx,
        );
        humanStepBody = await readJsonResponse(humanStepResponse);
      }

      if (!humanStepResponse || !humanStepBody || humanStepResponse.status >= 400) {
        const failedAttempt = await completeCapabilityExecutionAttempt(input.env, {
          attemptId: existingAttempt.id,
          status: 'failed',
          blockedReason: 'human_step_creation_failed',
          resultPayload: {
            error: humanStepBody?.error ?? 'HUMAN_STEP_CREATION_FAILED',
          },
        });
        return jsonResponse({
          error: humanStepBody?.error ?? 'Failed to create a hosted approval step',
          executionAttempt: {
            attemptId: failedAttempt.id,
            status: failedAttempt.status,
            statusUrl: executionStatusUrl,
          },
        }, humanStepResponse?.status ?? 502);
      }

      const hostedActionSessionId = typeof humanStepBody.actionSession?.sessionId === 'string'
        ? humanStepBody.actionSession.sessionId
        : typeof humanStepBody.session_id === 'string'
          ? humanStepBody.session_id
          : null;

      if (hostedActionSessionId) {
        await attachHostedActionSessionToExecutionAttempt(input.env, {
          attemptId: existingAttempt.id,
          hostedActionSessionId,
          nextAction: humanStepBody.nextAction ?? {
            type: humanStepBody.status ?? 'funding_required',
          },
          metadata: {
            humanStepSource: humanStepBody.status ?? 'funding_required',
          },
        });
      }

      const orchestratedStatus = humanStepBody.status === 'confirmation_required'
        ? 'confirmation_required'
        : 'funding_required';

      void recordProductSignalEvent(input.env, {
        merchantId: input.merchant.id,
        audience: input.audience,
        authType: input.authType,
        surface: 'capabilities',
        signalType: 'capability_next_action_returned',
        status: orchestratedStatus,
        requestId: asString(input.body.requestId),
        entityType: 'capability_execution_attempt',
        entityId: existingAttempt.id,
        estimatedCostMicros: Math.max(Math.round(result.usage.unitPriceUsd * 1_000_000), 0),
        metadata: {
          provider: result.provider,
          billable: true,
          actionSessionId: hostedActionSessionId,
          principalId,
          leaseId: input.leaseContext?.leaseId ?? null,
        },
      });

      return jsonResponse({
        status: orchestratedStatus,
        capabilityId: result.capabilityId,
        provider: result.provider,
        usage: result.usage,
        executionAttempt: {
          attemptId: existingAttempt.id,
          status: 'pending_human_step',
          statusUrl: executionStatusUrl,
          hostedActionSessionId,
        },
        nextAction: {
          ...(humanStepBody.nextAction ?? {}),
          type: orchestratedStatus,
          executionAttemptId: existingAttempt.id,
          executionStatusUrl,
          actionSessionId: hostedActionSessionId,
        },
      });
    }

    if (input.leaseContext?.leaseId) {
      await touchCapabilityAccessLease(input.env, input.leaseContext.leaseId).catch(() => {});
    }

    void recordProductSignalEvent(input.env, {
      merchantId: input.merchant.id,
      audience: input.audience,
      authType: input.authType,
      surface: 'capabilities',
      signalType: result.status === 'approval_required'
        ? 'capability_next_action_returned'
        : 'capability_execution_completed',
      status: result.status,
      requestId: asString(input.body.requestId),
      entityType: 'capability',
      entityId: input.capabilityId,
      estimatedCostMicros: Math.max(Math.round(result.usage.unitPriceUsd * 1_000_000), 0),
      metadata: {
        provider: result.provider,
        billable: result.usage.billable,
        usedCalls: result.usage.usedCalls,
        freeCalls: result.usage.freeCalls,
        nextActionType: result.status === 'approval_required' ? result.nextAction.type : null,
        leaseId: input.leaseContext?.leaseId ?? null,
      },
    });
    return jsonResponse(result as unknown as Record<string, unknown>);
  } catch (err) {
    if (err instanceof Error) {
      if (err.message === 'CAPABILITY_NOT_FOUND') {
        return jsonResponse({ error: 'Capability not found' }, 404);
      }
      if (err.message === 'CAPABILITY_BASE_URL_REQUIRED') {
        return jsonResponse({ error: 'Capability base URL is not configured' }, 409);
      }
      if (err.message === 'CAPABILITY_PATH_MUST_BE_RELATIVE') {
        return jsonResponse({ error: 'Capability path must be relative to the connected base URL' }, 400);
      }
      if (
        err.message === 'CAPABILITY_BASE_URL_INVALID'
        || err.message === 'CAPABILITY_BASE_URL_INSECURE'
        || err.message === 'CAPABILITY_TARGET_INSECURE'
        || err.message === 'CAPABILITY_TARGET_INVALID'
      ) {
        return jsonResponse({ error: 'Capability target is invalid' }, 400);
      }
      if (err.message === 'CAPABILITY_HOST_NOT_ALLOWED') {
        return jsonResponse({ error: 'Target host is not allowed for this capability' }, 403);
      }
      if (err.message === 'CAPABILITY_HOST_BLOCKED') {
        return jsonResponse({ error: 'Capability target is blocked by network policy' }, 403);
      }
    }
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[capabilities] execute failed:', msg);
    return jsonResponse({ error: 'Failed to execute capability' }, 500);
  }
}

router.post('/lease-execute', async (c) => {
  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const leaseToken = asString(body.leaseToken);
  const workbenchId = asString(body.workbenchId);
  if (!leaseToken) {
    return c.json({ error: 'leaseToken is required' }, 400);
  }
  if (!workbenchId) {
    return c.json({ error: 'workbenchId is required' }, 400);
  }

  try {
    const lease = await resolveCapabilityAccessLease(c.env, {
      leaseToken,
      workbenchId,
    });
    const merchant = await loadMerchantContextById(c.env, lease.merchantId);
    if (!merchant) {
      return c.json({ error: 'Merchant not found for lease execution' }, 404);
    }
    return await executeCapabilityRequest({
      env: c.env,
      executionCtx: c.executionCtx,
      merchant,
      capabilityId: lease.capabilityId,
      body,
      audience: 'workbench',
      authType: 'workbench_lease',
      leaseContext: {
        leaseId: lease.id,
        workbenchId: lease.workbenchId,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === 'CAPABILITY_ACCESS_LEASE_NOT_FOUND') {
      return c.json({ error: 'Capability access lease not found' }, 404);
    }
    if (msg === 'CAPABILITY_ACCESS_LEASE_EXPIRED') {
      return c.json({ error: 'Capability access lease expired' }, 410);
    }
    if (msg === 'CAPABILITY_ACCESS_LEASE_REVOKED') {
      return c.json({ error: 'Capability access lease revoked' }, 410);
    }
    if (msg === 'CAPABILITY_ACCESS_LEASE_WORKBENCH_MISMATCH') {
      return c.json({ error: 'Capability access lease is not valid for this workbench' }, 403);
    }
    console.error('[capabilities] lease execute failed:', msg);
    return c.json({ error: 'Failed to execute capability via lease' }, 500);
  }
});

router.post('/:capabilityId/execute', async (c) => {
  const merchant = c.get('merchant');
  const authorizationHeader = c.req.header('authorization');
  const xApiKeyHeader = c.req.header('x-api-key');
  const presentedToken = authorizationHeader ?? xApiKeyHeader ?? '';
  const audience = c.get('mcpAudience') ?? 'generic';
  const authType = isMcpAccessToken(presentedToken.startsWith('Bearer ') ? presentedToken.slice(7) : presentedToken) ? 'mcp_token' : 'api_key';
  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  return await executeCapabilityRequest({
    env: c.env,
    executionCtx: c.executionCtx,
    merchant,
    capabilityId: c.req.param('capabilityId'),
    body,
    audience,
    authType,
    authorizationHeader,
    xApiKeyHeader,
  });
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
      const secretPayload = cred.credentialKind === 'bearer_token'
        ? { token: cred.keyValue }
        : cred.credentialKind === 'basic_auth'
          ? { headerValue: cred.keyValue }
          : { apiKey: cred.keyValue };
      const freeCalls = providerDefaults?.freeCalls ?? 5;
      const paidUnitPriceUsdMicros = providerDefaults?.paidUnitPriceUsdMicros ?? 25_000;
      const inserted = await upsertCapabilityVaultCredential(c.env, {
        merchantId: merchant.id,
        capabilityKey,
        provider: cred.provider,
        subjectType: 'merchant',
        subjectRef: merchant.id,
        secretPayload,
        authScheme: cred.authScheme,
        credentialKind: cred.credentialKind,
        baseUrl: normalizedBaseUrl,
        allowedHosts,
        headerName: cred.headerName ?? null,
        freeCalls,
        paidUnitPriceUsdMicros,
        metadata: {
          connectedFrom: 'vault_from_env_confirm',
          providerLabel: cred.label,
        },
      });
      vaulted.push({
        provider: cred.provider,
        capabilityId: inserted.id,
        capabilityKey: inserted.capabilityKey,
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
