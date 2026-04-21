import type { Env } from '../types';
import { createDb, parseJsonb, type Sql } from './db';
import { sha256Hex } from './approvalSessions';

export type CapabilityAccessLeaseStatus = 'active' | 'revoked' | 'expired';

type CapabilityAccessLeaseRow = {
  id: string;
  merchant_id: string;
  capability_vault_entry_id: string;
  subject_type: string;
  subject_ref: string;
  principal_id: string | null;
  operator_id: string | null;
  workbench_id: string;
  workbench_label: string | null;
  lease_token_hash: string;
  status: CapabilityAccessLeaseStatus;
  metadata_json: unknown;
  expires_at: Date;
  revoked_at: Date | null;
  last_used_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

export type CapabilityAccessLeaseView = {
  id: string;
  merchantId: string;
  capabilityId: string;
  subjectType: string;
  subjectRef: string;
  principalId: string | null;
  operatorId: string | null;
  workbenchId: string;
  workbenchLabel: string | null;
  status: CapabilityAccessLeaseStatus;
  metadata: Record<string, unknown>;
  expiresAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

const memoryLeases = new Map<string, CapabilityAccessLeaseView>();
const memoryLeaseTokens = new Map<string, string>();

function randomHex(bytes: number): string {
  const array = new Uint8Array(bytes);
  crypto.getRandomValues(array);
  return Array.from(array).map((value) => value.toString(16).padStart(2, '0')).join('');
}

function isMissingRelationError(err: unknown): boolean {
  return err instanceof Error
    && /capability_access_leases/i.test(err.message)
    && /does not exist|relation/i.test(err.message);
}

function toIso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function toView(row: CapabilityAccessLeaseRow): CapabilityAccessLeaseView {
  const expired = row.status === 'active' && row.expires_at.getTime() < Date.now();
  return {
    id: row.id,
    merchantId: row.merchant_id,
    capabilityId: row.capability_vault_entry_id,
    subjectType: row.subject_type,
    subjectRef: row.subject_ref,
    principalId: row.principal_id,
    operatorId: row.operator_id,
    workbenchId: row.workbench_id,
    workbenchLabel: row.workbench_label,
    status: expired ? 'expired' : row.status,
    metadata: parseJsonb<Record<string, unknown>>(row.metadata_json, {}),
    expiresAt: row.expires_at.toISOString(),
    revokedAt: toIso(row.revoked_at),
    lastUsedAt: toIso(row.last_used_at),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function createCapabilityAccessLease(
  env: Env,
  input: {
    merchantId: string;
    capabilityId: string;
    subjectType: string;
    subjectRef: string;
    principalId?: string | null;
    operatorId?: string | null;
    workbenchId: string;
    workbenchLabel?: string | null;
    metadata?: Record<string, unknown>;
    expiresAt?: Date;
  },
): Promise<{ lease: CapabilityAccessLeaseView; leaseToken: string }> {
  const leaseToken = `apcl_${randomHex(24)}`;
  const leaseTokenHash = await sha256Hex(leaseToken);
  const expiresAt = input.expiresAt ?? new Date(Date.now() + 12 * 60 * 60 * 1000);
  let sql: Sql | undefined;
  try {
    sql = createDb(env);
    const rows = await sql<CapabilityAccessLeaseRow[]>`
      INSERT INTO capability_access_leases (
        id,
        merchant_id,
        capability_vault_entry_id,
        subject_type,
        subject_ref,
        principal_id,
        operator_id,
        workbench_id,
        workbench_label,
        lease_token_hash,
        status,
        metadata_json,
        expires_at
      ) VALUES (
        ${crypto.randomUUID()}::uuid,
        ${input.merchantId}::uuid,
        ${input.capabilityId}::uuid,
        ${input.subjectType},
        ${input.subjectRef},
        ${input.principalId ?? null},
        ${input.operatorId ?? null},
        ${input.workbenchId},
        ${input.workbenchLabel ?? null},
        ${leaseTokenHash},
        ${'active'},
        ${JSON.stringify(input.metadata ?? {})}::jsonb,
        ${expiresAt.toISOString()}::timestamptz
      )
      RETURNING *
    `;
    return {
      lease: toView(rows[0]),
      leaseToken,
    };
  } catch (err) {
    if (!isMissingRelationError(err)) throw err;
    const now = new Date().toISOString();
    const lease: CapabilityAccessLeaseView = {
      id: crypto.randomUUID(),
      merchantId: input.merchantId,
      capabilityId: input.capabilityId,
      subjectType: input.subjectType,
      subjectRef: input.subjectRef,
      principalId: input.principalId ?? null,
      operatorId: input.operatorId ?? null,
      workbenchId: input.workbenchId,
      workbenchLabel: input.workbenchLabel ?? null,
      status: 'active',
      metadata: input.metadata ?? {},
      expiresAt: expiresAt.toISOString(),
      revokedAt: null,
      lastUsedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    memoryLeases.set(lease.id, lease);
    memoryLeaseTokens.set(leaseTokenHash, lease.id);
    return { lease, leaseToken };
  } finally {
    await sql?.end().catch(() => {});
  }
}

export async function resolveCapabilityAccessLease(
  env: Env,
  input: {
    leaseToken: string;
    workbenchId?: string | null;
  },
): Promise<CapabilityAccessLeaseView> {
  const leaseTokenHash = await sha256Hex(input.leaseToken);
  let sql: Sql | undefined;
  try {
    sql = createDb(env);
    const rows = await sql<CapabilityAccessLeaseRow[]>`
      SELECT *
      FROM capability_access_leases
      WHERE lease_token_hash = ${leaseTokenHash}
      LIMIT 1
    `;
    const row = rows[0];
    if (!row) throw new Error('CAPABILITY_ACCESS_LEASE_NOT_FOUND');
    const lease = toView(row);
    if (lease.status === 'revoked') throw new Error('CAPABILITY_ACCESS_LEASE_REVOKED');
    if (lease.status === 'expired') throw new Error('CAPABILITY_ACCESS_LEASE_EXPIRED');
    if (input.workbenchId && input.workbenchId !== lease.workbenchId) {
      throw new Error('CAPABILITY_ACCESS_LEASE_WORKBENCH_MISMATCH');
    }
    return lease;
  } catch (err) {
    if (!isMissingRelationError(err)) throw err;
    const leaseId = memoryLeaseTokens.get(leaseTokenHash);
    const lease = leaseId ? memoryLeases.get(leaseId) : null;
    if (!lease) throw new Error('CAPABILITY_ACCESS_LEASE_NOT_FOUND');
    if (lease.status === 'revoked') throw new Error('CAPABILITY_ACCESS_LEASE_REVOKED');
    if (new Date(lease.expiresAt).getTime() < Date.now()) throw new Error('CAPABILITY_ACCESS_LEASE_EXPIRED');
    if (input.workbenchId && input.workbenchId !== lease.workbenchId) {
      throw new Error('CAPABILITY_ACCESS_LEASE_WORKBENCH_MISMATCH');
    }
    return lease;
  } finally {
    await sql?.end().catch(() => {});
  }
}

export async function touchCapabilityAccessLease(
  env: Env,
  leaseId: string,
): Promise<void> {
  let sql: Sql | undefined;
  try {
    sql = createDb(env);
    await sql`
      UPDATE capability_access_leases
      SET last_used_at = NOW(),
          updated_at = NOW()
      WHERE id = ${leaseId}::uuid
    `;
  } catch (err) {
    if (!isMissingRelationError(err)) throw err;
    const lease = memoryLeases.get(leaseId);
    if (!lease) return;
    const now = new Date().toISOString();
    memoryLeases.set(leaseId, {
      ...lease,
      lastUsedAt: now,
      updatedAt: now,
    });
  } finally {
    await sql?.end().catch(() => {});
  }
}

export async function listCapabilityAccessLeases(
  env: Env,
  input: {
    merchantId: string;
    principalId?: string | null;
    operatorId?: string | null;
    capabilityId?: string | null;
    workbenchId?: string | null;
    status?: CapabilityAccessLeaseStatus | 'all' | null;
    limit?: number;
  },
): Promise<CapabilityAccessLeaseView[]> {
  const limit = Math.max(1, Math.min(input.limit ?? 25, 100));
  let sql: Sql | undefined;
  try {
    sql = createDb(env);
    const rows = await sql<CapabilityAccessLeaseRow[]>`
      SELECT *
      FROM capability_access_leases
      WHERE merchant_id = ${input.merchantId}::uuid
      ORDER BY updated_at DESC
      LIMIT ${limit}
    `;
    return rows
      .map((row) => toView(row))
      .filter((lease) => {
        if (input.principalId && lease.principalId !== input.principalId) return false;
        if (input.operatorId && lease.operatorId !== input.operatorId) return false;
        if (input.capabilityId && lease.capabilityId !== input.capabilityId) return false;
        if (input.workbenchId && lease.workbenchId !== input.workbenchId) return false;
        if (input.status && input.status !== 'all' && lease.status !== input.status) return false;
        return true;
      });
  } catch (err) {
    if (!isMissingRelationError(err)) throw err;
    return [...memoryLeases.values()]
      .filter((lease) => {
        if (lease.merchantId !== input.merchantId) return false;
        if (input.principalId && lease.principalId !== input.principalId) return false;
        if (input.operatorId && lease.operatorId !== input.operatorId) return false;
        if (input.capabilityId && lease.capabilityId !== input.capabilityId) return false;
        if (input.workbenchId && lease.workbenchId !== input.workbenchId) return false;
        if (input.status && input.status !== 'all' && lease.status !== input.status) return false;
        return true;
      })
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
      .slice(0, limit);
  } finally {
    await sql?.end().catch(() => {});
  }
}

export async function revokeCapabilityAccessLease(
  env: Env,
  input: {
    merchantId: string;
    leaseId: string;
    reason?: string | null;
  },
): Promise<CapabilityAccessLeaseView> {
  let sql: Sql | undefined;
  try {
    sql = createDb(env);
    const rows = await sql<CapabilityAccessLeaseRow[]>`
      UPDATE capability_access_leases
      SET status = 'revoked',
          revoked_at = NOW(),
          updated_at = NOW(),
          metadata_json = COALESCE(metadata_json, '{}'::jsonb) || ${JSON.stringify({
            revokedReason: input.reason ?? null,
          })}::jsonb
      WHERE id = ${input.leaseId}::uuid
        AND merchant_id = ${input.merchantId}::uuid
      RETURNING *
    `;
    const row = rows[0];
    if (!row) throw new Error('CAPABILITY_ACCESS_LEASE_NOT_FOUND');
    return toView(row);
  } catch (err) {
    if (!isMissingRelationError(err)) throw err;
    const lease = memoryLeases.get(input.leaseId);
    if (!lease || lease.merchantId !== input.merchantId) {
      throw new Error('CAPABILITY_ACCESS_LEASE_NOT_FOUND');
    }
    const now = new Date().toISOString();
    const next: CapabilityAccessLeaseView = {
      ...lease,
      status: 'revoked',
      revokedAt: now,
      updatedAt: now,
      metadata: {
        ...lease.metadata,
        revokedReason: input.reason ?? null,
      },
    };
    memoryLeases.set(input.leaseId, next);
    return next;
  } finally {
    await sql?.end().catch(() => {});
  }
}
