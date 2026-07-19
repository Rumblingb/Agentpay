import { Hono, type Context } from 'hono';

import {
  CommerceDecisionError,
  hashCommerceValue,
  normalizeBuyerConstitution,
  verifyCommerceDecisionSignature,
  type CommerceDecision,
} from '../lib/commerceDecision';
import { createDb, parseJsonb, type Sql } from '../lib/db';
import {
  authenticateCommercePrincipal,
  createCommerceOrganizationKey,
} from '../middleware/commercePrincipalAuth';
import type { CommercePrincipalContext, Env, Variables } from '../types';

const router = new Hono<{ Bindings: Env; Variables: Variables }>();
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const PRINCIPAL_TYPES = ['user', 'agent', 'service'] as const;

type PrincipalType = (typeof PRINCIPAL_TYPES)[number];

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

function durableDecisionEvidence(decision: CommerceDecision): Record<string, unknown> {
  const recommendation = decision.recommendation;
  return {
    schema: 'agentpay.commerce-decision-evidence/1.0',
    decisionId: decision.decisionId,
    procurementRequestId: decision.procurementRequestId,
    generatedAt: decision.generatedAt,
    expiresAt: decision.expiresAt,
    intent: decision.intent,
    constitution: decision.constitution,
    selectedOffer: recommendation ? {
      id: recommendation.id,
      name: recommendation.name,
      sellerId: recommendation.merchantId,
      sellerName: recommendation.merchantName,
      category: recommendation.category,
      priceMinor: recommendation.priceMinor,
      currency: recommendation.currency,
      refundable: recommendation.refundable,
      returnWindowDays: recommendation.returnWindowDays,
      deliveryDays: recommendation.deliveryDays,
      score: recommendation.score,
      factors: recommendation.factors,
      evidence: recommendation.evidence,
      evidenceFreshAt: recommendation.evidenceFreshAt,
    } : null,
    rejected: decision.rejected.map((entry) => ({
      candidateId: entry.candidate.id,
      reasonCodes: entry.reasons.map((reason) => reason.code),
    })),
    tradeoffs: decision.tradeoffs,
    approval: decision.approval,
    proposedMandate: decision.proposedMandate,
    sourceRetention: 'selected-offer-and-reason-codes-only',
  };
}

async function authorizedOrganization(
  sql: Sql,
  organizationId: string,
  principal: CommercePrincipalContext,
): Promise<{ id: string; defaultCurrency: string }> {
  if (principal.organizationId !== organizationId) {
    throw new CommerceLedgerError('ORGANIZATION_NOT_FOUND', 'Active organization not found', 404);
  }
  const rows = await sql<Array<{ id: string; defaultCurrency: string }>>`
    SELECT organization.id, organization.default_currency AS "defaultCurrency"
    FROM commerce_organizations organization
    WHERE organization.id = ${organizationId}
      AND organization.status = 'active'
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
  organizationId: string,
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
    WHERE request.id = ${requestId}
      AND request.organization_id = ${organizationId}
    LIMIT 1
  `;
  if (!rows.length) {
    throw new CommerceLedgerError('REQUEST_NOT_FOUND', 'Procurement request not found', 404);
  }
  return rows[0];
}

function commercePrincipal(c: Context<{ Bindings: Env; Variables: Variables }>): CommercePrincipalContext {
  const principal = c.get('commercePrincipal');
  if (!principal) throw new CommerceLedgerError('COMMERCE_AUTH_MISSING', 'Organization authentication is required', 403);
  return principal;
}

function requireRole(
  principal: CommercePrincipalContext,
  roles: readonly CommercePrincipalContext['role'][],
): void {
  if (!roles.includes(principal.role)) {
    throw new CommerceLedgerError('ROLE_FORBIDDEN', 'Organization role is not permitted for this action', 403);
  }
}

function isExpired(expiresAt: string | null): boolean {
  return expiresAt !== null && Date.parse(expiresAt) <= Date.now();
}

router.use('/requests', authenticateCommercePrincipal);
router.use('/requests/*', authenticateCommercePrincipal);

