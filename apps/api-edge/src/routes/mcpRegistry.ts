/**
 * MCP Registry — /api/registry/*
 *
 * Agent-first MCP server marketplace. Supports both HTTP and stdio transports.
 * TOTP required only for: paid subscriptions + publishing (not free-tier subscribe).
 * Revenue: 70% publisher / 30% AgentPay on per-call billing.
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env, Variables } from '../types';
import { authenticateApiKey } from '../middleware/auth';
import { createDb } from '../lib/db';
import { generateTotpSecret, verifyTotpCode, buildOtpAuthUri, encryptTotpSecret, decryptTotpSecret } from '../lib/totp';

const router = new Hono<{ Bindings: Env; Variables: Variables }>();

const AGENTPAY_ISSUER = 'AgentPay';
const PUBLISHER_REVENUE_SHARE = 0.70;
const PLATFORM_FEE_SHARE = 1 - PUBLISHER_REVENUE_SHARE;

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function getTotpEnrollment(sql: ReturnType<typeof createDb>, agentId: string) {
  const rows = await sql.unsafe<Array<{ secret_enc: string; confirmed_at: Date | null }>>(
    `SELECT secret_enc, confirmed_at FROM totp_enrollments WHERE agent_id = $1 LIMIT 1`,
    [agentId],
  ).catch(() => []);
  return rows[0] ?? null;
}

type HonoContext = Context<{ Bindings: Env; Variables: Variables }>;

async function requireTotp(
  c: HonoContext,
  sql: ReturnType<typeof createDb>,
  agentId: string,
  totpCode: string | null | undefined,
): Promise<{ ok: true } | { ok: false; response: Response }> {
  const enrollment = await getTotpEnrollment(sql, agentId);
  if (!enrollment) {
    return { ok: false, response: c.json({ error: 'TOTP_SETUP_REQUIRED', message: 'Enroll TOTP first: call registry_enroll or POST /api/registry/totp/enroll' }, 403) as Response };
  }
  if (!enrollment.confirmed_at) {
    return { ok: false, response: c.json({ error: 'TOTP_NOT_CONFIRMED', message: 'Confirm TOTP: call registry_confirm_totp or POST /api/registry/totp/confirm with { "totp_code": "123456" }' }, 403) as Response };
  }
  if (!totpCode) {
    return { ok: false, response: c.json({ error: 'TOTP_CODE_REQUIRED', message: 'Include totp_code (6-digit code from authenticator app) in the request.' }, 401) as Response };
  }
  const encKey = c.env.TOTP_ENCRYPTION_KEY;
  if (!encKey) throw new Error('TOTP_ENCRYPTION_KEY not configured');
  const secret = await decryptTotpSecret(enrollment.secret_enc, encKey);
  if (!await verifyTotpCode(secret, totpCode)) {
    return { ok: false, response: c.json({ error: 'TOTP_INVALID', message: 'Invalid or expired TOTP code. Codes are valid for 30 seconds.' }, 401) as Response };
  }
  return { ok: true };
}

async function publishToFeed(
  env: Env,
  server: {
    name: string; description: string | null; endpoint_url: string; transport: string;
    category: string | null; pricing_model: string; price_per_call_usd: string | null;
    price_monthly_usd: string | null; slug: string;
  },
): Promise<void> {
  const adminKey = env.AGENTPAY_FEED_ADMIN_KEY;
  if (!adminKey) return;
  const feedUrl = env.AGENTPAY_FEED_URL ?? 'https://agentpay-feed.apaybeta.workers.dev';
  try {
    await fetch(`${feedUrl}/v1/feed/publish`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        category: 'tool_registration',
        action: 'register',
        source: `agentpay-registry/${server.slug}`,
        payload: {
          tool_name: server.name,
          description: server.description,
          endpoint: server.endpoint_url || undefined,
          transport: server.transport,
          tags: [server.category, server.transport].filter(Boolean),
          pricing: {
            model: server.pricing_model,
            per_call: server.price_per_call_usd ? parseFloat(server.price_per_call_usd) : undefined,
            monthly: server.price_monthly_usd ? parseFloat(server.price_monthly_usd) : undefined,
            currency: 'USD',
          },
        },
      }),
    });
  } catch { /* non-critical */ }
}

