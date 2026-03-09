import { v4 as uuidv4, validate as uuidValidate } from 'uuid';
import crypto from 'crypto';
import { promisify } from 'util';
import { query } from '../db/index.js';

const PBKDF2_ITERATIONS = 100000;
const PBKDF2_KEYLEN = 32;
const PBKDF2_DIGEST = 'sha256';

// Async PBKDF2 — avoids blocking the event loop for ~100–300 ms per call.
const pbkdf2Async = promisify(crypto.pbkdf2);

export interface Merchant {
  id: string;
  name: string;
  email: string;
  walletAddress: string;
  webhookUrl?: string | null;
  createdAt: Date;
}

export async function registerMerchant(
  name: string,
  email: string,
  walletAddress: string,
  webhookUrl?: string | null
): Promise<{ merchantId: string; apiKey: string }> {
  const merchantId = uuidv4();
  const apiKey = crypto.randomBytes(32).toString('hex');
  const keyPrefix = apiKey.substring(0, 8);
  const salt = crypto.randomBytes(16).toString('hex');
  const hashBuf = await pbkdf2Async(apiKey, salt, PBKDF2_ITERATIONS, PBKDF2_KEYLEN, PBKDF2_DIGEST);
  const hash = hashBuf.toString('hex');

  try {
    // Parameters: id, name, email, api_key_hash, api_key_salt, key_prefix,
    //             wallet_address, webhook_url, is_active
    await query(
      `INSERT INTO merchants (id, name, email, api_key_hash, api_key_salt, key_prefix, wallet_address, webhook_url, is_active, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
      [merchantId, name, email, hash, salt, keyPrefix, walletAddress, webhookUrl ?? null, true]
    );

    return { merchantId, apiKey };
  } catch (error: any) {
    if (error.code === '23505') {
      throw new Error('Email or wallet address is already registered');
    }
    throw error;
  }
}

/**
 * Typed result returned by authenticateMerchant.
 * The `reason` field pinpoints the exact failure so callers can emit
 * granular log messages without a second DB round-trip.
 */
export type AuthenticateResult =
  | { merchant: Merchant; reason: null }
  | { merchant: null; reason: 'prefix_not_found' | 'hash_mismatch' };

/**
 * Normalise an API key that may arrive in either of two formats:
 *
 *   1. Raw key  – 64-char hex string, e.g.
 *        5f16cbbedd9d2199ad25505f1d07344c8887f652c5bb27db4f572475cc9ec507
 *
 *   2. Prefixed key – {8-char-prefix}_{raw-key}, e.g.
 *        5f16cbbe_5f16cbbedd9d2199ad25505f1d07344c8887f652c5bb27db4f572475cc9ec507
 *
 * For format (2) the PBKDF2 hash stored in the database was derived from
 * just the raw-key portion (everything after the first underscore), so we
 * must strip the prefix before hashing.  The 8-char prefix is still used
 * for the indexed DB lookup either way.
 */
function extractRawKey(apiKey: string): string {
  // Detect "{8-hex-chars}_{rest}" pattern: underscore at position 8, preceded
  // by valid hex chars.  Raw hex keys (0-9a-f only) never contain underscores,
  // so this check is unambiguous.
  // Minimum valid length: 8 (prefix) + 1 (underscore) + 1 (at least one raw-key char) = 10.
  const PREFIX_PLUS_SEPARATOR_LEN = 9; // 8-char hex prefix + 1 underscore
  if (
    apiKey.length > PREFIX_PLUS_SEPARATOR_LEN &&
    apiKey[8] === '_' &&
    /^[0-9a-f]{8}$/i.test(apiKey.substring(0, 8))
  ) {
    return apiKey.slice(PREFIX_PLUS_SEPARATOR_LEN);
  }
  return apiKey;
}

export async function authenticateMerchant(apiKey: string): Promise<AuthenticateResult> {
  if (!apiKey) {
    return { merchant: null, reason: 'prefix_not_found' };
  }
  try {
    // Use key_prefix for efficient indexed lookup instead of scanning all merchants.
    // The key_prefix is always the first 8 characters of whatever is presented,
    // regardless of whether the key is in raw or prefixed format.
    const keyPrefix = apiKey.substring(0, 8);
    const result = await query(
      `SELECT id, name, email, wallet_address as "walletAddress", webhook_url as "webhookUrl",
              created_at as "createdAt", api_key_hash as "apiKeyHash", api_key_salt as "apiKeySalt"
       FROM merchants WHERE key_prefix = $1 AND is_active = true`,
      [keyPrefix]
    );

    if (!result.rows || result.rows.length === 0) {
      return { merchant: null, reason: 'prefix_not_found' };
    }

    // Strip the optional "{prefix}_" portion before hashing so that both
    // raw keys and prefixed keys (e.g. "5f16cbbe_5f16cbbe...") verify
    // correctly against the stored hash.
    const rawKey = extractRawKey(apiKey);

    for (const row of result.rows) {
      const hashBuf = await pbkdf2Async(rawKey, row.apiKeySalt, PBKDF2_ITERATIONS, PBKDF2_KEYLEN, PBKDF2_DIGEST);
      const testHash = hashBuf.toString('hex');

      if (testHash === row.apiKeyHash) {
        return {
          merchant: {
            id: row.id,
            name: row.name,
            email: row.email,
            walletAddress: row.walletAddress,
            webhookUrl: row.webhookUrl ?? null,
            createdAt: row.createdAt,
          },
          reason: null,
        };
      }
    }

    // Prefix was found but no hash matched — key has been rotated or was
    // manually inserted with the wrong algorithm (e.g. SHA-256 instead of PBKDF2).
    return { merchant: null, reason: 'hash_mismatch' };
  } catch (error: any) {
    throw error;
  }
}

export async function getMerchant(merchantId: string): Promise<Merchant | null> {
  if (!merchantId || !uuidValidate(merchantId)) {
    throw new Error('Invalid merchant ID');
  }
  try {
    const result = await query(
      `SELECT id, name, email, wallet_address as "walletAddress", webhook_url as "webhookUrl",
              created_at as "createdAt"
       FROM merchants WHERE id = $1`,
      [merchantId]
    );

    if (!result.rows || result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      id: row.id,
      name: row.name,
      email: row.email,
      walletAddress: row.walletAddress,
      webhookUrl: row.webhookUrl ?? null,
      createdAt: row.createdAt,
    };
  } catch (error: any) {
    throw error;
  }
}

export async function rotateApiKey(merchantId: string): Promise<{ apiKey: string }> {
  if (!merchantId || !uuidValidate(merchantId)) {
    throw new Error('Invalid merchant ID');
  }
  const newApiKey = crypto.randomBytes(32).toString('hex');
  const newKeyPrefix = newApiKey.substring(0, 8);
  const newSalt = crypto.randomBytes(16).toString('hex');
  const newHashBuf = await pbkdf2Async(newApiKey, newSalt, PBKDF2_ITERATIONS, PBKDF2_KEYLEN, PBKDF2_DIGEST);
  const newHash = newHashBuf.toString('hex');

  const result = await query(
    `UPDATE merchants
     SET api_key_hash = $1, api_key_salt = $2, key_prefix = $3, updated_at = NOW()
     WHERE id = $4 AND is_active = true`,
    [newHash, newSalt, newKeyPrefix, merchantId]
  );

  if (!result.rowCount || result.rowCount === 0) {
    throw new Error('Merchant not found or inactive');
  }

  return { apiKey: newApiKey };
}

export default {
  registerMerchant,
  authenticateMerchant,
  getMerchant,
  rotateApiKey,
};
