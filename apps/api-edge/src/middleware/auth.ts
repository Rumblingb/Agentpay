/**
 * API key authentication middleware for the AgentPay Workers API.
 *
 * Ports src/middleware/auth.ts to Hono/Workers with these changes:
 *   1. No process.env — reads AGENTPAY_TEST_MODE from Hono c.env.
 *   2. No pino logger — uses console.warn / console.error.
 *   3. No req.merchant — uses Hono's typed c.set('merchant', ...) / c.get().
 *   4. PBKDF2 via SubtleCrypto (pbkdf2Hex) instead of Node.js crypto.pbkdf2.
 *   5. Direct SQL via postgres.js (createDb) instead of Express service import.
 *
 * Preserved from src/middleware/auth.ts:
 *   - Same header extraction logic (Authorization: Bearer, x-api-key, raw)
 *   - Same test-mode bypass with sk_test_sim / sk_test_sim_12345
 *   - Same 401 response shape (code, message, help)
 *   - Same prefix-based DB lookup (key_prefix column)
 *   - Same prefixed-key format detection (8-char-prefix_rawkey)
 *   - Same PBKDF2 parameters (100k iterations, SHA-256, 32-byte key)
 *
 * Hono context variable:
 *   Route handlers access the authenticated merchant via c.get('merchant').
 *   The type is declared in src/types.ts (Variables.merchant).
 */

import type { Context, Next } from 'hono';
import type { Env, Variables } from '../types';
import { pbkdf2Hex } from '../lib/pbkdf2';
import { createDb } from '../lib/db';
import { isMcpAccessToken, verifyMcpAccessToken } from '../lib/mcpAccessTokens';
import { buildMcpWwwAuthenticateHeader } from '../lib/mcpOAuth';

// ---------------------------------------------------------------------------
// Key format helpers — mirrors src/services/merchants.ts exactly
// ---------------------------------------------------------------------------

/**
 * Normalise an API key that may arrive in either format:
 *   1. Raw key  — 64-char hex string
 *   2. Prefixed — {8-hex-prefix}_{raw-key}
 *
 * For format (2) the PBKDF2 hash in the DB was derived from just the raw-key
 * portion (after the underscore), so we strip the prefix before hashing.
 */
function extractRawKey(apiKey: string): string {
  const PREFIX_PLUS_SEPARATOR_LEN = 9; // 8 hex chars + 1 underscore
  if (
    apiKey.length > PREFIX_PLUS_SEPARATOR_LEN &&
    apiKey[8] === '_' &&
    /^[0-9a-f]{8}$/i.test(apiKey.substring(0, 8))
  ) {
    return apiKey.slice(PREFIX_PLUS_SEPARATOR_LEN);
  }
  return apiKey;
}

function parsePresentedToken(authHeader?: string | null): string | null {
  if (!authHeader) return null;
  if (authHeader.startsWith('Bearer ')) return authHeader.slice(7);
  if (authHeader.startsWith('Bearer')) return authHeader.slice(6).trim();
  return authHeader;
}