function buildHarnessConfigs(server: {
  slug: string; name: string; endpoint_url: string; transport: string;
  command?: string | null; command_args?: unknown; github_url?: string | null;
}) {
  if (server.transport === 'stdio') {
    const cmd = server.command ?? 'python3';
    const args = Array.isArray(server.command_args) ? server.command_args : ['server.py'];
    return {
      transport: 'stdio',
      claude_code: {
        file: '~/.claude/settings.json or .mcp.json',
        config: { mcpServers: { [server.slug]: { command: cmd, args } } },
      },
      codex: {
        file: '~/.codex/config.toml',
        config: `[mcp_servers.${server.slug}]\ncommand = "${cmd}"\nargs = ${JSON.stringify(args)}`,
      },
      cursor: {
        file: '.cursor/mcp.json',
        config: { mcpServers: { [server.slug]: { command: cmd, args } } },
      },
      install_note: server.github_url
        ? `Install locally first: git clone ${server.github_url} && cd ${server.slug} && pip install -r requirements.txt`
        : `Install from repo and run locally.`,
      smithery: server.github_url
        ? `npx @smithery/cli run ${server.github_url.replace('https://github.com/', '')}`
        : null,
    };
  }
  return {
    transport: 'http',
    claude_code: {
      file: '~/.claude/settings.json or .mcp.json',
      config: { mcpServers: { [server.slug]: { type: 'http', url: server.endpoint_url } } },
    },
    codex: {
      file: '~/.codex/config.toml',
      config: `[mcp_servers.${server.slug}]\nurl = "${server.endpoint_url}"`,
    },
    cursor: {
      file: '.cursor/mcp.json',
      config: { mcpServers: { [server.slug]: { url: server.endpoint_url, transport: 'http' } } },
    },
    generic_http: { url: server.endpoint_url, transport: 'streamable-http' },
  };
}

// ── GET /api/registry/servers ─────────────────────────────────────────────────

