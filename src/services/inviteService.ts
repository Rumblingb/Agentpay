/**
 * Merchant Invite Service
 *
 * Implements an invite code system for merchant onboarding.
 * Existing merchants can generate invite codes to refer new merchants.
 * Invite codes track usage and can have expiry dates and usage limits.
 */

import crypto from 'crypto';
import { query } from '../db/index';
import { logger } from '../logger';

// ── Types ──────────────────────────────────────────────────────────────────

export interface InviteCode {
  id: string;
  code: string;
  merchantId: string;
  maxUses: number;
  currentUses: number;
  expiresAt: Date | null;
  active: boolean;
  createdAt: Date;
}

export interface InviteValidation {
  valid: boolean;
  code?: string;
  referrerMerchantId?: string;
  reason?: string;
}

// ── Schema Bootstrap ───────────────────────────────────────────────────────

export async function ensureInviteCodesTable(): Promise<void> {
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS merchant_invite_codes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        code VARCHAR(32) UNIQUE NOT NULL,
        merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
        max_uses INT NOT NULL DEFAULT 10,
        current_uses INT NOT NULL DEFAULT 0,
        expires_at TIMESTAMP,
        active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_invite_codes_code ON merchant_invite_codes(code);
      CREATE INDEX IF NOT EXISTS idx_invite_codes_merchant ON merchant_invite_codes(merchant_id);
    `);
  } catch (err) {
    logger.error('Failed to bootstrap merchant_invite_codes table', { err });
  }
}

// ── Core Functions ─────────────────────────────────────────────────────────

/**
 * Generates a new invite code for a merchant.
 */
export async function generateInviteCode(
  merchantId: string,
  maxUses = 10,
  expiresInDays?: number,
): Promise<InviteCode> {
  const code = `AP_${crypto.randomBytes(8).toString('hex').toUpperCase()}`;
  const expiresAt = expiresInDays
    ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
    : null;

  const result = await query(
    `INSERT INTO merchant_invite_codes (code, merchant_id, max_uses, expires_at)
     VALUES ($1, $2, $3, $4)
     RETURNING id, code, merchant_id as "merchantId", max_uses as "maxUses",
               current_uses as "currentUses", expires_at as "expiresAt",
               active, created_at as "createdAt"`,
    [code, merchantId, maxUses, expiresAt],
  );

  logger.info('Invite code generated', { merchantId, code });
  return result.rows[0];
}

/**
 * Validates and consumes an invite code during merchant registration.
 */
export async function validateAndConsumeInvite(code: string): Promise<InviteValidation> {
  const result = await query(
    `SELECT id, code, merchant_id as "merchantId", max_uses, current_uses,
            expires_at, active
     FROM merchant_invite_codes
     WHERE code = $1`,
    [code],
  );

  if (result.rows.length === 0) {
    return { valid: false, reason: 'Invalid invite code' };
  }

  const invite = result.rows[0];

  if (!invite.active) {
    return { valid: false, reason: 'Invite code is no longer active' };
  }

  if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
    return { valid: false, reason: 'Invite code has expired' };
  }

  if (invite.current_uses >= invite.max_uses) {
    return { valid: false, reason: 'Invite code has reached its usage limit' };
  }

  // Increment usage
  await query(
    `UPDATE merchant_invite_codes SET current_uses = current_uses + 1 WHERE id = $1`,
    [invite.id],
  );

  return {
    valid: true,
    code: invite.code,
    referrerMerchantId: invite.merchantId,
  };
}

/**
 * Lists all invite codes for a merchant.
 */
export async function getMerchantInviteCodes(merchantId: string): Promise<InviteCode[]> {
  const result = await query(
    `SELECT id, code, merchant_id as "merchantId", max_uses as "maxUses",
            current_uses as "currentUses", expires_at as "expiresAt",
            active, created_at as "createdAt"
     FROM merchant_invite_codes
     WHERE merchant_id = $1
     ORDER BY created_at DESC`,
    [merchantId],
  );
  return result.rows;
}

/**
 * Deactivates an invite code.
 */
export async function deactivateInviteCode(
  codeId: string,
  merchantId: string,
): Promise<boolean> {
  const result = await query(
    `UPDATE merchant_invite_codes SET active = false WHERE id = $1 AND merchant_id = $2`,
    [codeId, merchantId],
  );
  return (result.rowCount ?? 0) > 0;
}

export default {
  ensureInviteCodesTable,
  generateInviteCode,
  validateAndConsumeInvite,
  getMerchantInviteCodes,
  deactivateInviteCode,
};
