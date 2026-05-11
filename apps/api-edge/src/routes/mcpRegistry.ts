/**
 * MCP Registry — /api/registry/*
 *
 * Agent-first MCP server marketplace. Agents discover, subscribe, and publish
 * MCP servers entirely via tool calls. No web UI required.
 *
 * Revenue: 70% publisher / 30% AgentPay on per-call billing.
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { authenticateApiKey } from '../middleware/auth';
import { createDb } from '../lib/db';
import { generateTotpSecret, verifyTotpCode, buildOtpAuthUri, encryptTotpSecret, decryptTotpSecret } from '../lib/totp';

const router = new Hono<{ Bindings: Env; Variables: Variables }>();

const AGENTPAY_ISSUER = 'AgentPay';
const PUBLISHER_REVENUE_SHARE = 0.70;

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

type HonoContext = Parameters<Parameters<typeof router.post>[1]>[0];

async function requireTotp(
  c: HonoContext,
  sql: ReturnType<typeof createDb>,
  agentId: string,
  totpCode: string | null | undefined,
): Promise<{ ok: true } | { ok: false; response: Response }> {
  const enrollment = await getTotpEnrollment(sql, agentId);
  if (!enrollment) {
    return { ok: false, response: c.json({ error: 'TOTP_SETUP_REQUIRED', message: 'Enroll TOTP first: POST /api/registry/totp/enroll with your API key.' }, 403) as Response };
  }
  if (!enrollment.confirmed_at) {
    return { ok: false, response: c.json({ error: 'TOTP_NOT_CONFIRMED', message: 'Confirm TOTP enrollment: POST /api/registry/totp/confirm with { "totp_code": "123456" }' }, 403) as Response };
  }
  if (!totpCode) {
    return { ok: false, response: c.json({ error: 'TOTP_CODE_REQUIRED', message: 'Include totp_code (6 digits from your authenticator app).' }, 401) as Response };
  }
  const encKey = (c.env as Record<string, string>).TOTP_ENCRYPTION_KEY;
  if (!encKey) throw new Error('TOTP_ENCRYPTION_KEY not configured');
  const secret = await decryptTotpSecret(enrollment.secret_enc, encKey);
  if (!await verifyTotpCode(secret, totpCode)) {
    return { ok: false, response: c.json({ error: 'TOTP_INVALID', message: 'Invalid or expired TOTP code.' }, 401) as Response };
  }
  return { ok: true };
}

// ── GET /api/registry/servers ─────────────────────────────────────────────────

router.get('/servers', async (c) => {
  const { q, category, limit = '20', offset = '0', featured } = c.req.query();
  const limitN = Math.min(parseInt(limit, 10) || 20, 100);
  const offsetN = Math.max(parseInt(offset, 10) || 0, 0);
  const sql = createDb(c.env);
  try {
    const conditions: string[] = ["status = 'active'"];
    const params: unknown[] = [];
    if (q) {
      params.push(`%${q.toLowerCase()}%`);
      conditions.push(`(LOWER(name) LIKE $${params.length} OR LOWER(description) LIKE $${params.length} OR LOWER(category) LIKE $${params.length})`);
    }
    if (category) { params.push(category.toLowerCase()); conditions.push(`LOWER(category) = $${params.length}`); }
    if (featured === 'true') conditions.push('featured = true');
    params.push(limitN, offsetN);
    const rows = await sql.unsafe<Array<{
      id: string; slug: string; name: string; description: string | null; category: string | null;
      pricing_model: string; price_per_call_usd: string | null; price_monthly_usd: string | null;
      free_tier_calls: number; verified: boolean; featured: boolean; install_count: number;
    }>>(
      `SELECT id, slug, name, description, category, pricing_model, price_per_call_usd, price_monthly_usd,
              free_tier_calls, verified, featured, install_count
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
      endpoint_url: string; publisher_id: string; pricing_model: string;
      price_per_call_usd: string | null; price_monthly_usd: string | null;
      free_tier_calls: number; status: string; verified: boolean; featured: boolean;
      install_count: number; domain_verified: boolean; metadata: unknown; created_at: Date;
    }>>(
      `SELECT id, slug, name, description, category, endpoint_url, publisher_id,
              pricing_model, price_per_call_usd, price_monthly_usd, free_tier_calls,
              status, verified, featured, install_count, domain_verified, metadata, created_at
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

  const { name, description, category, endpoint_url, pricing_model = 'free',
          price_per_call_usd, price_monthly_usd, free_tier_calls = 100, metadata = {}, totp_code } = body;

  if (typeof name !== 'string' || name.trim().length < 2)
    return c.json({ error: 'VALIDATION', message: 'name required (min 2 chars)' }, 400);
  if (typeof endpoint_url !== 'string' || !endpoint_url.startsWith('https://'))
    return c.json({ error: 'VALIDATION', message: 'endpoint_url must start with https://' }, 400);

  const sql = createDb(c.env);
  try {
    const totpCheck = await requireTotp(c, sql, merchant.id, totp_code as string | null);
    if (!totpCheck.ok) return totpCheck.response;

    const serverSlug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
    const verificationToken = await sha256Hex(`${serverSlug}-${merchant.id}-${Date.now()}`);

    const result = await sql.unsafe<Array<{ id: string; slug: string; verification_token: string }>>(
      `INSERT INTO mcp_servers
         (slug, name, description, category, endpoint_url, publisher_id, pricing_model,
          price_per_call_usd, price_monthly_usd, free_tier_calls, status, metadata, verification_token)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending',$11,$12)
       ON CONFLICT (slug) DO UPDATE SET updated_at = now()
       RETURNING id, slug, verification_token`,
      [serverSlug, name.trim(), description ?? null, category ?? null, endpoint_url, merchant.id,
       pricing_model, price_per_call_usd ?? null, price_monthly_usd ?? null,
       free_tier_calls, JSON.stringify(metadata), verificationToken],
    );
    const row = result[0];
    if (!row) return c.json({ error: 'INSERT_FAILED' }, 500);

    return c.json({
      success: true, server_id: row.id, slug: row.slug, status: 'pending',
      next_steps: {
        domain_verification: {
          method_1_dns_txt: {
            record: '_agentpay-verify',
            value: row.verification_token,
            instructions: `Add DNS TXT record: _agentpay-verify.yourdomain.com = "${row.verification_token}"`,
          },
          method_2_well_known: {
            path: '/.well-known/agentpay-publisher.json',
            content: JSON.stringify({ token: row.verification_token }),
          },
          verify_endpoint: `POST /api/registry/servers/${row.slug}/verify`,
        },
        listing_fee: pricing_model !== 'free'
          ? { required: true, amount_usd: 9, note: 'Paid servers require a one-time $9 listing fee.' }
          : { required: false },
      },
    }, 201);
  } finally { await sql.end().catch(() => {}); }
});

// ── POST /api/registry/servers/:slug/verify — domain ownership ───────────────

router.post('/servers/:slug/verify', authenticateApiKey, async (c) => {
  const merchant = c.get('merchant');
  const sql = createDb(c.env);
  try {
    const rows = await sql.unsafe<Array<{
      id: string; endpoint_url: string; publisher_id: string; verification_token: string;
    }>>(
      `SELECT id, endpoint_url, publisher_id, verification_token
       FROM mcp_servers WHERE slug = $1 AND status = 'pending' LIMIT 1`,
      [c.req.param('slug')],
    );
    const server = rows[0];
    if (!server) return c.json({ error: 'NOT_FOUND', message: 'Server not found or already active.' }, 404);
    if (server.publisher_id !== merchant.id) return c.json({ error: 'FORBIDDEN' }, 403);

    let verified = false;
    let method = '';

    // Try /.well-known/agentpay-publisher.json
    try {
      const url = new URL('/.well-known/agentpay-publisher.json', server.endpoint_url);
      const resp = await fetch(url.toString(), { signal: AbortSignal.timeout(5000) });
      if (resp.ok) {
        const json = await resp.json() as { token?: string };
        if (json.token === server.verification_token) { verified = true; method = 'well_known'; }
      }
    } catch { /* try DNS */ }

    // Try DNS TXT via Cloudflare DoH
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

    if (!verified) return c.json({ error: 'VERIFICATION_FAILED', message: 'Token not found. Check placement and try again.' }, 422);

    await sql.unsafe(
      `UPDATE mcp_servers SET domain_verified = true, status = 'active', updated_at = now() WHERE id = $1`,
      [server.id],
    );
    return c.json({ success: true, message: `Verified via ${method}. Server is now active.`, status: 'active' });
  } finally { await sql.end().catch(() => {}); }
});

