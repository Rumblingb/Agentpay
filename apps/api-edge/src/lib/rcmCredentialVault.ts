/**
 * RCM Credential Vault
 *
 * Provides secure storage and retrieval of payer portal credentials for
 * autonomous portal connector fallback paths.
 *
 * Encryption: AES-256-GCM via Web Crypto API (edge-compatible).
 * Key management: env.RCM_VAULT_ENCRYPTION_KEY (32-byte hex, Workers Secret).
 *
 * Database: rcm_credential_vault table (migration 002_rcm_credential_vault.sql)
 */

import type { Env } from '../types';
import { createDb } from './db';

// ─── Types ────────────────────────────────────────────────────────────────────

export type CredentialType =
  | 'payer_portal'  // Web portal login (username + password)
  | 'dde'           // Direct Data Entry system
  | 'x12_edi'       // X12 EDI clearinghouse credentials
  | 'api_key';      // REST API key

export interface VaultCredential {
  id: string;
  workspaceId: string;
  credentialType: CredentialType;
  payerName: string;
  payerId: string | null;
  portalUrl: string | null;
  /** Encrypted credential blob — AES-256-GCM, iv prepended, base64 encoded. */
  encryptedPayload: string;
  /** Additional unencrypted metadata (login URL, selector hints, etc.) */
  meta: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  rotatedAt: string | null;
  expiresAt: string | null;
}

export interface PlaintextCredential {
  username?: string;
  password?: string;
  apiKey?: string;
  clientId?: string;
  clientSecret?: string;
  submitterId?: string;
  /** Any extra payer-specific fields */
  [key: string]: unknown;
}

// ─── Pure crypto helpers ──────────────────────────────────────────────────────

export function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export async function deriveKey(keyHex: string): Promise<CryptoKey> {
  const keyBytes = hexToBytes(keyHex);
  return crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function encryptPayload(keyHex: string, plaintext: string): Promise<string> {
  const key = await deriveKey(keyHex);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
  const combined = new Uint8Array(12 + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), 12);
  return btoa(String.fromCharCode(...combined));
}

