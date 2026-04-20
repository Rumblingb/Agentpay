import type { Env, MerchantContext } from '../types';
import { createDb, parseJsonb, type Sql } from './db';
import { decryptPayload, encryptPayload } from './rcmCredentialVault';
import { sha256Hex } from './approvalSessions';
import { normalizeAllowedCapabilityHosts, normalizeCapabilityBaseUrl } from './networkPolicy';

export type CapabilitySubjectType = 'merchant' | 'principal' | 'agent' | 'workspace';
export type CapabilityCredentialKind = 'api_key' | 'bearer_token' | 'basic_auth';
export type CapabilityAuthScheme = 'bearer' | 'x_api_key' | 'basic';
export type CapabilityStatus = 'pending_connect' | 'active' | 'revoked';
export type CapabilityConnectSessionStatus = 'pending' | 'connected' | 'expired' | 'cancelled';

export interface CapabilitySecretPayload {
  apiKey?: string;
  token?: string;
  username?: string;
  password?: string;
  headerValue?: string;
  [key: string]: unknown;
}

export interface CapabilityMetadata {
  authScheme: CapabilityAuthScheme;
  credentialKind: CapabilityCredentialKind;
  baseUrl: string;
  allowedHosts: string[];
  headerName?: string | null;
  scopes: string[];
  freeCalls: number;
  paidUnitPriceUsdMicros: number;
}

