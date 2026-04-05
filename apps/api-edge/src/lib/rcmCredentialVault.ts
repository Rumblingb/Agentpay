/**
 * RCM Credential Vault — scaffold
 *
 * Provides secure storage and retrieval of payer portal credentials for
 * autonomous portal connector fallback paths.
 *
 * Status: SCAFFOLD — encryption and full credential lifecycle are TODO.
 *
 * Blocked on:
 *   1. Key management strategy (Workers Secrets vs. external KMS)
 *   2. HIPAA audit logging requirements
 *   3. Payer portal authentication schemes (form-based, SAML, OAuth)
 *
 * Once this is production-ready, the `portal` connector stubs in
 * rcmClaimStatusConnector.ts, rcmEligibilityConnector.ts, and
 * rcmDenialFollowUpConnector.ts can transition from `manual_fallback`
 * to `remote` mode.
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
  /** Encrypted credential blob — AES-GCM, key managed via Workers Secrets. */
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

// ─── Store ────────────────────────────────────────────────────────────────────

/**
 * Store a credential for a payer portal.
 *
 * TODO: Encrypt `plaintextData` with AES-GCM before storing.
 *       Use env.RCM_VAULT_ENCRYPTION_KEY (Workers Secret, 32-byte hex).
 */
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
    // TODO: Replace with real encryption using Web Crypto API + env.RCM_VAULT_ENCRYPTION_KEY
    const encryptedPayload = btoa(JSON.stringify(params.plaintextData)); // NOT SECURE — placeholder only

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

/**
 * Retrieve and decrypt a stored credential.
 *
 * TODO: Implement real AES-GCM decryption.
 */
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

    // TODO: Replace with real AES-GCM decryption
    const decrypted = JSON.parse(atob(rows[0].encryptedPayload)) as PlaintextCredential;
    return decrypted;
  } catch {
    return null;
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

// ─── Check availability ───────────────────────────────────────────────────────

/**
 * Returns true if a non-expired credential exists for the given payer.
 * Used by connector stubs to decide whether autonomous portal access is possible.
 */
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