export async function decryptPayload(keyHex: string, blob: string): Promise<string> {
  const key = await deriveKey(keyHex);
  const combined = Uint8Array.from(atob(blob), c => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return new TextDecoder().decode(decrypted);
}

// ─── Store ────────────────────────────────────────────────────────────────────

export async function storeCredential(
  env: Env,
  params: {
    workspaceId: string;
    credentialType: CredentialType;
    payerName: string;
    payerId?: string;
    portalUrl?: string;
    plaintextData: PlaintextCredential;
    meta?: Record<string, unknown>;
    expiresAt?: string;
  },
): Promise<string> {
  const sql = createDb(env);
  try {
    const id = crypto.randomUUID();
    const vaultKey = env.RCM_VAULT_ENCRYPTION_KEY;
    let encryptedPayload: string;
    if (vaultKey) {
      encryptedPayload = await encryptPayload(vaultKey, JSON.stringify(params.plaintextData));
    } else {
      console.warn('[rcm-vault] RCM_VAULT_ENCRYPTION_KEY not set — falling back to base64 (not secure)');
      encryptedPayload = btoa(JSON.stringify(params.plaintextData));
    }

    await sql`
      INSERT INTO rcm_credential_vault (
        id,
        workspace_id,
        credential_type,
        payer_name,
        payer_id,
        portal_url,
        encrypted_payload,
        meta,
        created_at,
        updated_at,
        expires_at
      ) VALUES (
        ${id},
        ${params.workspaceId},
        ${params.credentialType},
        ${params.payerName},
        ${params.payerId ?? null},
        ${params.portalUrl ?? null},
        ${encryptedPayload},
        ${JSON.stringify(params.meta ?? {})}::jsonb,
        NOW(),
        NOW(),
        ${params.expiresAt ?? null}
      )
    `;

    return id;
  } finally {
    await sql.end();
  }
}

// ─── Retrieve ─────────────────────────────────────────────────────────────────

export async function retrieveCredential(
  env: Env,
  params: {
    workspaceId: string;
    payerName: string;
    credentialType?: CredentialType;
  },
): Promise<PlaintextCredential | null> {
  const sql = createDb(env);
  try {
    const rows = await sql<Array<{ encryptedPayload: string; expiresAt: string | null }>>`
      SELECT encrypted_payload AS "encryptedPayload", expires_at AS "expiresAt"
      FROM rcm_credential_vault
      WHERE workspace_id = ${params.workspaceId}
        AND payer_name = ${params.payerName}
        ${params.credentialType ? sql`AND credential_type = ${params.credentialType}` : sql``}
        AND (expires_at IS NULL OR expires_at > NOW())
      ORDER BY created_at DESC
      LIMIT 1
    `;

    if (!rows[0]) return null;

    const vaultKey = env.RCM_VAULT_ENCRYPTION_KEY;
    let decryptedText: string;
    if (vaultKey) {
      decryptedText = await decryptPayload(vaultKey, rows[0].encryptedPayload);
    } else {
      decryptedText = atob(rows[0].encryptedPayload);
    }
    return JSON.parse(decryptedText) as PlaintextCredential;
  } catch {
    return null;
  } finally {
    await sql.end();
  }
}

// ─── Rotate ───────────────────────────────────────────────────────────────────

export async function rotateCredential(
  env: Env,
  credentialId: string,
  newPlaintextData: PlaintextCredential,
): Promise<void> {
  const sql = createDb(env);
  try {
    const vaultKey = env.RCM_VAULT_ENCRYPTION_KEY;
    let encryptedPayload: string;
    if (vaultKey) {
      encryptedPayload = await encryptPayload(vaultKey, JSON.stringify(newPlaintextData));
    } else {
      console.warn('[rcm-vault] RCM_VAULT_ENCRYPTION_KEY not set — falling back to base64 (not secure)');
      encryptedPayload = btoa(JSON.stringify(newPlaintextData));
    }

    await sql`
      UPDATE rcm_credential_vault
      SET
        encrypted_payload = ${encryptedPayload},
        rotated_at = NOW(),
        updated_at = NOW()
      WHERE id = ${credentialId}
    `;
  } finally {
    await sql.end();
  }
}

// ─── Revoke ───────────────────────────────────────────────────────────────────

export async function revokeCredential(env: Env, credentialId: string): Promise<void> {
  const sql = createDb(env);
  try {
    await sql`
      UPDATE rcm_credential_vault
      SET expires_at = NOW(), updated_at = NOW()
      WHERE id = ${credentialId}
    `;
  } finally {
    await sql.end();
  }
}

// ─── Access log ───────────────────────────────────────────────────────────────

export async function logCredentialAccess(
  env: Env,
  credentialId: string,
  workspaceId: string,
  accessedBy: string,
  accessReason: string,
  workItemId?: string,
): Promise<void> {
  const sql = createDb(env);
  try {
    await sql`
      INSERT INTO rcm_credential_access_log (
        id,
        credential_id,
        workspace_id,
        accessed_by,
        access_reason,
        work_item_id,
        accessed_at
      ) VALUES (
        ${crypto.randomUUID()},
        ${credentialId},
        ${workspaceId},
        ${accessedBy},
        ${accessReason},
        ${workItemId ?? null},
        NOW()
      )
    `;
  } finally {
    await sql.end();
  }
}

// ─── Check availability ───────────────────────────────────────────────────────

export async function hasCredential(
  env: Env,
  workspaceId: string,
  payerName: string,
  credentialType: CredentialType = 'payer_portal',
): Promise<boolean> {
  const sql = createDb(env);
  try {
    const rows = await sql<Array<{ count: string }>>`
      SELECT COUNT(*)::text AS count
      FROM rcm_credential_vault
      WHERE workspace_id = ${workspaceId}
        AND payer_name = ${payerName}
        AND credential_type = ${credentialType}
        AND (expires_at IS NULL OR expires_at > NOW())
    `;
    return parseInt(rows[0]?.count ?? '0', 10) > 0;
  } finally {
    await sql.end();
  }
}
