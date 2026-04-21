import type { Env, MerchantContext } from '../types';
import { createDb, parseJsonb } from './db';
import { pbkdf2Hex } from './pbkdf2';
import { sha256Hex } from './approvalSessions';
import { mintMcpAccessToken, type McpAccessTokenClaims } from './mcpAccessTokens';

export const MCP_OAUTH_SCOPE = 'remote_mcp';
export const MCP_AUTH_CODE_TTL_SECONDS = 10 * 60;
export const MCP_ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
export const MCP_EMAIL_LINK_TTL_SECONDS = 15 * 60;

type OAuthClientRow = {
  client_id: string;
  client_secret_hash: string | null;
  client_name: string | null;
  redirect_uris_json: string[] | null;
  token_endpoint_auth_method: string | null;
  grant_types_json: string[] | null;
  response_types_json: string[] | null;
  scope: string | null;
  metadata: Record<string, unknown> | null;
};

type OAuthAuthorizationCodeRow = {
  id: string;
  code_hash: string;
  client_id: string;
  merchant_id: string;
  merchant_email: string;
  merchant_key_prefix: string;
  redirect_uri: string;
  scope: string;
  resource: string | null;
  audience: McpAccessTokenClaims['audience'];
  code_challenge: string;
  code_challenge_method: string;
  expires_at: Date;
  used_at: Date | null;
};

type OAuthEmailLinkAttemptRow = {
  id: string;
  attempt_token_hash: string;
  client_id: string;
  client_name: string | null;
  merchant_id: string;
  merchant_email: string;
  merchant_key_prefix: string;
  redirect_uri: string;
  scope: string;
  state: string | null;
  resource: string | null;
  audience: McpAccessTokenClaims['audience'];
  code_challenge: string;
  code_challenge_method: string;
  delivery_channel: string;
  expires_at: Date;
  verified_at: Date | null;
  used_at: Date | null;
  created_at: Date;
};

export type RegisteredOAuthClient = {
  clientId: string;
  clientSecret: string | null;
  clientName: string | null;
  redirectUris: string[];
  tokenEndpointAuthMethod: 'none' | 'client_secret_post' | 'client_secret_basic';
  grantTypes: string[];
  responseTypes: string[];
  scope: string;
};

export type OAuthAuthorizationRequest = {
  clientId: string;
  redirectUri: string;
  scope: string;
  state: string | null;
  codeChallenge: string;
  codeChallengeMethod: 'S256';
  resource: string | null;
};

export type OAuthEmailLinkDelivery = 'email' | 'debug' | 'unavailable';

export type OAuthEmailLinkAttemptSummary = {
  attemptId: string;
  merchantEmail: string;
  clientId: string;
  clientName: string | null;
  redirectUri: string;
  state: string | null;
  scope: string;
  audience: McpAccessTokenClaims['audience'];
  expiresAt: Date;
};

function normalizeJsonArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  }
  return [];
}

function normalizeClient(row: OAuthClientRow | undefined): RegisteredOAuthClient | null {
  if (!row) return null;
  const redirectUris = normalizeJsonArray(parseJsonb<unknown[]>(row.redirect_uris_json, []));
  if (!redirectUris.length) return null;
  const grantTypes = normalizeJsonArray(parseJsonb<unknown[]>(row.grant_types_json, []));
  const responseTypes = normalizeJsonArray(parseJsonb<unknown[]>(row.response_types_json, []));
  return {
    clientId: row.client_id,
    clientSecret: null,
    clientName: row.client_name ?? null,
    redirectUris,
    tokenEndpointAuthMethod: row.token_endpoint_auth_method === 'client_secret_post' || row.token_endpoint_auth_method === 'client_secret_basic'
      ? row.token_endpoint_auth_method
      : 'none',
    grantTypes,
    responseTypes,
    scope: typeof row.scope === 'string' && row.scope.trim() ? row.scope.trim() : MCP_OAUTH_SCOPE,
  };
}

function isValidUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol === 'https:') return true;
    if (url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')) return true;
    if (['javascript:', 'data:', 'file:'].includes(url.protocol)) return false;
    return Boolean(url.protocol && url.protocol !== ':' && value.includes(':'));
  } catch {
    return false;
  }
}

function normalizeComparablePathname(pathname: string): string {
  if (!pathname || pathname === '/') return '/';
  return pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
}