router.get('/servers', async (c) => {
  const { q, category, limit = '20', offset = '0', featured, transport } = c.req.query();
  const limitN = Math.min(parseInt(limit, 10) || 20, 100);
  const offsetN = Math.max(parseInt(offset, 10) || 0, 0);
  const sql = createDb(c.env);
  try {
    const conditions: string[] = ["status = 'active'"];
    const params: (string | number | null | boolean)[] = [];
    if (q) {
      params.push(`%${q.toLowerCase()}%`);
      conditions.push(`(LOWER(name) LIKE $${params.length} OR LOWER(description) LIKE $${params.length} OR LOWER(category) LIKE $${params.length})`);
    }
    if (category) { params.push(category.toLowerCase()); conditions.push(`LOWER(category) = $${params.length}`); }
    if (transport) { params.push(transport); conditions.push(`transport = $${params.length}`); }
    if (featured === 'true') conditions.push('featured = true');
    params.push(limitN, offsetN);
    const rows = await sql.unsafe<Array<{
      id: string; slug: string; name: string; description: string | null; category: string | null;
      transport: string; pricing_model: string; price_per_call_usd: string | null;
      price_monthly_usd: string | null; free_tier_calls: number; verified: boolean;
      featured: boolean; install_count: number; github_url: string | null;
    }>>(
      `SELECT id, slug, name, description, category, transport, pricing_model,
              price_per_call_usd, price_monthly_usd, free_tier_calls,
              verified, featured, install_count, github_url
       FROM mcp_servers WHERE ${conditions.join(' AND ')}
       ORDER BY featured DESC, install_count DESC, created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return c.json({ success: true, servers: rows, limit: limitN, offset: offsetN });
  } finally { await sql.end().catch(() => {}); }
});

// ── GET /api/registry/servers/:slug ──────────────────────────────────────────

router.get('/servers/:slug', async (c) => {
  const sql = createDb(c.env);
  try {
    const rows = await sql.unsafe<Array<{
      id: string; slug: string; name: string; description: string | null; category: string | null;
      endpoint_url: string; publisher_id: string; transport: string; pricing_model: string;
      price_per_call_usd: string | null; price_monthly_usd: string | null; free_tier_calls: number;
      status: string; verified: boolean; featured: boolean; install_count: number;
      domain_verified: boolean; github_url: string | null; command: string | null;
      command_args: unknown; metadata: unknown; created_at: Date;
    }>>(
      `SELECT id, slug, name, description, category, endpoint_url, publisher_id, transport,
              pricing_model, price_per_call_usd, price_monthly_usd, free_tier_calls,
              status, verified, featured, install_count, domain_verified,
              github_url, command, command_args, metadata, created_at
       FROM mcp_servers WHERE slug = $1 AND status = 'active' LIMIT 1`,
      [c.req.param('slug')],
    );
    if (!rows[0]) return c.json({ error: 'NOT_FOUND' }, 404);
    return c.json({ success: true, server: rows[0] });
  } finally { await sql.end().catch(() => {}); }
});

// ── POST /api/registry/servers — publish a server ────────────────────────────

router.post('/servers', authenticateApiKey, async (c) => {
  const merchant = c.get('merchant');
  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return c.json({ error: 'INVALID_BODY' }, 400);

  const {
    name, description, category,
    endpoint_url, transport = 'http',
    command, command_args = [], command_env = {}, github_url,
    pricing_model = 'free', price_per_call_usd, price_monthly_usd,
    free_tier_calls = 100, metadata = {}, totp_code,
  } = body;

  if (typeof name !== 'string' || name.trim().length < 2)
    return c.json({ error: 'VALIDATION', message: 'name required (min 2 chars)' }, 400);

  const isHttp = transport === 'http';
  const isStdio = transport === 'stdio';

  if (isHttp && (typeof endpoint_url !== 'string' || !endpoint_url.startsWith('https://')))
    return c.json({ error: 'VALIDATION', message: 'For http transport, endpoint_url must start with https://' }, 400);
  if (isStdio && typeof github_url !== 'string')
    return c.json({ error: 'VALIDATION', message: 'For stdio transport, github_url (GitHub repo URL) is required' }, 400);

  const sql = createDb(c.env);
  try {
    const totpCheck = await requireTotp(c, sql, merchant.id, totp_code as string | null);
    if (!totpCheck.ok) return totpCheck.response;

    const serverSlug = (name as string).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
    const verificationToken = await sha256Hex(`${serverSlug}-${merchant.id}-${Date.now()}`);
    // stdio servers with a github_url go active immediately; http servers need domain verification
    const initialStatus = isStdio ? 'active' : 'pending';

    const result = await sql.unsafe<Array<{ id: string; slug: string; verification_token: string; status: string }>>(
      `INSERT INTO mcp_servers
         (slug, name, description, category, endpoint_url, publisher_id, transport,
          command, command_args, command_env, github_url,
          pricing_model, price_per_call_usd, price_monthly_usd, free_tier_calls,
          status, domain_verified, metadata, verification_token)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11,$12,$13,$14,$15,$16,$17,$18,$19)
       ON CONFLICT (slug) DO UPDATE SET updated_at = now()
       RETURNING id, slug, verification_token, status`,
      [
        serverSlug, (name as string).trim(), description ?? null, category ?? null,
        isHttp ? endpoint_url : (github_url ?? ''), merchant.id, transport,
        command ?? null, JSON.stringify(command_args), JSON.stringify(command_env), github_url ?? null,
        pricing_model, price_per_call_usd ?? null, price_monthly_usd ?? null,
        free_tier_calls, initialStatus, isStdio, JSON.stringify(metadata), verificationToken,
      ] as (string | number | null | boolean)[],
    );
    const row = result[0];
    if (!row) return c.json({ error: 'INSERT_FAILED' }, 500);

    const response: Record<string, unknown> = {
      success: true, server_id: row.id, slug: row.slug, status: row.status,
      transport,
    };

    if (isHttp) {
      response.next_steps = {
        domain_verification: {
          method_1_well_known: {
            path: '/.well-known/agentpay-publisher.json',
            content: JSON.stringify({ token: row.verification_token }),
            note: 'Preferred method — place this file at your endpoint URL root.',
          },
          method_2_dns_txt: {
            record: '_agentpay-verify.yourdomain.com',
            value: row.verification_token,
            note: 'Alternative — DNS TXT record. Not available on *.workers.dev domains.',
          },
          verify_endpoint: `POST /api/registry/servers/${row.slug}/verify`,
          mcp_tool: 'Call registry_verify_domain with your slug after placing the token.',
        },
        listing_fee: pricing_model !== 'free'
          ? { required: true, amount_usd: 9, note: 'One-time fee before going active.' }
          : { required: false },
      };
    } else {
      void publishToFeed(c.env, {
        name: (name as string).trim(),
        description: (description as string | null | undefined) ?? null,
        endpoint_url: (github_url as string | null | undefined) ?? '',
        transport: transport as string,
        category: (category as string | null | undefined) ?? null,
        pricing_model: pricing_model as string,
        price_per_call_usd: (price_per_call_usd as string | null | undefined) ?? null,
        price_monthly_usd: (price_monthly_usd as string | null | undefined) ?? null,
        slug: row.slug,
      });
      response.message = 'stdio server published and active immediately.';
    }

    return c.json(response, 201);
  } finally { await sql.end().catch(() => {}); }
});

// ── POST /api/registry/servers/:slug/verify ───────────────────────────────────

router.post('/servers/:slug/verify', authenticateApiKey, async (c) => {
  const merchant = c.get('merchant');
  const sql = createDb(c.env);
  try {
    const rows = await sql.unsafe<Array<{
      id: string; slug: string; endpoint_url: string; publisher_id: string;
      verification_token: string; transport: string;
      name: string; description: string | null; category: string | null;
      pricing_model: string; price_per_call_usd: string | null; price_monthly_usd: string | null;
    }>>(
      `SELECT id, slug, endpoint_url, publisher_id, verification_token, transport,
              name, description, category, pricing_model, price_per_call_usd, price_monthly_usd
       FROM mcp_servers WHERE slug = $1 AND status = 'pending' LIMIT 1`,
      [c.req.param('slug')!],
    );
    const server = rows[0];
    if (!server) return c.json({ error: 'NOT_FOUND', message: 'Server not found or already active.' }, 404);
    if (server.publisher_id !== merchant.id) return c.json({ error: 'FORBIDDEN' }, 403);
    if (server.transport === 'stdio') {
      // stdio servers don't need domain verification — activate immediately
      await sql.unsafe(`UPDATE mcp_servers SET status = 'active', updated_at = now() WHERE id = $1`, [server.id]);
      void publishToFeed(c.env, server);
      return c.json({ success: true, message: 'Server activated.', status: 'active' });
    }

    let verified = false, method = '';

    // Method 1: /.well-known/agentpay-publisher.json (preferred, works on *.workers.dev)
    try {
      const url = new URL('/.well-known/agentpay-publisher.json', server.endpoint_url);
      const resp = await fetch(url.toString(), { signal: AbortSignal.timeout(5000) });
      if (resp.ok) {
        const json = await resp.json() as { token?: string };
        if (json.token === server.verification_token) { verified = true; method = 'well_known'; }
      }
    } catch { /* try DNS */ }

    // Method 2: DNS TXT via Cloudflare DoH (not available on *.workers.dev)
    if (!verified) {
      try {
        const domain = new URL(server.endpoint_url).hostname;
        const resp = await fetch(
          `https://cloudflare-dns.com/dns-query?name=_agentpay-verify.${domain}&type=TXT`,
          { headers: { Accept: 'application/dns-json' }, signal: AbortSignal.timeout(5000) },
        );
        if (resp.ok) {
          const dns = await resp.json() as { Answer?: Array<{ data: string }> };
          if ((dns.Answer ?? []).some(r => r.data.replace(/^"|"$/g, '') === server.verification_token)) {
            verified = true; method = 'dns_txt';
          }
        }
      } catch { /* failed */ }
    }

    if (!verified) return c.json({
      error: 'VERIFICATION_FAILED',
      message: 'Token not found. If deploying on *.workers.dev, use the /.well-known/ method only (DNS TXT not available on Cloudflare default domains).',
    }, 422);

    await sql.unsafe(
      `UPDATE mcp_servers SET domain_verified = true, status = 'active', updated_at = now() WHERE id = $1`,
      [server.id],
    );
    void publishToFeed(c.env, server);
    return c.json({ success: true, message: `Verified via ${method}. Server is now active.`, status: 'active' });
  } finally { await sql.end().catch(() => {}); }
});

