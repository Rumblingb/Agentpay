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

/** UUID v4 format check — mirrors uuid validate(). */
function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
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

  // Validation — mirrors registerSchema (Joi) from Express route
  if (!name || typeof name !== 'string' || name.length < 3 || name.length > 255) {
    return c.json({ error: 'Validation error', details: ['"name" must be 3–255 characters'] }, 400);
  }
  if (!email || !isValidEmail(email)) {
    return c.json({ error: 'Validation error', details: ['"email" must be a valid email'] }, 400);
  }
  if (!walletAddress || walletAddress.length < 32 || walletAddress.length > 44) {
    return c.json({ error: 'Validation error', details: ['"walletAddress" must be 32–44 characters'] }, 400);
  }
  if (webhookUrl !== undefined && webhookUrl !== null && !isValidUri(webhookUrl as string)) {
    return c.json({ error: 'Validation error', details: ['"webhookUrl" must be a valid URI'] }, 400);
  }

  const sql = createDb(c.env);
  try {
    const merchantId = crypto.randomUUID();
    const apiKey = randomHex(32);          // 64-char hex, matches Node.js randomBytes(32).toString('hex')
    const keyPrefix = apiKey.substring(0, 8);
    const salt = randomHex(16);            // 32-char hex salt
    const hash = await pbkdf2Hex(apiKey, salt);

    await sql`
      INSERT INTO merchants (id, name, email, api_key_hash, api_key_salt, key_prefix,
                             wallet_address, webhook_url, is_active, created_at)
      VALUES (${merchantId}, ${name}, ${email}, ${hash}, ${salt}, ${keyPrefix},
              ${walletAddress}, ${webhookUrl ?? null}, true, NOW())
    `;

    console.info('[merchants] registered', { merchantId, email });

    return c.json(
      {
        success: true,
        merchantId,
        apiKey,
        message: 'Store your API key securely. You will not be able to view it again.',
      },
      201,
    );
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
    const result = await sql`
      UPDATE merchants
      SET api_key_hash = ${newHash},
          api_key_salt = ${newSalt},
          key_prefix   = ${newKeyPrefix},
          updated_at   = NOW()
      WHERE id = ${merchant.id}
        AND is_active = true
    `;

    if (!result.count) {
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
  return c.json(
    {
      error: 'NOT_YET_MIGRATED',
      message: 'This endpoint is not yet available on the Workers backend. Use the Render backend.',
    },
    501,
  );
});

export { router as merchantsRouter };
