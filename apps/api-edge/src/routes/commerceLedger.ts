import { Hono, type Context } from 'hono';

import {
  CommerceDecisionError,
  hashCommerceValue,
  normalizeBuyerConstitution,
  verifyCommerceDecisionSignature,
  type CommerceDecision,
} from '../lib/commerceDecision';
import { createDb, parseJsonb, type Sql } from '../lib/db';
import { authenticateApiKey } from '../middleware/auth';
import type { Env, Variables } from '../types';

const router = new Hono<{ Bindings: Env; Variables: Variables }>();
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const PRINCIPAL_TYPES = ['user', 'agent', 'service'] as const;
const APPROVER_TYPES = ['user', 'agent', 'service', 'policy'] as const;

type PrincipalType = (typeof PRINCIPAL_TYPES)[number];
type ApproverType = (typeof APPROVER_TYPES)[number];

type ProcurementRequestRow = {
  id: string;
  organizationId: string;
  costCenterId: string | null;
  requesterType: PrincipalType;
  requesterId: string;
  agentId: string | null;
  idempotencyKey: string;
  intent: string;
  state: string;
  constitutionSnapshot: unknown;
  policyHash: string;
  currency: string;
  maxTotalMinor: string;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
};

class CommerceLedgerError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: 400 | 403 | 404 | 409 | 503 = 400,
  ) {
    super(message);
    this.name = 'CommerceLedgerError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requiredString(
  value: unknown,
  field: string,
  maxLength: number,
): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    throw new CommerceLedgerError('INVALID_REQUEST', `${field} must be a non-empty string of at most ${maxLength} characters`);
  }
  return value.trim();
}

function requiredUuid(value: unknown, field: string): string {
  const normalized = requiredString(value, field, 36);
  if (!UUID_PATTERN.test(normalized)) {
    throw new CommerceLedgerError('INVALID_REQUEST', `${field} must be a UUID`);
  }
  return normalized;
}

function optionalUuid(value: unknown, field: string): string | null {
  return value === undefined || value === null ? null : requiredUuid(value, field);
}

function idempotencyKey(value: unknown): string {
  const normalized = requiredString(value, 'idempotencyKey', 128);
  if (!IDEMPOTENCY_KEY_PATTERN.test(normalized)) {
    throw new CommerceLedgerError('INVALID_REQUEST', 'idempotencyKey has an invalid format');
  }
  return normalized;
}

function enumValue<T extends string>(
  value: unknown,
  field: string,
  allowed: readonly T[],
): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new CommerceLedgerError('INVALID_REQUEST', `${field} must be one of: ${allowed.join(', ')}`);
  }
  return value as T;
}

function optionalDate(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  const raw = requiredString(value, field, 40);
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new CommerceLedgerError('INVALID_REQUEST', `${field} must be an ISO timestamp`);
  }
  return parsed.toISOString();
}

function requestResponse(row: ProcurementRequestRow) {
  return {
    ...row,
    maxTotalMinor: Number(row.maxTotalMinor),
    constitutionSnapshot: parseJsonb(row.constitutionSnapshot, {}),
  };
}

async function ownedOrganization(
  sql: Sql,
  organizationId: string,
  merchantId: string,
): Promise<{ id: string; defaultCurrency: string }> {
  const rows = await sql<Array<{ id: string; defaultCurrency: string }>>`
    SELECT id, default_currency AS "defaultCurrency"
    FROM commerce_organizations
    WHERE id = ${organizationId}
      AND owner_merchant_id = ${merchantId}
      AND status = 'active'
    LIMIT 1
  `;
  if (!rows.length) {
    throw new CommerceLedgerError('ORGANIZATION_NOT_FOUND', 'Active organization not found', 404);
  }
  return rows[0];
}