// ── GET /api/registry/servers/:slug/config ────────────────────────────────────

router.get('/servers/:slug/config', authenticateApiKey, async (c) => {
  const merchant = c.get('merchant');
  const serverSlug = c.req.param('slug')!;
  const sql = createDb(c.env);
  try {
    const sub = await sql.unsafe<Array<{ id: string }>>(
      `SELECT s.id FROM mcp_subscriptions s JOIN mcp_servers ms ON ms.id = s.server_id
       WHERE ms.slug = $1 AND s.agent_id = $2 AND s.status = 'active' LIMIT 1`,
      [serverSlug, merchant.id],
    );
    if (!sub[0]) return c.json({ error: 'NOT_SUBSCRIBED', message: 'Subscribe first.' }, 403);

    const rows = await sql.unsafe<Array<{
      name: string; endpoint_url: string; transport: string;
      command: string | null; command_args: unknown; github_url: string | null;
    }>>(
      `SELECT name, endpoint_url, transport, command, command_args, github_url
       FROM mcp_servers WHERE slug = $1 LIMIT 1`,
      [serverSlug],
    );
    const server = rows[0];
    if (!server) return c.json({ error: 'NOT_FOUND' }, 404);

    return c.json({
      success: true, name: server.name,
      harness_configs: buildHarnessConfigs({ slug: serverSlug, ...server }),
    });
  } finally { await sql.end().catch(() => {}); }
});

