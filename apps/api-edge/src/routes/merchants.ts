/**
 * Merchant/account routes — /api/merchants/*
 *
 * Ports src/routes/merchants.ts to Hono/Workers.
 *
 * Changes from Express:
 *   - No Joi / no express-rate-limit (Node.js packages) — inline validation
 *   - No service imports (services use Node.js-specific crypto/db) — SQL inline
 *   - Hono Context: c.get('merchant') instead of req.merchant
 *   - DB via createDb(c.env) — postgres.js tagged template literals
 *   - Random bytes via crypto.getRandomValues (Web Crypto API)
 *   - PBKDF2 via pbkdf2Hex (SubtleCrypto, same params as Express)
 *
 * Preserved:
 *   - All route paths and HTTP methods
 *   - All request/response shapes (fields, status codes)
 *   - Ownership checks (403 vs 404)
 *   - Key rotation generates a fresh PBKDF2 hash with a new salt
 *
 * Deferred (complex Solana + billing + webhook dispatch):
 *   - POST /api/merchants/payments/:id/verify
 *     (requires blockchain verification — deferred to a later phase)
 */

import { Hono, type Context } from 'hono';
import type { Env, Variables } from '../types';
import { authenticateApiKey } from '../middleware/auth';
import { createDb } from '../lib/db';
import { pbkdf2Hex } from '../lib/pbkdf2';
import { hmacSign, hmacVerify } from '../lib/hmac';

const router = new Hono<{ Bindings: Env; Variables: Variables }>();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Generate `bytes` random bytes as a lowercase hex string. */
function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Basic email format check — mirrors Joi.string().email() pattern. */
function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

/** Basic URI syntax check — mirrors Joi.string().uri(). */
function isValidUri(s: string): boolean {
  try {
    new URL(s);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Wallet ownership helpers (Hole #5)
// ---------------------------------------------------------------------------
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/** Decode a base-58 string (used for Solana pubkeys and signatures) to Uint8Array. */
function decodeBase58(str: string): Uint8Array {
  let num = 0n;
  for (const ch of str) {
    const idx = BASE58_ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error(`Invalid base58 character: ${ch}`);
    num = num * 58n + BigInt(idx);
  }
  const bytes: number[] = [];
  while (num > 0n) {
    bytes.unshift(Number(num & 0xffn));
    num >>= 8n;
  }
  for (const ch of str) {
    if (ch === '1') bytes.unshift(0);
    else break;
  }
  return new Uint8Array(bytes);
}

/**
 * Build a stateless, time-limited wallet challenge token.
 * Format: "apw:v1:{merchantId}:{expiresAt}:{nonce}:{hmac}"
 * The HMAC covers all fields except itself (prevents forgery).
 * TTL: 5 minutes.
 */
async function buildWalletChallenge(merchantId: string, signingSecret: string): Promise<{ challenge: string; expiresAt: number }> {
  const nonce = randomHex(16);
  const expiresAt = Math.floor(Date.now() / 1000) + 300; // 5-minute window
  const payload = `apw:v1:${merchantId}:${expiresAt}:${nonce}`;
  const mac = await hmacSign(payload, signingSecret);
  return { challenge: `${payload}:${mac}`, expiresAt };
}

/**
 * Verify a wallet challenge + ed25519 signature.
 * Returns an error string, or null if valid.
 *
 * The client wallet must sign the challenge string as raw UTF-8 bytes
 * (e.g. Phantom: wallet.signMessage(new TextEncoder().encode(challenge))).
 * The signature is transmitted as lowercase hex (128 chars = 64 bytes).
 */
async function verifyWalletOwnership(
  challenge: string,
  signatureHex: string,
  walletAddress: string,
  merchantId: string,
  signingSecret: string,
): Promise<string | null> {
  // 1. Parse challenge parts
  const parts = challenge.split(':');
  if (parts.length !== 6 || parts[0] !== 'apw' || parts[1] !== 'v1') {
    return 'Invalid challenge format';
  }
  const [, , cMerchantId, cExpiresAtStr, cNonce, cMac] = parts;

  // 2. Check merchant binding (prevents replay across merchants)
  if (cMerchantId !== merchantId) return 'Challenge was not issued for this merchant';

  // 3. Check expiry
  const expiresAt = parseInt(cExpiresAtStr, 10);
  if (isNaN(expiresAt) || Math.floor(Date.now() / 1000) > expiresAt) {
    return 'Challenge has expired — request a new one';
  }

  // 4. Verify server-issued HMAC (prevent forged challenges)
  const payload = `apw:v1:${cMerchantId}:${cExpiresAtStr}:${cNonce}`;
  const macValid = await hmacVerify(payload, cMac, signingSecret);
  if (!macValid) return 'Invalid challenge token';

  // 5. Verify ed25519 signature — prove wallet private key control
  if (!/^[0-9a-f]{128}$/i.test(signatureHex)) {
    return 'Signature must be 128 hex chars (64-byte ed25519 signature)';
  }
  try {
    const pubKeyBytes = decodeBase58(walletAddress);
    if (pubKeyBytes.length !== 32) return 'Invalid wallet address length';

    const sigBytes = new Uint8Array(
      (signatureHex.match(/.{2}/g) as string[]).map((h) => parseInt(h, 16)),
    );
    const challengeBytes = new TextEncoder().encode(challenge);

    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      pubKeyBytes,
      'Ed25519',
      false,
      ['verify'],
    );
    const valid = await crypto.subtle.verify('Ed25519', cryptoKey, sigBytes, challengeBytes);
    if (!valid) return 'Signature does not match wallet address — ownership not proven';
  } catch (err) {
    return `Signature verification error: ${err instanceof Error ? err.message : String(err)}`;
  }

  return null; // all checks passed
}

/** UUID v4 format check — mirrors uuid validate(). */
function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}

interface ResendEmailPayload {
  from: string;
  to: string[];
  subject: string;
  html: string;
}

interface EmailDeliveryResult {
  status: 'sent' | 'failed' | 'not_configured';
  provider: 'resend';
  providerMessageId?: string;
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function truncateForLog(value: string, max = 300): string {
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

async function sendResendEmail(
  env: Env,
  operation: string,
  payload: ResendEmailPayload,
): Promise<EmailDeliveryResult> {
  if (!env.RESEND_API_KEY) {
    console.warn(`[merchants] ${operation}: RESEND_API_KEY not set; email not sent`);
    return { status: 'not_configured', provider: 'resend' };
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
      },
      body: JSON.stringify(payload),
    });

    const text = await response.text();
    const parsed = parseJsonObject(text);
    const providerMessageId = typeof parsed?.id === 'string' ? parsed.id : undefined;

    if (!response.ok) {
      console.error(`[merchants] ${operation}: Resend rejected email`, {
        status: response.status,
        body: truncateForLog(text),
        recipients: payload.to,
      });
      return { status: 'failed', provider: 'resend' };
    }

    console.info(`[merchants] ${operation}: Resend accepted email`, {
      status: response.status,
      providerMessageId,
      recipients: payload.to,
    });
    return { status: 'sent', provider: 'resend', providerMessageId };
  } catch (err) {
    console.error(
      `[merchants] ${operation}: Resend request failed`,
      err instanceof Error ? err.message : err,
    );
    return { status: 'failed', provider: 'resend' };
  }
}

