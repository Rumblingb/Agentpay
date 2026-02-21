import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import { query } from '../db/index';

const PBKDF2_ITERATIONS = 100000;
const PBKDF2_KEYLEN = 32;
const PBKDF2_DIGEST = 'sha256';

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
  const hash = crypto
    .pbkdf2Sync(apiKey, salt, PBKDF2_ITERATIONS, PBKDF2_KEYLEN, PBKDF2_DIGEST)
    .toString('hex');

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

export async function authenticateMerchant(apiKey: string): Promise<Merchant | null> {
  try {
    // Use key_prefix for efficient indexed lookup instead of scanning all merchants
    const keyPrefix = apiKey.substring(0, 8);
    const result = await query(
      `SELECT id, name, email, wallet_address as "walletAddress", webhook_url as "webhookUrl",
              created_at as "createdAt", api_key_hash as "apiKeyHash", api_key_salt as "apiKeySalt"
       FROM merchants WHERE key_prefix = $1 AND is_active = true`,
      [keyPrefix]
    );

    if (!result.rows || result.rows.length === 0) {
      return null;
    }

    for (const row of result.rows) {
      const testHash = crypto
        .pbkdf2Sync(apiKey, row.apiKeySalt, PBKDF2_ITERATIONS, PBKDF2_KEYLEN, PBKDF2_DIGEST)
        .toString('hex');

      if (testHash === row.apiKeyHash) {
        return {
          id: row.id,
          name: row.name,
          email: row.email,
          walletAddress: row.walletAddress,
          webhookUrl: row.webhookUrl ?? null,
          createdAt: row.createdAt,
        };
      }
    }

    return null;
  } catch (error: any) {
    throw error;
  }
}

export async function getMerchant(merchantId: string): Promise<Merchant | null> {
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
  const newApiKey = crypto.randomBytes(32).toString('hex');
  const newKeyPrefix = newApiKey.substring(0, 8);
  const newSalt = crypto.randomBytes(16).toString('hex');
  const newHash = crypto
    .pbkdf2Sync(newApiKey, newSalt, PBKDF2_ITERATIONS, PBKDF2_KEYLEN, PBKDF2_DIGEST)
    .toString('hex');

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