// ── GET /api/registry/subscriptions ──────────────────────────────────────────

router.get('/subscriptions', authenticateApiKey, async (c) => {
  const merchant = c.get('merchant');
  const sql = createDb(c.env);
  try {
    const rows = await sql.unsafe<Array<{
      id: string; slug: string; name: string; category: string | null;
      transport: string; pricing_model: string; plan: string; calls_used: number; started_at: Date;
    }>>(
      `SELECT s.id, ms.slug, ms.name, ms.category, ms.transport, ms.pricing_model,
              s.plan, s.calls_used, s.started_at
       FROM mcp_subscriptions s JOIN mcp_servers ms ON ms.id = s.server_id
       WHERE s.agent_id = $1 AND s.status = 'active' ORDER BY s.started_at DESC`,
      [merchant.id],
    );
    return c.json({ success: true, subscriptions: rows });
  } finally { await sql.end().catch(() => {}); }
});

// ── POST /api/registry/subscriptions ─────────────────────────────────────────

router.post('/subscriptions', authenticateApiKey, async (c) => {
  const merchant = c.get('merchant');
  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return c.json({ error: 'INVALID_BODY' }, 400);
  const { server_slug, totp_code } = body;
  if (typeof server_slug !== 'string') return c.json({ error: 'VALIDATION', message: 'server_slug required' }, 400);

  const sql = createDb(c.env);
  try {
    const rows = await sql.unsafe<Array<{
      id: string; name: string; pricing_model: string;
      price_monthly_usd: string | null; free_tier_calls: number; transport: string;
    }>>(
      `SELECT id, name, pricing_model, price_monthly_usd, free_tier_calls, transport
       FROM mcp_servers WHERE slug = $1 AND status = 'active' LIMIT 1`,
      [server_slug],
    );
    const server = rows[0];
    if (!server) return c.json({ error: 'NOT_FOUND', message: `Server "${server_slug}" not found` }, 404);

    const isPaid = server.pricing_model !== 'free' && Boolean(server.price_monthly_usd);

    // TOTP only required for paid subscriptions
    if (isPaid) {
      const totpCheck = await requireTotp(c, sql, merchant.id, totp_code as string | null);
      if (!totpCheck.ok) return totpCheck.response;
    }

    await sql.unsafe(
      `INSERT INTO mcp_subscriptions (agent_id, server_id, plan)
       VALUES ($1, $2, $3)
       ON CONFLICT (agent_id, server_id) DO UPDATE SET status = 'active', updated_at = now()`,
      [merchant.id, server.id, server.pricing_model],
    ).catch(() => null);

    await sql.unsafe(
      `UPDATE mcp_servers SET install_count = install_count + 1, updated_at = now() WHERE id = $1`,
      [server.id],
    ).catch(() => null);

    if (isPaid) {
      return c.json({
        success: true, payment_required: true, price_monthly_usd: server.price_monthly_usd,
        message: `Subscribed to ${server.name}. Use agentpay_create_payment_intent to pay and activate.`,
      });
    }

    return c.json({
      success: true,
      message: `Subscribed to ${server.name}. Free tier: ${server.free_tier_calls} calls/month.`,
      next: 'Call registry_server_info to get harness connection config.',
    }, 201);
  } finally { await sql.end().catch(() => {}); }
});