function scheduleBackgroundTask(
  c: Context<{ Bindings: Env; Variables: Variables }>,
  task: Promise<unknown>,
): void {
  const executionCtx = c.executionCtx;
  if (executionCtx && typeof executionCtx.waitUntil === 'function') {
    executionCtx.waitUntil(task);
    return;
  }
  void task;
}

// ---------------------------------------------------------------------------
// POST /api/merchants/register
// Public — no auth required.
// Mirrors src/routes/merchants.ts POST /register exactly.
// ---------------------------------------------------------------------------

router.post('/register', async (c) => {
  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const { name, email, walletAddress, webhookUrl } = body as Record<string, string | undefined>;

  // Validation
  if (!name || typeof name !== 'string' || name.length < 3 || name.length > 255) {
    return c.json({ error: 'Validation error', details: ['"name" must be 3–255 characters'] }, 400);
  }
  if (!email || !isValidEmail(email)) {
    return c.json({ error: 'Validation error', details: ['"email" must be a valid email'] }, 400);
  }
  // walletAddress is optional — only validate format when provided
  if (walletAddress !== undefined && walletAddress !== null &&
      (typeof walletAddress !== 'string' || walletAddress.length < 32 || walletAddress.length > 44)) {
    return c.json({ error: 'Validation error', details: ['"walletAddress" must be a valid Solana address (32–44 characters)'] }, 400);
  }
  if (webhookUrl !== undefined && webhookUrl !== null && !isValidUri(webhookUrl as string)) {
    return c.json({ error: 'Validation error', details: ['"webhookUrl" must be a valid URI'] }, 400);
  }

  const normalizedName = name.trim();
  const normalizedEmail = email.trim().toLowerCase();
  const resolvedWalletAddress = (typeof walletAddress === 'string' && walletAddress.trim()) ? walletAddress.trim() : null;

  const sql = createDb(c.env);
  try {
    const existingMerchant = await sql<Array<{ id: string }>>`
      SELECT id
      FROM merchants
      WHERE LOWER(email) = ${normalizedEmail}
      LIMIT 1
    `;

    if (existingMerchant.length) {
      return c.json({ error: 'Email or wallet address is already registered' }, 400);
    }

    const merchantId = crypto.randomUUID();
    const apiKey = randomHex(32);          // 64-char hex, matches Node.js randomBytes(32).toString('hex')
    const keyPrefix = apiKey.substring(0, 8);
    const salt = randomHex(16);            // 32-char hex salt
    const hash = await pbkdf2Hex(apiKey, salt);

    await sql`
      INSERT INTO merchants (id, name, email, api_key_hash, api_key_salt, key_prefix,
                             wallet_address, webhook_url, is_active, created_at)
      VALUES (${merchantId}, ${normalizedName}, ${normalizedEmail}, ${hash}, ${salt}, ${keyPrefix},
              ${resolvedWalletAddress}, ${webhookUrl ?? null}, true, NOW())
    `;

    console.info('[merchants] registered', { merchantId, email: normalizedEmail });

    const emailDelivery = await sendResendEmail(c.env, 'register', {
      from: 'AgentPay <notifications@agentpay.so>',
      to: [normalizedEmail],
      subject: 'Your AgentPay API key',
      html: `<!doctype html><html><body style="margin:0;padding:32px;background:#f8fafc;font-family:system-ui,sans-serif;color:#0f172a;">
        <div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:32px;">
          <h1 style="margin:0 0 8px;font-size:22px;font-weight:800;letter-spacing:-0.5px;">Welcome to AgentPay</h1>
          <p style="margin:0 0 20px;color:#475569;line-height:1.6;">Here is your API key, ${normalizedName}. Keep it secret — it will not be shown again.</p>
          <div style="background:#0f172a;border-radius:12px;padding:20px;margin-bottom:24px;">
            <p style="margin:0 0 6px;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;">API Key</p>
            <code style="font-family:monospace;font-size:13px;color:#4ade80;word-break:break-all;">${apiKey}</code>
          </div>
          <p style="margin:0 0 8px;font-size:13px;color:#475569;">Your merchant ID: <code style="font-family:monospace;background:#f1f5f9;padding:2px 6px;border-radius:4px;">${merchantId}</code></p>
          <p style="margin:16px 0 0;font-size:13px;color:#64748b;">Add this to your MCP server config as <code style="font-family:monospace;">AGENTPAY_API_KEY</code>. If you lose this key, use the account recovery flow to get a new one.</p>
        </div>
      </body></html>`,
    });

    if (emailDelivery.status !== 'sent') {
      return c.json({
        success: true,
        merchantId,
        apiKey,
        message: 'Email delivery is unavailable right now, so your API key is returned directly. Store it securely — it will not be shown again.',
        emailDelivery,
      }, 201);
    }

    return c.json({
      success: true,
      merchantId,
      message: `Your API key has been sent to ${normalizedEmail}. Check your inbox.`,
      emailDelivery,
    }, 201);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    // Duplicate email or wallet address (Postgres unique constraint)
    if (msg.includes('23505') || msg.includes('unique')) {
      return c.json({ error: 'Email or wallet address is already registered' }, 400);
    }
    console.error('[merchants] register error:', msg);
    return c.json({ error: msg }, 400);
  } finally {
    sql.end().catch(() => {});
  }
});

