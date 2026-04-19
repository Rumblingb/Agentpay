import type { Env, MerchantContext } from '../types';
import { createDb, parseJsonb, type Sql } from './db';
import { sha256Hex } from './approvalSessions';

export type HostedActionSessionStatus =
  | 'pending'
  | 'completed'
  | 'failed'
  | 'expired';

export type HostedActionType =
  | 'funding_required'
  | 'auth_required'
  | 'approval_required'
  | 'verification_required'
  | 'confirmation_required';

type HostedActionSessionRow = {
  id: string;
  merchant_id: string;
  action_type: string;
  entity_type: string | null;
  entity_id: string | null;
  title: string;
  summary: string | null;
  status: HostedActionSessionStatus;
  audience: string | null;
  auth_type: string | null;
  resume_url: string | null;
  display_payload_json: unknown;
  result_payload_json: unknown;
  metadata_json: unknown;
  expires_at: Date;
  completed_at: Date | null;
  used_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

export type HostedActionSessionView = {
  sessionId: string;
  merchantId: string;
  actionType: HostedActionType;
  entityType: string | null;
  entityId: string | null;
  title: string;
  summary: string | null;
  status: HostedActionSessionStatus;
  audience: string | null;
  authType: string | null;
  resumeUrl: string | null;
  displayPayload: Record<string, unknown>;
  resultPayload: Record<string, unknown>;
  metadata: Record<string, unknown>;
  expiresAt: Date;
  completedAt: Date | null;
  usedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

const memorySessions = new Map<string, HostedActionSessionView>();
const memoryTokenHashes = new Map<string, string>();

function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function isMissingRelationError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return /hosted_action_sessions/i.test(err.message) && /does not exist|relation/i.test(err.message);
}

function toView(row: HostedActionSessionRow): HostedActionSessionView {
  return {
    sessionId: row.id,
    merchantId: row.merchant_id,
    actionType: (row.action_type || 'confirmation_required') as HostedActionType,
    entityType: row.entity_type,
    entityId: row.entity_id,
    title: row.title,
    summary: row.summary,
    status: row.status,
    audience: row.audience,
    authType: row.auth_type,
    resumeUrl: row.resume_url,
    displayPayload: parseJsonb<Record<string, unknown>>(row.display_payload_json, {}),
    resultPayload: parseJsonb<Record<string, unknown>>(row.result_payload_json, {}),
    metadata: parseJsonb<Record<string, unknown>>(row.metadata_json, {}),
    expiresAt: row.expires_at,
    completedAt: row.completed_at,
    usedAt: row.used_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function buildSessionStatusUrl(env: Env, sessionId: string): string {
  return new URL(`/api/actions/${sessionId}`, env.API_BASE_URL).toString();
}

function buildSessionResumeUrl(env: Env, sessionId: string, resumeToken: string): string {
  const url = new URL(`/api/actions/${sessionId}/resume`, env.API_BASE_URL);
  url.searchParams.set('token', resumeToken);
  return url.toString();
}

export function isSafeHostedActionResumeUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.hostname === 'localhost';
  } catch {
    return false;
  }
}

function resolveMergedStatus(
  currentStatus: HostedActionSessionStatus,
  requestedStatus?: HostedActionSessionStatus,
): HostedActionSessionStatus {
  if (!requestedStatus) return currentStatus;
  if (currentStatus === 'completed') return currentStatus;
  return requestedStatus;
}

export async function createHostedActionSession(
  env: Env,
  input: {
    merchant: MerchantContext;
    actionType: HostedActionType;
    entityType?: string | null;
    entityId?: string | null;
    title: string;
    summary?: string | null;
    audience?: string | null;
    authType?: string | null;
    resumeUrl?: string | null;
    displayPayload?: Record<string, unknown>;
    resultPayload?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
    expiresAt?: Date;
  },
): Promise<{
  session: HostedActionSessionView;
  resumeToken: string;
  statusUrl: string;
  publicResumeUrl: string;
}> {
  const sessionId = crypto.randomUUID();
  const resumeToken = `apas_${randomHex(24)}`;
  const resumeTokenHash = await sha256Hex(resumeToken);
  const expiresAt = input.expiresAt ?? new Date(Date.now() + 30 * 60 * 1000);

  let sql: Sql | undefined;
  try {
    sql = createDb(env);
    const rows = await sql<HostedActionSessionRow[]>`
      INSERT INTO hosted_action_sessions (
        id,
        merchant_id,
        action_type,
        entity_type,
        entity_id,
        title,
        summary,
        status,
        audience,
        auth_type,
        resume_url,
        resume_token_hash,
        display_payload_json,
        result_payload_json,
        metadata_json,
        expires_at,
        used_at
      ) VALUES (
        ${sessionId}::uuid,
        ${input.merchant.id}::uuid,
        ${input.actionType},
        ${input.entityType ?? null},
        ${input.entityId ?? null},
        ${input.title},
        ${input.summary ?? null},
        ${'pending'},
        ${input.audience ?? null},
        ${input.authType ?? null},
        ${input.resumeUrl ?? null},
        ${resumeTokenHash},
        ${JSON.stringify(input.displayPayload ?? {})}::jsonb,
        ${JSON.stringify(input.resultPayload ?? {})}::jsonb,
        ${JSON.stringify(input.metadata ?? {})}::jsonb,
        ${expiresAt.toISOString()}::timestamptz,
        ${null}
      )
      RETURNING *
    `;

    const session = toView(rows[0]);
    return {
      session,
      resumeToken,
      statusUrl: buildSessionStatusUrl(env, session.sessionId),
      publicResumeUrl: buildSessionResumeUrl(env, session.sessionId, resumeToken),
    };
  } catch (err) {
    if (!isMissingRelationError(err)) throw err;

    const now = new Date();
    const session: HostedActionSessionView = {
      sessionId,
      merchantId: input.merchant.id,
      actionType: input.actionType,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      title: input.title,
      summary: input.summary ?? null,
      status: 'pending',
      audience: input.audience ?? null,
      authType: input.authType ?? null,
      resumeUrl: input.resumeUrl ?? null,
      displayPayload: input.displayPayload ?? {},
      resultPayload: input.resultPayload ?? {},
      metadata: input.metadata ?? {},
      expiresAt,
      completedAt: null,
      usedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    memorySessions.set(sessionId, session);
    memoryTokenHashes.set(sessionId, resumeTokenHash);
    return {
      session,
      resumeToken,
      statusUrl: buildSessionStatusUrl(env, session.sessionId),
      publicResumeUrl: buildSessionResumeUrl(env, session.sessionId, resumeToken),
    };
  } finally {
    await sql?.end().catch(() => {});
  }
}

export async function getHostedActionSession(
  env: Env,
  merchantId: string,
  sessionId: string,
): Promise<HostedActionSessionView | null> {
  let sql: Sql | undefined;
  try {
    sql = createDb(env);
    const rows = await sql<HostedActionSessionRow[]>`
      SELECT *
      FROM hosted_action_sessions
      WHERE id = ${sessionId}::uuid
        AND merchant_id = ${merchantId}::uuid
      LIMIT 1
    `;
    const row = rows[0];
    if (!row) return null;
    const view = toView(row);
    if (view.status === 'pending' && view.expiresAt.getTime() < Date.now()) {
      return {
        ...view,
        status: 'expired',
      };
    }
    return view;
  } catch (err) {
    if (!isMissingRelationError(err)) throw err;
    const session = memorySessions.get(sessionId);
    if (!session || session.merchantId !== merchantId) return null;
    if (session.status === 'pending' && session.expiresAt.getTime() < Date.now()) {
      return { ...session, status: 'expired' };
    }
    return session;
  } finally {
    await sql?.end().catch(() => {});
  }
}

export async function completeHostedActionSession(
  env: Env,
  input: {
    sessionId: string;
    resumeToken: string;
    status?: HostedActionSessionStatus;
    resultPayload?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  },
): Promise<HostedActionSessionView> {
  const status = input.status ?? 'completed';
  const resumeTokenHash = await sha256Hex(input.resumeToken);

  let sql: Sql | undefined;
  try {
    const sqlClient = createDb(env);
    sql = sqlClient;
    const rows = await sqlClient<HostedActionSessionRow[]>`
      UPDATE hosted_action_sessions
      SET
        status = ${status},
        completed_at = CASE WHEN ${status} = 'pending' THEN completed_at ELSE NOW() END,
        used_at = NOW(),
        result_payload_json = COALESCE(result_payload_json, '{}'::jsonb) || ${JSON.stringify(input.resultPayload ?? {})}::jsonb,
        metadata_json = COALESCE(metadata_json, '{}'::jsonb) || ${JSON.stringify(input.metadata ?? {})}::jsonb,
        updated_at = NOW()
      WHERE id = ${input.sessionId}::uuid
        AND resume_token_hash = ${resumeTokenHash}
        AND used_at IS NULL
      RETURNING *
    `.catch(async (err: unknown) => {
      if (err instanceof Error && /column .*used_at/i.test(err.message)) {
        const fallback = await sqlClient<HostedActionSessionRow[]>`
          UPDATE hosted_action_sessions
          SET
            status = ${status},
            completed_at = CASE WHEN ${status} = 'pending' THEN completed_at ELSE NOW() END,
            result_payload_json = COALESCE(result_payload_json, '{}'::jsonb) || ${JSON.stringify(input.resultPayload ?? {})}::jsonb,
            metadata_json = COALESCE(metadata_json, '{}'::jsonb) || ${JSON.stringify(input.metadata ?? {})}::jsonb,
            updated_at = NOW()
          WHERE id = ${input.sessionId}::uuid
            AND resume_token_hash = ${resumeTokenHash}
          RETURNING *
        `;
        return fallback;
      }
      throw err;
    });

    const row = rows[0];
    if (!row) throw new Error('HOSTED_ACTION_SESSION_INVALID');
    const view = toView(row);
    if (view.expiresAt.getTime() < Date.now()) {
      throw new Error('HOSTED_ACTION_SESSION_EXPIRED');
    }
    return view;
  } catch (err) {
    if (!isMissingRelationError(err)) throw err;
    const session = memorySessions.get(input.sessionId);
    if (!session) throw new Error('HOSTED_ACTION_SESSION_INVALID');
    if (memoryTokenHashes.get(input.sessionId) !== resumeTokenHash) {
      throw new Error('HOSTED_ACTION_SESSION_INVALID');
    }
    if (session.usedAt) {
      throw new Error('HOSTED_ACTION_SESSION_INVALID');
    }
    if (session.expiresAt.getTime() < Date.now()) {
      throw new Error('HOSTED_ACTION_SESSION_EXPIRED');
    }
    const usedAt = new Date();
    const next: HostedActionSessionView = {
      ...session,
      status: resolveMergedStatus(session.status, status),
      resultPayload: {
        ...session.resultPayload,
        ...(input.resultPayload ?? {}),
      },
      metadata: {
        ...session.metadata,
        ...(input.metadata ?? {}),
      },
      completedAt: status === 'pending' ? session.completedAt : (session.completedAt ?? new Date()),
      usedAt,
      updatedAt: usedAt,
    };
    memorySessions.set(input.sessionId, next);
    return next;
  } finally {
    await sql?.end().catch(() => {});
  }
}

export async function syncHostedActionSession(
  env: Env,
  input: {
    sessionId: string;
    status?: HostedActionSessionStatus;
    displayPayload?: Record<string, unknown>;
    resultPayload?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  },
): Promise<HostedActionSessionView> {
  let sql: Sql | undefined;
  try {
    sql = createDb(env);
    const rows = await sql<HostedActionSessionRow[]>`
      SELECT *
      FROM hosted_action_sessions
      WHERE id = ${input.sessionId}::uuid
      LIMIT 1
    `;

    const row = rows[0];
    if (!row) throw new Error('HOSTED_ACTION_SESSION_INVALID');

    const current = toView(row);
    const nextStatus = resolveMergedStatus(current.status, input.status);
    const completedAt = nextStatus === 'pending'
      ? current.completedAt
      : (current.completedAt ?? new Date());

    const updatedRows = await sql<HostedActionSessionRow[]>`
      UPDATE hosted_action_sessions
      SET
        status = ${nextStatus},
        completed_at = ${completedAt ? completedAt.toISOString() : null}::timestamptz,
        display_payload_json = COALESCE(display_payload_json, '{}'::jsonb) || ${JSON.stringify(input.displayPayload ?? {})}::jsonb,
        result_payload_json = COALESCE(result_payload_json, '{}'::jsonb) || ${JSON.stringify(input.resultPayload ?? {})}::jsonb,
        metadata_json = COALESCE(metadata_json, '{}'::jsonb) || ${JSON.stringify(input.metadata ?? {})}::jsonb,
        updated_at = NOW()
      WHERE id = ${input.sessionId}::uuid
      RETURNING *
    `;

    const updated = updatedRows[0];
    if (!updated) throw new Error('HOSTED_ACTION_SESSION_INVALID');
    return toView(updated);
  } catch (err) {
    if (!isMissingRelationError(err)) throw err;
    const session = memorySessions.get(input.sessionId);
    if (!session) throw new Error('HOSTED_ACTION_SESSION_INVALID');

    const nextStatus = resolveMergedStatus(session.status, input.status);
    const next: HostedActionSessionView = {
      ...session,
      status: nextStatus,
      displayPayload: {
        ...session.displayPayload,
        ...(input.displayPayload ?? {}),
      },
      resultPayload: {
        ...session.resultPayload,
        ...(input.resultPayload ?? {}),
      },
      metadata: {
        ...session.metadata,
        ...(input.metadata ?? {}),
      },
      completedAt: nextStatus === 'pending'
        ? session.completedAt
        : (session.completedAt ?? new Date()),
      updatedAt: new Date(),
    };
    memorySessions.set(input.sessionId, next);
    return next;
  } finally {
    await sql?.end().catch(() => {});
  }
}

export function buildHostedActionResumeRedirect(
  session: HostedActionSessionView,
  input: {
    resultPayload?: Record<string, unknown>;
    fallbackText?: string;
  },
): Response {
  if (session.resumeUrl) {
    const redirect = new URL(session.resumeUrl);
    redirect.searchParams.set('agentpayActionSessionId', session.sessionId);
    redirect.searchParams.set('agentpayActionStatus', session.status);
    redirect.searchParams.set('agentpayActionType', session.actionType);
    return Response.redirect(redirect.toString(), 302);
  }

  return new Response(
    input.fallbackText ?? `AgentPay action ${session.status}. You can return to your host and resume the task.`,
    {
      status: 200,
      headers: {
        'content-type': 'text/plain; charset=utf-8',
      },
    },
  );
}