// ── DELETE /api/registry/subscriptions/:id ───────────────────────────────────

router.delete('/subscriptions/:id', authenticateApiKey, async (c) => {
  const merchant = c.get('merchant');
  const sql = createDb(c.env);
  try {
    await sql.unsafe(
      `UPDATE mcp_subscriptions SET status = 'cancelled' WHERE id = $1 AND agent_id = $2`,
      [c.req.param('id')!, merchant.id],
    );
    return c.json({ success: true });
  } finally { await sql.end().catch(() => {}); }
});

// ── POST /api/registry/totp/enroll ───────────────────────────────────────────

router.post('/totp/enroll', authenticateApiKey, async (c) => {
  const merchant = c.get('merchant');
  const encKey = c.env.TOTP_ENCRYPTION_KEY;
  if (!encKey) return c.json({ error: 'TOTP_NOT_CONFIGURED' }, 503);

  const sql = createDb(c.env);
  try {
    const existing = await getTotpEnrollment(sql, merchant.id);
    if (existing?.confirmed_at) return c.json({ error: 'ALREADY_ENROLLED' }, 409);

    const secret = generateTotpSecret();
    const secretEnc = await encryptTotpSecret(secret, encKey);
    const accountName = merchant.email ?? merchant.id;
    const otpauthUri = buildOtpAuthUri(secret, AGENTPAY_ISSUER, accountName);
    const setupToken = await sha256Hex(`${merchant.id}-setup-${Date.now()}`);
    const setupUrl = `${c.env.API_BASE_URL}/api/registry/totp/setup?token=${setupToken}&uri=${encodeURIComponent(otpauthUri)}`;
    const setupKey = secret.match(/.{1,4}/g)?.join(' ') ?? secret;

    await sql.unsafe(
      `INSERT INTO totp_enrollments (agent_id, secret_enc)
       VALUES ($1, $2) ON CONFLICT (agent_id) DO UPDATE SET secret_enc = $2, confirmed_at = NULL`,
      [merchant.id, secretEnc],
    );

    return c.json({
      success: true, enrolled: false,
      message: 'Open setup_url in a browser to scan the QR, or enter setup_key manually in Google Authenticator / Authy.',
      otpauth_uri: otpauthUri,
      setup_key: setupKey,
      setup_url: setupUrl,
      next_step: 'Call registry_confirm_totp with your first 6-digit code.',
    });
  } finally { await sql.end().catch(() => {}); }
});

// ── POST /api/registry/totp/confirm ──────────────────────────────────────────

router.post('/totp/confirm', authenticateApiKey, async (c) => {
  const merchant = c.get('merchant');
  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  const code = typeof body?.totp_code === 'string' ? body.totp_code : null;
  if (!code) return c.json({ error: 'TOTP_CODE_REQUIRED', message: 'Provide totp_code.' }, 400);

  const encKey = c.env.TOTP_ENCRYPTION_KEY;
  if (!encKey) return c.json({ error: 'TOTP_NOT_CONFIGURED' }, 503);

  const sql = createDb(c.env);
  try {
    const enrollment = await getTotpEnrollment(sql, merchant.id);
    if (!enrollment) return c.json({ error: 'NOT_ENROLLED', message: 'Start with registry_enroll.' }, 404);
    if (enrollment.confirmed_at) return c.json({ error: 'ALREADY_CONFIRMED' }, 409);

    const secret = await decryptTotpSecret(enrollment.secret_enc, encKey);
    if (!await verifyTotpCode(secret, code)) {
      return c.json({ error: 'TOTP_INVALID', message: 'Code incorrect or expired. Check device clock and retry.' }, 401);
    }
    await sql.unsafe(`UPDATE totp_enrollments SET confirmed_at = now() WHERE agent_id = $1`, [merchant.id]);
    return c.json({ success: true, message: 'TOTP confirmed. Pass totp_code when publishing or subscribing to paid servers.' });
  } finally { await sql.end().catch(() => {}); }
});