function oauthRedirectFamily(value: URL): 'openai' | 'anthropic' | 'generic' {
  const protocol = value.protocol.toLowerCase();
  const host = value.hostname.toLowerCase();
  const haystack = `${protocol} ${host}`;
  if (haystack.includes('chatgpt') || haystack.includes('openai')) return 'openai';
  if (haystack.includes('claude') || haystack.includes('anthropic')) return 'anthropic';
  return 'generic';
}

function pathMatchesLoosely(registeredPath: string, requestedPath: string): boolean {
  if (registeredPath === requestedPath) return true;
  if (requestedPath.startsWith(`${registeredPath}/`)) return true;
  if (registeredPath.startsWith(`${requestedPath}/`)) return true;
  return false;
}

function queryEntries(url: URL): Array<[string, string]> {
  return Array.from(url.searchParams.entries()).sort(([aKey, aVal], [bKey, bVal]) => {
    if (aKey === bKey) return aVal.localeCompare(bVal);
    return aKey.localeCompare(bKey);
  });
}

export function oauthRedirectUrisMatch(registeredUri: string, requestedUri: string): boolean {
  if (registeredUri === requestedUri) return true;
  try {
    const registered = new URL(registeredUri);
    const requested = new URL(requestedUri);
    const registeredFamily = oauthRedirectFamily(registered);
    const requestedFamily = oauthRedirectFamily(requested);
    const sameTrustedFamily = registeredFamily !== 'generic' && registeredFamily === requestedFamily;

    // Claude/OpenAI hosts have already proven caller ownership by dynamically
    // registering the client. Their callback shapes can vary by app shell,
    // desktop/native bridge, or product surface. For those known families,
    // accept the family match and let PKCE + short-lived codes carry the rest.
    if (sameTrustedFamily) return true;

    if (registered.protocol !== requested.protocol) return false;
    if (registered.host !== requested.host) return false;
    if (!pathMatchesLoosely(
      normalizeComparablePathname(registered.pathname),
      normalizeComparablePathname(requested.pathname),
    )) return false;

    const registeredQuery = queryEntries(registered);
    if (!registeredQuery.length) return true;
    const requestedQuery = queryEntries(requested);
    if (registeredQuery.length !== requestedQuery.length) return false;
    return registeredQuery.every(([key, value], index) => {
      const [requestedKey, requestedValue] = requestedQuery[index] ?? [];
      return key === requestedKey && value === requestedValue;
    });
  } catch {
    return false;
  }
}

export function oauthClientAllowsRedirectUri(client: RegisteredOAuthClient | null, redirectUri: string): boolean {
  if (!client) return false;
  return client.redirectUris.some((registeredUri) => oauthRedirectUrisMatch(registeredUri, redirectUri));
}

function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function toBase64Url(input: string): string {
  return btoa(input)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function fromBase64Url(input: string): string {
  const normalized = input
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(input.length / 4) * 4, '=');
  return atob(normalized);
}

async function hmacSha256Base64Url(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  const bytes = String.fromCharCode(...new Uint8Array(signature));
  return toBase64Url(bytes);
}

type StatelessOAuthClientPayload = {
  v: 1;
  jti: string;
  clientName: string | null;
  redirectUris: string[];
  tokenEndpointAuthMethod: RegisteredOAuthClient['tokenEndpointAuthMethod'];
  grantTypes: string[];
  responseTypes: string[];
  scope: string;
};

async function buildStatelessOAuthClientId(
  signingSecret: string,
  payload: Omit<StatelessOAuthClientPayload, 'v'>,
): Promise<string> {
  const encodedPayload = toBase64Url(JSON.stringify({
    v: 1,
    ...payload,
  } satisfies StatelessOAuthClientPayload));
  const signature = await hmacSha256Base64Url(signingSecret, encodedPayload);
  return `apcli_${encodedPayload}.${signature}`;
}