router.post('/organizations', async (c) => {
  try {
    const body = await c.req.json() as unknown;
    if (!isRecord(body)) throw new CommerceLedgerError('INVALID_REQUEST', 'A JSON object is required');
    const ownerPrincipalType = enumValue(body.ownerPrincipalType, 'ownerPrincipalType', PRINCIPAL_TYPES);
    const ownerPrincipalId = requiredString(body.ownerPrincipalId, 'ownerPrincipalId', 255);
    const name = requiredString(body.name, 'name', 200);
    const slug = requiredString(body.slug, 'slug', 64).toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/.test(slug)) {
      throw new CommerceLedgerError('INVALID_REQUEST', 'slug must contain 3-64 lowercase letters, numbers, or hyphens');
    }
    const currency = requiredString(body.defaultCurrency, 'defaultCurrency', 3).toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) {
      throw new CommerceLedgerError('INVALID_REQUEST', 'defaultCurrency must be an ISO 4217 code');
    }
    const credential = await createCommerceOrganizationKey();

    const sql = createDb(c.env);
    try {
      const organization = await sql.begin(async (transaction) => {
        const tx = transaction as unknown as Sql;
        const rows = await tx<Array<{ id: string; name: string; slug: string; defaultCurrency: string }>>`
          INSERT INTO commerce_organizations (
            created_by_principal_type, created_by_principal_id, name, slug, default_currency
          )
          VALUES (${ownerPrincipalType}, ${ownerPrincipalId}, ${name}, ${slug}, ${currency})
          ON CONFLICT (slug) DO NOTHING
          RETURNING id, name, slug, default_currency AS "defaultCurrency"
        `;
        if (!rows.length) throw new CommerceLedgerError('SLUG_CONFLICT', 'Organization slug is already in use', 409);
        const members = await tx<Array<{ id: string }>>`
          INSERT INTO commerce_organization_members (
            organization_id, principal_type, principal_id, role, status
          ) VALUES (${rows[0].id}, ${ownerPrincipalType}, ${ownerPrincipalId}, 'owner', 'active')
          RETURNING id
        `;
        await tx`
          INSERT INTO commerce_organization_credentials (
            organization_id, member_id, key_prefix, key_hash, key_salt
          ) VALUES (
            ${rows[0].id}, ${members[0].id}, ${credential.keyPrefix},
            ${credential.keyHash}, ${credential.keySalt}
          )
        `;
        return rows[0];
      });
      return c.json({
        organization,
        organizationKey: credential.presentedKey,
        warning: 'Store this organization key now; it will not be shown again.',
      }, 201);
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
    const principal = commercePrincipal(c);
    requireRole(principal, ['owner', 'admin', 'requester']);
    const organizationId = requiredUuid(body.organizationId, 'organizationId');
    const costCenterId = optionalUuid(body.costCenterId, 'costCenterId');
    const requesterType = principal.principalType;
    const requesterId = principal.principalId;
    const agentId = principal.principalType === 'agent' ? principal.principalId : null;
    const key = idempotencyKey(body.idempotencyKey);
    const intent = requiredString(body.intent, 'intent', 2000);
    const constitution = normalizeBuyerConstitution(body.constitution);
    const policyHash = await hashCommerceValue(constitution);
    const expiresAt = optionalDate(body.expiresAt, 'expiresAt');
    if (expiresAt && Date.parse(expiresAt) <= Date.now()) {
      throw new CommerceLedgerError('REQUEST_EXPIRED', 'expiresAt must be in the future', 409);
    }

    const sql = createDb(c.env);
    try {
      const organization = await authorizedOrganization(sql, organizationId, principal);
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
        || row.costCenterId !== costCenterId
        || row.requesterType !== requesterType
        || row.requesterId !== requesterId
        || row.agentId !== agentId
        || (row.expiresAt ? new Date(row.expiresAt).toISOString() : null) !== expiresAt
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
    const evidence = durableDecisionEvidence(decision);
    const principal = commercePrincipal(c);
    requireRole(principal, ['owner', 'admin', 'requester']);
    const sql = createDb(c.env);
    try {
      const request = await procurementRequest(sql, requestId, principal.organizationId);
      if (isExpired(request.expiresAt)) {
        await sql`
          UPDATE commerce_procurement_requests
          SET state = 'expired', updated_at = now()
          WHERE id = ${requestId} AND state IN ('draft', 'evaluating', 'approval_required', 'approved')
        `;
        throw new CommerceLedgerError('REQUEST_EXPIRED', 'Procurement request has expired', 409);
      }
      if (
        decision.procurementRequestId !== requestId
        || decision.intent !== request.intent
        || decisionPolicyHash !== request.policyHash
      ) {
        throw new CommerceLedgerError(
          'DECISION_DRIFT',
          'Decision is not bound to this exact request, intent, and normalized policy',
          409,
        );
      }
      const recommendation = decision.recommendation;
      const nextState = recommendation
        ? (decision.approval.required ? 'approval_required' : 'approved')
        : 'rejected';
      const requestIntentHash = await hashCommerceValue(request.intent);

      const stored = await sql.begin(async (transaction) => {
        const tx = transaction as unknown as Sql;
        const inserted = await tx<Array<{ id: string }>>`
          INSERT INTO commerce_decisions (
            procurement_request_id, decision_id, schema_version, decision_payload,
            payload_hash, policy_hash, request_intent_hash, signature, signing_key_id,
            recommended_variant_reference, amount_minor, currency, expires_at
          ) VALUES (
            ${requestId}, ${decision.decisionId}, ${decision.schema},
            ${JSON.stringify(evidence)}::jsonb, ${payloadHash}, ${decisionPolicyHash},
            ${requestIntentHash}, ${signature}, ${signingKeyId},
            ${recommendation?.id ?? null},
            ${recommendation?.priceMinor ?? null}, ${recommendation?.currency ?? null},
            ${decision.expiresAt}
          )
          ON CONFLICT (decision_id) DO NOTHING
          RETURNING id
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
        if (request.state !== 'evaluating') {
          if (request.state !== nextState || inserted.length > 0) {
            throw new CommerceLedgerError(
              'REQUEST_STATE_CONFLICT',
              `A decision cannot move a request from ${request.state} to ${nextState}`,
              409,
            );
          }
          return rows[0];
        }
        const transitions = await tx<Array<{ id: string }>>`
          UPDATE commerce_procurement_requests
          SET state = ${nextState}, updated_at = now()
          WHERE id = ${requestId}
            AND state = 'evaluating'
          RETURNING id
        `;
        if (!transitions.length) {
          throw new CommerceLedgerError('REQUEST_STATE_CONFLICT', 'Procurement request changed state concurrently', 409);
        }
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
    const action = enumValue(body.action, 'action', ['approved', 'rejected'] as const);
    const key = idempotencyKey(body.idempotencyKey);
    const reason = body.reason === undefined || body.reason === null
      ? null
      : requiredString(body.reason, 'reason', 1000);
    const normalizedPolicySnapshot = normalizeBuyerConstitution(body.policySnapshot);
    const policyHash = await hashCommerceValue(normalizedPolicySnapshot);
    const principal = commercePrincipal(c);
    requireRole(principal, ['owner', 'admin', 'approver']);

    const sql = createDb(c.env);
    try {
      const request = await procurementRequest(sql, requestId, principal.organizationId);
      if (
        request.requesterType === principal.principalType
        && request.requesterId === principal.principalId
      ) {
        throw new CommerceLedgerError('SELF_APPROVAL_FORBIDDEN', 'Requesters cannot approve their own requests', 403);
      }
      const existing = await sql<Array<{
        sequenceId: string;
        action: string;
        policyHash: string;
        procurementRequestId: string;
      }>>`
        SELECT sequence_id::text AS "sequenceId", action, policy_hash AS "policyHash",
               procurement_request_id AS "procurementRequestId"
        FROM commerce_approvals
        WHERE organization_id = ${request.organizationId} AND idempotency_key = ${key}
        LIMIT 1
      `;
      if (existing.length) {
        if (
          existing[0].action !== action
          || existing[0].policyHash !== policyHash
          || existing[0].procurementRequestId !== requestId
        ) {
          throw new CommerceLedgerError('IDEMPOTENCY_CONFLICT', 'Idempotency key was already used for a different approval', 409);
        }
        return c.json({ approval: { ...existing[0], requestState: request.state } });
      }
      if (isExpired(request.expiresAt)) {
        await sql`
          UPDATE commerce_procurement_requests
          SET state = 'expired', updated_at = now()
          WHERE id = ${requestId} AND state IN ('draft', 'evaluating', 'approval_required', 'approved')
        `;
        throw new CommerceLedgerError('REQUEST_EXPIRED', 'Procurement request has expired', 409);
      }
      if (request.state !== 'approval_required') {
        throw new CommerceLedgerError(
          'REQUEST_STATE_CONFLICT',
          `Request in state ${request.state} cannot be approved or rejected`,
          409,
        );
      }
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
            ${requestId}, ${decisions[0].id}, ${request.organizationId}, ${principal.principalType},
            ${principal.principalId}, ${action}, ${key}, ${JSON.stringify(normalizedPolicySnapshot)}::jsonb,
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
        const nextState = action;
        const transitions = await tx<Array<{ id: string }>>`
          UPDATE commerce_procurement_requests
          SET state = ${nextState}, updated_at = now()
          WHERE id = ${requestId} AND state = 'approval_required'
          RETURNING id
        `;
        if (!transitions.length) {
          throw new CommerceLedgerError('REQUEST_STATE_CONFLICT', 'Procurement request changed state concurrently', 409);
        }
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
    const principal = commercePrincipal(c);
    const sql = createDb(c.env);
    try {
      const request = await procurementRequest(sql, requestId, principal.organizationId);
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