async function procurementRequest(
  sql: Sql,
  requestId: string,
  merchantId: string,
): Promise<ProcurementRequestRow> {
  const rows = await sql<ProcurementRequestRow[]>`
    SELECT
      request.id,
      request.organization_id AS "organizationId",
      request.cost_center_id AS "costCenterId",
      request.requester_type AS "requesterType",
      request.requester_id AS "requesterId",
      request.agent_id AS "agentId",
      request.idempotency_key AS "idempotencyKey",
      request.intent,
      request.state,
      request.constitution_snapshot AS "constitutionSnapshot",
      request.policy_hash AS "policyHash",
      request.currency,
      request.max_total_minor::text AS "maxTotalMinor",
      request.expires_at AS "expiresAt",
      request.created_at AS "createdAt",
      request.updated_at AS "updatedAt"
    FROM commerce_procurement_requests request
    JOIN commerce_organizations organization ON organization.id = request.organization_id
    WHERE request.id = ${requestId}
      AND organization.owner_merchant_id = ${merchantId}
    LIMIT 1
  `;
  if (!rows.length) {
    throw new CommerceLedgerError('REQUEST_NOT_FOUND', 'Procurement request not found', 404);
  }
  return rows[0];
}

router.use('*', authenticateApiKey);

router.post('/organizations', async (c) => {
  try {
    const body = await c.req.json() as unknown;
    if (!isRecord(body)) throw new CommerceLedgerError('INVALID_REQUEST', 'A JSON object is required');
    const merchant = c.get('merchant');
    const name = requiredString(body.name, 'name', 200);
    const slug = requiredString(body.slug, 'slug', 64).toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/.test(slug)) {
      throw new CommerceLedgerError('INVALID_REQUEST', 'slug must contain 3-64 lowercase letters, numbers, or hyphens');
    }
    const currency = requiredString(body.defaultCurrency, 'defaultCurrency', 3).toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) {
      throw new CommerceLedgerError('INVALID_REQUEST', 'defaultCurrency must be an ISO 4217 code');
    }

    const sql = createDb(c.env);
    try {
      const organization = await sql.begin(async (transaction) => {
        const tx = transaction as unknown as Sql;
        const rows = await tx<Array<{ id: string; name: string; slug: string; defaultCurrency: string }>>`
          INSERT INTO commerce_organizations (owner_merchant_id, name, slug, default_currency)
          VALUES (${merchant.id}, ${name}, ${slug}, ${currency})
          ON CONFLICT (slug) DO NOTHING
          RETURNING id, name, slug, default_currency AS "defaultCurrency"
        `;
        if (!rows.length) throw new CommerceLedgerError('SLUG_CONFLICT', 'Organization slug is already in use', 409);
        await tx`
          INSERT INTO commerce_organization_members (
            organization_id, principal_type, principal_id, role, status
          ) VALUES (${rows[0].id}, 'service', ${merchant.id}, 'owner', 'active')
        `;
        return rows[0];
      });
      return c.json({ organization }, 201);
    } finally {
      sql.end().catch(() => {});
    }
  } catch (error: unknown) {
    return ledgerError(c, error);
  }
});