async function decodeStatelessOAuthClientId(
  signingSecret: string,
  clientId: string,
): Promise<RegisteredOAuthClient | null> {
  if (!clientId.startsWith('apcli_')) return null;
  const encoded = clientId.slice('apcli_'.length);
  const dotIndex = encoded.lastIndexOf('.');
  if (dotIndex <= 0) return null;

  const payloadPart = encoded.slice(0, dotIndex);
  const signaturePart = encoded.slice(dotIndex + 1);
  const expectedSignature = await hmacSha256Base64Url(signingSecret, payloadPart);
  if (expectedSignature !== signaturePart) return null;

  try {
    const parsed = JSON.parse(fromBase64Url(payloadPart)) as Partial<StatelessOAuthClientPayload>;
    if (parsed.v !== 1) return null;
    const redirectUris = normalizeJsonArray(parsed.redirectUris);
    if (!redirectUris.length) return null;
    return {
      clientId,
      clientSecret: null,
      clientName: typeof parsed.clientName === 'string' && parsed.clientName.trim() ? parsed.clientName : null,
      redirectUris,
      tokenEndpointAuthMethod: parsed.tokenEndpointAuthMethod === 'client_secret_post' || parsed.tokenEndpointAuthMethod === 'client_secret_basic'
        ? parsed.tokenEndpointAuthMethod
        : 'none',
      grantTypes: normalizeJsonArray(parsed.grantTypes).length ? normalizeJsonArray(parsed.grantTypes) : ['authorization_code'],
      responseTypes: normalizeJsonArray(parsed.responseTypes).length ? normalizeJsonArray(parsed.responseTypes) : ['code'],
      scope: typeof parsed.scope === 'string' && parsed.scope.trim() ? parsed.scope.trim() : MCP_OAUTH_SCOPE,
    };
  } catch {
    return null;
  }
}

function parseAudience(value: string | null | undefined): McpAccessTokenClaims['audience'] {
  if (value === 'openai' || value === 'anthropic') return value;
  return 'generic';
}

export function inferMcpAudience(input: { redirectUri?: string | null; resource?: string | null; clientName?: string | null }): McpAccessTokenClaims['audience'] {
  const haystack = `${input.redirectUri ?? ''} ${input.resource ?? ''} ${input.clientName ?? ''}`.toLowerCase();
  if (haystack.includes('chatgpt.com') || haystack.includes('openai')) return 'openai';
  if (haystack.includes('claude') || haystack.includes('anthropic')) return 'anthropic';
  return 'generic';
}

export function mcpProtectedResourceMetadataUrl(apiBaseUrl: string, path = '/api/mcp'): string {
  const base = new URL(apiBaseUrl);
  return new URL(`/.well-known/oauth-protected-resource${path}`, `${base.protocol}//${base.host}`).toString();
}

export function buildMcpWwwAuthenticateHeader(apiBaseUrl: string, error = 'invalid_token'): string {
  return `Bearer realm="agentpay-mcp", error="${error}", resource_metadata="${mcpProtectedResourceMetadataUrl(apiBaseUrl)}"`;
}

export function buildProtectedResourceMetadata(apiBaseUrl: string) {
  const resource = new URL('/api/mcp', apiBaseUrl).toString();
  const authServer = new URL('/.well-known/oauth-authorization-server', apiBaseUrl).toString();
  return {
    resource,
    authorization_servers: [authServer],
    bearer_methods_supported: ['header'],
    scopes_supported: [MCP_OAUTH_SCOPE],
    resource_name: 'AgentPay MCP Runtime',
    resource_documentation: new URL('/api/mcp/setup', apiBaseUrl).toString(),
  };
}

export function buildAuthorizationServerMetadata(apiBaseUrl: string) {
  return {
    issuer: new URL(apiBaseUrl).origin,
    authorization_endpoint: new URL('/authorize', apiBaseUrl).toString(),
    token_endpoint: new URL('/token', apiBaseUrl).toString(),
    registration_endpoint: new URL('/register', apiBaseUrl).toString(),
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
    scopes_supported: [MCP_OAUTH_SCOPE],
    resource_parameter_supported: true,
    client_id_metadata_document_supported: false,
    service_documentation: new URL('/api/mcp/setup', apiBaseUrl).toString(),
  };
}

async function lookupMerchantByEmail(
  sql: any,
  email: string,
): Promise<(MerchantContext & { keyPrefix: string }) | null> {
  const rows = await sql<Array<{
    id: string;
    name: string;
    email: string;
    walletAddress: string | null;
    webhookUrl: string | null;
    parentMerchantId: string | null;
    keyPrefix: string;
  }>>`
    SELECT
      id,
      name,
      email,
      wallet_address     AS "walletAddress",
      webhook_url        AS "webhookUrl",
      parent_merchant_id AS "parentMerchantId",
      key_prefix         AS "keyPrefix"
    FROM merchants
    WHERE LOWER(email) = ${email.toLowerCase()}
      AND is_active = true
    LIMIT 1
  `;

  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    walletAddress: row.walletAddress,
    webhookUrl: row.webhookUrl ?? null,
    parentMerchantId: row.parentMerchantId ?? null,
    keyPrefix: row.keyPrefix,
  };
}

function extractRawKey(apiKey: string): string {
  if (apiKey.length > 9 && apiKey[8] === '_' && /^[0-9a-f]{8}$/i.test(apiKey.substring(0, 8))) {
    return apiKey.slice(9);
  }
  return apiKey;
}