// ---------------------------------------------------------------------------
// GET /api/merchants/profile  &  GET /api/merchants/me
// Auth required.
// Returns the authenticated merchant's profile.
// ---------------------------------------------------------------------------

async function handleGetProfile(c: Context<{ Bindings: Env; Variables: Variables }>) {
  const merchant = c.get('merchant');
  const sql = createDb(c.env);
  try {
    const rows = await sql<
      Array<{
        id: string;
        name: string;
        email: string;
        walletAddress: string;
        webhookUrl: string | null;
        createdAt: Date;
      }>
    >`
      SELECT id, name, email,
             wallet_address AS "walletAddress",
             webhook_url    AS "webhookUrl",
             created_at     AS "createdAt"
      FROM merchants
      WHERE id = ${merchant.id}
    `;

    if (!rows.length) {
      // Fallback: return auth-middleware data (covers test-mode bypass)
      return c.json({
        id: merchant.id,
        name: merchant.name ?? null,
        email: merchant.email,
        walletAddress: merchant.walletAddress ?? null,
        webhookUrl: merchant.webhookUrl ?? null,
        createdAt: null,
      });
    }

    const row = rows[0];
    return c.json({
      id: row.id,
      name: row.name,
      email: row.email,
      walletAddress: row.walletAddress,
      webhookUrl: row.webhookUrl,
      createdAt: row.createdAt,
    });
  } catch (err: unknown) {
    console.error('[merchants] profile error:', err instanceof Error ? err.message : err);
    return c.json({ error: 'Failed to fetch profile' }, 500);
  } finally {
    sql.end().catch(() => {});
  }
}

router.get('/profile', authenticateApiKey, handleGetProfile);
router.get('/me', authenticateApiKey, handleGetProfile);

// ---------------------------------------------------------------------------
// GET /api/merchants/webhooks
// Auth required. Returns webhook event history (last 50).
// ---------------------------------------------------------------------------