// ── GET /api/registry/servers/:slug/config ────────────────────────────────────

router.get('/servers/:slug/config', authenticateApiKey, async (c) => {
  const merchant = c.get('merchant');
  const serverSlug = c.req.param('slug');
  const sql = createDb(c.env);
  try {
    const sub = await sql.unsafe<Array<{ id: string }>>(
      `SELECT s.id FROM mcp_subscriptions s JOIN mcp_servers ms ON ms.id = s.server_id
       WHERE ms.slug = $1 AND s.agent_id = $2 AND s.status = 'active' LIMIT 1`,
      [serverSlug, merchant.id],
    );
    if (!sub[0]) return c.json({ error: 'NOT_SUBSCRIBED', message: 'Subscribe to this server first.' }, 403);

    const rows = await sql.unsafe<Array<{ name: string; endpoint_url: string; pricing_model: string }>>(
      `SELECT name, endpoint_url, pricing_model FROM mcp_servers WHERE slug = $1 LIMIT 1`,
      [serverSlug],
    );
    const server = rows[0];
    if (!server) return c.json({ error: 'NOT_FOUND' }, 404);

    return c.json({
      success: true, name: server.name,
      harness_configs: {
        claude_code: {
          file: '~/.claude/settings.json or .mcp.json',
          config: { mcpServers: { [serverSlug]: { type: 'http', url: server.endpoint_url } } },
        },
        codex: {
          file: '~/.codex/config.toml',
          config: `[mcp_servers.${serverSlug}]\nurl = "${server.endpoint_url}"`,
        },
        cursor: {
          file: '.cursor/mcp.json',
          config: { mcpServers: { [serverSlug]: { url: server.endpoint_url, transport: 'http' } } },
        },
        generic_http: { url: server.endpoint_url, transport: 'streamable-http' },
      },
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
      pricing_model: string; plan: string; calls_used: number; started_at: Date;
    }>>(
      `SELECT s.id, ms.slug, ms.name, ms.category, ms.pricing_model, s.plan, s.calls_used, s.started_at
       FROM mcp_subscriptions s JOIN mcp_servers ms ON ms.id = s.server_id
       WHERE s.agent_id = $1 AND s.status = 'active' ORDER BY s.started_at DESC`,
      [merchant.id],
    );
    return c.json({ success: true, subscriptions: rows });
  } finally { await sql.end().catch(() => {}); }
});

// ── POST /api/registry/subscriptions — subscribe ─────────────────────────────

router.post('/subscriptions', authenticateApiKey, async (c) => {
  const merchant = c.get('merchant');
  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return c.json({ error: 'INVALID_BODY' }, 400);
  const { server_slug, totp_code } = body;
  if (typeof server_slug !== 'string') return c.json({ error: 'VALIDATION', message: 'server_slug required' }, 400);

  const sql = createDb(c.env);
  try {
    const totpCheck = await requireTotp(c, sql, merchant.id, totp_code as string | null);
    if (!totpCheck.ok) return totpCheck.response;

    const rows = await sql.unsafe<Array<{
      id: string; name: string; pricing_model: string;
      price_monthly_usd: string | null; free_tier_calls: number;
    }>>(
      `SELECT id, name, pricing_model, price_monthly_usd, free_tier_calls
       FROM mcp_servers WHERE slug = $1 AND status = 'active' LIMIT 1`,
      [server_slug],
    );
    const server = rows[0];
    if (!server) return c.json({ error: 'NOT_FOUND', message: `Server "${server_slug}" not found` }, 404);

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

    if (server.pricing_model !== 'free' && server.price_monthly_usd) {
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
      [c.req.param('id'), merchant.id],
    );
    return c.json({ success: true });
  } finally { await sql.end().catch(() => {}); }
});

// ── POST /api/registry/totp/enroll ───────────────────────────────────────────

router.post('/totp/enroll', authenticateApiKey, async (c) => {
  const merchant = c.get('merchant');
  const encKey = (c.env as Record<string, string>).TOTP_ENCRYPTION_KEY;
  if (!encKey) return c.json({ error: 'TOTP_NOT_CONFIGURED' }, 503);

  const sql = createDb(c.env);
  try {
    const existing = await getTotpEnrollment(sql, merchant.id);
    if (existing?.confirmed_at) return c.json({ error: 'ALREADY_ENROLLED' }, 409);

    const secret = generateTotpSecret();
    const secretEnc = await encryptTotpSecret(secret, encKey);
    const accountName = (merchant as Record<string, string>).email ?? merchant.id;
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
      message: 'Scan the QR in Google Authenticator or Authy. Then confirm with your first 6-digit code.',
      otpauth_uri: otpauthUri,
      setup_key: setupKey,
      setup_url: setupUrl,
      next_step: 'POST /api/registry/totp/confirm with { "totp_code": "123456" }',
    });
  } finally { await sql.end().catch(() => {}); }
});