export async function authenticateMerchantForFounderOAuth(
  env: Env,
  email: string,
  apiKey: string,
): Promise<(MerchantContext & { keyPrefix: string }) | null> {
  const normalizedEmail = email.trim().toLowerCase();
  const rawKey = apiKey.trim();
  if (!normalizedEmail || !rawKey) return null;

  const keyPrefix = rawKey.substring(0, 8);
  let sql;
  try {
    sql = createDb(env);
    const rows = await sql<Array<{
      id: string;
      name: string;
      email: string;
      walletAddress: string | null;
      webhookUrl: string | null;
      apiKeyHash: string;
      apiKeySalt: string;
      parentMerchantId: string | null;
    }>>`
      SELECT
        id,
        name,
        email,
        wallet_address     AS "walletAddress",
        webhook_url        AS "webhookUrl",
        api_key_hash       AS "apiKeyHash",
        api_key_salt       AS "apiKeySalt",
        parent_merchant_id AS "parentMerchantId"
      FROM merchants
      WHERE key_prefix = ${keyPrefix}
        AND is_active = true
        AND LOWER(email) = ${normalizedEmail}
    `;

    for (const row of rows) {
      const computed = await pbkdf2Hex(extractRawKey(rawKey), row.apiKeySalt);
      if (computed === row.apiKeyHash) {
        return {
          id: row.id,
          name: row.name,
          email: row.email,
          walletAddress: row.walletAddress,
          webhookUrl: row.webhookUrl ?? null,
          parentMerchantId: row.parentMerchantId ?? null,
          keyPrefix,
        };
      }
    }
    return null;
  } finally {
    await sql?.end().catch(() => {});
  }
}