router.post('/requests', async (c) => {
  try {
    const body = await c.req.json() as unknown;
    if (!isRecord(body)) throw new CommerceLedgerError('INVALID_REQUEST', 'A JSON object is required');
    const merchant = c.get('merchant');
    const organizationId = requiredUuid(body.organizationId, 'organizationId');
    const costCenterId = optionalUuid(body.costCenterId, 'costCenterId');
    const requesterType = enumValue(body.requesterType, 'requesterType', PRINCIPAL_TYPES);
    const requesterId = requiredString(body.requesterId, 'requesterId', 255);
    const agentId = body.agentId === undefined || body.agentId === null
      ? null
      : requiredString(body.agentId, 'agentId', 255);
    const key = idempotencyKey(body.idempotencyKey);
    const intent = requiredString(body.intent, 'intent', 2000);
    const constitution = normalizeBuyerConstitution(body.constitution);
    const policyHash = await hashCommerceValue(constitution);
    const expiresAt = optionalDate(body.expiresAt, 'expiresAt');

    const sql = createDb(c.env);
    try {
      const organization = await ownedOrganization(sql, organizationId, merchant.id);
      if (organization.defaultCurrency !== constitution.currency) {
        throw new CommerceLedgerError('CURRENCY_MISMATCH', 'Constitution currency must match the organization currency');
      }
      if (costCenterId) {
        const centers = await sql<Array<{ id: string }>>`
          SELECT id FROM commerce_cost_centers
          WHERE id = ${costCenterId} AND organization_id = ${organizationId} AND active = true
        `;
        if (!centers.length) throw new CommerceLedgerError('COST_CENTER_NOT_FOUND', 'Active cost center not found', 404);
      }

      const row = await sql.begin(async (transaction) => {
        const tx = transaction as unknown as Sql;
        await tx`
          INSERT INTO commerce_procurement_requests (
            organization_id, cost_center_id, requester_type, requester_id, agent_id,
            idempotency_key, intent, state, constitution_snapshot, policy_hash,
            currency, max_total_minor, expires_at
          ) VALUES (
            ${organizationId}, ${costCenterId}, ${requesterType}, ${requesterId}, ${agentId},
            ${key}, ${intent}, 'evaluating', ${JSON.stringify(constitution)}::jsonb, ${policyHash},
            ${constitution.currency}, ${constitution.maxTotalMinor}, ${expiresAt}
          )
          ON CONFLICT (organization_id, idempotency_key) DO NOTHING
        `;
        const rows = await tx<ProcurementRequestRow[]>`
          SELECT
            id, organization_id AS "organizationId", cost_center_id AS "costCenterId",
            requester_type AS "requesterType", requester_id AS "requesterId",
            agent_id AS "agentId", idempotency_key AS "idempotencyKey", intent, state,
            constitution_snapshot AS "constitutionSnapshot", policy_hash AS "policyHash",
            currency, max_total_minor::text AS "maxTotalMinor", expires_at AS "expiresAt",
            created_at AS "createdAt", updated_at AS "updatedAt"
          FROM commerce_procurement_requests
          WHERE organization_id = ${organizationId} AND idempotency_key = ${key}
          FOR UPDATE
        `;
        return rows[0];
      });

      if (
        row.policyHash !== policyHash
        || row.intent !== intent
        || Number(row.maxTotalMinor) !== constitution.maxTotalMinor
      ) {
        throw new CommerceLedgerError('IDEMPOTENCY_CONFLICT', 'Idempotency key was already used for a different request', 409);
      }
      return c.json({ request: requestResponse(row) }, 201);
    } finally {
      sql.end().catch(() => {});
    }
  } catch (error: unknown) {
    return ledgerError(c, error);
  }
});