// ── POST /api/registry/totp/confirm ──────────────────────────────────────────

router.post('/totp/confirm', authenticateApiKey, async (c) => {
  const merchant = c.get('merchant');
  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  const code = typeof body?.totp_code === 'string' ? body.totp_code : null;
  if (!code) return c.json({ error: 'TOTP_CODE_REQUIRED', message: 'Provide totp_code.' }, 400);

  const encKey = (c.env as Record<string, string>).TOTP_ENCRYPTION_KEY;
  if (!encKey) return c.json({ error: 'TOTP_NOT_CONFIGURED' }, 503);

  const sql = createDb(c.env);
  try {
    const enrollment = await getTotpEnrollment(sql, merchant.id);
    if (!enrollment) return c.json({ error: 'NOT_ENROLLED', message: 'Start with POST /api/registry/totp/enroll' }, 404);
    if (enrollment.confirmed_at) return c.json({ error: 'ALREADY_CONFIRMED' }, 409);

    const secret = await decryptTotpSecret(enrollment.secret_enc, encKey);
    if (!await verifyTotpCode(secret, code)) {
      return c.json({ error: 'TOTP_INVALID', message: 'Code incorrect or expired. Check clock and retry.' }, 401);
    }
    await sql.unsafe(`UPDATE totp_enrollments SET confirmed_at = now() WHERE agent_id = $1`, [merchant.id]);
    return c.json({ success: true, message: 'TOTP confirmed. Pass totp_code in all registry actions.' });
  } finally { await sql.end().catch(() => {}); }
});