// ── GET /api/registry/totp/setup — browser QR page ───────────────────────────

router.get('/totp/setup', async (c) => {
  const uri = c.req.query('uri');
  if (!uri) return c.text('Missing uri', 400);
  const decoded = decodeURIComponent(uri);
  if (!decoded.startsWith('otpauth://')) return c.text('Invalid URI', 400);

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>AgentPay — Set Up Authenticator</title>
  <style>
    body{font-family:ui-sans-serif,system-ui,sans-serif;background:#f8fafc;color:#0f172a;margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;}
    .card{background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:32px;text-align:center;max-width:380px;box-shadow:0 8px 24px rgba(15,23,42,.06);}
    h1{font-size:20px;margin:0 0 8px;}p{color:#475569;font-size:14px;line-height:1.5;margin:0 0 16px;}
    #qr{margin:0 auto;}
    .key{font-family:monospace;font-size:13px;background:#f1f5f9;border-radius:8px;padding:10px 14px;word-break:break-all;margin-top:4px;}
    .note{font-size:12px;color:#64748b;margin-top:16px;}
    code{background:#f1f5f9;padding:2px 6px;border-radius:4px;font-size:11px;}
  </style>
</head>
<body><div class="card">
  <h1>Scan with Authenticator</h1>
  <p>Open Google Authenticator, Authy, or any TOTP app.</p>
  <div id="qr"></div>
  <p class="note">Or enter the key manually:</p>
  <div class="key" id="key">Loading...</div>
  <p class="note">After scanning, confirm in your agent:<br/><code>registry_confirm_totp</code></p>
</div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js" crossorigin="anonymous"></script>
<script>
  var uri = decodeURIComponent("${encodeURIComponent(decoded)}");
  try {
    new QRCode(document.getElementById("qr"),{text:uri,width:220,height:220,colorDark:"#0f172a",colorLight:"#ffffff",correctLevel:QRCode.CorrectLevel.M});
  } catch(e) { document.getElementById("qr").textContent = "QR library failed to load. Use the key below."; }
  var m = uri.match(/secret=([A-Z2-7]+)/);
  document.getElementById("key").textContent = m ? m[1].match(/.{1,4}/g).join(" ") : "Key not found";
</script>
</body></html>`;

  c.header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline' https://cdnjs.cloudflare.com; img-src data:; base-uri 'none'; frame-ancestors 'none'");
  c.header('Cache-Control', 'no-store');
  return c.html(html);
});

// ── GET /api/registry/usage — publisher stats ─────────────────────────────────

router.get('/usage', authenticateApiKey, async (c) => {
  const merchant = c.get('merchant');
  const sql = createDb(c.env);
  try {
    const rows = await sql.unsafe<Array<{
      slug: string; name: string; transport: string; install_count: number;
      total_calls: string; total_billed: string; publisher_earnings: string;
    }>>(
      `SELECT ms.slug, ms.name, ms.transport, ms.install_count,
              COUNT(ue.id)::text                            AS total_calls,
              COALESCE(SUM(ue.billed_amount_usd),0)::text  AS total_billed,
              COALESCE(SUM(ue.publisher_share_usd),0)::text AS publisher_earnings
       FROM mcp_servers ms
       LEFT JOIN mcp_usage_events ue ON ue.server_id = ms.id
       WHERE ms.publisher_id = $1
       GROUP BY ms.id ORDER BY ms.install_count DESC`,
      [merchant.id],
    );
    return c.json({ success: true, revenue_share_pct: PUBLISHER_REVENUE_SHARE * 100, servers: rows });
  } finally { await sql.end().catch(() => {}); }
});

// ── GET /api/registry/payouts — publisher payout summary ──────────────────────

router.get('/payouts', authenticateApiKey, async (c) => {
  const merchant = c.get('merchant');
  const sql = createDb(c.env);
  try {
    // Current month unpaid earnings
    const pending = await sql.unsafe<Array<{ earned: string }>>(
      `SELECT COALESCE(SUM(publisher_share_usd),0)::text AS earned
       FROM mcp_usage_events ue
       JOIN mcp_servers ms ON ms.id = ue.server_id
       WHERE ms.publisher_id = $1
         AND ue.created_at >= date_trunc('month', now())`,
      [merchant.id],
    );

    const history = await sql.unsafe<Array<{
      id: string; period_start: Date; period_end: Date;
      net_payout_usd: string; status: string; paid_at: Date | null;
    }>>(
      `SELECT id, period_start, period_end, net_payout_usd, status, paid_at
       FROM publisher_payouts WHERE publisher_id = $1 ORDER BY period_start DESC LIMIT 12`,
      [merchant.id],
    );

    return c.json({
      success: true,
      revenue_share_pct: PUBLISHER_REVENUE_SHARE * 100,
      pending_this_month_usd: pending[0]?.earned ?? '0',
      payout_schedule: 'Monthly, 1st of each month for previous month earnings.',
      history,
    });
  } finally { await sql.end().catch(() => {}); }
});

// ── POST /api/registry/payouts/calculate (internal admin) ────────────────────

router.post('/payouts/calculate', authenticateApiKey, async (c) => {
  const merchant = c.get('merchant');
  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  const { period_start, period_end } = body ?? {};

  // Only admins (ADMIN_SECRET_KEY header match) can run batch calculation for all publishers
  const adminKey = c.env.ADMIN_SECRET_KEY;
  const isAdmin = adminKey && c.req.header('x-admin-key') === adminKey;

  const sql = createDb(c.env);
  try {
    const pStart = typeof period_start === 'string' ? period_start : new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1).toISOString().slice(0, 10);
    const pEnd = typeof period_end === 'string' ? period_end : new Date(new Date().getFullYear(), new Date().getMonth(), 0).toISOString().slice(0, 10);

    // Calculate for requesting publisher (or all if admin)
    const publisherFilter = isAdmin ? '' : `AND ms.publisher_id = '${merchant.id}'`;

    const earnings = await sql.unsafe<Array<{
      publisher_id: string; gross: string; publisher_share: string;
    }>>(
      `SELECT ms.publisher_id,
              COALESCE(SUM(ue.billed_amount_usd),0)::text  AS gross,
              COALESCE(SUM(ue.publisher_share_usd),0)::text AS publisher_share
       FROM mcp_usage_events ue
       JOIN mcp_servers ms ON ms.id = ue.server_id
       WHERE ue.created_at BETWEEN $1 AND $2 ${publisherFilter}
       GROUP BY ms.publisher_id`,
      [pStart, pEnd],
    );

    const upserted: string[] = [];
    for (const row of earnings) {
      const gross = parseFloat(row.gross);
      const net = parseFloat(row.publisher_share);
      const fee = gross - net;
      if (net <= 0) continue;
      await sql.unsafe(
        `INSERT INTO publisher_payouts (publisher_id, period_start, period_end, gross_earned_usd, platform_fee_usd, net_payout_usd)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (publisher_id, period_start) DO UPDATE
           SET gross_earned_usd = EXCLUDED.gross_earned_usd,
               platform_fee_usd = EXCLUDED.platform_fee_usd,
               net_payout_usd   = EXCLUDED.net_payout_usd`,
        [row.publisher_id, pStart, pEnd, gross.toFixed(4), fee.toFixed(4), net.toFixed(4)],
      );
      upserted.push(row.publisher_id);
    }

    return c.json({ success: true, period_start: pStart, period_end: pEnd, publishers_processed: upserted.length });
  } finally { await sql.end().catch(() => {}); }
});

export { router as mcpRegistryRouter };