export async function registerOAuthClient(
  env: Env,
  input: {
    clientName?: string | null;
    redirectUris: string[];
    tokenEndpointAuthMethod?: string | null;
    grantTypes?: string[];
    responseTypes?: string[];
    scope?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<RegisteredOAuthClient> {
  const redirectUris = input.redirectUris.filter((uri) => typeof uri === 'string' && isValidUrl(uri));
  if (!redirectUris.length) {
    throw new Error('OAUTH_REDIRECT_URIS_REQUIRED');
  }

  const tokenEndpointAuthMethod = input.tokenEndpointAuthMethod === 'client_secret_post' || input.tokenEndpointAuthMethod === 'client_secret_basic'
    ? input.tokenEndpointAuthMethod
    : 'none';
  const grantTypes = input.grantTypes?.length ? input.grantTypes : ['authorization_code'];
  const responseTypes = input.responseTypes?.length ? input.responseTypes : ['code'];
  const scope = input.scope?.trim() || MCP_OAUTH_SCOPE;
  const clientId = await buildStatelessOAuthClientId(env.AGENTPAY_SIGNING_SECRET, {
    jti: crypto.randomUUID(),
    clientName: input.clientName ?? null,
    redirectUris,
    tokenEndpointAuthMethod,
    grantTypes,
    responseTypes,
    scope,
  });
  const clientSecret = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
  const clientSecretHash = await sha256Hex(clientSecret);

  let sql;
  try {
    sql = createDb(env);
    await sql`
      INSERT INTO oauth_clients (
        id,
        client_id,
        client_secret_hash,
        client_name,
        redirect_uris_json,
        token_endpoint_auth_method,
        grant_types_json,
        response_types_json,
        scope,
        metadata
      ) VALUES (
        ${crypto.randomUUID()}::uuid,
        ${clientId},
        ${clientSecretHash},
        ${input.clientName ?? null},
        ${JSON.stringify(redirectUris)}::jsonb,
        ${tokenEndpointAuthMethod},
        ${JSON.stringify(grantTypes)}::jsonb,
        ${JSON.stringify(responseTypes)}::jsonb,
        ${scope},
        ${JSON.stringify(input.metadata ?? {})}::jsonb
      )
    `;
  } finally {
    await sql?.end().catch(() => {});
  }

  return {
    clientId,
    clientSecret,
    clientName: input.clientName ?? null,
    redirectUris,
    tokenEndpointAuthMethod,
    grantTypes,
    responseTypes,
    scope,
  };
}

export async function getOAuthClient(env: Env, clientId: string): Promise<RegisteredOAuthClient | null> {
  let sql;
  try {
    sql = createDb(env);
    const rows = await sql<OAuthClientRow[]>`
      SELECT
        client_id,
        client_secret_hash,
        client_name,
        redirect_uris_json,
        token_endpoint_auth_method,
        grant_types_json,
        response_types_json,
        scope,
        metadata
      FROM oauth_clients
      WHERE client_id = ${clientId}
      LIMIT 1
    `;
    return normalizeClient(rows[0]) ?? await decodeStatelessOAuthClientId(env.AGENTPAY_SIGNING_SECRET, clientId);
  } finally {
    await sql?.end().catch(() => {});
  }
}

export async function verifyOAuthClientSecret(env: Env, clientId: string, clientSecret: string): Promise<boolean> {
  let sql;
  try {
    sql = createDb(env);
    const rows = await sql<Array<{ client_secret_hash: string | null }>>`
      SELECT client_secret_hash
      FROM oauth_clients
      WHERE client_id = ${clientId}
      LIMIT 1
    `;
    const hash = rows[0]?.client_secret_hash;
    if (!hash) return false;
    return hash === await sha256Hex(clientSecret);
  } finally {
    await sql?.end().catch(() => {});
  }
}

async function insertOAuthAuthorizationCode(
  sql: any,
  input: {
    code?: string;
    clientId: string;
    merchant: MerchantContext & { keyPrefix: string };
    redirectUri: string;
    scope: string;
    resource?: string | null;
    codeChallenge: string;
    codeChallengeMethod: 'S256';
    audience: McpAccessTokenClaims['audience'];
  },
): Promise<string> {
  const code = input.code ?? `apcode_${crypto.randomUUID().replace(/-/g, '')}`;
  const codeHash = await sha256Hex(code);
  const expiresAt = new Date(Date.now() + MCP_AUTH_CODE_TTL_SECONDS * 1000);

  await sql`
    INSERT INTO oauth_authorization_codes (
      id,
      code_hash,
      client_id,
      merchant_id,
      merchant_email,
      merchant_key_prefix,
      redirect_uri,
      scope,
      resource,
      audience,
      code_challenge,
      code_challenge_method,
      expires_at
    ) VALUES (
      ${crypto.randomUUID()}::uuid,
      ${codeHash},
      ${input.clientId},
      ${input.merchant.id}::uuid,
      ${input.merchant.email},
      ${input.merchant.keyPrefix},
      ${input.redirectUri},
      ${input.scope},
      ${input.resource ?? null},
      ${input.audience},
      ${input.codeChallenge},
      ${input.codeChallengeMethod},
      ${expiresAt.toISOString()}::timestamptz
    )
  `;

  return code;
}

export async function createOAuthAuthorizationCode(
  env: Env,
  input: {
    clientId: string;
    merchant: MerchantContext & { keyPrefix: string };
    redirectUri: string;
    scope: string;
    resource?: string | null;
    codeChallenge: string;
    codeChallengeMethod: 'S256';
    audience: McpAccessTokenClaims['audience'];
  },
): Promise<string> {
  let sql;
  try {
    sql = createDb(env);
    return await insertOAuthAuthorizationCode(sql, input);
  } finally {
    await sql?.end().catch(() => {});
  }
}

export async function requestOAuthEmailLink(
  env: Env,
  input: OAuthAuthorizationRequest & { clientName: string | null; email: string },
): Promise<{
  delivery: OAuthEmailLinkDelivery;
  expiresAt: Date | null;
  debugLink: string | null;
}> {
  const normalizedEmail = input.email.trim().toLowerCase();
  if (!normalizedEmail) {
    throw new Error('OAUTH_EMAIL_REQUIRED');
  }

  const testMode = env.AGENTPAY_TEST_MODE === 'true';
  let sql;
  try {
    sql = createDb(env);
    const merchant = await lookupMerchantByEmail(sql, normalizedEmail);
    if (!merchant) {
      await sha256Hex(`oauth-email-link-noop:${normalizedEmail}`);
      return {
        delivery: env.RESEND_API_KEY && !testMode ? 'email' : 'unavailable',
        expiresAt: null,
        debugLink: null,
      };
    }

    const attemptId = crypto.randomUUID();
    const rawAttemptToken = `apoel_${randomHex(24)}`;
    const attemptTokenHash = await sha256Hex(rawAttemptToken);
    const audience = inferMcpAudience({
      redirectUri: input.redirectUri,
      resource: input.resource,
      clientName: input.clientName,
    });
    const expiresAt = new Date(Date.now() + MCP_EMAIL_LINK_TTL_SECONDS * 1000);

    await sql`
      INSERT INTO oauth_email_link_attempts (
        id,
        attempt_token_hash,
        client_id,
        merchant_id,
        merchant_email,
        merchant_key_prefix,
        redirect_uri,
        scope,
        state,
        resource,
        audience,
        code_challenge,
        code_challenge_method,
        delivery_channel,
        expires_at
      ) VALUES (
        ${attemptId}::uuid,
        ${attemptTokenHash},
        ${input.clientId},
        ${merchant.id}::uuid,
        ${merchant.email},
        ${merchant.keyPrefix},
        ${input.redirectUri},
        ${input.scope},
        ${input.state},
        ${input.resource ?? null},
        ${audience},
        ${input.codeChallenge},
        ${input.codeChallengeMethod},
        ${'email_link'},
        ${expiresAt.toISOString()}::timestamptz
      )
    `;

    const emailLinkUrl = new URL('/authorize/email-link', env.API_BASE_URL);
    emailLinkUrl.searchParams.set('attempt', attemptId);
    emailLinkUrl.searchParams.set('token', rawAttemptToken);

    if (testMode) {
      return {
        delivery: 'debug',
        expiresAt,
        debugLink: emailLinkUrl.toString(),
      };
    }

    if (!env.RESEND_API_KEY) {
      return {
        delivery: 'unavailable',
        expiresAt,
        debugLink: null,
      };
    }

    const subjectClient = input.clientName?.trim() || 'your MCP host';
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: 'AgentPay <notifications@agentpay.so>',
        to: [merchant.email],
        subject: `Continue your AgentPay connection to ${subjectClient}`,
        html: `<!doctype html><html><body style="margin:0;padding:32px;background:#f8fafc;font-family:system-ui,sans-serif;color:#0f172a;">
          <div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:24px;">
            <h1 style="margin:0 0 12px;font-size:24px;">Finish connecting AgentPay</h1>
            <p style="margin:0 0 12px;line-height:1.6;color:#475569;">Use the button below to continue your AgentPay connection to ${subjectClient}. This link expires in 15 minutes.</p>
            <p style="margin:0 0 24px;line-height:1.6;color:#475569;">No API key lookup is required for this path.</p>
            <a href="${emailLinkUrl.toString()}" style="display:inline-block;background:#0f172a;color:#fff;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:600;">Continue to AgentPay</a>
            <p style="margin:24px 0 0;font-size:12px;color:#64748b;">If you did not start this connection, you can ignore this email.</p>
          </div>
        </body></html>`,
      }),
    }).catch(() => {});

    return {
      delivery: 'email',
      expiresAt,
      debugLink: null,
    };
  } finally {
    await sql?.end().catch(() => {});
  }
}

