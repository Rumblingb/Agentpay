import type { MerchantContext } from '../types';
import { createDb, parseJsonb, type Sql } from './db';
import type { CapabilityExecutionResult } from './capabilityBroker';
import { executeCapabilityProxy, getCapabilityProviderDefaults } from './capabilityBroker';
import { getCapability, getCapabilityMetadata, type CapabilityVaultRecord } from './capabilityVault';

export type CapabilityExecutionAttemptStatus =
  | 'pending_human_step'
  | 'resuming'
  | 'completed'
  | 'failed'
  | 'expired';

type CapabilityExecutionAttemptRow = {
  id: string;
  merchant_id: string;
  capability_vault_entry_id: string;
  authority_profile_id: string | null;
  hosted_action_session_id: string | null;
  principal_id: string | null;
  operator_id: string | null;
  idempotency_key: string | null;
  status: CapabilityExecutionAttemptStatus;
  blocked_reason: string | null;
  method: string;
  path: string;
  query_json: unknown;
  headers_json: unknown;
  body_json: unknown;
  request_id: string | null;
  host_context_json: unknown;
  guardrail_context_json: unknown;
  authority_context_json: unknown;
  next_action_json: unknown;
  result_payload_json: unknown;
  metadata_json: unknown;
  locked_unit_price_micros: number;
  locked_currency: string;
  used_calls_snapshot: number;
  free_calls_snapshot: number;
  resume_count: number;
  expires_at: Date;
  completed_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

type MerchantRow = {
  id: string;
  name: string;
  email: string;
  wallet_address: string | null;
  webhook_url: string | null;
};

export type CapabilityExecutionAttemptView = {
  id: string;
  merchantId: string;
  capabilityId: string;
  authorityProfileId: string | null;
  hostedActionSessionId: string | null;
  principalId: string | null;
  operatorId: string | null;
  idempotencyKey: string | null;
  status: CapabilityExecutionAttemptStatus;
  blockedReason: string | null;
  method: string;
  path: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  body: unknown;
  requestId: string | null;
  hostContext: Record<string, unknown>;
  guardrailContext: Record<string, unknown>;
  authorityContext: Record<string, unknown>;
  nextAction: Record<string, unknown>;
  resultPayload: Record<string, unknown>;
  metadata: Record<string, unknown>;
  lockedUnitPriceMicros: number;
  lockedCurrency: string;
  usedCallsSnapshot: number;
  freeCallsSnapshot: number;
  resumeCount: number;
  expiresAt: string;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

const memoryAttempts = new Map<string, CapabilityExecutionAttemptView>();
const memoryIdempotency = new Map<string, string>();

function isMissingRelationError(err: unknown): boolean {
  return err instanceof Error
    && /capability_execution_attempts|authority_profiles/i.test(err.message)
    && /does not exist|relation/i.test(err.message);
}

function mapAttemptRow(row: CapabilityExecutionAttemptRow): CapabilityExecutionAttemptView {
  const status = row.status === 'pending_human_step' && row.expires_at.getTime() < Date.now()
    ? 'expired'
    : row.status;
  return {
    id: row.id,
    merchantId: row.merchant_id,
    capabilityId: row.capability_vault_entry_id,
    authorityProfileId: row.authority_profile_id,
    hostedActionSessionId: row.hosted_action_session_id,
    principalId: row.principal_id,
    operatorId: row.operator_id,
    idempotencyKey: row.idempotency_key,
    status,
    blockedReason: row.blocked_reason,
    method: row.method,
    path: row.path,
    query: parseJsonb<Record<string, string>>(row.query_json, {}),
    headers: parseJsonb<Record<string, string>>(row.headers_json, {}),
    body: parseJsonb<unknown>(row.body_json, null),
    requestId: row.request_id,
    hostContext: parseJsonb<Record<string, unknown>>(row.host_context_json, {}),
    guardrailContext: parseJsonb<Record<string, unknown>>(row.guardrail_context_json, {}),
    authorityContext: parseJsonb<Record<string, unknown>>(row.authority_context_json, {}),
    nextAction: parseJsonb<Record<string, unknown>>(row.next_action_json, {}),
    resultPayload: parseJsonb<Record<string, unknown>>(row.result_payload_json, {}),
    metadata: parseJsonb<Record<string, unknown>>(row.metadata_json, {}),
    lockedUnitPriceMicros: row.locked_unit_price_micros,
    lockedCurrency: row.locked_currency,
    usedCallsSnapshot: row.used_calls_snapshot,
    freeCallsSnapshot: row.free_calls_snapshot,
    resumeCount: row.resume_count,
    expiresAt: row.expires_at.toISOString(),
    completedAt: row.completed_at ? row.completed_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function idempotencyKey(merchantId: string, capabilityId: string, key: string): string {
  return `${merchantId}:${capabilityId}:${key}`;
}

async function getMerchantContext(sql: Sql, merchantId: string): Promise<MerchantContext | null> {
  const rows = await sql<MerchantRow[]>`
    SELECT id, name, email, wallet_address, webhook_url
    FROM merchants
    WHERE id = ${merchantId}::uuid
    LIMIT 1
  `;
  const merchant = rows[0];
  if (!merchant) return null;
  return {
    id: merchant.id,
    name: merchant.name,
    email: merchant.email,
    walletAddress: merchant.wallet_address,
    webhookUrl: merchant.webhook_url,
  };
}

export async function createCapabilityExecutionAttempt(
  env: { DATABASE_URL?: string; HYPERDRIVE?: { connectionString?: string } },
  input: {
    merchantId: string;
    capabilityId: string;
    authorityProfileId?: string | null;
    principalId?: string | null;
    operatorId?: string | null;
    idempotencyKey?: string | null;
    blockedReason?: string | null;
    method: string;
    path: string;
    query?: Record<string, string>;
    headers?: Record<string, string>;
    body?: unknown;
    requestId?: string | null;
    hostContext?: Record<string, unknown>;
    guardrailContext?: Record<string, unknown>;
    authorityContext?: Record<string, unknown>;
    nextAction?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
    lockedUnitPriceMicros: number;
    lockedCurrency?: string;
    usedCallsSnapshot: number;
    freeCallsSnapshot: number;
    expiresAt?: Date;
  },
): Promise<{ attempt: CapabilityExecutionAttemptView; reused: boolean }> {
  const expiresAt = input.expiresAt ?? new Date(Date.now() + 30 * 60 * 1000);
  let sql: Sql | undefined;
  try {
    sql = createDb(env);
    if (input.idempotencyKey) {
      const existingRows = await sql<CapabilityExecutionAttemptRow[]>`
        SELECT *
        FROM capability_execution_attempts
        WHERE merchant_id = ${input.merchantId}::uuid
          AND capability_vault_entry_id = ${input.capabilityId}::uuid
          AND idempotency_key = ${input.idempotencyKey}
        LIMIT 1
      `;
      if (existingRows[0]) {
        return { attempt: mapAttemptRow(existingRows[0]), reused: true };
      }
    }

    const rows = await sql<CapabilityExecutionAttemptRow[]>`
      INSERT INTO capability_execution_attempts (
        id,
        merchant_id,
        capability_vault_entry_id,
        authority_profile_id,
        principal_id,
        operator_id,
        idempotency_key,
        status,
        blocked_reason,
        method,
        path,
        query_json,
        headers_json,
        body_json,
        request_id,
        host_context_json,
        guardrail_context_json,
        authority_context_json,
        next_action_json,
        result_payload_json,
        metadata_json,
        locked_unit_price_micros,
        locked_currency,
        used_calls_snapshot,
        free_calls_snapshot,
        expires_at
      ) VALUES (
        ${crypto.randomUUID()}::uuid,
        ${input.merchantId}::uuid,
        ${input.capabilityId}::uuid,
        ${input.authorityProfileId ?? null},
        ${input.principalId ?? null},
        ${input.operatorId ?? null},
        ${input.idempotencyKey ?? null},
        ${'pending_human_step'},
        ${input.blockedReason ?? null},
        ${input.method},
        ${input.path},
        ${JSON.stringify(input.query ?? {})}::jsonb,
        ${JSON.stringify(input.headers ?? {})}::jsonb,
        ${JSON.stringify(input.body ?? null)}::jsonb,
        ${input.requestId ?? null},
        ${JSON.stringify(input.hostContext ?? {})}::jsonb,
        ${JSON.stringify(input.guardrailContext ?? {})}::jsonb,
        ${JSON.stringify(input.authorityContext ?? {})}::jsonb,
        ${JSON.stringify(input.nextAction ?? {})}::jsonb,
        ${JSON.stringify({})}::jsonb,
        ${JSON.stringify(input.metadata ?? {})}::jsonb,
        ${Math.max(input.lockedUnitPriceMicros, 0)},
        ${input.lockedCurrency ?? 'USD'},
        ${Math.max(input.usedCallsSnapshot, 0)},
        ${Math.max(input.freeCallsSnapshot, 0)},
        ${expiresAt.toISOString()}::timestamptz
      )
      RETURNING *
    `;
    return { attempt: mapAttemptRow(rows[0]), reused: false };
  } catch (err) {
    if (!isMissingRelationError(err)) throw err;
    if (input.idempotencyKey) {
      const existingId = memoryIdempotency.get(idempotencyKey(input.merchantId, input.capabilityId, input.idempotencyKey));
      if (existingId) {
        const existing = memoryAttempts.get(existingId);
        if (existing) return { attempt: existing, reused: true };
      }
    }
    const now = new Date().toISOString();
    const attempt: CapabilityExecutionAttemptView = {
      id: crypto.randomUUID(),
      merchantId: input.merchantId,
      capabilityId: input.capabilityId,
      authorityProfileId: input.authorityProfileId ?? null,
      hostedActionSessionId: null,
      principalId: input.principalId ?? null,
      operatorId: input.operatorId ?? null,
      idempotencyKey: input.idempotencyKey ?? null,
      status: 'pending_human_step',
      blockedReason: input.blockedReason ?? null,
      method: input.method,
      path: input.path,
      query: input.query ?? {},
      headers: input.headers ?? {},
      body: input.body ?? null,
      requestId: input.requestId ?? null,
      hostContext: input.hostContext ?? {},
      guardrailContext: input.guardrailContext ?? {},
      authorityContext: input.authorityContext ?? {},
      nextAction: input.nextAction ?? {},
      resultPayload: {},
      metadata: input.metadata ?? {},
      lockedUnitPriceMicros: Math.max(input.lockedUnitPriceMicros, 0),
      lockedCurrency: input.lockedCurrency ?? 'USD',
      usedCallsSnapshot: Math.max(input.usedCallsSnapshot, 0),
      freeCallsSnapshot: Math.max(input.freeCallsSnapshot, 0),
      resumeCount: 0,
      expiresAt: expiresAt.toISOString(),
      completedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    memoryAttempts.set(attempt.id, attempt);
    if (attempt.idempotencyKey) {
      memoryIdempotency.set(idempotencyKey(attempt.merchantId, attempt.capabilityId, attempt.idempotencyKey), attempt.id);
    }
    return { attempt, reused: false };
  } finally {
    await sql?.end().catch(() => {});
  }
}

export async function getCapabilityExecutionAttempt(
  env: { DATABASE_URL?: string; HYPERDRIVE?: { connectionString?: string } },
  merchantId: string,
  attemptId: string,
): Promise<CapabilityExecutionAttemptView | null> {
  let sql: Sql | undefined;
  try {
    sql = createDb(env);
    const rows = await sql<CapabilityExecutionAttemptRow[]>`
      SELECT *
      FROM capability_execution_attempts
      WHERE id = ${attemptId}::uuid
        AND merchant_id = ${merchantId}::uuid
      LIMIT 1
    `;
    return rows[0] ? mapAttemptRow(rows[0]) : null;
  } catch (err) {
    if (!isMissingRelationError(err)) throw err;
    const attempt = memoryAttempts.get(attemptId);
    return attempt?.merchantId === merchantId ? attempt : null;
  } finally {
    await sql?.end().catch(() => {});
  }
}

export async function attachHostedActionSessionToExecutionAttempt(
  env: { DATABASE_URL?: string; HYPERDRIVE?: { connectionString?: string } },
  input: {
    attemptId: string;
    hostedActionSessionId: string;
    nextAction?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  },
): Promise<CapabilityExecutionAttemptView> {
  let sql: Sql | undefined;
  try {
    sql = createDb(env);
    const rows = await sql<CapabilityExecutionAttemptRow[]>`
      UPDATE capability_execution_attempts
      SET hosted_action_session_id = ${input.hostedActionSessionId}::uuid,
          next_action_json = COALESCE(next_action_json, '{}'::jsonb) || ${JSON.stringify(input.nextAction ?? {})}::jsonb,
          metadata_json = COALESCE(metadata_json, '{}'::jsonb) || ${JSON.stringify(input.metadata ?? {})}::jsonb,
          updated_at = NOW()
      WHERE id = ${input.attemptId}::uuid
      RETURNING *
    `;
    if (!rows[0]) throw new Error('CAPABILITY_EXECUTION_ATTEMPT_NOT_FOUND');
    return mapAttemptRow(rows[0]);
  } catch (err) {
    if (!isMissingRelationError(err)) throw err;
    const existing = memoryAttempts.get(input.attemptId);
    if (!existing) throw new Error('CAPABILITY_EXECUTION_ATTEMPT_NOT_FOUND');
    const next: CapabilityExecutionAttemptView = {
      ...existing,
      hostedActionSessionId: input.hostedActionSessionId,
      nextAction: {
        ...existing.nextAction,
        ...(input.nextAction ?? {}),
      },
      metadata: {
        ...existing.metadata,
        ...(input.metadata ?? {}),
      },
      updatedAt: new Date().toISOString(),
    };
    memoryAttempts.set(input.attemptId, next);
    return next;
  } finally {
    await sql?.end().catch(() => {});
  }
}

export async function beginCapabilityExecutionAttemptResume(
  env: { DATABASE_URL?: string; HYPERDRIVE?: { connectionString?: string } },
  attemptId: string,
): Promise<{ attempt: CapabilityExecutionAttemptView | null; acquired: boolean }> {
  let sql: Sql | undefined;
  try {
    sql = createDb(env);
    const rows = await sql<CapabilityExecutionAttemptRow[]>`
      UPDATE capability_execution_attempts
      SET status = ${'resuming'},
          resume_count = resume_count + 1,
          updated_at = NOW()
      WHERE id = ${attemptId}::uuid
        AND status = ${'pending_human_step'}
        AND completed_at IS NULL
        AND expires_at > NOW()
      RETURNING *
    `;
    if (rows[0]) {
      return { attempt: mapAttemptRow(rows[0]), acquired: true };
    }
    const existing = await sql<CapabilityExecutionAttemptRow[]>`
      SELECT *
      FROM capability_execution_attempts
      WHERE id = ${attemptId}::uuid
      LIMIT 1
    `;
    return { attempt: existing[0] ? mapAttemptRow(existing[0]) : null, acquired: false };
  } catch (err) {
    if (!isMissingRelationError(err)) throw err;
    const existing = memoryAttempts.get(attemptId) ?? null;
    if (!existing) return { attempt: null, acquired: false };
    if (existing.status !== 'pending_human_step' || (existing.completedAt ?? null) || new Date(existing.expiresAt).getTime() <= Date.now()) {
      return { attempt: existing, acquired: false };
    }
    const next: CapabilityExecutionAttemptView = {
      ...existing,
      status: 'resuming',
      resumeCount: existing.resumeCount + 1,
      updatedAt: new Date().toISOString(),
    };
    memoryAttempts.set(attemptId, next);
    return { attempt: next, acquired: true };
  } finally {
    await sql?.end().catch(() => {});
  }
}

export async function completeCapabilityExecutionAttempt(
  env: { DATABASE_URL?: string; HYPERDRIVE?: { connectionString?: string } },
  input: {
    attemptId: string;
    status: CapabilityExecutionAttemptStatus;
    blockedReason?: string | null;
    resultPayload?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
    hostedActionSessionId?: string | null;
  },
): Promise<CapabilityExecutionAttemptView> {
  let sql: Sql | undefined;
  try {
    sql = createDb(env);
    const rows = await sql<CapabilityExecutionAttemptRow[]>`
      UPDATE capability_execution_attempts
      SET status = ${input.status},
          blocked_reason = ${input.blockedReason ?? null},
          hosted_action_session_id = COALESCE(${input.hostedActionSessionId ?? null}::uuid, hosted_action_session_id),
          result_payload_json = COALESCE(result_payload_json, '{}'::jsonb) || ${JSON.stringify(input.resultPayload ?? {})}::jsonb,
          metadata_json = COALESCE(metadata_json, '{}'::jsonb) || ${JSON.stringify(input.metadata ?? {})}::jsonb,
          completed_at = CASE
            WHEN ${input.status} IN ('completed', 'failed', 'expired') THEN COALESCE(completed_at, NOW())
            ELSE completed_at
          END,
          updated_at = NOW()
      WHERE id = ${input.attemptId}::uuid
      RETURNING *
    `;
    if (!rows[0]) throw new Error('CAPABILITY_EXECUTION_ATTEMPT_NOT_FOUND');
    return mapAttemptRow(rows[0]);
  } catch (err) {
    if (!isMissingRelationError(err)) throw err;
    const existing = memoryAttempts.get(input.attemptId);
    if (!existing) throw new Error('CAPABILITY_EXECUTION_ATTEMPT_NOT_FOUND');
    const now = new Date().toISOString();
    const next: CapabilityExecutionAttemptView = {
      ...existing,
      status: input.status,
      blockedReason: input.blockedReason ?? existing.blockedReason,
      hostedActionSessionId: input.hostedActionSessionId ?? existing.hostedActionSessionId,
      resultPayload: {
        ...existing.resultPayload,
        ...(input.resultPayload ?? {}),
      },
      metadata: {
        ...existing.metadata,
        ...(input.metadata ?? {}),
      },
      completedAt: ['completed', 'failed', 'expired'].includes(input.status)
        ? (existing.completedAt ?? now)
        : existing.completedAt,
      updatedAt: now,
    };
    memoryAttempts.set(input.attemptId, next);
    return next;
  } finally {
    await sql?.end().catch(() => {});
  }
}

export async function resumeCapabilityExecutionAttempt(
  env: { DATABASE_URL?: string; HYPERDRIVE?: { connectionString?: string } },
  attemptId: string,
): Promise<{
  attempt: CapabilityExecutionAttemptView | null;
  executionResult: CapabilityExecutionResult | null;
  resumed: boolean;
}> {
  const started = await beginCapabilityExecutionAttemptResume(env, attemptId);
  const attempt = started.attempt;
  if (!attempt) {
    return { attempt: null, executionResult: null, resumed: false };
  }
  if (!started.acquired) {
    return { attempt, executionResult: null, resumed: false };
  }

  let sql: Sql | undefined;
  try {
    sql = createDb(env);
    const merchant = await getMerchantContext(sql, attempt.merchantId);
    if (!merchant) {
      const failed = await completeCapabilityExecutionAttempt(env, {
        attemptId,
        status: 'failed',
        blockedReason: 'merchant_not_found',
        resultPayload: {
          error: 'MERCHANT_NOT_FOUND',
        },
      });
      return { attempt: failed, executionResult: null, resumed: true };
    }

    const capability = await getCapability(env as never, merchant.id, attempt.capabilityId);
    if (!capability || capability.status !== 'active') {
      const failed = await completeCapabilityExecutionAttempt(env, {
        attemptId,
        status: 'failed',
        blockedReason: 'capability_unavailable',
        resultPayload: {
          error: 'CAPABILITY_UNAVAILABLE',
        },
      });
      return { attempt: failed, executionResult: null, resumed: true };
    }

    const policy = getCapabilityMetadata(capability);
    const providerInfo = getCapabilityProviderDefaults(capability.provider ?? 'generic_rest_api');
    const currentUnitPriceMicros = policy.paidUnitPriceUsdMicros || providerInfo?.paidUnitPriceUsdMicros || 0;
    if (currentUnitPriceMicros !== attempt.lockedUnitPriceMicros) {
      const failed = await completeCapabilityExecutionAttempt(env, {
        attemptId,
        status: 'failed',
        blockedReason: 'pricing_changed',
        resultPayload: {
          error: 'PRICING_CHANGED',
          currentUnitPriceUsd: currentUnitPriceMicros / 1_000_000,
          lockedUnitPriceUsd: attempt.lockedUnitPriceMicros / 1_000_000,
        },
      });
      return { attempt: failed, executionResult: null, resumed: true };
    }

    const executionResult = await executeCapabilityProxy(env as never, merchant, {
      capabilityId: attempt.capabilityId,
      method: attempt.method,
      path: attempt.path,
      query: attempt.query,
      headers: attempt.headers,
      body: attempt.body,
      allowPaidUsage: true,
      requestId: attempt.requestId,
    });

    const provider = capability.provider ?? providerInfo?.provider ?? 'generic_rest_api';
    const proof = {
      chargedAmountUsd: attempt.lockedUnitPriceMicros / 1_000_000,
      chargedCurrency: attempt.lockedCurrency,
      authorityProfileId: attempt.authorityProfileId,
      principalId: attempt.principalId,
      operatorId: attempt.operatorId,
      hostedActionSessionId: attempt.hostedActionSessionId,
      capabilityId: capability.id,
      capabilityKey: capability.capabilityKey,
      provider,
      continuity: {
        executionAttemptId: attempt.id,
        resumedServerSide: true,
        remainingAutonomy: attempt.guardrailContext,
      },
    };

    const completed = await completeCapabilityExecutionAttempt(env, {
      attemptId,
      status: 'completed',
      resultPayload: {
        executionResult,
        proof,
        completedAt: new Date().toISOString(),
      },
      metadata: {
        resumedFromHostedAction: attempt.hostedActionSessionId ?? null,
      },
    });
    return { attempt: completed, executionResult, resumed: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const failed = await completeCapabilityExecutionAttempt(env, {
      attemptId,
      status: 'failed',
      blockedReason: 'resume_execution_failed',
      resultPayload: {
        error: message,
      },
    });
    return { attempt: failed, executionResult: null, resumed: true };
  } finally {
    await sql?.end().catch(() => {});
  }
}