export interface CapabilityVaultRecord {
  id: string;
  merchantId: string;
  capabilityKey: string;
  capabilityType: string;
  capabilityScope: string | null;
  provider: string | null;
  subjectType: string | null;
  subjectRef: string | null;
  status: CapabilityStatus;
  metadata: Record<string, unknown>;
  expiresAt: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CapabilityConnectSessionRecord {
  id: string;
  merchantId: string;
  capabilityVaultEntryId: string;
  status: CapabilityConnectSessionStatus;
  provider: string | null;
  redirectUrl: string | null;
  callbackUrl: string | null;
  connectionPayload: Record<string, unknown>;
  metadata: Record<string, unknown>;
  expiresAt: string;
  connectedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PublicCapabilityConnectSessionView {
  session: CapabilityConnectSessionRecord;
  capability: CapabilityVaultRecord;
}

export interface CreateCapabilityConnectSessionInput {
  merchant: MerchantContext;
  subjectType: CapabilitySubjectType;
  subjectRef: string;
  provider: string;
  capabilityKey: string;
  baseUrl: string;
  allowedHosts: string[];
  authScheme: CapabilityAuthScheme;
  credentialKind: CapabilityCredentialKind;
  headerName?: string | null;
  scopes?: string[];
  freeCalls?: number;
  paidUnitPriceUsdMicros?: number;
  redirectUrl?: string | null;
  callbackUrl?: string | null;
  metadata?: Record<string, unknown>;
  expiresAt?: string;
}

export interface SubmitCapabilityConnectSessionInput {
  sessionId: string;
  sessionToken: string;
  secretPayload: CapabilitySecretPayload;
  expiresAt?: string | null;
}

export interface UpsertCapabilityVaultCredentialInput {
  merchantId: string;
  capabilityKey: string;
  provider: string;
  subjectType: CapabilitySubjectType;
  subjectRef: string;
  secretPayload: CapabilitySecretPayload;
  authScheme: CapabilityAuthScheme;
  credentialKind: CapabilityCredentialKind;
  baseUrl: string;
  allowedHosts: string[];
  headerName?: string | null;
  scopes?: string[];
  freeCalls?: number;
  paidUnitPriceUsdMicros?: number;
  metadata?: Record<string, unknown>;
  expiresAt?: string | null;
}

export interface PeekCapabilityConnectSessionInput {
  sessionId: string;
  sessionToken: string;
}

const CONNECT_SESSION_TTL_MS = 15 * 60 * 1000;

type CapabilityVaultRow = {
  id: string;
  merchant_id: string;
  capability_key: string;
  capability_type: string;
  capability_scope: string | null;
  provider: string | null;
  subject_type: string | null;
  subject_ref: string | null;
  status: CapabilityStatus;
  secret_payload_json: unknown;
  metadata: unknown;
  expires_at: Date | null;
  revoked_at: Date | null;
  last_used_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

type CapabilityConnectSessionRow = {
  id: string;
  merchant_id: string;
  capability_vault_entry_id: string;
  session_token_hash: string;
  session_state: CapabilityConnectSessionStatus;
  provider: string | null;
  redirect_url: string | null;
  callback_url: string | null;
  connection_payload_json: unknown;
  metadata: unknown;
  expires_at: Date;
  connected_at: Date | null;
  revoked_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

function parseCapabilityDecryptionKeys(raw?: string): string[] {
  return Array.from(new Set(
    (raw ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  ));
}

function requireCapabilityVaultKey(env: Env): string {
  const key = env.CAPABILITY_VAULT_ENCRYPTION_KEY ?? env.RCM_VAULT_ENCRYPTION_KEY;
  if (!key) throw new Error('CAPABILITY_VAULT_ENCRYPTION_KEY_NOT_CONFIGURED');
  return key;
}

function getCapabilityVaultReadKeys(env: Env): string[] {
  return Array.from(new Set([
    requireCapabilityVaultKey(env),
    ...parseCapabilityDecryptionKeys(env.CAPABILITY_VAULT_DECRYPTION_KEYS),
  ]));
}

async function decryptCapabilityPayload(env: Env, encryptedBlob: string): Promise<string> {
  const keys = getCapabilityVaultReadKeys(env);
  let lastError: unknown = null;
  for (const key of keys) {
    try {
      return await decryptPayload(key, encryptedBlob);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('CAPABILITY_SECRET_DECRYPT_FAILED');
}

function toIso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

export function getCapabilityMetadata(record: CapabilityVaultRecord): CapabilityMetadata {
  const metadata = parseJsonb<Record<string, unknown>>(record.metadata, {});
  return {
    authScheme: (metadata.authScheme as CapabilityAuthScheme | undefined) ?? 'bearer',
    credentialKind: (metadata.credentialKind as CapabilityCredentialKind | undefined) ?? 'api_key',
    baseUrl: typeof metadata.baseUrl === 'string' ? metadata.baseUrl : '',
    allowedHosts: Array.isArray(metadata.allowedHosts) ? metadata.allowedHosts.filter((v): v is string => typeof v === 'string') : [],
    headerName: typeof metadata.headerName === 'string' ? metadata.headerName : null,
    scopes: Array.isArray(metadata.scopes) ? metadata.scopes.filter((v): v is string => typeof v === 'string') : [],
    freeCalls: Number.isFinite(metadata.freeCalls) ? Number(metadata.freeCalls) : 0,
    paidUnitPriceUsdMicros: Number.isFinite(metadata.paidUnitPriceUsdMicros) ? Number(metadata.paidUnitPriceUsdMicros) : 0,
  };
}

function toStoredSecretPayload(encryptedBlob: string): Record<string, unknown> {
  return {
    encryption: 'aes-256-gcm',
    encryptedBlob,
  };
}

function getEncryptedBlob(payload: unknown): string | null {
  const parsed = parseJsonb<Record<string, unknown>>(payload, {});
  return typeof parsed.encryptedBlob === 'string' ? parsed.encryptedBlob : null;
}

function mapCapabilityRow(row: CapabilityVaultRow): CapabilityVaultRecord {
  return {
    id: row.id,
    merchantId: row.merchant_id,
    capabilityKey: row.capability_key,
    capabilityType: row.capability_type,
    capabilityScope: row.capability_scope,
    provider: row.provider,
    subjectType: row.subject_type,
    subjectRef: row.subject_ref,
    status: row.status,
    metadata: parseJsonb<Record<string, unknown>>(row.metadata, {}),
    expiresAt: toIso(row.expires_at),
    revokedAt: toIso(row.revoked_at),
    lastUsedAt: toIso(row.last_used_at),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function mapConnectSessionRow(row: CapabilityConnectSessionRow): CapabilityConnectSessionRecord {
  return {
    id: row.id,
    merchantId: row.merchant_id,
    capabilityVaultEntryId: row.capability_vault_entry_id,
    status: row.session_state,
    provider: row.provider,
    redirectUrl: row.redirect_url,
    callbackUrl: row.callback_url,
    connectionPayload: parseJsonb<Record<string, unknown>>(row.connection_payload_json, {}),
    metadata: parseJsonb<Record<string, unknown>>(row.metadata, {}),
    expiresAt: row.expires_at.toISOString(),
    connectedAt: toIso(row.connected_at),
    revokedAt: toIso(row.revoked_at),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function createCapabilityConnectSession(
  env: Env,
  input: CreateCapabilityConnectSessionInput,
): Promise<{ capability: CapabilityVaultRecord; session: CapabilityConnectSessionRecord; sessionToken: string }> {
  const sql = createDb(env);
  try {
    const capabilityId = crypto.randomUUID();
    const sessionId = crypto.randomUUID();
    const sessionToken = crypto.randomUUID();
    const sessionTokenHash = await sha256Hex(sessionToken);
    const expiresAt = input.expiresAt
      ? new Date(input.expiresAt)
      : new Date(Date.now() + CONNECT_SESSION_TTL_MS);
    const normalizedBaseUrl = normalizeCapabilityBaseUrl(input.baseUrl, env);
    const normalizedAllowedHosts = normalizeAllowedCapabilityHosts(input.allowedHosts, env);
    const capabilityMetadata: CapabilityMetadata & Record<string, unknown> = {
      ...(input.metadata ?? {}),
      authScheme: input.authScheme,
      credentialKind: input.credentialKind,
      baseUrl: normalizedBaseUrl,
      allowedHosts: normalizedAllowedHosts,
      headerName: input.headerName ?? null,
      scopes: input.scopes ?? [],
      freeCalls: Math.max(input.freeCalls ?? 0, 0),
      paidUnitPriceUsdMicros: Math.max(input.paidUnitPriceUsdMicros ?? 0, 0),
    };

    const insertedCapabilities = await sql<CapabilityVaultRow[]>`
      INSERT INTO capability_vault_entries (
        id,
        merchant_id,
        capability_key,
        capability_type,
        capability_scope,
        provider,
        subject_type,
        subject_ref,
        status,
        secret_payload_json,
        metadata,
        expires_at
      ) VALUES (
        ${capabilityId}::uuid,
        ${input.merchant.id}::uuid,
        ${input.capabilityKey},
        ${'external_api'},
        ${input.provider},
        ${input.provider},
        ${input.subjectType},
        ${input.subjectRef},
        ${'pending_connect'},
        ${JSON.stringify({})}::jsonb,
        ${JSON.stringify(capabilityMetadata)}::jsonb,
        ${null}
      )
      ON CONFLICT (merchant_id, capability_key)
      DO UPDATE SET
        capability_type = EXCLUDED.capability_type,
        capability_scope = EXCLUDED.capability_scope,
        provider = EXCLUDED.provider,
        subject_type = EXCLUDED.subject_type,
        subject_ref = EXCLUDED.subject_ref,
        status = 'pending_connect',
        metadata = EXCLUDED.metadata,
        revoked_at = NULL,
        updated_at = NOW()
      RETURNING *
    `;
    const capability = mapCapabilityRow(insertedCapabilities[0]);

    const insertedSessions = await sql<CapabilityConnectSessionRow[]>`
      INSERT INTO capability_connect_sessions (
        id,
        merchant_id,
        capability_vault_entry_id,
        session_token_hash,
        session_state,
        provider,
        redirect_url,
        callback_url,
        connection_payload_json,
        metadata,
        expires_at
      ) VALUES (
        ${sessionId}::uuid,
        ${input.merchant.id}::uuid,
        ${capability.id}::uuid,
        ${sessionTokenHash},
        ${'pending'},
        ${input.provider},
        ${input.redirectUrl ?? null},
        ${input.callbackUrl ?? null},
        ${JSON.stringify({
          capabilityKey: input.capabilityKey,
          provider: input.provider,
          fields: input.credentialKind === 'basic_auth'
            ? [
                { key: 'username', label: 'Username', secret: false, autocomplete: 'username' },
                { key: 'password', label: 'Password', secret: true, autocomplete: 'current-password' },
              ]
            : [{
                key: input.credentialKind === 'bearer_token' ? 'token' : 'apiKey',
                label: input.credentialKind === 'bearer_token' ? 'Bearer token' : 'API key',
                secret: true,
                autocomplete: 'off',
              }],
        })}::jsonb,
        ${JSON.stringify({ providerLabel: input.provider, capabilityKey: input.capabilityKey })}::jsonb,
        ${expiresAt.toISOString()}::timestamptz
      )
      RETURNING *
    `;

    return {
      capability,
      session: mapConnectSessionRow(insertedSessions[0]),
      sessionToken,
    };
  } finally {
    await sql.end().catch(() => {});
  }
}

export async function getCapabilityConnectSession(
  env: Env,
  merchantId: string,
  sessionId: string,
): Promise<CapabilityConnectSessionRecord | null> {
  const sql = createDb(env);
  try {
    const rows = await sql<CapabilityConnectSessionRow[]>`
      SELECT *
      FROM capability_connect_sessions
      WHERE id = ${sessionId}::uuid
        AND merchant_id = ${merchantId}::uuid
      LIMIT 1
    `;
    return rows[0] ? mapConnectSessionRow(rows[0]) : null;
  } finally {
    await sql.end().catch(() => {});
  }
}

export async function peekCapabilityConnectSession(
  env: Env,
  input: PeekCapabilityConnectSessionInput,
): Promise<PublicCapabilityConnectSessionView> {
  const sql = createDb(env);
  try {
    const sessionRows = await sql<CapabilityConnectSessionRow[]>`
      SELECT *
      FROM capability_connect_sessions
      WHERE id = ${input.sessionId}::uuid
      LIMIT 1
    `;
    const session = sessionRows[0];
    if (!session) throw new Error('CAPABILITY_CONNECT_SESSION_NOT_FOUND');
    if (session.session_state !== 'pending') throw new Error('CAPABILITY_CONNECT_SESSION_NOT_PENDING');
    if (new Date(session.expires_at).getTime() < Date.now()) throw new Error('CAPABILITY_CONNECT_SESSION_EXPIRED');

    const providedHash = await sha256Hex(input.sessionToken.trim());
    if (session.session_token_hash !== providedHash) throw new Error('CAPABILITY_CONNECT_SESSION_TOKEN_INVALID');

    const capabilityRows = await sql<CapabilityVaultRow[]>`
      SELECT *
      FROM capability_vault_entries
      WHERE id = ${session.capability_vault_entry_id}::uuid
      LIMIT 1
    `;
    const capability = capabilityRows[0];
    if (!capability) throw new Error('CAPABILITY_NOT_FOUND');

    return {
      session: mapConnectSessionRow(session),
      capability: mapCapabilityRow(capability),
    };
  } finally {
    await sql.end().catch(() => {});
  }
}

export async function submitCapabilityConnectSession(
  env: Env,
  input: SubmitCapabilityConnectSessionInput,
): Promise<CapabilityVaultRecord> {
  const sql = createDb(env);
  try {
    const sessionRows = await sql<CapabilityConnectSessionRow[]>`
      SELECT *
      FROM capability_connect_sessions
      WHERE id = ${input.sessionId}::uuid
      LIMIT 1
    `;
    const session = sessionRows[0];
    if (!session) throw new Error('CAPABILITY_CONNECT_SESSION_NOT_FOUND');
    if (session.session_state !== 'pending') throw new Error('CAPABILITY_CONNECT_SESSION_NOT_PENDING');
    if (new Date(session.expires_at).getTime() < Date.now()) throw new Error('CAPABILITY_CONNECT_SESSION_EXPIRED');

    const providedHash = await sha256Hex(input.sessionToken.trim());
    if (session.session_token_hash !== providedHash) throw new Error('CAPABILITY_CONNECT_SESSION_TOKEN_INVALID');

    const vaultKey = requireCapabilityVaultKey(env);
    const encryptedBlob = await encryptPayload(vaultKey, JSON.stringify(input.secretPayload));
    const updatedRows = await sql<CapabilityVaultRow[]>`
      UPDATE capability_vault_entries
      SET status = ${'active'},
          secret_payload_json = ${JSON.stringify(toStoredSecretPayload(encryptedBlob))}::jsonb,
          expires_at = ${input.expiresAt ?? null},
          revoked_at = NULL,
          updated_at = NOW()
      WHERE id = ${session.capability_vault_entry_id}::uuid
      RETURNING *
    `;
    await sql`
      UPDATE capability_connect_sessions
      SET session_state = ${'connected'},
          connected_at = NOW(),
          updated_at = NOW()
      WHERE id = ${input.sessionId}::uuid
    `;
    return mapCapabilityRow(updatedRows[0]);
  } finally {
    await sql.end().catch(() => {});
  }
}

export async function upsertCapabilityVaultCredential(
  env: Env,
  input: UpsertCapabilityVaultCredentialInput,
): Promise<CapabilityVaultRecord> {
  const sql = createDb(env);
  try {
    const vaultKey = requireCapabilityVaultKey(env);
    const normalizedBaseUrl = normalizeCapabilityBaseUrl(input.baseUrl, env);
    const normalizedAllowedHosts = normalizeAllowedCapabilityHosts(input.allowedHosts, env);
    const encryptedBlob = await encryptPayload(vaultKey, JSON.stringify(input.secretPayload));
    const capabilityMetadata: CapabilityMetadata & Record<string, unknown> = {
      ...(input.metadata ?? {}),
      authScheme: input.authScheme,
      credentialKind: input.credentialKind,
      baseUrl: normalizedBaseUrl,
      allowedHosts: normalizedAllowedHosts,
      headerName: input.headerName ?? null,
      scopes: input.scopes ?? [],
      freeCalls: Math.max(input.freeCalls ?? 0, 0),
      paidUnitPriceUsdMicros: Math.max(input.paidUnitPriceUsdMicros ?? 0, 0),
    };

    const rows = await sql<CapabilityVaultRow[]>`
      INSERT INTO capability_vault_entries (
        id,
        merchant_id,
        capability_key,
        capability_type,
        capability_scope,
        provider,
        subject_type,
        subject_ref,
        status,
        secret_payload_json,
        metadata,
        expires_at
      ) VALUES (
        ${crypto.randomUUID()}::uuid,
        ${input.merchantId}::uuid,
        ${input.capabilityKey},
        ${'external_api'},
        ${input.provider},
        ${input.provider},
        ${input.subjectType},
        ${input.subjectRef},
        ${'active'},
        ${JSON.stringify(toStoredSecretPayload(encryptedBlob))}::jsonb,
        ${JSON.stringify(capabilityMetadata)}::jsonb,
        ${input.expiresAt ?? null}
      )
      ON CONFLICT (merchant_id, capability_key)
      DO UPDATE SET
        capability_type = EXCLUDED.capability_type,
        capability_scope = EXCLUDED.capability_scope,
        provider = EXCLUDED.provider,
        subject_type = EXCLUDED.subject_type,
        subject_ref = EXCLUDED.subject_ref,
        status = 'active',
        secret_payload_json = EXCLUDED.secret_payload_json,
        metadata = EXCLUDED.metadata,
        expires_at = EXCLUDED.expires_at,
        revoked_at = NULL,
        updated_at = NOW()
      RETURNING *
    `;

    return mapCapabilityRow(rows[0]);
  } finally {
    await sql.end().catch(() => {});
  }
}

export async function listCapabilities(
  env: Env,
  merchantId: string,
): Promise<CapabilityVaultRecord[]> {
  const sql = createDb(env);
  try {
    const rows = await sql<CapabilityVaultRow[]>`
      SELECT *
      FROM capability_vault_entries
      WHERE merchant_id = ${merchantId}::uuid
      ORDER BY updated_at DESC
    `;
    return rows.map(mapCapabilityRow);
  } finally {
    await sql.end().catch(() => {});
  }
}

export async function getCapability(
  env: Env,
  merchantId: string,
  capabilityId: string,
): Promise<CapabilityVaultRecord | null> {
  const sql = createDb(env);
  try {
    const rows = await sql<CapabilityVaultRow[]>`
      SELECT *
      FROM capability_vault_entries
      WHERE id = ${capabilityId}::uuid
        AND merchant_id = ${merchantId}::uuid
      LIMIT 1
    `;
    return rows[0] ? mapCapabilityRow(rows[0]) : null;
  } finally {
    await sql.end().catch(() => {});
  }
}

export async function findSubjectCapabilityAccess(
  env: Env,
  input: {
    merchantId: string;
    subjectType: CapabilitySubjectType;
    subjectRef: string;
    provider?: string | null;
    capabilityKey?: string | null;
    statuses?: CapabilityStatus[];
  },
): Promise<CapabilityVaultRecord | null> {
  const sql = createDb(env);
  try {
    const statuses = input.statuses && input.statuses.length > 0
      ? input.statuses
      : ['active'];
    const provider = input.provider?.trim() || null;
    const capabilityKey = input.capabilityKey?.trim() || null;
    const rows = await sql<CapabilityVaultRow[]>`
      SELECT *
      FROM capability_vault_entries
      WHERE merchant_id = ${input.merchantId}::uuid
        AND subject_type = ${input.subjectType}
        AND subject_ref = ${input.subjectRef}
        AND status = ANY(${statuses}::text[])
        AND (
          ${provider}::text IS NULL
          OR provider = ${provider}
          OR capability_scope = ${provider}
        )
        AND (
          ${capabilityKey}::text IS NULL
          OR capability_key = ${capabilityKey}
        )
      ORDER BY
        CASE WHEN status = 'active' THEN 0 ELSE 1 END,
        updated_at DESC
      LIMIT 1
    `;
    return rows[0] ? mapCapabilityRow(rows[0]) : null;
  } finally {
    await sql.end().catch(() => {});
  }
}

export async function retrieveCapabilitySecret(
  env: Env,
  merchantId: string,
  capabilityId: string,
): Promise<{ capability: CapabilityVaultRecord; secretPayload: CapabilitySecretPayload } | null> {
  const sql = createDb(env);
  try {
    const rows = await sql<CapabilityVaultRow[]>`
      SELECT *
      FROM capability_vault_entries
      WHERE id = ${capabilityId}::uuid
        AND merchant_id = ${merchantId}::uuid
        AND status = 'active'
        AND (expires_at IS NULL OR expires_at > NOW())
      LIMIT 1
    `;
    const row = rows[0];
    if (!row) return null;
    const encryptedBlob = getEncryptedBlob(row.secret_payload_json);
    if (!encryptedBlob) return null;
    const decrypted = await decryptCapabilityPayload(env, encryptedBlob);
    return {
      capability: mapCapabilityRow(row),
      secretPayload: JSON.parse(decrypted) as CapabilitySecretPayload,
    };
  } finally {
    await sql.end().catch(() => {});
  }
}

export async function revokeCapability(
  env: Env,
  merchantId: string,
  capabilityId: string,
): Promise<void> {
  const sql = createDb(env);
  try {
    await sql`
      UPDATE capability_vault_entries
      SET status = ${'revoked'},
          revoked_at = NOW(),
          updated_at = NOW()
      WHERE id = ${capabilityId}::uuid
        AND merchant_id = ${merchantId}::uuid
    `;
  } finally {
    await sql.end().catch(() => {});
  }
}

export async function logCapabilityAccess(
  sql: Sql,
  input: {
    merchantId: string;
    capabilityId?: string | null;
    sessionId?: string | null;
    capabilityKey: string;
    capabilityType?: string;
    action: string;
    outcome?: string;
    actorType?: string | null;
    actorRef?: string | null;
    requestId?: string | null;
    reasonCode?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await sql`
    INSERT INTO capability_access_logs (
      id,
      merchant_id,
      capability_vault_entry_id,
      session_id,
      capability_key,
      capability_type,
      action,
      outcome,
      actor_type,
      actor_ref,
      request_id,
      reason_code,
      metadata
    ) VALUES (
      ${crypto.randomUUID()}::uuid,
      ${input.merchantId}::uuid,
      ${input.capabilityId ?? null},
      ${input.sessionId ?? null},
      ${input.capabilityKey},
      ${input.capabilityType ?? 'external_api'},
      ${input.action},
      ${input.outcome ?? 'allowed'},
      ${input.actorType ?? null},
      ${input.actorRef ?? null},
      ${input.requestId ?? null},
      ${input.reasonCode ?? null},
      ${JSON.stringify(input.metadata ?? {})}::jsonb
    )
  `;
}

export async function countCapabilityUsage(
  sql: Sql,
  capabilityId: string,
): Promise<number> {
  const rows = await sql<Array<{ count: string | number }>>`
    SELECT COALESCE(SUM(usage_units), 0) AS count
    FROM capability_usage_events
    WHERE capability_vault_entry_id = ${capabilityId}::uuid
      AND event_type = 'proxy_call'
      AND status_code >= 200
      AND status_code < 400
  `;
  return Number(rows[0]?.count ?? 0);
}

export async function recordCapabilityUsageEvent(
  sql: Sql,
  input: {
    merchantId: string;
    capabilityId?: string | null;
    sessionId?: string | null;
    capabilityKey: string;
    capabilityType?: string;
    eventType: string;
    requestId?: string | null;
    toolName?: string | null;
    usageUnits?: number;
    unitPriceMicros?: number;
    estimatedAmountMicros?: number;
    statusCode?: number | null;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await sql`
    INSERT INTO capability_usage_events (
      id,
      merchant_id,
      capability_vault_entry_id,
      session_id,
      capability_key,
      capability_type,
      event_type,
      request_id,
      tool_name,
      usage_units,
      unit_price_micros,
      estimated_amount_micros,
      status_code,
      metadata
    ) VALUES (
      ${crypto.randomUUID()}::uuid,
      ${input.merchantId}::uuid,
      ${input.capabilityId ?? null},
      ${input.sessionId ?? null},
      ${input.capabilityKey},
      ${input.capabilityType ?? 'external_api'},
      ${input.eventType},
      ${input.requestId ?? null},
      ${input.toolName ?? null},
      ${Math.max(input.usageUnits ?? 1, 1)},
      ${Math.max(input.unitPriceMicros ?? 0, 0)},
      ${Math.max(input.estimatedAmountMicros ?? 0, 0)},
      ${input.statusCode ?? null},
      ${JSON.stringify(input.metadata ?? {})}::jsonb
    )
  `;
}