// ── GET /api/registry/totp/setup — browser QR setup page ─────────────────────

router.get('/totp/setup', async (c) => {
  const uri = c.req.query('uri');
  if (!uri) return c.text('Missing uri', 400);
  const decoded = decodeURIComponent(uri);
  if (!decoded.startsWith('otpauth://')) return c.text('Invalid URI', 400);

  const escaped = decoded.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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
    .key{font-family:monospace;font-size:13px;background:#f1f5f9;border-radius:8px;padding:10px 14px;word-break:break-all;margin-top:12px;}
    .note{font-size:12px;color:#64748b;margin-top:16px;}
  </style>
</head>
<body><div class="card">
  <h1>Scan with Authenticator</h1>
  <p>Open Google Authenticator, Authy, or any TOTP app and scan this QR.</p>
  <div id="qr"></div>
  <p class="note">Or enter the key manually:</p>
  <div class="key" id="key"></div>
  <p class="note">After scanning, confirm in your agent: POST /api/registry/totp/confirm</p>
</div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js" integrity="sha512-CNgIRecGo7nphbeZ04Sc13ka07paqdeTu0WR1IM4kNcpmBAUSHSE1FNjHe5liRFgNNbNbwl1LcZ/QCZxiALtg==" crossorigin="anonymous"></script>
<script>
  var uri = decodeURIComponent("${encodeURIComponent(decoded)}");
  new QRCode(document.getElementById("qr"),{text:uri,width:220,height:220,colorDark:"#0f172a",colorLight:"#ffffff",correctLevel:QRCode.CorrectLevel.M});
  var m=uri.match(/secret=([A-Z2-7]+)/);
  if(m)document.getElementById("key").textContent=m[1].match(/.{1,4}/g).join(" ");
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
      slug: string; name: string; install_count: number;
      total_calls: string; total_billed: string; publisher_earnings: string;
    }>>(
      `SELECT ms.slug, ms.name, ms.install_count,
              COUNT(ue.id)::text              AS total_calls,
              COALESCE(SUM(ue.billed_amount_usd),0)::text   AS total_billed,
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

export { router as mcpRegistryRouter };