router.get('/webhooks', authenticateApiKey, async (c) => {
  const merchant = c.get('merchant');
  const sql = createDb(c.env);
  try {
    const events = await sql`
      SELECT id, event_type, status, payload, created_at
      FROM webhook_events
      WHERE merchant_id = ${merchant.id}
      ORDER BY created_at DESC
      LIMIT 50
    `;
    return c.json({ success: true, events });
  } catch (err: unknown) {
    console.error('[merchants] webhooks error:', err instanceof Error ? err.message : err);
    return c.json({ error: 'Failed to fetch webhook history' }, 500);
  } finally {
    sql.end().catch(() => {});
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/merchants/profile/webhook
// Auth required. Updates the merchant's outgoing webhook URL.
// ---------------------------------------------------------------------------

router.patch('/profile/webhook', authenticateApiKey, async (c) => {
  const merchant = c.get('merchant');
  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const { webhookUrl } = body;

  // Allow null to clear the webhook URL; otherwise validate URI
  if (webhookUrl !== null && webhookUrl !== undefined) {
    if (typeof webhookUrl !== 'string' || !isValidUri(webhookUrl)) {
      return c.json({ error: '"webhookUrl" must be a valid URI or null' }, 400);
    }
  }

  const sql = createDb(c.env);
  try {
    await sql`
      UPDATE merchants
      SET webhook_url = ${(webhookUrl as string | null) ?? null}, updated_at = NOW()
      WHERE id = ${merchant.id}
    `;
    return c.json({ success: true, message: 'Webhook URL updated' });
  } catch (err: unknown) {
    console.error('[merchants] webhook update error:', err instanceof Error ? err.message : err);
    return c.json({ error: 'Failed to update webhook URL' }, 500);
  } finally {
    sql.end().catch(() => {});
  }
});

// ---------------------------------------------------------------------------
// GET /api/merchants/stats
// Auth required. Returns aggregate payment statistics.
// Mirrors getMerchantStats() from src/services/transactions.ts.
// ---------------------------------------------------------------------------

router.get('/stats', authenticateApiKey, async (c) => {
  const merchant = c.get('merchant');
  const sql = createDb(c.env);
  try {
    const rows = await sql<
      Array<{
        totalCount: string;
        confirmedCount: string;
        pendingCount: string;
        failedCount: string;
        totalConfirmedUsdc: string;
      }>
    >`
      SELECT
        COUNT(*)                                                             AS "totalCount",
        SUM(CASE WHEN status IN ('confirmed','released') THEN 1 ELSE 0 END) AS "confirmedCount",
        SUM(CASE WHEN status = 'pending'  THEN 1 ELSE 0 END)               AS "pendingCount",
        SUM(CASE WHEN status = 'failed'   THEN 1 ELSE 0 END)               AS "failedCount",
        SUM(CASE WHEN status IN ('confirmed','released') THEN amount_usdc ELSE 0 END)
                                                                             AS "totalConfirmedUsdc"
      FROM transactions
      WHERE merchant_id = ${merchant.id}
    `;

    const row = rows[0];
    return c.json({
      success: true,
      totalTransactions: parseInt(row?.totalCount ?? '0') || 0,
      confirmedCount: parseInt(row?.confirmedCount ?? '0') || 0,
      pendingCount: parseInt(row?.pendingCount ?? '0') || 0,
      failedCount: parseInt(row?.failedCount ?? '0') || 0,
      totalConfirmedUsdc: parseFloat(row?.totalConfirmedUsdc ?? '0') || 0,
    });
  } catch (err: unknown) {
    console.error('[merchants] stats error:', err instanceof Error ? err.message : err);
    return c.json({ error: 'Failed to fetch stats' }, 500);
  } finally {
    sql.end().catch(() => {});
  }
});

// ---------------------------------------------------------------------------
// GET /api/merchants/payments
// Auth required. Returns paginated transaction list + stats.
// Mirrors getMerchantTransactions() from src/services/transactions.ts.
// ---------------------------------------------------------------------------

router.get('/payments', authenticateApiKey, async (c) => {
  const merchant = c.get('merchant');
  const limitParam = parseInt(c.req.query('limit') ?? '50', 10);
  const offsetParam = parseInt(c.req.query('offset') ?? '0', 10);
  const limit = Math.min(isNaN(limitParam) ? 50 : limitParam, 100);
  const offset = isNaN(offsetParam) ? 0 : offsetParam;

  const sql = createDb(c.env);
  try {
    const [transactions, statsRows] = await Promise.all([
      sql<
        Array<{
          id: string;
          merchantId: string;
          paymentId: string;
          amountUsdc: number;
          recipientAddress: string;
          payerAddress: string | null;
          transactionHash: string | null;
          status: string;
          confirmationDepth: number;
          requiredDepth: number;
          expiresAt: Date;
          createdAt: Date;
        }>
      >`
        SELECT id,
               merchant_id        AS "merchantId",
               payment_id         AS "paymentId",
               amount_usdc        AS "amountUsdc",
               recipient_address  AS "recipientAddress",
               payer_address      AS "payerAddress",
               transaction_hash   AS "transactionHash",
               status,
               confirmation_depth AS "confirmationDepth",
               required_depth     AS "requiredDepth",
               expires_at         AS "expiresAt",
               created_at         AS "createdAt"
        FROM transactions
        WHERE merchant_id = ${merchant.id}
        ORDER BY created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `,
      sql<
        Array<{
          totalCount: string;
          confirmedCount: string;
          pendingCount: string;
          failedCount: string;
          totalConfirmedUsdc: string;
        }>
      >`
        SELECT
          COUNT(*)                                                             AS "totalCount",
          SUM(CASE WHEN status IN ('confirmed','released') THEN 1 ELSE 0 END) AS "confirmedCount",
          SUM(CASE WHEN status = 'pending'  THEN 1 ELSE 0 END)               AS "pendingCount",
          SUM(CASE WHEN status = 'failed'   THEN 1 ELSE 0 END)               AS "failedCount",
          SUM(CASE WHEN status IN ('confirmed','released') THEN amount_usdc ELSE 0 END)
                                                                               AS "totalConfirmedUsdc"
        FROM transactions
        WHERE merchant_id = ${merchant.id}
      `,
    ]);

    const sr = statsRows[0];
    return c.json({
      success: true,
      transactions,
      stats: {
        totalTransactions: parseInt(sr?.totalCount ?? '0') || 0,
        confirmedCount: parseInt(sr?.confirmedCount ?? '0') || 0,
        pendingCount: parseInt(sr?.pendingCount ?? '0') || 0,
        failedCount: parseInt(sr?.failedCount ?? '0') || 0,
        totalConfirmedUsdc: parseFloat(sr?.totalConfirmedUsdc ?? '0') || 0,
      },
      pagination: { limit, offset },
    });
  } catch (err: unknown) {
    console.error('[merchants] payments list error:', err instanceof Error ? err.message : err);
    return c.json({ error: 'Failed to fetch payments' }, 500);
  } finally {
    sql.end().catch(() => {});
  }
});

// ---------------------------------------------------------------------------
// GET /api/merchants/payments/:transactionId
// Auth required. Returns a single transaction (403 on ownership mismatch).
// ---------------------------------------------------------------------------

router.get('/payments/:transactionId', authenticateApiKey, async (c) => {
  const merchant = c.get('merchant');
  const { transactionId } = c.req.param();

  if (!isUuid(transactionId)) {
    return c.json({ error: 'Invalid transaction ID' }, 400);
  }

  const sql = createDb(c.env);
  try {
    const rows = await sql<
      Array<{
        id: string;
        merchantId: string;
        paymentId: string;
        amountUsdc: number;
        recipientAddress: string;
        payerAddress: string | null;
        transactionHash: string | null;
        status: string;
        confirmationDepth: number;
        requiredDepth: number;
        expiresAt: Date;
        createdAt: Date;
      }>
    >`
      SELECT id,
             merchant_id        AS "merchantId",
             payment_id         AS "paymentId",
             amount_usdc        AS "amountUsdc",
             recipient_address  AS "recipientAddress",
             payer_address      AS "payerAddress",
             transaction_hash   AS "transactionHash",
             status,
             confirmation_depth AS "confirmationDepth",
             required_depth     AS "requiredDepth",
             expires_at         AS "expiresAt",
             created_at         AS "createdAt"
      FROM transactions
      WHERE id = ${transactionId}
    `;

    if (!rows.length) {
      return c.json({ error: 'Transaction not found' }, 404);
    }

    const tx = rows[0];
    if (tx.merchantId !== merchant.id) {
      console.warn('[security] unauthorized transaction access', {
        transactionId,
        requestingMerchant: merchant.id,
      });
      return c.json({ error: 'Unauthorized access to this transaction' }, 403);
    }

    return c.json(tx);
  } catch (err: unknown) {
    console.error('[merchants] get transaction error:', err instanceof Error ? err.message : err);
    return c.json({ error: 'Failed to fetch transaction' }, 500);
  } finally {
    sql.end().catch(() => {});
  }
});

// ---------------------------------------------------------------------------
// POST /api/merchants/payments
// Auth required. Creates a new payment request (pending transaction).
// Mirrors createPaymentRequest() from src/services/transactions.ts.
// ---------------------------------------------------------------------------

router.post('/payments', authenticateApiKey, async (c) => {
  const merchant = c.get('merchant');
  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const { amountUsdc, recipientAddress, agentId, protocol, metadata, expiryMinutes } =
    body as Record<string, unknown>;

  // Validation — mirrors paymentSchema (Joi) from Express route
  if (typeof amountUsdc !== 'number' || amountUsdc <= 0) {
    return c.json({ error: 'Validation error', details: ['"amountUsdc" must be a positive number'] }, 400);
  }
  if (typeof recipientAddress !== 'string' || recipientAddress.length < 32 || recipientAddress.length > 44) {
    return c.json({ error: 'Validation error', details: ['"recipientAddress" must be 32–44 characters'] }, 400);
  }
  if (agentId !== undefined && !isUuid(agentId as string)) {
    return c.json({ error: 'Validation error', details: ['"agentId" must be a valid UUID'] }, 400);
  }
  const validProtocols = ['solana', 'x402', 'ap2', 'acp'];
  if (protocol !== undefined && !validProtocols.includes(protocol as string)) {
    return c.json({ error: 'Validation error', details: [`"protocol" must be one of: ${validProtocols.join(', ')}`] }, 400);
  }
  const expiry = typeof expiryMinutes === 'number' ? expiryMinutes : 30;
  if (expiry < 1 || expiry > 1440) {
    return c.json({ error: 'Validation error', details: ['"expiryMinutes" must be between 1 and 1440'] }, 400);
  }

  const transactionId = crypto.randomUUID();
  const paymentId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + expiry * 60 * 1000);

  const sql = createDb(c.env);
  try {
    await sql`
      INSERT INTO transactions
        (id, merchant_id, payment_id, amount_usdc, recipient_address,
         status, confirmation_depth, required_depth, expires_at, created_at)
      VALUES
        (${transactionId}, ${merchant.id}, ${paymentId}, ${amountUsdc},
         ${recipientAddress as string}, 'pending', 0, 2, ${expiresAt}, NOW())
    `;

    console.info('[merchants] payment created', { transactionId, paymentId, merchantId: merchant.id });

    return c.json(
      {
        success: true,
        transactionId,
        paymentId,
        amount: amountUsdc,
        recipientAddress,
        instructions: 'Send USDC to the recipient address within the expiry time',
      },
      201,
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[merchants] payment create error:', msg);
    return c.json({ error: msg }, 400);
  } finally {
    sql.end().catch(() => {});
  }
});

// ---------------------------------------------------------------------------
// GET /api/merchants/profile/wallet/challenge
// Auth required. Issues a time-limited ownership challenge for PATCH /profile/wallet.
//
// Flow:
//   1. Merchant calls this endpoint to get a challenge string.
//   2. Merchant wallet signs the challenge bytes (UTF-8) with their private key.
//   3. Merchant calls PATCH /profile/wallet with { walletAddress, challenge, signature }.
//
// Challenge TTL: 5 minutes. Stateless — no DB round-trip needed.
// ---------------------------------------------------------------------------

router.get('/profile/wallet/challenge', authenticateApiKey, async (c) => {
  const merchant = c.get('merchant');
  const signingSecret = c.env.AGENTPAY_SIGNING_SECRET;
  if (!signingSecret) {
    return c.json({ error: 'Server configuration error' }, 500);
  }

  const { challenge, expiresAt } = await buildWalletChallenge(merchant.id, signingSecret);
  return c.json({
    challenge,
    expiresAt,
    instructions: 'Sign this challenge string (as UTF-8 bytes) with your Solana wallet, then send the hex-encoded signature to PATCH /api/merchants/profile/wallet',
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/merchants/profile/wallet
// Auth required. Updates the merchant's Solana wallet address.
//
// Requires ownership proof: the new wallet address must have signed the
// challenge issued by GET /api/merchants/profile/wallet/challenge.
//
// Body: { walletAddress, challenge, signature }
//   walletAddress — target Solana wallet (base58, 32–44 chars)
//   challenge     — opaque token from GET /profile/wallet/challenge
//   signature     — ed25519 signature of challenge bytes, hex-encoded (128 chars)
// ---------------------------------------------------------------------------

router.patch('/profile/wallet', authenticateApiKey, async (c) => {
  const merchant = c.get('merchant');
  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const { walletAddress, challenge, signature } = body;

  if (
    !walletAddress ||
    typeof walletAddress !== 'string' ||
    walletAddress.length < 32 ||
    walletAddress.length > 44
  ) {
    return c.json(
      { error: '"walletAddress" must be a valid Solana address (32–44 characters)' },
      400,
    );
  }

  if (!challenge || typeof challenge !== 'string') {
    return c.json(
      { error: '"challenge" is required — call GET /api/merchants/profile/wallet/challenge first' },
      400,
    );
  }

  if (!signature || typeof signature !== 'string') {
    return c.json(
      { error: '"signature" is required — sign the challenge with your wallet private key (hex-encoded)' },
      400,
    );
  }

  const signingSecret = c.env.AGENTPAY_SIGNING_SECRET;
  if (!signingSecret) {
    return c.json({ error: 'Server configuration error' }, 500);
  }

  // Verify challenge authenticity + ed25519 wallet ownership
  const ownershipError = await verifyWalletOwnership(challenge, signature, walletAddress, merchant.id, signingSecret);
  if (ownershipError) {
    console.warn('[merchants] wallet update ownership check failed', { merchantId: merchant.id, reason: ownershipError });
    return c.json({ error: ownershipError }, 403);
  }

  const sql = createDb(c.env);
  try {
    await sql`
      UPDATE merchants
      SET wallet_address = ${walletAddress},
          updated_at     = NOW()
      WHERE id = ${merchant.id}
    `;

    console.info('[merchants] wallet updated with ownership proof', { merchantId: merchant.id, walletAddress });
    return c.json({ success: true, walletAddress, message: 'Wallet address updated' });
  } catch (err: unknown) {
    console.error('[merchants] wallet update error:', err instanceof Error ? err.message : err);
    return c.json({ error: 'Failed to update wallet address' }, 500);
  } finally {
    sql.end().catch(() => {});
  }
});

// ---------------------------------------------------------------------------
// POST /api/merchants/rotate-key
// Auth required. Generates a new API key, re-hashes, updates DB.
// Mirrors rotateApiKey() from src/services/merchants.ts.
// Note: Express applies a 10-req/hour rate limiter here.
//       In Workers, rate limiting is done at the Cloudflare zone level.
// ---------------------------------------------------------------------------

router.post('/rotate-key', authenticateApiKey, async (c) => {
  const merchant = c.get('merchant');
  const newApiKey = randomHex(32);
  const newKeyPrefix = newApiKey.substring(0, 8);
  const newSalt = randomHex(16);
  const newHash = await pbkdf2Hex(newApiKey, newSalt);

  const sql = createDb(c.env);
  try {
    const result = await sql<Array<{ id: string }>>`
      UPDATE merchants
      SET api_key_hash = ${newHash},
          api_key_salt = ${newSalt},
          key_prefix   = ${newKeyPrefix},
          updated_at   = NOW()
      WHERE id = ${merchant.id}
        AND is_active = true
      RETURNING id
    `;

    // result.length is reliable because RETURNING ensures the array is non-empty
    // only when at least one row was updated.
    if (!result.length) {
      return c.json({ error: 'Merchant not found or inactive' }, 500);
    }

    return c.json({
      success: true,
      apiKey: newApiKey,
      message: 'Please store this key securely.',
    });
  } catch (err: unknown) {
    console.error('[merchants] rotate-key error:', err instanceof Error ? err.message : err);
    return c.json({ error: 'Failed to rotate API key' }, 500);
  } finally {
    sql.end().catch(() => {});
  }
});

// ---------------------------------------------------------------------------
// POST /api/merchants/payments/:transactionId/verify
// DEFERRED — requires Solana blockchain verification, certificate signing,
// billing service, and webhook dispatch. These will be added in later phases
// (Phase 9 for certificates, Phase 10 for webhooks).
// ---------------------------------------------------------------------------

router.post('/payments/:transactionId/verify', authenticateApiKey, (c) => {
  return new Response(
    JSON.stringify({ status: "beta" }),
    { status: 200 }
  );
});

// ---------------------------------------------------------------------------
// POST /api/merchants/recover/request
// Unauthenticated. Initiates API key recovery for a locked-out merchant.
//
// Body: { email }
//
// Generates a time-limited, single-effective-use recovery token bound to:
//   - the merchant's current key state (keyHashSnippet)
//   - a 15-minute expiry
//   - an HMAC preventing forgery
//
// Security: always returns a generic success message whether or not the
// email is found, to prevent account enumeration.
// ---------------------------------------------------------------------------

router.post('/recover/request', async (c) => {
  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const { email } = body;
  if (!email || typeof email !== 'string' || !isValidEmail(email)) {
    return c.json({ error: '"email" must be a valid email address' }, 400);
  }
  const normalizedEmail = email.trim().toLowerCase();

  const signingSecret = c.env.AGENTPAY_SIGNING_SECRET;
  if (!signingSecret) return c.json({ error: 'Server configuration error' }, 500);

  const GENERIC_RESPONSE = {
    success: true,
    message: 'If an account with that email exists, recovery instructions have been sent.',
  };

  const sql = createDb(c.env);
  try {
    const rows = await sql<Array<{ id: string; apiKeyHash: string }>>`
      SELECT id, api_key_hash AS "apiKeyHash"
      FROM merchants
      WHERE LOWER(email) = ${normalizedEmail} AND is_active = true
      LIMIT 1
    `;

    if (!rows.length) {
      // Perform dummy HMAC work to equalize timing (prevent enumeration via timing)
      await hmacSign('dummy:v1:noop', signingSecret);
      return c.json(GENERIC_RESPONSE);
    }

    const { id: merchantId, apiKeyHash } = rows[0];
    const keySnippet = (apiKeyHash ?? '').slice(0, 16); // first 16 chars — invalidated on rotation
    const nonce = randomHex(12);
    const expiresAt = Math.floor(Date.now() / 1000) + 900; // 15-minute window
    const payload = `rec:v1:${merchantId}:${keySnippet}:${expiresAt}:${nonce}`;
    const mac = await hmacSign(payload, signingSecret);
    const recoveryToken = `${payload}:${mac}`;

    console.info('[merchants] recovery token issued', { merchantId, email: normalizedEmail, expiresAt });

    const encodedEmail = encodeURIComponent(normalizedEmail);
    const encodedToken = encodeURIComponent(recoveryToken);
    const recoveryUrl = `https://app.agentpay.so/rcm-login?email=${encodedEmail}&token=${encodedToken}`;
    scheduleBackgroundTask(c, sendResendEmail(c.env, 'recover/request', {
      from: 'Ace Billing <notifications@agentpay.so>',
      to: [normalizedEmail],
      subject: 'Recover access to Ace Billing',
      html: `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;background:#000;font-family:Inter,system-ui,sans-serif;color:#f8fafc;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#000;padding:40px 20px;">
  <tr><td align="center">
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;">
      <tr><td style="padding-bottom:24px;">
        <table cellpadding="0" cellspacing="0"><tr>
          <td style="width:32px;height:32px;border-radius:8px;background:linear-gradient(135deg,#10b981,#059669);text-align:center;vertical-align:middle;">
            <span style="font-size:16px;color:#000;">&#x2666;</span>
          </td>
          <td style="padding-left:10px;font-size:17px;font-weight:700;letter-spacing:-0.03em;color:#f8fafc;">Ace</td>
        </tr></table>
      </td></tr>
      <tr><td style="padding-bottom:12px;">
        <h1 style="margin:0;font-size:26px;font-weight:800;letter-spacing:-0.03em;color:#f8fafc;">Recover access to Ace Billing</h1>
      </td></tr>
      <tr><td style="padding-bottom:24px;">
        <p style="margin:0;font-size:15px;color:#94a3b8;line-height:1.6;">Click the button below to recover access. This link expires in 15 minutes.</p>
      </td></tr>
      <tr><td style="padding-bottom:32px;">
        <a href="${recoveryUrl}" style="display:inline-block;background:#4ade80;color:#000;font-size:14px;font-weight:700;text-decoration:none;padding:13px 24px;border-radius:12px;letter-spacing:-0.01em;">Recover access &rarr;</a>
      </td></tr>
      <tr><td>
        <p style="margin:0;font-size:12px;color:#334155;line-height:1.5;">If you didn&rsquo;t request this, ignore this email.</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`,
    }));

    return c.json(GENERIC_RESPONSE);
  } catch (err: unknown) {
    console.error('[merchants] recover/request error:', err instanceof Error ? err.message : err);
    return c.json(GENERIC_RESPONSE); // never reveal internal errors
  } finally {
    sql.end().catch(() => {});
  }
});

// ---------------------------------------------------------------------------
// POST /api/merchants/recover/confirm
// Unauthenticated. Completes key recovery using a token from /recover/request.
//
// Body: { email, recoveryToken }
//
// On success: rotates the API key and returns the new key.
// The token is effectively single-use: key rotation changes keyHashSnippet,
// invalidating any previously issued token for that account.
// ---------------------------------------------------------------------------

router.post('/recover/confirm', async (c) => {
  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const { email, recoveryToken } = body;
  if (!email || typeof email !== 'string' || !isValidEmail(email)) {
    return c.json({ error: '"email" must be a valid email address' }, 400);
  }
  if (!recoveryToken || typeof recoveryToken !== 'string') {
    return c.json({ error: '"recoveryToken" is required' }, 400);
  }

  const signingSecret = c.env.AGENTPAY_SIGNING_SECRET;
  if (!signingSecret) return c.json({ error: 'Server configuration error' }, 500);

  // Parse token: rec:v1:{merchantId}:{keySnippet}:{expiresAt}:{nonce}:{mac}
  const parts = recoveryToken.split(':');
  if (parts.length !== 7 || parts[0] !== 'rec' || parts[1] !== 'v1') {
    return c.json({ error: 'Invalid recovery token format' }, 400);
  }
  const [, , tokenMerchantId, tokenKeySnippet, tokenExpiresAtStr, tokenNonce, tokenMac] = parts;

  // Check expiry
  const expiresAt = parseInt(tokenExpiresAtStr, 10);
  if (isNaN(expiresAt) || Math.floor(Date.now() / 1000) > expiresAt) {
    return c.json({ error: 'Recovery token has expired — request a new one' }, 400);
  }

  // Verify HMAC (prevents forged tokens)
  const payload = `rec:v1:${tokenMerchantId}:${tokenKeySnippet}:${tokenExpiresAtStr}:${tokenNonce}`;
  const macValid = await hmacVerify(payload, tokenMac, signingSecret);
  if (!macValid) {
    return c.json({ error: 'Invalid recovery token' }, 400);
  }

  const sql = createDb(c.env);
  try {
    // Look up merchant — must match both merchantId and email (double bind)
    const rows = await sql<Array<{ id: string; apiKeyHash: string }>>`
      SELECT id, api_key_hash AS "apiKeyHash"
      FROM merchants
      WHERE id = ${tokenMerchantId}::uuid
        AND LOWER(email) = ${email.trim().toLowerCase()}
        AND is_active = true
      LIMIT 1
    `;

    if (!rows.length) {
      return c.json({ error: 'Recovery token does not match this account' }, 403);
    }

    const { apiKeyHash } = rows[0];

    // Verify token was issued for the current key state (single-effective-use)
    const currentSnippet = (apiKeyHash ?? '').slice(0, 16);
    if (currentSnippet !== tokenKeySnippet) {
      return c.json({ error: 'Recovery token has already been used or key was already rotated' }, 409);
    }

    // Rotate API key
    const newApiKey = randomHex(32);
    const newKeyPrefix = newApiKey.substring(0, 8);
    const newSalt = randomHex(16);
    const newHash = await pbkdf2Hex(newApiKey, newSalt);

    await sql`
      UPDATE merchants
      SET api_key_hash = ${newHash},
          api_key_salt = ${newSalt},
          key_prefix   = ${newKeyPrefix},
          updated_at   = NOW()
      WHERE id = ${tokenMerchantId}::uuid AND is_active = true
    `;

    console.info('[merchants] key recovered via recovery token', { merchantId: tokenMerchantId });
    return c.json({
      success: true,
      apiKey: newApiKey,
      message: 'API key recovered successfully. Store this key securely — it will not be shown again.',
    });
  } catch (err: unknown) {
    console.error('[merchants] recover/confirm error:', err instanceof Error ? err.message : err);
    return c.json({ error: 'Recovery failed — please try again' }, 500);
  } finally {
    sql.end().catch(() => {});
  }
});

export { router as merchantsRouter };