async function loadOAuthEmailLinkAttempt(
  sql: any,
  input: { attemptId: string; token: string; allowUsed?: boolean },
): Promise<OAuthEmailLinkAttemptRow> {
  const tokenHash = await sha256Hex(input.token);
  const rows = await sql<OAuthEmailLinkAttemptRow[]>`
    SELECT
      a.id,
      a.attempt_token_hash,
      a.client_id,
      c.client_name AS client_name,
      a.merchant_id,
      a.merchant_email,
      a.merchant_key_prefix,
      a.redirect_uri,
      a.scope,
      a.state,
      a.resource,
      a.audience,
      a.code_challenge,
      a.code_challenge_method,
      a.delivery_channel,
      a.expires_at,
      a.verified_at,
      a.used_at,
      a.created_at
    FROM oauth_email_link_attempts a
    INNER JOIN oauth_clients c
      ON c.client_id = a.client_id
    WHERE a.id = ${input.attemptId}::uuid
      AND a.attempt_token_hash = ${tokenHash}
    LIMIT 1
  `;

  const row = rows[0];
  if (!row) throw new Error('OAUTH_EMAIL_LINK_INVALID');
  if (row.used_at && !input.allowUsed) throw new Error('OAUTH_EMAIL_LINK_ALREADY_USED');
  if (new Date(row.expires_at).getTime() < Date.now()) throw new Error('OAUTH_EMAIL_LINK_EXPIRED');
  if (row.code_challenge_method !== 'S256') throw new Error('OAUTH_PKCE_METHOD_UNSUPPORTED');
  return row;
}

async function deriveEmailLinkAuthorizationCode(
  env: Env,
  input: { attemptId: string; token: string },
): Promise<string> {
  const codeMaterial = await sha256Hex(
    `${env.AGENTPAY_SIGNING_SECRET}:oauth-email-link:${input.attemptId}:${input.token}`,
  );
  return `apcode_${codeMaterial}`;
}