async function authenticateMcpToken(
  c: Context<{ Bindings: Env; Variables: Variables }>,
  token: string,
): Promise<boolean> {
  const signingSecret = c.env.AGENTPAY_SIGNING_SECRET;
  if (!signingSecret) return false;

  const claims = await verifyMcpAccessToken(token, signingSecret);
  if (!claims) return false;

  const testMode = c.env.AGENTPAY_TEST_MODE === 'true';
  if (testMode && claims.sub === '26e7ac4f-017e-4316-bf4f-9a1b37112510') {
    c.set('merchant', {
      id: claims.sub,
      name: 'Test Merchant',
      email: claims.email,
      walletAddress: '9B5X2Fwc4PQHqbXkhmr8vgYKHjgP7V8HBzMgMTf8H',
      webhookUrl: null,
    });
    return true;
  }

  const sql = createDb(c.env);
  try {
    const rows = await sql<Array<{
      id: string;
      name: string;
      email: string;
      walletAddress: string | null;
      webhookUrl: string | null;
      parentMerchantId: string | null;
      keyPrefix: string;
    }>>`
      SELECT id,
             name,
             email,
             wallet_address     AS "walletAddress",
             webhook_url        AS "webhookUrl",
             parent_merchant_id AS "parentMerchantId",
             key_prefix         AS "keyPrefix"
      FROM merchants
      WHERE id = ${claims.sub}
        AND is_active = true
      LIMIT 1
    `;

    const merchant = rows[0];
    if (!merchant || merchant.keyPrefix !== claims.keyPrefix || merchant.email.toLowerCase() !== claims.email.toLowerCase()) {
      return false;
    }

    c.set('merchant', {
      id: merchant.id,
      name: merchant.name,
      email: merchant.email,
      walletAddress: merchant.walletAddress,
      webhookUrl: merchant.webhookUrl ?? null,
      parentMerchantId: merchant.parentMerchantId ?? null,
    });
    c.set('mcpAudience', claims.audience);
    return true;
  } finally {
    sql.end().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

export async function authenticateApiKey(
  c: Context<{ Bindings: Env; Variables: Variables }>,
  next: Next,
): Promise<void | Response> {
  const mcpTransportRequest = c.req.path === '/api/mcp';
  const unauthorizedResponse = (
    body: Record<string, unknown>,
    error = 'invalid_token',
  ) => {
    const response = c.json(body, 401);
    if (mcpTransportRequest) {
      response.headers.set('WWW-Authenticate', buildMcpWwwAuthenticateHeader(c.env.API_BASE_URL, error));
    }
    return response;
  };

  try {
    // 1. Extract header — Authorization (Bearer or raw) or x-api-key
    const authHeader =
      c.req.header('authorization') ?? c.req.header('x-api-key');

    if (!authHeader) {
      console.warn('[auth] missing authorization header');
      return unauthorizedResponse({ code: 'AUTH_MISSING', message: 'Provide a token or API key.' }, 'invalid_token');
    }

    // 2. Strip "Bearer " prefix — mirrors src/middleware/auth.ts exactly
    const apiKey = parsePresentedToken(authHeader);

    // 3. Guard against empty / literal "undefined" strings
    if (!apiKey || apiKey === 'undefined' || apiKey === 'null') {
      console.warn('[auth] empty or literal-undefined API key');
      return unauthorizedResponse({ code: 'AUTH_INVALID', message: 'Invalid API key provided' }, 'invalid_token');
    }

    if (isMcpAccessToken(apiKey)) {
      const authenticated = await authenticateMcpToken(c, apiKey);
      if (!authenticated) {
        return unauthorizedResponse(
          {
            code: 'AUTH_INVALID',
            message: 'Invalid MCP access token',
            help: {
              suggestion: 'Mint a fresh MCP access token and try again.',
              fix: 'Call POST /api/mcp/tokens with a valid AgentPay API key to mint a short-lived remote MCP token.',
            },
          },
          'invalid_token',
        );
      }
      await next();
      return;
    }

    // 4. Test-mode bypass — matches src/middleware/auth.ts TEST_KEYS list.
    //    AGENTPAY_TEST_MODE is a Workers [vars] binding (optional string "true"/"false").
    //    validateEnv() rejects "true" in NODE_ENV=production so this branch is
    //    unreachable in production deployments.
    const testMode = c.env.AGENTPAY_TEST_MODE === 'true';
    const TEST_KEYS = ['sk_test_sim', 'sk_test_sim_12345'];
    if (testMode && TEST_KEYS.includes(apiKey)) {
      console.info('[auth] test-mode bypass');
      c.set('merchant', {
        id: '26e7ac4f-017e-4316-bf4f-9a1b37112510',
        name: 'Test Merchant',
        email: 'test@agentpay.com',
        walletAddress: '9B5X2Fwc4PQHqbXkhmr8vgYKHjgP7V8HBzMgMTf8H',
        webhookUrl: null,
      });
      await next();
      return;
    }

    // 5. DB lookup by key_prefix (indexed) — same query as merchants service
    const keyPrefix = apiKey.substring(0, 8);
    const sql = createDb(c.env);

    let rows: Array<{
      id: string;
      name: string;
      email: string;
      walletAddress: string | null;
      webhookUrl: string | null;
      createdAt: Date;
      apiKeyHash: string;
      apiKeySalt: string;
      parentMerchantId: string | null;
    }>;

    try {
      rows = await sql<typeof rows>`
        SELECT id, name, email,
               wallet_address     AS "walletAddress",
               webhook_url        AS "webhookUrl",
               created_at         AS "createdAt",
               api_key_hash       AS "apiKeyHash",
               api_key_salt       AS "apiKeySalt",
               parent_merchant_id AS "parentMerchantId"
        FROM merchants
        WHERE key_prefix = ${keyPrefix}
          AND is_active = true
      `;
    } finally {
      // Close the connection without blocking the response.
      sql.end().catch(() => {});
    }

    if (!rows.length) {
      console.warn(`[auth] prefix not found: ${keyPrefix}`);
      return unauthorizedResponse(
        {
          code: 'AUTH_INVALID',
          message: 'Invalid API key',
          help: {
            suggestion: 'Check your API key is correct and active.',
            link: 'https://docs.agentpay.gg/authentication',
            fix: 'Generate a new API key at https://dashboard.agentpay.gg/api-keys',
          },
        },
        'invalid_token',
      );
    }

    // 6. PBKDF2 verification — same params as src/services/merchants.ts
    const rawKey = extractRawKey(apiKey);
    for (const row of rows) {
      const testHash = await pbkdf2Hex(rawKey, row.apiKeySalt);
      if (testHash === row.apiKeyHash) {
        c.set('merchant', {
          id: row.id,
          name: row.name,
          email: row.email,
          walletAddress: row.walletAddress,
          webhookUrl: row.webhookUrl ?? null,
          parentMerchantId: row.parentMerchantId ?? null,
        });
        await next();
        return;
      }
    }

    // Hash mismatch — key found but wrong password
    console.warn(`[auth] hash mismatch for prefix ${keyPrefix}`);
    return unauthorizedResponse(
      {
        code: 'AUTH_INVALID',
        message: 'Invalid API key',
        help: {
          suggestion: 'Check your API key is correct and active.',
          link: 'https://docs.agentpay.gg/authentication',
          fix: 'Generate a new API key at https://dashboard.agentpay.gg/api-keys',
        },
      },
      'invalid_token',
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[auth] error:', msg);
    return c.json(
      { code: 'AUTH_ERROR', message: 'Internal server error during authentication' },
      500,
    );
  }
}
