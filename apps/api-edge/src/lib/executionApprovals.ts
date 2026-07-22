import type { Env } from '../types';
import { createDb, parseJsonb } from './db';
import { sha256Hex } from './approvalSessions';

export type ExecutionApprovalPayload = {
  schema: 'agentpay.execution-approval/1.0';
  actionKind: string;
  principalId: string;
  transcript: string;
  plan: unknown[];
  amountMinor: number;
  currency: string;
  createdAt: string;
};

export type ExecutionApprovalResult = Record<string, unknown>;

type ExecutionApprovalRow = {
  id: string;
  principal_id: string;
  approval_token_hash: string | null;
  action_kind: string | null;
  action_payload_hash: string | null;
  action_payload_json: unknown;
  execution_status: string | null;
  execution_result_json: unknown;
  approved_at: Date | null;
  expires_at: Date;
  consumed_at: Date | null;
};

export type ExecutionApprovalClaim =
  | { state: 'claimed'; sessionId: string; payload: ExecutionApprovalPayload }
  | { state: 'completed'; sessionId: string; payload: ExecutionApprovalPayload; result: ExecutionApprovalResult };

const EXECUTION_APPROVAL_TTL_MS = 10 * 60 * 1000;

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `apa_${Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')}`;
}

export function stableCanonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableCanonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableCanonicalJson(record[key])}`)
      .join(',')}}`;
  }
  const encoded = JSON.stringify(value);
  return encoded === undefined ? 'null' : encoded;
}

export async function digestExecutionApprovalPayload(payload: ExecutionApprovalPayload): Promise<string> {
  return sha256Hex(stableCanonicalJson(payload));
}

export function executionApprovalClaimDecision(
  executionStatus: string | null,
  consumedAt: Date | null,
): 'claim' | 'replay' {
  if (executionStatus === 'completed') return 'replay';
  if (executionStatus === 'executing' || consumedAt) {
    throw new Error('EXECUTION_APPROVAL_IN_PROGRESS');
  }
  if (executionStatus === 'failed') throw new Error('EXECUTION_APPROVAL_FAILED');
  if (executionStatus !== 'approved') throw new Error('EXECUTION_APPROVAL_NOT_CONFIRMED');
  return 'claim';
}

function parsePayload(row: ExecutionApprovalRow): ExecutionApprovalPayload {
  return parseJsonb<ExecutionApprovalPayload>(row.action_payload_json, null as never);
}

async function assertPayloadIntegrity(row: ExecutionApprovalRow): Promise<ExecutionApprovalPayload> {
  const payload = parsePayload(row);
  if (!payload || payload.schema !== 'agentpay.execution-approval/1.0') {
    throw new Error('EXECUTION_APPROVAL_PAYLOAD_INVALID');
  }
  const digest = await digestExecutionApprovalPayload(payload);
  if (!row.action_payload_hash || digest !== row.action_payload_hash) {
    throw new Error('EXECUTION_APPROVAL_PAYLOAD_TAMPERED');
  }
  if (payload.principalId !== row.principal_id || payload.actionKind !== row.action_kind) {
    throw new Error('EXECUTION_APPROVAL_BINDING_INVALID');
  }
  return payload;
}

export async function createExecutionApproval(
  env: Env,
  input: {
    principalId: string;
    actionKind: string;
    transcript: string;
    plan: unknown[];
    amountMinor: number;
    currency: string;
  },
): Promise<{ sessionId: string; approvalToken: string; planDigest: string; expiresAt: string }> {
  const sessionId = crypto.randomUUID();
  const approvalToken = randomToken();
  const approvalTokenHash = await sha256Hex(approvalToken);
  const expiresAt = new Date(Date.now() + EXECUTION_APPROVAL_TTL_MS);
  const payload: ExecutionApprovalPayload = {
    schema: 'agentpay.execution-approval/1.0',
    actionKind: input.actionKind,
    principalId: input.principalId,
    transcript: input.transcript,
    plan: input.plan,
    amountMinor: input.amountMinor,
    currency: input.currency.toUpperCase(),
    createdAt: new Date().toISOString(),
  };
  const planDigest = await digestExecutionApprovalPayload(payload);

  const sql = createDb(env);
  try {
    await sql`
      INSERT INTO approval_events (
        id,
        principal_id,
        method,
        approval_token_hash,
        amount_pence,
        currency,
        policy_version,
        action_kind,
        action_payload_hash,
        action_payload_json,
        execution_status,
        expires_at
      ) VALUES (
        ${sessionId}::uuid,
        ${input.principalId},
        ${'device_confirmation'},
        ${approvalTokenHash},
        ${input.amountMinor},
        ${payload.currency},
        ${'agentpay.execution-approval/1.0'},
        ${input.actionKind},
        ${planDigest},
        ${JSON.stringify(payload)}::jsonb,
        ${'pending'},
        ${expiresAt.toISOString()}::timestamptz
      )
    `;
    return { sessionId, approvalToken, planDigest, expiresAt: expiresAt.toISOString() };
  } finally {
    await sql.end().catch(() => {});
  }
}

