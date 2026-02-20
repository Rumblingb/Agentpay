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
  createdAt: Date;
}

export async function registerMerchant(
  name: string,
  email: string,
  walletAddress: string
): Promise<{ merchantId: string; apiKey: string }> {
  const merchantId = uuidv4();
  const apiKey = crypto.randomBytes(32).toString('hex');
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto
    .pbkdf2Sync(apiKey, salt, PBKDF2_ITERATIONS, PBKDF2_KEYLEN, PBKDF2_DIGEST)
    .toString('hex');

  try {
    await query(
      `INSERT INTO merchants (id, name, email, api_key_hash, api_key_salt, wallet_address, is_active, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
      [merchantId, name, email, hash, salt, walletAddress, true]
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
    const result = await query(
      `SELECT id, name, email, wallet_address as "walletAddress", created_at as "createdAt", 
              api_key_hash as "apiKeyHash", api_key_salt as "apiKeySalt"
       FROM merchants WHERE is_active = true`
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
      `SELECT id, name, email, wallet_address as "walletAddress", created_at as "createdAt"
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
      createdAt: row.createdAt,
    };
  } catch (error: any) {
    throw error;
  }
}

export default {
  registerMerchant,
  authenticateMerchant,
  getMerchant,
};