router.post('/requests/:requestId/decisions', async (c) => {
  try {
    const requestId = requiredUuid(c.req.param('requestId'), 'requestId');
    const body = await c.req.json() as unknown;
    if (!isRecord(body) || !isRecord(body.decision)) {
      throw new CommerceLedgerError('INVALID_REQUEST', 'decision and signature are required');
    }
    const signature = requiredString(body.signature, 'signature', 512);
    const signingKeyId = requiredString(body.signingKeyId ?? 'agentpay-commerce-v1', 'signingKeyId', 120);
    const decision = body.decision as CommerceDecision;
    if (!await verifyCommerceDecisionSignature(decision, signature, c.env.AGENTPAY_SIGNING_SECRET)) {
      throw new CommerceLedgerError('INVALID_SIGNATURE', 'Commerce decision signature is invalid', 403);
    }
    if (Date.parse(decision.expiresAt) <= Date.now()) {
      throw new CommerceLedgerError('DECISION_EXPIRED', 'Commerce decision has expired', 409);
    }

    const payloadHash = await hashCommerceValue(decision);
    const decisionPolicyHash = await hashCommerceValue(decision.constitution);
    const merchant = c.get('merchant');
    const sql = createDb(c.env);
    try {
      const request = await procurementRequest(sql, requestId, merchant.id);
      if (
        decision.intent !== request.intent
        || decisionPolicyHash !== request.policyHash
      ) {
        throw new CommerceLedgerError('DECISION_DRIFT', 'Decision no longer matches the procurement policy', 409);
      }
      const recommendation = decision.recommendation;
      const nextState = recommendation
        ? (decision.approval.required ? 'approval_required' : 'approved')
        : 'rejected';

      const stored = await sql.begin(async (transaction) => {
        const tx = transaction as unknown as Sql;
        await tx`
          INSERT INTO commerce_decisions (
            procurement_request_id, decision_id, schema_version, decision_payload,
            payload_hash, signature, signing_key_id, amount_minor, currency, expires_at
          ) VALUES (
            ${requestId}, ${decision.decisionId}, ${decision.schema},
            ${JSON.stringify(decision)}::jsonb, ${payloadHash}, ${signature}, ${signingKeyId},
            ${recommendation?.priceMinor ?? null}, ${recommendation?.currency ?? null},
            ${decision.expiresAt}
          )
          ON CONFLICT (decision_id) DO NOTHING
        `;
        const rows = await tx<Array<{ id: string; decisionId: string; payloadHash: string; expiresAt: string }>>`
          SELECT id, decision_id AS "decisionId", payload_hash AS "payloadHash", expires_at AS "expiresAt"
          FROM commerce_decisions
          WHERE decision_id = ${decision.decisionId}
            AND procurement_request_id = ${requestId}
          FOR UPDATE
        `;
        if (!rows.length || rows[0].payloadHash !== payloadHash) {
          throw new CommerceLedgerError('DECISION_CONFLICT', 'Decision ID is already bound to different evidence', 409);
        }
        await tx`
          UPDATE commerce_procurement_requests
          SET state = ${nextState}, updated_at = now()
          WHERE id = ${requestId}
            AND state IN ('draft', 'evaluating', 'approval_required', 'approved', 'rejected')
        `;
        return rows[0];
      });
      return c.json({ decision: stored, requestState: nextState }, 201);
    } finally {
      sql.end().catch(() => {});
    }
  } catch (error: unknown) {
    return ledgerError(c, error);
  }
});

router.post('/requests/:requestId/approvals', async (c) => {
  try {
    const requestId = requiredUuid(c.req.param('requestId'), 'requestId');
    const body = await c.req.json() as unknown;
    if (!isRecord(body) || !isRecord(body.policySnapshot)) {
      throw new CommerceLedgerError('INVALID_REQUEST', 'policySnapshot is required');
    }
    const decisionId = requiredString(body.decisionId, 'decisionId', 128);
    const action = enumValue(body.action, 'action', ['approved', 'rejected', 'revoked'] as const);
    const approverType = enumValue(body.approverType, 'approverType', APPROVER_TYPES);
    const approverId = requiredString(body.approverId, 'approverId', 255);
    const key = idempotencyKey(body.idempotencyKey);
    const reason = body.reason === undefined || body.reason === null
      ? null
      : requiredString(body.reason, 'reason', 1000);
    const policyHash = await hashCommerceValue(body.policySnapshot);
    const merchant = c.get('merchant');

    const sql = createDb(c.env);
    try {
      const request = await procurementRequest(sql, requestId, merchant.id);
      if (request.policyHash !== policyHash) {
        throw new CommerceLedgerError('POLICY_DRIFT', 'Approval policy snapshot differs from the evaluated policy', 409);
      }
      const decisions = await sql<Array<{ id: string; expiresAt: string }>>`
        SELECT id, expires_at AS "expiresAt"
        FROM commerce_decisions
        WHERE procurement_request_id = ${requestId} AND decision_id = ${decisionId}
        LIMIT 1
      `;
      if (!decisions.length) throw new CommerceLedgerError('DECISION_NOT_FOUND', 'Decision not found', 404);
      if (action === 'approved' && Date.parse(decisions[0].expiresAt) <= Date.now()) {
        throw new CommerceLedgerError('DECISION_EXPIRED', 'Expired decisions cannot be approved', 409);
      }

      const outcome = await sql.begin(async (transaction) => {
        const tx = transaction as unknown as Sql;
        await tx`
          INSERT INTO commerce_approvals (
            procurement_request_id, decision_id, organization_id, approver_type,
            approver_id, action, idempotency_key, policy_snapshot, policy_hash, reason
          ) VALUES (
            ${requestId}, ${decisions[0].id}, ${request.organizationId}, ${approverType},
            ${approverId}, ${action}, ${key}, ${JSON.stringify(body.policySnapshot)}::jsonb,
            ${policyHash}, ${reason}
          )
          ON CONFLICT (organization_id, idempotency_key) DO NOTHING
        `;
        const rows = await tx<Array<{ sequenceId: string; action: string; policyHash: string }>>`
          SELECT sequence_id::text AS "sequenceId", action, policy_hash AS "policyHash"
          FROM commerce_approvals
          WHERE organization_id = ${request.organizationId} AND idempotency_key = ${key}
          FOR UPDATE
        `;
        if (!rows.length || rows[0].action !== action || rows[0].policyHash !== policyHash) {
          throw new CommerceLedgerError('IDEMPOTENCY_CONFLICT', 'Idempotency key was already used for a different approval', 409);
        }
        const nextState = action === 'approved' ? 'approved' : action === 'rejected' ? 'rejected' : 'approval_required';
        await tx`
          UPDATE commerce_procurement_requests
          SET state = ${nextState}, updated_at = now()
          WHERE id = ${requestId}
        `;
        return { ...rows[0], requestState: nextState };
      });
      return c.json({ approval: outcome }, 201);
    } finally {
      sql.end().catch(() => {});
    }
  } catch (error: unknown) {
    return ledgerError(c, error);
  }
});

