import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env, Variables } from '../types';
import {
  MCP_OAUTH_SCOPE,
  authenticateMerchantForFounderOAuth,
  buildAuthorizationServerMetadata,
  buildAuthorizeSuccessRedirect,
  buildProtectedResourceMetadata,
  completeOAuthEmailLinkAttempt,
  createOAuthAuthorizationCode,
  exchangeAuthorizationCode,
  getOAuthClient,
  inferMcpAudience,
  peekOAuthEmailLinkAttempt,
  requestOAuthEmailLink,
  registerOAuthClient,
  validateOAuthAuthorizationRequest,
  verifyOAuthClientSecret,
} from '../lib/mcpOAuth';

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

function secureHtml(c: Context<{ Bindings: Env; Variables: Variables }>, html: string) {
  c.header('Cache-Control', 'no-store');
  c.header('Pragma', 'no-cache');
  c.header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'");
  return c.html(html);
}

function authorizePage(input: {
  request: ReturnType<typeof validateOAuthAuthorizationRequest>;
  clientName: string | null;
  email?: string | null;
  error?: string | null;
  emailLinkNotice?: string | null;
  debugEmailLink?: string | null;
}) {
  const { request, clientName, email, error, emailLinkNotice, debugEmailLink } = input;
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Authorize AgentPay MCP</title>
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
      .notice { margin-top: 12px; color: #166534; font-size: 14px; }
      .fine { font-size: 12px; color: #64748b; }
      .section { margin-top: 22px; padding-top: 18px; border-top: 1px solid #e2e8f0; }
      .subhead { margin: 0 0 8px; font-size: 16px; font-weight: 700; color: #0f172a; }
      .muted { margin: 0 0 12px; font-size: 13px; color: #64748b; line-height: 1.5; }
      .linkbox { margin-top: 12px; padding: 12px; border-radius: 10px; background: #ecfeff; border: 1px solid #a5f3fc; font-size: 13px; word-break: break-all; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="card">
        <h1>Authorize AgentPay</h1>
        <p>${htmlEscape(clientName ?? 'This MCP host')} is requesting access to your AgentPay hosted MCP runtime.</p>
        <div class="meta">
          <div><strong>Scope:</strong> ${htmlEscape(request.scope || MCP_OAUTH_SCOPE)}</div>
          <div><strong>Redirect URI:</strong> ${htmlEscape(request.redirectUri)}</div>
        </div>
        <div class="section" style="margin-top:0;padding-top:0;border-top:none;">
          <div class="subhead">Recommended: email link</div>
          <p class="muted">Enter your AgentPay email. We will send a short-lived sign-in link that continues this host connection without asking you to find an API key.</p>
          <form method="post" action="/authorize/email-link">
            <input type="hidden" name="client_id" value="${htmlEscape(request.clientId)}" />
            <input type="hidden" name="redirect_uri" value="${htmlEscape(request.redirectUri)}" />
            <input type="hidden" name="scope" value="${htmlEscape(request.scope)}" />
            <input type="hidden" name="state" value="${htmlEscape(request.state ?? '')}" />
            <input type="hidden" name="code_challenge" value="${htmlEscape(request.codeChallenge)}" />
            <input type="hidden" name="code_challenge_method" value="${htmlEscape(request.codeChallengeMethod)}" />
            <input type="hidden" name="resource" value="${htmlEscape(request.resource ?? '')}" />
            <label for="email">AgentPay email</label>
            <input id="email" name="email" type="email" autocomplete="email" value="${htmlEscape(email ?? '')}" required />
            <button type="submit">Send sign-in link</button>
          </form>
          ${emailLinkNotice ? `<div class="notice">${htmlEscape(emailLinkNotice)}</div>` : ''}
          ${debugEmailLink ? `<div class="linkbox"><strong>Test-mode link:</strong><br />${htmlEscape(debugEmailLink)}</div>` : ''}
        </div>
        <div class="section">
          <div class="subhead">Fallback: API key</div>
          <p class="muted">Use this only if email-link connect is unavailable. Your API key stays on AgentPay and is exchanged for a short-lived MCP token.</p>
          <form method="post" action="/authorize">
          <input type="hidden" name="client_id" value="${htmlEscape(request.clientId)}" />
          <input type="hidden" name="redirect_uri" value="${htmlEscape(request.redirectUri)}" />
          <input type="hidden" name="scope" value="${htmlEscape(request.scope)}" />
          <input type="hidden" name="state" value="${htmlEscape(request.state ?? '')}" />
          <input type="hidden" name="code_challenge" value="${htmlEscape(request.codeChallenge)}" />
          <input type="hidden" name="code_challenge_method" value="${htmlEscape(request.codeChallengeMethod)}" />
          <input type="hidden" name="resource" value="${htmlEscape(request.resource ?? '')}" />
          <label for="email">AgentPay email</label>
          <input id="email" name="email" type="email" autocomplete="email" required />
          <label for="api_key">AgentPay API key</label>
          <input id="api_key" name="api_key" type="password" autocomplete="off" required />
          <button type="submit">Authorize MCP access</button>
        </form>
        </div>
        ${error ? `<div class="error">${htmlEscape(error)}</div>` : ''}
        <p class="fine">AgentPay issues a short-lived access token scoped to remote MCP. Prefer email-link connect so humans do not need to look up long-lived credentials inside the host flow.</p>
      </div>
    </div>
  </body>
</html>`;
}

function emailLinkConfirmPage(input: {
  attemptId: string;
  token: string;
  clientName: string | null;
  merchantEmail: string;
  expiresAt: Date;
  error?: string | null;
}) {
  const { attemptId, token, clientName, merchantEmail, expiresAt, error } = input;
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Continue AgentPay connection</title>
    <style>
      body { font-family: ui-sans-serif, system-ui, sans-serif; background: #f8fafc; color: #0f172a; margin: 0; }
      .wrap { max-width: 560px; margin: 48px auto; padding: 24px; }
      .card { background: #fff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 24px; box-shadow: 0 8px 24px rgba(15,23,42,0.06); }
      h1 { margin: 0 0 8px; font-size: 24px; }
      p { color: #475569; line-height: 1.5; }
      .meta { margin: 16px 0; padding: 12px; border-radius: 10px; background: #f8fafc; border: 1px solid #e2e8f0; font-size: 13px; color: #334155; }
      button { margin-top: 20px; width: 100%; border: none; border-radius: 10px; background: #0f172a; color: #fff; padding: 12px 16px; font-size: 15px; font-weight: 600; cursor: pointer; }
      .error { margin-top: 12px; color: #b91c1c; font-size: 14px; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="card">
        <h1>Continue to ${htmlEscape(clientName ?? 'your MCP host')}</h1>
        <p>This link verified ${htmlEscape(merchantEmail)} for AgentPay. Continue to finish the MCP connection in the host.</p>
        <div class="meta">
          <div><strong>Account:</strong> ${htmlEscape(merchantEmail)}</div>
          <div><strong>Expires:</strong> ${htmlEscape(expiresAt.toISOString())}</div>
        </div>
        <form method="post" action="/authorize/email-link/confirm">
          <input type="hidden" name="attempt" value="${htmlEscape(attemptId)}" />
          <input type="hidden" name="token" value="${htmlEscape(token)}" />
          <button type="submit">Continue</button>
        </form>
        ${error ? `<div class="error">${htmlEscape(error)}</div>` : ''}
      </div>
    </div>
  </body>
</html>`;
}

router.get('/.well-known/oauth-protected-resource', (c) => c.json(buildProtectedResourceMetadata(c.env.API_BASE_URL)));
router.get('/.well-known/oauth-protected-resource/api/mcp', (c) => c.json(buildProtectedResourceMetadata(c.env.API_BASE_URL)));
router.get('/.well-known/oauth-authorization-server', (c) => c.json(buildAuthorizationServerMetadata(c.env.API_BASE_URL)));

router.post('/register', async (c) => {
  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_client_metadata', error_description: 'Expected JSON body.' }, 400);
  }

  const redirectUris = Array.isArray(body.redirect_uris)
    ? body.redirect_uris.filter((value): value is string => typeof value === 'string')
    : [];

  try {
    const client = await registerOAuthClient(c.env, {
      clientName: typeof body.client_name === 'string' ? body.client_name : null,
      redirectUris,
      tokenEndpointAuthMethod: typeof body.token_endpoint_auth_method === 'string' ? body.token_endpoint_auth_method : null,
      grantTypes: Array.isArray(body.grant_types) ? body.grant_types.filter((value): value is string => typeof value === 'string') : undefined,
      responseTypes: Array.isArray(body.response_types) ? body.response_types.filter((value): value is string => typeof value === 'string') : undefined,
      scope: typeof body.scope === 'string' ? body.scope : null,
      metadata: typeof body === 'object' && body ? body : undefined,
    });

    return c.json({
      client_id: client.clientId,
      client_secret: client.clientSecret,
      client_name: client.clientName,
      redirect_uris: client.redirectUris,
      token_endpoint_auth_method: client.tokenEndpointAuthMethod,
      grant_types: client.grantTypes,
      response_types: client.responseTypes,
      scope: client.scope,
    }, 201);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === 'OAUTH_REDIRECT_URIS_REQUIRED') {
      return c.json({
        error: 'invalid_redirect_uri',
        error_description: 'At least one valid HTTPS redirect URI is required.',
      }, 400);
    }
    return c.json({ error: 'server_error', error_description: 'Failed to register OAuth client.' }, 500);
  }
});

router.get('/authorize', async (c) => {
  try {
    const request = validateOAuthAuthorizationRequest(new URLSearchParams(c.req.query()));
    const client = await getOAuthClient(c.env, request.clientId);
    if (!client || !client.redirectUris.includes(request.redirectUri)) {
      return c.text('Invalid OAuth client or redirect URI.', 400);
    }
    return secureHtml(c, authorizePage({
      request,
      clientName: client.clientName,
    }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.text(`OAuth authorization request is invalid: ${message}`, 400);
  }
});

router.post('/authorize/email-link', async (c) => {
  const form = await c.req.formData();
  const clientId = asString(form.get('client_id'));
  const redirectUri = asString(form.get('redirect_uri'));
  const scope = asString(form.get('scope')) ?? MCP_OAUTH_SCOPE;
  const state = asString(form.get('state'));
  const codeChallenge = asString(form.get('code_challenge'));
  const codeChallengeMethod = asString(form.get('code_challenge_method'));
  const resource = asString(form.get('resource'));
  const email = asString(form.get('email'));

  if (!clientId || !redirectUri || !codeChallenge || codeChallengeMethod !== 'S256') {
    return c.text('Invalid OAuth authorization form submission.', 400);
  }

  const client = await getOAuthClient(c.env, clientId);
  if (!client || !client.redirectUris.includes(redirectUri)) {
    return c.text('Invalid OAuth client or redirect URI.', 400);
  }

  if (!email) {
    c.status(400);
    return secureHtml(c, authorizePage({
      request: {
        clientId,
        redirectUri,
        scope,
        state,
        codeChallenge,
        codeChallengeMethod: 'S256',
        resource,
      },
      clientName: client.clientName,
      error: 'Email is required.',
    }));
  }

  const requested = await requestOAuthEmailLink(c.env, {
    clientId,
    redirectUri,
    scope,
    state,
    codeChallenge,
    codeChallengeMethod: 'S256',
    resource,
    clientName: client.clientName,
    email,
  });

  return secureHtml(c, authorizePage({
    request: {
      clientId,
      redirectUri,
      scope,
      state,
      codeChallenge,
      codeChallengeMethod: 'S256',
      resource,
    },
    clientName: client.clientName,
    email,
    emailLinkNotice: requested.delivery === 'unavailable'
      ? 'Email delivery is not available in this environment. Use the API key fallback below.'
      : 'If an AgentPay account exists for that email, a sign-in link has been sent.',
    debugEmailLink: requested.debugLink,
  }));
});

router.get('/authorize/email-link', async (c) => {
  const attemptId = asString(c.req.query('attempt'));
  const token = asString(c.req.query('token'));
  if (!attemptId || !token) {
    return c.text('Invalid email link.', 400);
  }

  try {
    const attempt = await peekOAuthEmailLinkAttempt(c.env, { attemptId, token });
    return secureHtml(c, emailLinkConfirmPage({
      attemptId,
      token,
      clientName: attempt.clientName,
      merchantEmail: attempt.merchantEmail,
      expiresAt: attempt.expiresAt,
    }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    c.status(400);
    return secureHtml(c, emailLinkConfirmPage({
      attemptId,
      token,
      clientName: null,
      merchantEmail: '',
      expiresAt: new Date(),
      error: message === 'OAUTH_EMAIL_LINK_EXPIRED'
        ? 'This sign-in link has expired. Restart the AgentPay connection from the host.'
        : 'This sign-in link is invalid or has already been used.',
    }));
  }
});

router.post('/authorize/email-link/confirm', async (c) => {
  const form = await c.req.formData();
  const attemptId = asString(form.get('attempt'));
  const token = asString(form.get('token'));
  if (!attemptId || !token) {
    return c.text('Invalid email link confirmation.', 400);
  }

  try {
    const completed = await completeOAuthEmailLinkAttempt(c.env, { attemptId, token });
    return c.redirect(buildAuthorizeSuccessRedirect({
      redirectUri: completed.redirectUri,
      code: completed.code,
      state: completed.state,
    }), 302);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    c.status(400);
    return secureHtml(c, emailLinkConfirmPage({
      attemptId,
      token,
      clientName: null,
      merchantEmail: '',
      expiresAt: new Date(),
      error: message === 'OAUTH_EMAIL_LINK_EXPIRED'
        ? 'This sign-in link has expired. Restart the AgentPay connection from the host.'
        : 'This sign-in link is invalid or has already been used.',
    }));
  }
});

router.post('/authorize', async (c) => {
  const form = await c.req.formData();
  const clientId = asString(form.get('client_id'));
  const redirectUri = asString(form.get('redirect_uri'));
  const scope = asString(form.get('scope')) ?? MCP_OAUTH_SCOPE;
  const state = asString(form.get('state'));
  const codeChallenge = asString(form.get('code_challenge'));
  const codeChallengeMethod = asString(form.get('code_challenge_method'));
  const resource = asString(form.get('resource'));
  const email = asString(form.get('email'));
  const apiKey = asString(form.get('api_key'));

  if (!clientId || !redirectUri || !codeChallenge || codeChallengeMethod !== 'S256') {
    return c.text('Invalid OAuth authorization form submission.', 400);
  }

  const client = await getOAuthClient(c.env, clientId);
  if (!client || !client.redirectUris.includes(redirectUri)) {
    return c.text('Invalid OAuth client or redirect URI.', 400);
  }

  const merchant = email && apiKey
    ? await authenticateMerchantForFounderOAuth(c.env, email, apiKey)
    : null;
  if (!merchant) {
    c.status(401);
    return secureHtml(c, authorizePage({
      request: {
        clientId,
        redirectUri,
        scope,
        state,
        codeChallenge,
        codeChallengeMethod: 'S256',
        resource,
      },
      clientName: client.clientName,
      email,
      error: 'Email or API key is invalid.',
    }));
  }

  const audience = inferMcpAudience({
    redirectUri,
    resource,
    clientName: client.clientName,
  });
  const code = await createOAuthAuthorizationCode(c.env, {
    clientId,
    merchant,
    redirectUri,
    scope,
    resource,
    codeChallenge,
    codeChallengeMethod: 'S256',
    audience,
  });

  return c.redirect(buildAuthorizeSuccessRedirect({
    redirectUri,
    code,
    state,
  }), 302);
});

router.post('/token', async (c) => {
  const authHeader = c.req.header('authorization');
  const form = await c.req.formData();

  const grantType = asString(form.get('grant_type'));
  const code = asString(form.get('code'));
  const redirectUri = asString(form.get('redirect_uri'));
  const codeVerifier = asString(form.get('code_verifier'));
  let clientId = asString(form.get('client_id'));
  let clientSecret = asString(form.get('client_secret'));

  if (authHeader?.startsWith('Basic ')) {
    try {
      const decoded = atob(authHeader.slice(6));
      const [basicClientId, basicClientSecret] = decoded.split(':');
      clientId = clientId ?? basicClientId ?? null;
      clientSecret = clientSecret ?? basicClientSecret ?? null;
    } catch {
      return c.json({ error: 'invalid_client', error_description: 'Malformed basic authorization header.' }, 401);
    }
  }

  if (grantType !== 'authorization_code' || !code || !redirectUri || !codeVerifier || !clientId) {
    return c.json({ error: 'invalid_request', error_description: 'grant_type, code, redirect_uri, code_verifier, and client_id are required.' }, 400);
  }

  const client = await getOAuthClient(c.env, clientId);
  if (!client) {
    return c.json({ error: 'invalid_client', error_description: 'OAuth client not found.' }, 401);
  }

  if (client.tokenEndpointAuthMethod !== 'none') {
    if (!clientSecret || !(await verifyOAuthClientSecret(c.env, clientId, clientSecret))) {
      return c.json({ error: 'invalid_client', error_description: 'OAuth client authentication failed.' }, 401);
    }
  }

  try {
    const exchanged = await exchangeAuthorizationCode(c.env, {
      clientId,
      redirectUri,
      code,
      codeVerifier,
    });
    c.header('Cache-Control', 'no-store');
    c.header('Pragma', 'no-cache');
    return c.json({
      access_token: exchanged.accessToken,
      token_type: 'Bearer',
      expires_in: exchanged.expiresIn,
      scope: exchanged.scope,
      audience: exchanged.audience,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const invalidGrant = new Set([
      'OAUTH_CODE_INVALID',
      'OAUTH_CODE_ALREADY_USED',
      'OAUTH_CODE_EXPIRED',
      'OAUTH_PKCE_VERIFIER_INVALID',
      'OAUTH_PKCE_METHOD_UNSUPPORTED',
    ]);
    if (invalidGrant.has(message)) {
      return c.json({ error: 'invalid_grant', error_description: message }, 400);
    }
    return c.json({ error: 'server_error', error_description: 'Failed to exchange authorization code.' }, 500);
  }
});

export { router as mcpOAuthRouter };