export async function claimExecutionApproval(
  env: Env,
  input: {
    sessionId: string;
    approvalToken: string;
    expectedActionKind: string;
  },
): Promise<ExecutionApprovalClaim> {
  const tokenHash = await sha256Hex(input.approvalToken);
  const sql = createDb(env);
  try {
    return await sql.begin(async (transaction) => {
      // postgres.js's TransactionSql runtime is callable, but its current type
      // declaration loses the tagged-template call signature through Omit.
      const tx = transaction as unknown as typeof sql;
      const rows = await tx<ExecutionApprovalRow[]>`
        SELECT *
        FROM approval_events
        WHERE id = ${input.sessionId}::uuid
        FOR UPDATE
      `;
      const row = rows[0];
      if (!row || row.approval_token_hash !== tokenHash) {
        throw new Error('EXECUTION_APPROVAL_INVALID');
      }
      if (row.action_kind !== input.expectedActionKind) {
        throw new Error('EXECUTION_APPROVAL_SCOPE_INVALID');
      }
      if (new Date(row.expires_at).getTime() <= Date.now()) {
        throw new Error('EXECUTION_APPROVAL_EXPIRED');
      }
      if (!row.approved_at) {
        throw new Error('EXECUTION_APPROVAL_NOT_CONFIRMED');
      }

      const payload = await assertPayloadIntegrity(row);
      const decision = executionApprovalClaimDecision(row.execution_status, row.consumed_at);
      if (decision === 'replay') {
        return {
          state: 'completed' as const,
          sessionId: row.id,
          payload,
          result: parseJsonb<ExecutionApprovalResult>(row.execution_result_json, {}),
        };
      }
      const claimed = await tx<ExecutionApprovalRow[]>`
        UPDATE approval_events
        SET execution_status = 'executing', consumed_at = NOW()
        WHERE id = ${input.sessionId}::uuid
          AND approved_at IS NOT NULL
          AND consumed_at IS NULL
          AND execution_status = 'approved'
        RETURNING *
      `;
      if (!claimed[0]) throw new Error('EXECUTION_APPROVAL_IN_PROGRESS');
      return { state: 'claimed' as const, sessionId: row.id, payload };
    });
  } finally {
    await sql.end().catch(() => {});
  }
}

export async function completeExecutionApproval(
  env: Env,
  sessionId: string,
  result: ExecutionApprovalResult,
): Promise<void> {
  const sql = createDb(env);
  try {
    const rows = await sql`
      UPDATE approval_events
      SET execution_status = 'completed', execution_result_json = ${JSON.stringify(result)}::jsonb
      WHERE id = ${sessionId}::uuid
        AND execution_status = 'executing'
      RETURNING id
    `;
    if (!rows[0]) throw new Error('EXECUTION_APPROVAL_COMPLETE_INVALID');
  } finally {
    await sql.end().catch(() => {});
  }
}

export async function failExecutionApproval(env: Env, sessionId: string, reason: string): Promise<void> {
  const sql = createDb(env);
  try {
    await sql`
      UPDATE approval_events
      SET
        execution_status = 'failed',
        execution_result_json = ${JSON.stringify({ error: reason.slice(0, 240) })}::jsonb
      WHERE id = ${sessionId}::uuid
        AND execution_status = 'executing'
    `;
  } finally {
    await sql.end().catch(() => {});
  }
}

export function executionApprovalHttpStatus(error: unknown): 403 | 409 | 410 | 500 {
  const message = error instanceof Error ? error.message : String(error);
  if (message === 'EXECUTION_APPROVAL_EXPIRED') return 410;
  if (message === 'EXECUTION_APPROVAL_IN_PROGRESS' || message === 'EXECUTION_APPROVAL_FAILED') return 409;
  if (message.startsWith('EXECUTION_APPROVAL_')) return 403;
  return 500;
}