async function findReplayableEmailLinkAuthorizationCode(
  sql: any,
  env: Env,
  row: OAuthEmailLinkAttemptRow,
  input: { attemptId: string; token: string },
): Promise<string | null> {
  const code = await deriveEmailLinkAuthorizationCode(env, input);
  const codeHash = await sha256Hex(code);
  const matches = await sql<Array<{
    client_id: string;
    merchant_id: string;
    redirect_uri: string;
    scope: string;
    resource: string | null;
    audience: string;
    code_challenge: string;
    expires_at: Date;
    used_at: Date | null;
  }>>`
    SELECT
      client_id,
      merchant_id,
      redirect_uri,
      scope,
      resource,
      audience,
      code_challenge,
      expires_at,
      used_at
    FROM oauth_authorization_codes
    WHERE code_hash = ${codeHash}
    LIMIT 1
  `;

  const existing = matches[0];
  if (!existing) return null;
  if (existing.used_at) return null;
  if (new Date(existing.expires_at).getTime() < Date.now()) return null;
  if (
    existing.client_id !== row.client_id ||
    existing.merchant_id !== row.merchant_id ||
    existing.redirect_uri !== row.redirect_uri ||
    existing.scope !== row.scope ||
    (existing.resource ?? null) !== (row.resource ?? null) ||
    parseAudience(existing.audience) !== parseAudience(row.audience) ||
    existing.code_challenge !== row.code_challenge
  ) {
    return null;
  }

  return code;
}

export async function peekOAuthEmailLinkAttempt(
  env: Env,
  input: { attemptId: string; token: string },
): Promise<OAuthEmailLinkAttemptSummary> {
  let sql;
  try {
    sql = createDb(env);
    const row = await loadOAuthEmailLinkAttempt(sql, input);
    return {
      attemptId: row.id,
      merchantEmail: row.merchant_email,
      clientId: row.client_id,
      clientName: row.client_name,
      redirectUri: row.redirect_uri,
      state: row.state,
      scope: row.scope,
      audience: parseAudience(row.audience),
      expiresAt: new Date(row.expires_at),
    };
  } finally {
    await sql?.end().catch(() => {});
  }
}

export async function completeOAuthEmailLinkAttempt(
  env: Env,
  input: { attemptId: string; token: string },
): Promise<{
  redirectUri: string;
  state: string | null;
  code: string;
}> {
  let sql;
  try {
    sql = createDb(env);
    return await sql.begin(async (trx: any) => {
      const row = await loadOAuthEmailLinkAttempt(trx, { ...input, allowUsed: true });

      if (row.used_at) {
        const replayableCode = await findReplayableEmailLinkAuthorizationCode(trx, env, row, input);
        if (replayableCode) {
          return {
            redirectUri: row.redirect_uri,
            state: row.state,
            code: replayableCode,
          };
        }
        throw new Error('OAUTH_EMAIL_LINK_ALREADY_USED');
      }

      const code = await deriveEmailLinkAuthorizationCode(env, input);

      const claimed = await trx<Array<{ id: string }>>`
        UPDATE oauth_email_link_attempts
        SET
          verified_at = COALESCE(verified_at, NOW()),
          used_at = NOW()
        WHERE id = ${row.id}::uuid
          AND used_at IS NULL
          AND expires_at > NOW()
        RETURNING id
      `;

      if (!claimed.length) {
        const replayableCode = await findReplayableEmailLinkAuthorizationCode(trx, env, row, input);
        if (replayableCode) {
          return {
            redirectUri: row.redirect_uri,
            state: row.state,
            code: replayableCode,
          };
        }
        throw new Error('OAUTH_EMAIL_LINK_ALREADY_USED');
      }

      await insertOAuthAuthorizationCode(trx, {
        code,
        clientId: row.client_id,
        merchant: {
          id: row.merchant_id,
          email: row.merchant_email,
          name: 'AgentPay Merchant',
          walletAddress: null,
          webhookUrl: null,
          keyPrefix: row.merchant_key_prefix,
        },
        redirectUri: row.redirect_uri,
        scope: row.scope,
        resource: row.resource,
        codeChallenge: row.code_challenge,
        codeChallengeMethod: 'S256',
        audience: parseAudience(row.audience),
      });

      return {
        redirectUri: row.redirect_uri,
        state: row.state,
        code,
      };
    });
  } finally {
    await sql?.end().catch(() => {});
  }
}

async function pkceChallengeS256(codeVerifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(codeVerifier));
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