router.get('/requests/:requestId', async (c) => {
  try {
    const requestId = requiredUuid(c.req.param('requestId'), 'requestId');
    const merchant = c.get('merchant');
    const sql = createDb(c.env);
    try {
      const request = await procurementRequest(sql, requestId, merchant.id);
      const decisions = await sql<Array<Record<string, unknown>>>`
        SELECT id, decision_id AS "decisionId", schema_version AS "schemaVersion",
               payload_hash AS "payloadHash", signing_key_id AS "signingKeyId",
               amount_minor::text AS "amountMinor", currency, expires_at AS "expiresAt",
               created_at AS "createdAt"
        FROM commerce_decisions
        WHERE procurement_request_id = ${requestId}
        ORDER BY created_at ASC
      `;
      const approvals = await sql<Array<Record<string, unknown>>>`
        SELECT sequence_id::text AS "sequenceId", approver_type AS "approverType",
               approver_id AS "approverId", action, policy_hash AS "policyHash",
               reason, occurred_at AS "occurredAt"
        FROM commerce_approvals
        WHERE procurement_request_id = ${requestId}
        ORDER BY sequence_id ASC
      `;
      return c.json({ request: requestResponse(request), decisions, approvals });
    } finally {
      sql.end().catch(() => {});
    }
  } catch (error: unknown) {
    return ledgerError(c, error);
  }
});

function ledgerError(
  c: Context<{ Bindings: Env; Variables: Variables }>,
  error: unknown,
): Response {
  if (error instanceof CommerceLedgerError) {
    return c.json({ error: error.code, message: error.message }, error.status);
  }
  if (error instanceof CommerceDecisionError || error instanceof SyntaxError) {
    return c.json({
      error: error instanceof CommerceDecisionError ? error.code : 'INVALID_REQUEST',
      message: error instanceof CommerceDecisionError ? error.message : 'A valid JSON body is required',
    }, 400);
  }
  console.error('[commerce-ledger] request failed', error instanceof Error ? error.message : String(error));
  return c.json({ error: 'INTERNAL_ERROR', message: 'Commerce ledger request failed' }, 500);
}

export { router as commerceLedgerRouter };