export async function exchangeAuthorizationCode(
  env: Env,
  input: {
    clientId: string;
    redirectUri: string;
    code: string;
    codeVerifier: string;
  },
): Promise<{ accessToken: string; expiresIn: number; scope: string; audience: McpAccessTokenClaims['audience'] }> {
  const codeHash = await sha256Hex(input.code);
  let sql;
  try {
    sql = createDb(env);
    const rows = await sql<OAuthAuthorizationCodeRow[]>`
      SELECT
        id,
        code_hash,
        client_id,
        merchant_id,
        merchant_email,
        merchant_key_prefix,
        redirect_uri,
        scope,
        resource,
        audience,
        code_challenge,
        code_challenge_method,
        expires_at,
        used_at
      FROM oauth_authorization_codes
      WHERE code_hash = ${codeHash}
      LIMIT 1
    `;

    const row = rows[0];
    if (!row) throw new Error('OAUTH_CODE_INVALID');
    if (row.client_id !== input.clientId || !oauthRedirectUrisMatch(row.redirect_uri, input.redirectUri)) throw new Error('OAUTH_CODE_INVALID');
    if (row.used_at) throw new Error('OAUTH_CODE_ALREADY_USED');
    if (new Date(row.expires_at).getTime() < Date.now()) throw new Error('OAUTH_CODE_EXPIRED');
    if (row.code_challenge_method !== 'S256') throw new Error('OAUTH_PKCE_METHOD_UNSUPPORTED');

    const expectedChallenge = await pkceChallengeS256(input.codeVerifier);
    if (expectedChallenge !== row.code_challenge) throw new Error('OAUTH_PKCE_VERIFIER_INVALID');

    await sql`
      UPDATE oauth_authorization_codes
      SET used_at = NOW()
      WHERE id = ${row.id}::uuid
    `;

    const merchant: MerchantContext = {
      id: row.merchant_id,
      email: row.merchant_email,
      name: 'AgentPay Merchant',
      walletAddress: null,
      webhookUrl: null,
    };
    const minted = await mintMcpAccessToken({
      merchant,
      keyPrefix: row.merchant_key_prefix,
      signingSecret: env.AGENTPAY_SIGNING_SECRET,
      ttlSeconds: MCP_ACCESS_TOKEN_TTL_SECONDS,
      audience: parseAudience(row.audience),
    });

    return {
      accessToken: minted.accessToken,
      expiresIn: MCP_ACCESS_TOKEN_TTL_SECONDS,
      scope: row.scope,
      audience: parseAudience(row.audience),
    };
  } finally {
    await sql?.end().catch(() => {});
  }
}

export function buildAuthorizeSuccessRedirect(input: {
  redirectUri: string;
  code: string;
  state?: string | null;
}): string {
  const redirect = new URL(input.redirectUri);
  redirect.searchParams.set('code', input.code);
  if (input.state) redirect.searchParams.set('state', input.state);
  return redirect.toString();
}

export function buildAuthorizeErrorRedirect(input: {
  redirectUri: string;
  error: string;
  errorDescription: string;
  state?: string | null;
}): string {
  const redirect = new URL(input.redirectUri);
  redirect.searchParams.set('error', input.error);
  redirect.searchParams.set('error_description', input.errorDescription);
  if (input.state) redirect.searchParams.set('state', input.state);
  return redirect.toString();
}

export function validateOAuthAuthorizationRequest(query: URLSearchParams): OAuthAuthorizationRequest {
  const responseType = query.get('response_type');
  const clientId = query.get('client_id');
  const redirectUri = query.get('redirect_uri');
  const state = query.get('state');
  const scope = query.get('scope')?.trim() || MCP_OAUTH_SCOPE;
  const codeChallenge = query.get('code_challenge');
  const codeChallengeMethod = query.get('code_challenge_method');
  const resource = query.get('resource');

  if (responseType !== 'code') throw new Error('OAUTH_RESPONSE_TYPE_UNSUPPORTED');
  if (!clientId) throw new Error('OAUTH_CLIENT_ID_REQUIRED');
  if (!redirectUri || !isValidUrl(redirectUri)) throw new Error('OAUTH_REDIRECT_URI_INVALID');
  if (!codeChallenge) throw new Error('OAUTH_CODE_CHALLENGE_REQUIRED');
  if (codeChallengeMethod !== 'S256') throw new Error('OAUTH_CODE_CHALLENGE_METHOD_UNSUPPORTED');

  return {
    clientId,
    redirectUri,
    scope,
    state,
    codeChallenge,
    codeChallengeMethod: 'S256',
    resource,
  };
}
