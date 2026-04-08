/**
 * RCM routes — /api/rcm/*
 *
 * Thin vertical surface for autonomous hospital / provider billing ops.
 * The first lane now has a live control loop and manager reads, while the
 * broader RCM domain still grows incrementally on top of AgentPay core.
 */

import { Hono, type Context } from 'hono';
import Stripe from 'stripe';
import type { Env, Variables } from '../types';
import { authenticateApiKey } from '../middleware/auth';
import { createDb, parseJsonb, type Sql } from '../lib/db';
import {
  getClaimStatusConnectorAvailability,
  runClaimStatusConnector,
  type ClaimStatusAutoQaRecommendation,
  type ClaimStatusConnectorExecution,
  type ClaimStatusConnectorExecutionInput,
  type ClaimStatusConnectorKey,
  type ClaimStatusExceptionSuggestion,
} from '../lib/rcmClaimStatusConnector';
import {
  getEligibilityConnectorAvailability,
  runEligibilityConnector,
  type EligibilityAutoQaRecommendation,
  type EligibilityConnectorExecution,
  type EligibilityConnectorExecutionInput,
  type EligibilityConnectorKey,
  type EligibilityExceptionSuggestion,
} from '../lib/rcmEligibilityConnector';
import {
  getDenialFollowUpConnectorAvailability,
  runDenialFollowUpConnector,
  type DenialFollowUpAutoQaRecommendation,
  type DenialFollowUpConnectorExecution,
  type DenialFollowUpConnectorExecutionInput,
  type DenialFollowUpConnectorKey,
  type DenialFollowUpExceptionSuggestion,
} from '../lib/rcmDenialFollowUpConnector';
import {
  getEra835ConnectorAvailability,
  runEra835Connector,
  type Era835ConnectorExecutionInput,
} from '../lib/rcmEra835Connector';
import {
  getPriorAuthConnectorAvailability,
  runPriorAuthConnector,
  priorAuthLaneContract,
  PRIOR_AUTH_LANE_KEY,
  type PriorAuthConnectorKey,
  type PriorAuthConnectorExecutionInput,
} from '../lib/rcmPriorAuthConnector';

const router = new Hono<{ Bindings: Env; Variables: Variables }>();

type JsonRecord = Record<string, unknown>;

type WorkItemRow = {
  id: string;
  workspaceId: string;
  workspaceName: string;
  assignedAgentId: string | null;
  workType: string;
  formType?: string | null;
  title: string;
  payerName: string | null;
  coverageType: string | null;
  patientRef: string | null;
  providerRef: string | null;
  claimRef: string | null;
  sourceSystem: string | null;
  amountAtRisk: string | number | null;
  confidencePct: number | null;
  priority: string;
  status: string;
  requiresHumanReview: boolean;
  dueAt: Date | string | null;
  submittedAt: Date | string | null;
  completedAt: Date | string | null;
  metadata: unknown;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type ExceptionQueueRow = {
  id: string;
  workItemId: string;
  workspaceName: string;
  payerName: string | null;
  claimRef: string | null;
  priority: string;
  exceptionType: string;
  severity: string;
  reasonCode: string | null;
  summary: string;
  confidencePct: number | null;
  amountAtRisk: string | number | null;
  payload: unknown;
  openedAt: Date | string;
};

type OpenExceptionRow = {
  id: string;
  payload: unknown;
};

type EvidenceInput = {
  actorType?: string;
  actorRef?: string;
  evidenceType: string;
  payload?: unknown;
};

function jsonb(value: unknown): string {
  return JSON.stringify(value ?? {});
}

function toIso(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  return null;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function asObject(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function parseDateString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function parsePositiveAmount(value: unknown): number | null {
  const amount = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function parseConfidence(value: unknown): number | null {
  const confidence = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(confidence)) return null;
  if (confidence < 0 || confidence > 100) return null;
  return Math.round(confidence);
}

function parseLimit(value: string | undefined, fallback = 50, max = 200): number {
  const parsed = value ? Number(value) : fallback;
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.round(parsed), max);
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function validationResponse(
  c: Context<{ Bindings: Env; Variables: Variables }>,
  details: string[],
) {
  return c.json({ error: 'Validation error', details }, 400);
}

function normalizePriority(value: unknown): string {
  const raw = typeof value === 'string' ? value.toLowerCase() : 'normal';
  return ['urgent', 'high', 'normal', 'low'].includes(raw) ? raw : 'normal';
}

function getAttemptHistory(metadata: JsonRecord): JsonRecord[] {
  const attempts = metadata['attemptHistory'];
  return Array.isArray(attempts) ? attempts.filter((entry): entry is JsonRecord => Boolean(entry) && typeof entry === 'object') : [];
}

function mapWorkItem(row: WorkItemRow) {
  const metadata = parseJsonb<JsonRecord>(row.metadata, {});
  return {
    workItemId: row.id,
    workspaceId: row.workspaceId,
    workspaceName: row.workspaceName,
    assignedAgentId: row.assignedAgentId,
    workType: row.workType,
    title: row.title,
    payerName: row.payerName,
    coverageType: row.coverageType,
    patientRef: row.patientRef,
    providerRef: row.providerRef,
    claimRef: row.claimRef,
    sourceSystem: row.sourceSystem,
    amountAtRisk: row.amountAtRisk === null ? null : Number(row.amountAtRisk),
    confidencePct: row.confidencePct,
    priority: row.priority,
    status: row.status,
    requiresHumanReview: row.requiresHumanReview,
    dueAt: toIso(row.dueAt),
    submittedAt: toIso(row.submittedAt),
    completedAt: toIso(row.completedAt),
    metadata,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

function mapException(row: ExceptionQueueRow) {
  const payload = parseJsonb<JsonRecord>(row.payload, {});
  return {
    exceptionId: row.id,
    workItemId: row.workItemId,
    workspaceName: row.workspaceName,
    payerName: row.payerName,
    claimRef: row.claimRef,
    priority: row.priority,
    exceptionType: row.exceptionType,
    severity: row.severity,
    reasonCode: row.reasonCode,
    summary: row.summary,
    confidencePct: row.confidencePct,
    amountAtRisk: row.amountAtRisk === null ? null : Number(row.amountAtRisk),
    requiredContextFields: Array.isArray(payload['requiredContextFields'])
      ? payload['requiredContextFields'].filter(
          (value): value is string => typeof value === 'string' && value.trim().length > 0,
        )
      : [],
    recommendedHumanAction: typeof payload['recommendedHumanAction'] === 'string' ? payload['recommendedHumanAction'] : null,
    assignedReviewer: typeof payload['assignedReviewer'] === 'string' ? payload['assignedReviewer'] : null,
    slaAt: toIso(payload['slaAt']),
    openedAt: toIso(row.openedAt),
    payload,
  };
}

async function getOwnedWorkspace(sql: Sql, merchantId: string, workspaceId: string) {
  const rows = await sql<Array<{ id: string; name: string }>>`
    SELECT id, name
    FROM rcm_workspaces
    WHERE id = ${workspaceId}
      AND merchant_id = ${merchantId}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

async function getOwnedClaimStatusWorkItem(sql: Sql, merchantId: string, workItemId: string) {
  const rows = await sql<WorkItemRow[]>`
    SELECT
      w.id,
      w.workspace_id         AS "workspaceId",
      ws.name                AS "workspaceName",
      w.assigned_agent_id    AS "assignedAgentId",
      w.work_type            AS "workType",
      w.form_type            AS "formType",
      w.title,
      w.payer_name           AS "payerName",
      w.coverage_type        AS "coverageType",
      w.patient_ref          AS "patientRef",
      w.provider_ref         AS "providerRef",
      w.claim_ref            AS "claimRef",
      w.source_system        AS "sourceSystem",
      w.amount_at_risk       AS "amountAtRisk",
      w.confidence_pct       AS "confidencePct",
      w.priority,
      w.status,
      w.requires_human_review AS "requiresHumanReview",
      w.due_at               AS "dueAt",
      w.submitted_at         AS "submittedAt",
      w.completed_at         AS "completedAt",
      w.metadata,
      w.created_at           AS "createdAt",
      w.updated_at           AS "updatedAt"
    FROM rcm_work_items w
    JOIN rcm_workspaces ws ON ws.id = w.workspace_id
    WHERE w.id = ${workItemId}
      AND w.merchant_id = ${merchantId}
      AND w.work_type = ${claimStatusLaneContract.laneKey}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

async function getOwnedClaimStatusWorkItemForUpdate(
  sql: Sql,
  merchantId: string,
  workItemId: string,
) {
  const rows = await sql<WorkItemRow[]>`
    SELECT
      w.id,
      w.workspace_id         AS "workspaceId",
      ws.name                AS "workspaceName",
      w.assigned_agent_id    AS "assignedAgentId",
      w.work_type            AS "workType",
      w.form_type            AS "formType",
      w.title,
      w.payer_name           AS "payerName",
      w.coverage_type        AS "coverageType",
      w.patient_ref          AS "patientRef",
      w.provider_ref         AS "providerRef",
      w.claim_ref            AS "claimRef",
      w.source_system        AS "sourceSystem",
      w.amount_at_risk       AS "amountAtRisk",
      w.confidence_pct       AS "confidencePct",
      w.priority,
      w.status,
      w.requires_human_review AS "requiresHumanReview",
      w.due_at               AS "dueAt",
      w.submitted_at         AS "submittedAt",
      w.completed_at         AS "completedAt",
      w.metadata,
      w.created_at           AS "createdAt",
      w.updated_at           AS "updatedAt"
    FROM rcm_work_items w
    JOIN rcm_workspaces ws ON ws.id = w.workspace_id
    WHERE w.id = ${workItemId}
      AND w.merchant_id = ${merchantId}
      AND w.work_type = ${claimStatusLaneContract.laneKey}
    LIMIT 1
    FOR UPDATE
  `;
  return rows[0] ?? null;
}

async function insertEvidence(
  sql: Sql,
  workItemId: string,
  items: EvidenceInput[],
  defaultActorType: string,
  defaultActorRef: string,
) {
  for (const item of items) {
    await sql`
      INSERT INTO rcm_work_item_evidence
        (id, work_item_id, actor_type, actor_ref, evidence_type, payload, created_at)
      VALUES
        (
          ${crypto.randomUUID()},
          ${workItemId},
          ${item.actorType ?? defaultActorType},
          ${item.actorRef ?? defaultActorRef},
          ${item.evidenceType},
          ${jsonb(item.payload ?? {})}::jsonb,
          NOW()
      )
    `;
  }
}

async function getLatestOpenExceptionForUpdate(sql: Sql, workItemId: string) {
  const rows = await sql<OpenExceptionRow[]>`
    SELECT id, payload
    FROM rcm_exceptions
    WHERE work_item_id = ${workItemId}
      AND resolved_at IS NULL
    ORDER BY created_at DESC
    LIMIT 1
    FOR UPDATE
  `;
  return rows[0] ?? null;
}

async function upsertVendorMetric(
  sql: Sql,
  merchantId: string,
  agentId: string,
  delta: { approved?: number; rejected?: number; escalated?: number; completed?: number },
) {
  const now = new Date();
  const periodStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999).toISOString();

  const existing = await sql<Array<{ id: string }>>`
    SELECT id FROM rcm_vendor_metrics
    WHERE merchant_id = ${merchantId}
      AND agent_id    = ${agentId}
      AND period_start = ${periodStart}
    LIMIT 1
  `;

  if (existing[0]) {
    await sql`
      UPDATE rcm_vendor_metrics SET
        completed_count  = completed_count  + ${delta.completed ?? 0},
        approved_count   = approved_count   + ${delta.approved ?? 0},
        rejected_count   = rejected_count   + ${delta.rejected ?? 0},
        escalated_count  = escalated_count  + ${delta.escalated ?? 0},
        updated_at       = NOW()
      WHERE id = ${existing[0].id}
    `;
  } else {
    await sql`
      INSERT INTO rcm_vendor_metrics (
        id, merchant_id, agent_id, period_start, period_end,
        completed_count, approved_count, rejected_count, escalated_count,
        avg_turnaround_mins, released_amount, score_payload, created_at, updated_at
      ) VALUES (
        ${crypto.randomUUID()}, ${merchantId}, ${agentId}, ${periodStart}, ${periodEnd},
        ${delta.completed ?? 0}, ${delta.approved ?? 0}, ${delta.rejected ?? 0}, ${delta.escalated ?? 0},
        0, 0, '{}'::jsonb, NOW(), NOW()
      )
    `;
  }
}

function connectorInputFromWorkItem(row: WorkItemRow): ClaimStatusConnectorExecutionInput {
  return {
    workItemId: row.id,
    claimRef: row.claimRef ?? '',
    payerName: row.payerName ?? '',
    coverageType: row.coverageType ?? '',
    patientRef: row.patientRef ?? '',
    providerRef: row.providerRef ?? '',
    formType: row.formType ?? '',
    sourceSystem: row.sourceSystem ?? '',
    amountAtRisk: row.amountAtRisk === null ? null : Number(row.amountAtRisk),
    metadata: parseJsonb<JsonRecord>(row.metadata, {}),
  };
}

async function resolveOpenExceptions(sql: any, workItemId: string) {
  await sql`
    UPDATE rcm_exceptions
    SET resolved_at = NOW()
    WHERE work_item_id = ${workItemId}
      AND resolved_at IS NULL
  `;
}

async function upsertOpenException(
  sql: Sql,
  workItemId: string,
  params: {
    exceptionType: string;
    severity: string;
    reasonCode: string | null;
    summary: string;
    payload: JsonRecord;
  },
) {
  const existing = await getLatestOpenExceptionForUpdate(sql, workItemId);
  if (existing) {
    const existingPayload = parseJsonb<JsonRecord>(existing.payload, {});
    await sql`
      UPDATE rcm_exceptions
      SET
        exception_type = ${params.exceptionType},
        severity = ${params.severity},
        reason_code = ${params.reasonCode},
        summary = ${params.summary},
        payload = ${jsonb({
          ...existingPayload,
          ...params.payload,
        })}::jsonb
      WHERE id = ${existing.id}
    `;
    return existing.id;
  }

  const exceptionId = crypto.randomUUID();
  await sql`
    INSERT INTO rcm_exceptions (
      id,
      work_item_id,
      exception_type,
      severity,
      reason_code,
      summary,
      payload,
      created_at
    )
    VALUES (
      ${exceptionId},
      ${workItemId},
      ${params.exceptionType},
      ${params.severity},
      ${params.reasonCode},
      ${params.summary},
      ${jsonb(params.payload)}::jsonb,
      NOW()
    )
  `;
  return exceptionId;
}

function defaultExceptionForConnector(result: ClaimStatusConnectorExecution): ClaimStatusExceptionSuggestion {
  return (
    result.exceptionSuggestion ?? {
      exceptionType: 'ambiguous_payer_response',
      severity: 'high',
      summary: result.summary,
      recommendedHumanAction: 'Review the connector result and decide whether to take over or add context.',
      requiredContextFields: ['payer_follow_up_context'],
      reasonCode: result.resolutionReasonCode,
    }
  );
}

// ─── Eligibility lane — DB helpers ───────────────────────────────────────────

async function getOwnedEligibilityWorkItem(sql: Sql, merchantId: string, workItemId: string) {
  const rows = await sql<WorkItemRow[]>`
    SELECT
      w.id,
      w.workspace_id         AS "workspaceId",
      ws.name                AS "workspaceName",
      w.assigned_agent_id    AS "assignedAgentId",
      w.work_type            AS "workType",
      w.form_type            AS "formType",
      w.title,
      w.payer_name           AS "payerName",
      w.coverage_type        AS "coverageType",
      w.patient_ref          AS "patientRef",
      w.provider_ref         AS "providerRef",
      w.claim_ref            AS "claimRef",
      w.source_system        AS "sourceSystem",
      w.amount_at_risk       AS "amountAtRisk",
      w.confidence_pct       AS "confidencePct",
      w.priority,
      w.status,
      w.requires_human_review AS "requiresHumanReview",
      w.due_at               AS "dueAt",
      w.submitted_at         AS "submittedAt",
      w.completed_at         AS "completedAt",
      w.metadata,
      w.created_at           AS "createdAt",
      w.updated_at           AS "updatedAt"
    FROM rcm_work_items w
    JOIN rcm_workspaces ws ON ws.id = w.workspace_id
    WHERE w.id = ${workItemId}
      AND w.merchant_id = ${merchantId}
      AND w.work_type = ${eligibilityLaneContract.laneKey}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

async function getOwnedEligibilityWorkItemForUpdate(sql: Sql, merchantId: string, workItemId: string) {
  const rows = await sql<WorkItemRow[]>`
    SELECT
      w.id,
      w.workspace_id         AS "workspaceId",
      ws.name                AS "workspaceName",
      w.assigned_agent_id    AS "assignedAgentId",
      w.work_type            AS "workType",
      w.form_type            AS "formType",
      w.title,
      w.payer_name           AS "payerName",
      w.coverage_type        AS "coverageType",
      w.patient_ref          AS "patientRef",
      w.provider_ref         AS "providerRef",
      w.claim_ref            AS "claimRef",
      w.source_system        AS "sourceSystem",
      w.amount_at_risk       AS "amountAtRisk",
      w.confidence_pct       AS "confidencePct",
      w.priority,
      w.status,
      w.requires_human_review AS "requiresHumanReview",
      w.due_at               AS "dueAt",
      w.submitted_at         AS "submittedAt",
      w.completed_at         AS "completedAt",
      w.metadata,
      w.created_at           AS "createdAt",
      w.updated_at           AS "updatedAt"
    FROM rcm_work_items w
    JOIN rcm_workspaces ws ON ws.id = w.workspace_id
    WHERE w.id = ${workItemId}
      AND w.merchant_id = ${merchantId}
      AND w.work_type = ${eligibilityLaneContract.laneKey}
    LIMIT 1
    FOR UPDATE
  `;
  return rows[0] ?? null;
}

function mapEligibilityWorkItem(row: WorkItemRow) {
  const base = mapWorkItem(row);
  const metadata = parseJsonb<JsonRecord>(row.metadata, {});
  return {
    workItemId: base.workItemId,
    workspaceId: base.workspaceId,
    workspaceName: base.workspaceName,
    assignedAgentId: base.assignedAgentId,
    workType: base.workType,
    title: base.title,
    payerName: base.payerName,
    coverageType: base.coverageType,
    /** claim_ref column stores the member/subscriber ID for eligibility work items. */
    memberId: base.claimRef,
    patientRef: base.patientRef,
    providerRef: base.providerRef,
    sourceSystem: base.sourceSystem,
    amountAtRisk: base.amountAtRisk,
    confidencePct: base.confidencePct,
    priority: base.priority,
    status: base.status,
    requiresHumanReview: base.requiresHumanReview,
    dueAt: base.dueAt,
    submittedAt: base.submittedAt,
    completedAt: base.completedAt,
    // Eligibility-specific fields promoted from metadata
    dateOfService: typeof metadata['dateOfService'] === 'string' ? metadata['dateOfService'] : null,
    serviceTypeCodes: Array.isArray(metadata['serviceTypeCodes'])
      ? metadata['serviceTypeCodes'].filter((s): s is string => typeof s === 'string')
      : [],
    providerNpi: typeof metadata['providerNpi'] === 'string' ? metadata['providerNpi'] : null,
    payerId: typeof metadata['payerId'] === 'string' ? metadata['payerId'] : null,
    metadata: base.metadata,
    createdAt: base.createdAt,
    updatedAt: base.updatedAt,
  };
}

function eligibilityConnectorInputFromWorkItem(row: WorkItemRow): EligibilityConnectorExecutionInput {
  const metadata = parseJsonb<JsonRecord>(row.metadata, {});
  return {
    workItemId: row.id,
    memberId: row.claimRef ?? '',
    payerName: row.payerName ?? '',
    payerId: typeof metadata['payerId'] === 'string' ? metadata['payerId'] : null,
    coverageType: row.coverageType ?? '',
    patientRef: row.patientRef ?? '',
    providerRef: row.providerRef ?? '',
    providerNpi: typeof metadata['providerNpi'] === 'string' ? metadata['providerNpi'] : '',
    dateOfService: typeof metadata['dateOfService'] === 'string' ? metadata['dateOfService'] : '',
    serviceTypeCodes: Array.isArray(metadata['serviceTypeCodes'])
      ? metadata['serviceTypeCodes'].filter((s): s is string => typeof s === 'string')
      : [],
    formType: row.formType ?? '',
    sourceSystem: row.sourceSystem ?? '',
    metadata,
  };
}

function defaultExceptionForEligibilityConnector(result: EligibilityConnectorExecution): EligibilityExceptionSuggestion {
  return (
    result.exceptionSuggestion ?? {
      exceptionType: 'payer_system_unavailable',
      severity: 'high',
      summary: result.summary,
      recommendedHumanAction:
        'Review the connector result and verify eligibility manually via the payer portal.',
      requiredContextFields: ['manual_verification_path'],
      reasonCode: result.resolutionReasonCode,
    }
  );
}

function eligibilityQaDecisionForRecommendation(
  recommendation: EligibilityAutoQaRecommendation,
): 'approve_auto_close' | 'escalate' {
  return recommendation === 'close_auto' ? 'approve_auto_close' : 'escalate';
}

async function persistEligibilityConnectorRun(
  sql: any,
  merchantId: string,
  workItemId: string,
  params: {
    attemptRole: 'primary_worker' | 'fallback_worker';
    agentId: string | null;
    qaActorRef: string;
    playbookVersion: string;
    strategy: string;
    connectorResult: EligibilityConnectorExecution;
    autoRoute: boolean;
  },
) {
  const row = await getOwnedEligibilityWorkItemForUpdate(sql, merchantId, workItemId);
  if (!row) throw new Error('WORK_ITEM_NOT_FOUND');

  const expectedStatus = params.attemptRole === 'primary_worker' ? 'routed' : 'retry_pending';
  if (row.status !== expectedStatus) throw new Error('INVALID_STATE');

  const metadata = parseJsonb<JsonRecord>(row.metadata, {});
  const attempts = getAttemptHistory(metadata);
  if (attempts.length >= eligibilityLaneContract.retryPolicy.maxAutonomousAttempts) {
    throw new Error('ATTEMPTS_EXHAUSTED');
  }

  if (params.attemptRole === 'fallback_worker') {
    if (attempts.length === 0) throw new Error('NO_PRIOR_ATTEMPT');
    const previousAttempt = attempts[attempts.length - 1];
    const previousStrategy =
      typeof previousAttempt['strategy'] === 'string' ? previousAttempt['strategy'] : '';
    const previousConnector =
      typeof previousAttempt['connectorStrategy'] === 'string'
        ? previousAttempt['connectorStrategy']
        : previousStrategy;
    const strategyChanged = params.strategy !== previousStrategy;
    const connectorChanged = params.connectorResult.connectorKey !== previousConnector;
    if (
      eligibilityLaneContract.retryPolicy.requireDifferentStrategyOnRetry &&
      !strategyChanged &&
      !connectorChanged
    ) {
      throw new Error('SAME_STRATEGY');
    }
  }

  const attemptSummary = {
    attemptNumber: attempts.length + 1,
    attemptRole: params.attemptRole,
    strategy: params.strategy,
    connectorStrategy: params.connectorResult.connectorKey,
    connectorMode: params.connectorResult.mode,
    playbookVersion: params.playbookVersion,
    proposedResolution: params.connectorResult.proposedResolution,
    resolutionReasonCode: params.connectorResult.resolutionReasonCode,
    confidencePct: params.connectorResult.confidencePct,
    nextBestAction: params.connectorResult.nextBestAction,
    submittedAt: params.connectorResult.performedAt,
    connectorTraceId: params.connectorResult.connectorTraceId,
    statusCode: params.connectorResult.statusCode,
    statusLabel: params.connectorResult.statusLabel,
    evidenceTypes: params.connectorResult.evidence.map((item) => item.evidenceType),
  };

  const updatedMetadata = {
    ...metadata,
    playbookVersion: params.playbookVersion,
    lastExecution: attemptSummary,
    lastConnectorRun: {
      connectorKey: params.connectorResult.connectorKey,
      mode: params.connectorResult.mode,
      statusCode: params.connectorResult.statusCode,
      statusLabel: params.connectorResult.statusLabel,
      traceId: params.connectorResult.connectorTraceId,
      summary: params.connectorResult.summary,
      performedAt: params.connectorResult.performedAt,
    },
    attemptHistory: [...attempts, attemptSummary],
  };

  const workerActorType =
    params.attemptRole === 'primary_worker' ? 'worker_agent' : 'fallback_worker_agent';
  const workerActorRef =
    params.agentId ??
    (params.attemptRole === 'primary_worker'
      ? 'eligibility_connector_primary'
      : 'eligibility_connector_fallback');

  let nextState = 'awaiting_qa';
  if (params.autoRoute) {
    nextState =
      params.connectorResult.autoQaRecommendation === 'close_auto'
        ? 'closed_auto'
        : params.connectorResult.autoQaRecommendation === 'human_review_required'
          ? 'human_review_required'
          : 'awaiting_qa';
  }

  if (nextState === 'closed_auto') {
    await sql`
      UPDATE rcm_work_items
      SET
        assigned_agent_id = ${params.agentId},
        confidence_pct = ${params.connectorResult.confidencePct},
        status = 'closed_auto',
        requires_human_review = false,
        submitted_at = NOW(),
        completed_at = NOW(),
        metadata = ${jsonb(updatedMetadata)}::jsonb,
        updated_at = NOW()
      WHERE id = ${workItemId}
    `;
    await resolveOpenExceptions(sql, workItemId);
  } else if (nextState === 'human_review_required') {
    const exception = defaultExceptionForEligibilityConnector(params.connectorResult);
    await upsertOpenException(sql, workItemId, {
      exceptionType: exception.exceptionType,
      severity: exception.severity,
      reasonCode: exception.reasonCode,
      summary: exception.summary,
      payload: {
        requiredContextFields: exception.requiredContextFields,
        recommendedHumanAction: exception.recommendedHumanAction,
        connectorKey: params.connectorResult.connectorKey,
        connectorMode: params.connectorResult.mode,
        connectorTraceId: params.connectorResult.connectorTraceId,
        rawResponse: params.connectorResult.rawResponse,
      },
    });
    await sql`
      UPDATE rcm_work_items
      SET
        assigned_agent_id = ${params.agentId},
        confidence_pct = ${params.connectorResult.confidencePct},
        status = 'human_review_required',
        requires_human_review = true,
        submitted_at = NOW(),
        metadata = ${jsonb(updatedMetadata)}::jsonb,
        updated_at = NOW()
      WHERE id = ${workItemId}
    `;
  } else {
    await sql`
      UPDATE rcm_work_items
      SET
        assigned_agent_id = ${params.agentId},
        confidence_pct = ${params.connectorResult.confidencePct},
        status = 'awaiting_qa',
        requires_human_review = false,
        submitted_at = NOW(),
        metadata = ${jsonb(updatedMetadata)}::jsonb,
        updated_at = NOW()
      WHERE id = ${workItemId}
    `;
  }

  await insertEvidence(
    sql,
    workItemId,
    [
      ...params.connectorResult.evidence.map((item) => ({
        ...item,
        actorType: item.actorType ?? workerActorType,
        actorRef: item.actorRef ?? workerActorRef,
      })),
      {
        actorType: workerActorType,
        actorRef: workerActorRef,
        evidenceType:
          params.attemptRole === 'primary_worker'
            ? 'execution_resolution_proposed'
            : 'fallback_execution_submitted',
        payload: attemptSummary,
      },
    ],
    workerActorType,
    workerActorRef,
  );

  if (params.autoRoute && nextState !== 'awaiting_qa') {
    await insertEvidence(
      sql,
      workItemId,
      [
        {
          actorType: 'qa_agent',
          actorRef: params.qaActorRef,
          evidenceType: 'qa_decision_recorded',
          payload: {
            qaDecision: eligibilityQaDecisionForRecommendation(
              params.connectorResult.autoQaRecommendation,
            ),
            qaReasonCode:
              params.connectorResult.autoQaRecommendation === 'close_auto'
                ? 'connector_policy_auto_close'
                : defaultExceptionForEligibilityConnector(params.connectorResult).reasonCode,
            source: 'connector_policy_loop',
            reviewedAt: new Date().toISOString(),
            connectorKey: params.connectorResult.connectorKey,
            connectorMode: params.connectorResult.mode,
          },
        },
      ],
      'qa_agent',
      params.qaActorRef,
    );
  }

  const updated = await getOwnedEligibilityWorkItem(sql, merchantId, workItemId);
  if (!updated) throw new Error('WORK_ITEM_NOT_FOUND');
  return {
    nextState,
    workItem: mapEligibilityWorkItem(updated),
  };
}

function qaDecisionForRecommendation(
  recommendation: ClaimStatusAutoQaRecommendation,
): 'approve_auto_close' | 'escalate' {
  return recommendation === 'close_auto' ? 'approve_auto_close' : 'escalate';
}

async function persistClaimStatusConnectorRun(
  sql: any,
  merchantId: string,
  workItemId: string,
  params: {
    attemptRole: 'primary_worker' | 'fallback_worker';
    agentId: string | null;
    qaActorRef: string;
    playbookVersion: string;
    strategy: string;
    connectorResult: ClaimStatusConnectorExecution;
    autoRoute: boolean;
  },
) {
  const row = await getOwnedClaimStatusWorkItemForUpdate(sql, merchantId, workItemId);
  if (!row) throw new Error('WORK_ITEM_NOT_FOUND');

  const expectedStatus = params.attemptRole === 'primary_worker' ? 'routed' : 'retry_pending';
  if (row.status !== expectedStatus) throw new Error('INVALID_STATE');

  const metadata = parseJsonb<JsonRecord>(row.metadata, {});
  const attempts = getAttemptHistory(metadata);
  if (attempts.length >= claimStatusLaneContract.retryPolicy.maxAutonomousAttempts) {
    throw new Error('ATTEMPTS_EXHAUSTED');
  }

  if (params.attemptRole === 'fallback_worker') {
    if (attempts.length === 0) throw new Error('NO_PRIOR_ATTEMPT');
    const previousAttempt = attempts[attempts.length - 1];
    const previousStrategy =
      typeof previousAttempt['strategy'] === 'string' ? previousAttempt['strategy'] : '';
    const previousConnector =
      typeof previousAttempt['connectorStrategy'] === 'string'
        ? previousAttempt['connectorStrategy']
        : previousStrategy;
    const strategyChanged = params.strategy !== previousStrategy;
    const connectorChanged = params.connectorResult.connectorKey !== previousConnector;
    if (
      claimStatusLaneContract.retryPolicy.requireDifferentStrategyOnRetry &&
      !strategyChanged &&
      !connectorChanged
    ) {
      throw new Error('SAME_STRATEGY');
    }
  }

  const attemptSummary = {
    attemptNumber: attempts.length + 1,
    attemptRole: params.attemptRole,
    strategy: params.strategy,
    connectorStrategy: params.connectorResult.connectorKey,
    connectorMode: params.connectorResult.mode,
    playbookVersion: params.playbookVersion,
    proposedResolution: params.connectorResult.proposedResolution,
    resolutionReasonCode: params.connectorResult.resolutionReasonCode,
    confidencePct: params.connectorResult.confidencePct,
    nextBestAction: params.connectorResult.nextBestAction,
    submittedAt: params.connectorResult.performedAt,
    connectorTraceId: params.connectorResult.connectorTraceId,
    statusCode: params.connectorResult.statusCode,
    statusLabel: params.connectorResult.statusLabel,
    evidenceTypes: params.connectorResult.evidence.map((item) => item.evidenceType),
  };

  const updatedMetadata = {
    ...metadata,
    playbookVersion: params.playbookVersion,
    lastExecution: attemptSummary,
    lastConnectorRun: {
      connectorKey: params.connectorResult.connectorKey,
      mode: params.connectorResult.mode,
      statusCode: params.connectorResult.statusCode,
      statusLabel: params.connectorResult.statusLabel,
      traceId: params.connectorResult.connectorTraceId,
      summary: params.connectorResult.summary,
      performedAt: params.connectorResult.performedAt,
    },
    attemptHistory: [...attempts, attemptSummary],
  };

  const workerActorType = params.attemptRole === 'primary_worker' ? 'worker_agent' : 'fallback_worker_agent';
  const workerActorRef =
    params.agentId ??
    (params.attemptRole === 'primary_worker'
      ? 'claim_status_connector_primary'
      : 'claim_status_connector_fallback');

  let nextState = 'awaiting_qa';
  if (params.autoRoute) {
    nextState =
      params.connectorResult.autoQaRecommendation === 'close_auto'
        ? 'closed_auto'
        : params.connectorResult.autoQaRecommendation === 'human_review_required'
          ? 'human_review_required'
          : 'awaiting_qa';
  }

  if (nextState === 'closed_auto') {
    await sql`
      UPDATE rcm_work_items
      SET
        assigned_agent_id = ${params.agentId},
        confidence_pct = ${params.connectorResult.confidencePct},
        status = 'closed_auto',
        requires_human_review = false,
        submitted_at = NOW(),
        completed_at = NOW(),
        metadata = ${jsonb(updatedMetadata)}::jsonb,
        updated_at = NOW()
      WHERE id = ${workItemId}
    `;
    await resolveOpenExceptions(sql, workItemId);
  } else if (nextState === 'human_review_required') {
    const exception = defaultExceptionForConnector(params.connectorResult);
    await upsertOpenException(sql, workItemId, {
      exceptionType: exception.exceptionType,
      severity: exception.severity,
      reasonCode: exception.reasonCode,
      summary: exception.summary,
      payload: {
        requiredContextFields: exception.requiredContextFields,
        recommendedHumanAction: exception.recommendedHumanAction,
        connectorKey: params.connectorResult.connectorKey,
        connectorMode: params.connectorResult.mode,
        connectorTraceId: params.connectorResult.connectorTraceId,
        rawResponse: params.connectorResult.rawResponse,
      },
    });
    await sql`
      UPDATE rcm_work_items
      SET
        assigned_agent_id = ${params.agentId},
        confidence_pct = ${params.connectorResult.confidencePct},
        status = 'human_review_required',
        requires_human_review = true,
        submitted_at = NOW(),
        metadata = ${jsonb(updatedMetadata)}::jsonb,
        updated_at = NOW()
      WHERE id = ${workItemId}
    `;
  } else {
    await sql`
      UPDATE rcm_work_items
      SET
        assigned_agent_id = ${params.agentId},
        confidence_pct = ${params.connectorResult.confidencePct},
        status = 'awaiting_qa',
        requires_human_review = false,
        submitted_at = NOW(),
        metadata = ${jsonb(updatedMetadata)}::jsonb,
        updated_at = NOW()
      WHERE id = ${workItemId}
    `;
  }

  await insertEvidence(
    sql,
    workItemId,
    [
      ...params.connectorResult.evidence.map((item) => ({
        ...item,
        actorType: item.actorType ?? workerActorType,
        actorRef: item.actorRef ?? workerActorRef,
      })),
      {
        actorType: workerActorType,
        actorRef: workerActorRef,
        evidenceType:
          params.attemptRole === 'primary_worker'
            ? 'execution_resolution_proposed'
            : 'fallback_execution_submitted',
        payload: attemptSummary,
      },
    ],
    workerActorType,
    workerActorRef,
  );

  if (params.autoRoute && nextState !== 'awaiting_qa') {
    await insertEvidence(
      sql,
      workItemId,
      [
        {
          actorType: 'qa_agent',
          actorRef: params.qaActorRef,
          evidenceType: 'qa_decision_recorded',
          payload: {
            qaDecision: qaDecisionForRecommendation(params.connectorResult.autoQaRecommendation),
            qaReasonCode:
              params.connectorResult.autoQaRecommendation === 'close_auto'
                ? 'connector_policy_auto_close'
                : defaultExceptionForConnector(params.connectorResult).reasonCode,
            source: 'connector_policy_loop',
            reviewedAt: new Date().toISOString(),
            connectorKey: params.connectorResult.connectorKey,
            connectorMode: params.connectorResult.mode,
          },
        },
      ],
      'qa_agent',
      params.qaActorRef,
    );
  }

  const updated = await getOwnedClaimStatusWorkItem(sql, merchantId, workItemId);
  if (!updated) throw new Error('WORK_ITEM_NOT_FOUND');
  return {
    nextState,
    workItem: mapWorkItem(updated),
  };
}

const claimStatusLaneContract = {
  laneKey: 'institutional_claim_status',
  version: 'v1',
  supportedDomains: ['facility', 'home_health', 'institutional'],
  supportedForms: ['UB-04'],
  intakeSchema: {
    required: [
      'workspaceId',
      'title',
      'workType',
      'billingDomain',
      'formType',
      'payerName',
      'coverageType',
      'patientRef',
      'providerRef',
      'claimRef',
      'sourceSystem',
      'priority',
      'dueAt',
      'amountAtRisk',
    ],
    optional: ['encounterRef', 'metadata.billType', 'metadata.portalChannel'],
    metadata: {
      required: ['supportingDocRefs', 'providerContactEmail', 'originalSubmissionDate'],
      optional: ['claimFrequencyCode', 'macRegion', 'notes', 'secondaryPayerName'],
    },
  },
  stateMachine: {
    initialState: 'new',
    terminalStates: ['closed_auto', 'closed_human', 'blocked', 'rejected'],
    states: [
      { key: 'new', owner: 'router_agent', purpose: 'Awaiting lane classification and playbook selection.' },
      { key: 'routed', owner: 'router_agent', purpose: 'Lane accepted and ready for execution.' },
      { key: 'executing_primary', owner: 'worker_agent', purpose: 'Primary worker is running the playbook.' },
      { key: 'awaiting_qa', owner: 'qa_agent', purpose: 'Evidence and proposed resolution are under QA review.' },
      { key: 'retry_pending', owner: 'qa_agent', purpose: 'Fallback execution has been approved and queued.' },
      { key: 'executing_fallback', owner: 'fallback_worker_agent', purpose: 'Second bounded attempt with a different strategy.' },
      { key: 'human_review_required', owner: 'escalation_agent_or_human', purpose: 'Exception inbox owns the case.' },
      { key: 'blocked', owner: 'escalation_agent_or_human', purpose: 'Case cannot continue until external conditions change.' },
      { key: 'closed_auto', owner: 'system', purpose: 'Case closed autonomously after successful QA.' },
      { key: 'closed_human', owner: 'human_reviewer', purpose: 'Case closed after explicit human review or takeover.' },
      { key: 'rejected', owner: 'human_reviewer', purpose: 'Proposed closure or workflow path was rejected.' },
    ],
    transitions: [
      { from: 'new', to: 'routed', trigger: 'router_accepts_lane', owner: 'router_agent' },
      { from: 'new', to: 'blocked', trigger: 'router_detects_missing_prerequisite', owner: 'router_agent' },
      { from: 'routed', to: 'executing_primary', trigger: 'execution_started', owner: 'worker_agent' },
      { from: 'executing_primary', to: 'awaiting_qa', trigger: 'worker_submits_resolution', owner: 'worker_agent' },
      { from: 'awaiting_qa', to: 'closed_auto', trigger: 'qa_approves', owner: 'qa_agent' },
      { from: 'awaiting_qa', to: 'retry_pending', trigger: 'qa_requests_fallback_retry', owner: 'qa_agent' },
      { from: 'awaiting_qa', to: 'human_review_required', trigger: 'qa_escalates', owner: 'qa_agent' },
      { from: 'retry_pending', to: 'executing_fallback', trigger: 'fallback_execution_started', owner: 'fallback_worker_agent' },
      { from: 'executing_fallback', to: 'awaiting_qa', trigger: 'fallback_worker_submits_resolution', owner: 'fallback_worker_agent' },
      { from: 'human_review_required', to: 'closed_human', trigger: 'human_approves_or_takes_over', owner: 'human_reviewer' },
      { from: 'human_review_required', to: 'blocked', trigger: 'human_marks_blocked', owner: 'human_reviewer' },
      { from: 'human_review_required', to: 'rejected', trigger: 'human_rejects_resolution', owner: 'human_reviewer' },
    ],
  },
  agentPayloads: {
    router: {
      input: ['workItemCore', 'metadata.supportingDocRefs', 'metadata.originalSubmissionDate'],
      output: ['laneSelection', 'playbookVersion', 'priorityBand', 'autoExecuteAllowed', 'routingReason'],
    },
    worker: {
      input: ['claimRef', 'payerName', 'coverageType', 'formType', 'playbookVersion', 'connectorHints'],
      output: ['proposedResolution', 'resolutionReasonCode', 'confidencePct', 'evidenceBundle', 'nextBestAction'],
    },
    qa: {
      input: ['proposedResolution', 'confidencePct', 'evidenceBundle', 'playbookVersion'],
      output: ['qaDecision', 'qaReasonCode', 'retryAllowed', 'requiredEscalationFields'],
    },
    fallbackWorker: {
      input: ['priorAttemptSummary', 'connectorFailureHistory', 'alternativeStrategy'],
      output: ['fallbackResolution', 'fallbackReasonCode', 'confidencePct', 'evidenceBundle'],
    },
    escalation: {
      input: ['workItemSummary', 'exceptionPacket', 'missingContextFields', 'recommendedHumanAction'],
      output: ['queueAssignment', 'reviewerInstructions', 'newExceptionClassCandidate'],
    },
  },
  retryPolicy: {
    maxAutonomousAttempts: 2,
    retryPath: ['primary_worker', 'fallback_worker'],
    requireDifferentStrategyOnRetry: true,
    neverRetryWithoutNewEvidence: true,
    escalateOnRepeatedConnectorFailure: true,
  },
  completionCriteria: [
    'Current claim status is clearly established or the correction was successfully submitted.',
    'Required evidence exists for every external action.',
    'No required documentation gap remains.',
    'No unresolved payer ambiguity remains.',
    'Confidence and QA checks meet the lane threshold.',
  ],
  evidenceTypes: [
    'status_lookup_requested',
    'status_lookup_completed',
    'portal_response_captured',
    'edi_276_submitted',
    'edi_277_received',
    'dde_correction_prepared',
    'dde_correction_submitted',
    'documentation_gap_found',
    'payer_response_ambiguous',
    'qa_decision_recorded',
  ],
  exceptionInbox: {
    queueKey: 'claim_status_exceptions',
    columns: [
      'workItemId',
      'workspaceName',
      'payerName',
      'claimRef',
      'priority',
      'exceptionType',
      'reasonCode',
      'confidencePct',
      'amountAtRisk',
      'requiredContextFields',
      'recommendedHumanAction',
      'openedAt',
      'slaAt',
      'assignedReviewer',
    ],
    triageBuckets: [
      'missing_documentation',
      'credentialing_or_enrollment_gap',
      'coverage_mismatch',
      'portal_or_dde_access_failure',
      'ambiguous_payer_response',
      'underpayment_or_partial_payment',
    ],
    allowedHumanActions: [
      'approve_closure',
      'reject_closure',
      'add_missing_context',
      'take_over_case',
      'mark_blocked',
      'propose_rule_candidate',
      'classify_new_exception_type',
    ],
  },
  metrics: [
    'autoClosedPct',
    'retryRate',
    'exceptionRate',
    'humanInterventionRate',
    'avgTurnaroundMins',
    'qaRejectionRate',
    'connectorFailureRate',
    'amountAtRiskClosed',
  ],
  endpoints: {
    read: [
      'GET /api/rcm/lanes/claim-status',
      'GET /api/rcm/lanes/claim-status/work-items',
      'GET /api/rcm/queues/claim-status-exceptions',
      'GET /api/rcm/connectors/claim-status',
      'GET /api/rcm/autonomy-loop',
      'GET /api/rcm/metrics/queues',
    ],
    liveMutations: [
      'POST /api/rcm/lanes/claim-status/intake',
      'POST /api/rcm/lanes/claim-status/work-items/:workItemId/run-primary',
      'POST /api/rcm/lanes/claim-status/work-items/:workItemId/run-fallback',
      'POST /api/rcm/lanes/claim-status/work-items/:workItemId/execute',
      'POST /api/rcm/lanes/claim-status/work-items/:workItemId/verify',
      'POST /api/rcm/lanes/claim-status/work-items/:workItemId/retry',
      'POST /api/rcm/lanes/claim-status/work-items/:workItemId/escalate',
      'POST /api/rcm/lanes/claim-status/work-items/:workItemId/resolve',
    ],
    plannedMutations: [],
  },
};

const eligibilityLaneContract = {
  laneKey: 'eligibility_verification',
  version: 'v1',
  supportedDomains: ['professional', 'facility', 'home_health', 'dme', 'hospice', 'institutional'],
  supportedForms: ['CMS-1500', 'UB-04'],
  intakeSchema: {
    required: [
      'workspaceId',
      'title',
      'workType',
      'billingDomain',
      'formType',
      'payerName',
      'coverageType',
      'patientRef',
      'providerRef',
      'sourceSystem',
      'priority',
      'dueAt',
    ],
    optional: ['encounterRef', 'amountAtRisk'],
    metadata: {
      required: ['memberId', 'providerNpi', 'dateOfService', 'serviceTypeCodes'],
      optional: ['payerId', 'groupNumber', 'providerTaxonomyCode', 'secondaryPayerName', 'notes'],
    },
  },
  stateMachine: {
    initialState: 'new',
    terminalStates: ['closed_auto', 'closed_human', 'blocked', 'rejected'],
    states: [
      { key: 'new', owner: 'router_agent', purpose: 'Awaiting lane classification and playbook selection.' },
      { key: 'routed', owner: 'router_agent', purpose: 'Lane accepted and ready for HETS inquiry.' },
      { key: 'executing_primary', owner: 'worker_agent', purpose: 'Primary worker is running the 270/271 inquiry.' },
      { key: 'awaiting_qa', owner: 'qa_agent', purpose: 'Eligibility result and proposed resolution are under QA review.' },
      { key: 'retry_pending', owner: 'qa_agent', purpose: 'Fallback execution has been approved and queued.' },
      { key: 'executing_fallback', owner: 'fallback_worker_agent', purpose: 'Second bounded attempt via portal or alternate path.' },
      { key: 'human_review_required', owner: 'escalation_agent_or_human', purpose: 'Exception inbox owns the case.' },
      { key: 'blocked', owner: 'escalation_agent_or_human', purpose: 'Case cannot continue until external conditions change.' },
      { key: 'closed_auto', owner: 'system', purpose: 'Eligibility confirmed autonomously; case closed.' },
      { key: 'closed_human', owner: 'human_reviewer', purpose: 'Case closed after explicit human review or takeover.' },
      { key: 'rejected', owner: 'human_reviewer', purpose: 'Proposed closure or workflow path was rejected.' },
    ],
    transitions: [
      { from: 'new', to: 'routed', trigger: 'router_accepts_lane', owner: 'router_agent' },
      { from: 'new', to: 'blocked', trigger: 'router_detects_missing_prerequisite', owner: 'router_agent' },
      { from: 'routed', to: 'executing_primary', trigger: 'hets_inquiry_started', owner: 'worker_agent' },
      { from: 'executing_primary', to: 'awaiting_qa', trigger: 'worker_submits_eligibility_result', owner: 'worker_agent' },
      { from: 'awaiting_qa', to: 'closed_auto', trigger: 'qa_approves_eligibility', owner: 'qa_agent' },
      { from: 'awaiting_qa', to: 'retry_pending', trigger: 'qa_requests_fallback_retry', owner: 'qa_agent' },
      { from: 'awaiting_qa', to: 'human_review_required', trigger: 'qa_escalates', owner: 'qa_agent' },
      { from: 'retry_pending', to: 'executing_fallback', trigger: 'fallback_inquiry_started', owner: 'fallback_worker_agent' },
      { from: 'executing_fallback', to: 'awaiting_qa', trigger: 'fallback_worker_submits_result', owner: 'fallback_worker_agent' },
      { from: 'human_review_required', to: 'closed_human', trigger: 'human_approves_or_takes_over', owner: 'human_reviewer' },
      { from: 'human_review_required', to: 'blocked', trigger: 'human_marks_blocked', owner: 'human_reviewer' },
      { from: 'human_review_required', to: 'rejected', trigger: 'human_rejects_resolution', owner: 'human_reviewer' },
    ],
  },
  agentPayloads: {
    router: {
      input: ['workItemCore', 'metadata.memberId', 'metadata.dateOfService', 'metadata.serviceTypeCodes'],
      output: ['laneSelection', 'playbookVersion', 'priorityBand', 'autoExecuteAllowed', 'routingReason'],
    },
    worker: {
      input: ['memberId', 'payerName', 'coverageType', 'providerNpi', 'dateOfService', 'serviceTypeCodes', 'playbookVersion', 'connectorHints'],
      output: ['eligibilityStatus', 'resolutionReasonCode', 'confidencePct', 'evidenceBundle', 'nextBestAction'],
    },
    qa: {
      input: ['eligibilityResult', 'confidencePct', 'evidenceBundle', 'playbookVersion'],
      output: ['qaDecision', 'qaReasonCode', 'retryAllowed', 'requiredEscalationFields'],
    },
    fallbackWorker: {
      input: ['priorAttemptSummary', 'connectorFailureHistory', 'alternativeStrategy'],
      output: ['fallbackEligibilityResult', 'fallbackReasonCode', 'confidencePct', 'evidenceBundle'],
    },
    escalation: {
      input: ['workItemSummary', 'exceptionPacket', 'missingContextFields', 'recommendedHumanAction'],
      output: ['queueAssignment', 'reviewerInstructions', 'newExceptionClassCandidate'],
    },
  },
  retryPolicy: {
    maxAutonomousAttempts: 2,
    retryPath: ['primary_worker', 'fallback_worker'],
    requireDifferentStrategyOnRetry: true,
    neverRetryWithoutNewEvidence: true,
    escalateOnRepeatedConnectorFailure: true,
  },
  completionCriteria: [
    'Subscriber eligibility status is clearly established via 270/271 or manual verification.',
    'Required benefit detail is captured (deductible, copay, network status).',
    'Prior auth flags are documented and handed off.',
    'No unresolved coverage ambiguity remains.',
    'Confidence and QA checks meet the lane threshold.',
  ],
  evidenceTypes: [
    'eligibility_inquiry_requested',
    'edi_270_submitted',
    'edi_271_received',
    'eligibility_verified',
    'coverage_gap_detected',
    'prior_auth_flag_detected',
    'benefit_detail_captured',
    'payer_response_ambiguous',
    'qa_decision_recorded',
    'router_decision_recorded',
    'escalation_packet_created',
    'human_resolution_recorded',
    'human_context_added',
  ],
  exceptionInbox: {
    queueKey: 'eligibility_exceptions',
    columns: [
      'workItemId',
      'workspaceName',
      'payerName',
      'memberId',
      'dateOfService',
      'priority',
      'exceptionType',
      'reasonCode',
      'confidencePct',
      'requiredContextFields',
      'recommendedHumanAction',
      'openedAt',
      'slaAt',
      'assignedReviewer',
    ],
    triageBuckets: [
      'subscriber_not_found',
      'coverage_inactive',
      'prior_auth_required',
      'coordination_of_benefits_gap',
      'out_of_network_provider',
      'payer_system_unavailable',
    ],
    allowedHumanActions: [
      'approve_closure',
      'reject_closure',
      'add_missing_context',
      'take_over_case',
      'mark_blocked',
      'propose_rule_candidate',
      'classify_new_exception_type',
    ],
  },
  metrics: [
    'autoClosedPct',
    'retryRate',
    'exceptionRate',
    'humanInterventionRate',
    'avgTurnaroundMins',
    'qaRejectionRate',
    'connectorFailureRate',
    'priorAuthFlagRate',
  ],
  endpoints: {
    read: [
      'GET /api/rcm/lanes/eligibility',
      'GET /api/rcm/lanes/eligibility/work-items',
      'GET /api/rcm/queues/eligibility-exceptions',
      'GET /api/rcm/connectors/eligibility',
    ],
    liveMutations: [
      'POST /api/rcm/lanes/eligibility/intake',
      'POST /api/rcm/lanes/eligibility/work-items/:workItemId/run-primary',
      'POST /api/rcm/lanes/eligibility/work-items/:workItemId/run-fallback',
      'POST /api/rcm/lanes/eligibility/work-items/:workItemId/execute',
      'POST /api/rcm/lanes/eligibility/work-items/:workItemId/verify',
      'POST /api/rcm/lanes/eligibility/work-items/:workItemId/retry',
      'POST /api/rcm/lanes/eligibility/work-items/:workItemId/escalate',
      'POST /api/rcm/lanes/eligibility/work-items/:workItemId/resolve',
    ],
    plannedMutations: [],
  },
};

// ─── Denial follow-up lane contract ──────────────────────────────────────────

const denialFollowUpLaneContract = {
  laneKey: 'denial_follow_up',
  version: 'v1',
  supportedDomains: ['facility', 'professional', 'home_health', 'institutional'],
  supportedForms: ['UB-04', 'CMS-1500'],
  intakeSchema: {
    required: [
      'workspaceId',
      'title',
      'workType',
      'billingDomain',
      'formType',
      'payerName',
      'coverageType',
      'patientRef',
      'providerRef',
      'claimRef',
      'sourceSystem',
      'priority',
      'dueAt',
      'amountAtRisk',
    ],
    optional: ['encounterRef'],
    metadata: {
      required: ['denialReasonCode', 'denialDate', 'appealDeadline'],
      optional: ['appealLevel', 'originalSubmissionDate', 'priorAuthRef', 'notes'],
    },
  },
  stateMachine: {
    initialState: 'new',
    terminalStates: ['closed_auto', 'closed_human', 'blocked', 'rejected'],
    states: [
      { key: 'new', owner: 'router_agent', purpose: 'Awaiting denial classification and appeal eligibility check.' },
      { key: 'routed', owner: 'router_agent', purpose: 'Lane accepted and ready for denial follow-up execution.' },
      { key: 'executing_primary', owner: 'worker_agent', purpose: 'Primary worker is querying denial status and appeal eligibility.' },
      { key: 'awaiting_qa', owner: 'qa_agent', purpose: 'Denial status and appeal plan are under QA review.' },
      { key: 'retry_pending', owner: 'qa_agent', purpose: 'Fallback execution approved and queued.' },
      { key: 'executing_fallback', owner: 'fallback_worker_agent', purpose: 'Second bounded attempt with a different strategy.' },
      { key: 'human_review_required', owner: 'escalation_agent_or_human', purpose: 'Appeal or denial requires human judgment.' },
      { key: 'blocked', owner: 'escalation_agent_or_human', purpose: 'Case cannot proceed until external conditions change.' },
      { key: 'closed_auto', owner: 'system', purpose: 'Appeal approved or denial resolved autonomously.' },
      { key: 'closed_human', owner: 'human_reviewer', purpose: 'Resolved after explicit human review or takeover.' },
      { key: 'rejected', owner: 'human_reviewer', purpose: 'Proposed resolution was rejected.' },
    ],
    transitions: [
      { from: 'new', to: 'routed', trigger: 'router_accepts_lane', owner: 'router_agent' },
      { from: 'new', to: 'blocked', trigger: 'router_detects_missing_prerequisite', owner: 'router_agent' },
      { from: 'routed', to: 'executing_primary', trigger: 'denial_inquiry_started', owner: 'worker_agent' },
      { from: 'executing_primary', to: 'awaiting_qa', trigger: 'worker_submits_denial_result', owner: 'worker_agent' },
      { from: 'awaiting_qa', to: 'closed_auto', trigger: 'qa_approves_denial_resolution', owner: 'qa_agent' },
      { from: 'awaiting_qa', to: 'retry_pending', trigger: 'qa_requests_fallback_retry', owner: 'qa_agent' },
      { from: 'awaiting_qa', to: 'human_review_required', trigger: 'qa_escalates', owner: 'qa_agent' },
      { from: 'retry_pending', to: 'executing_fallback', trigger: 'fallback_denial_inquiry_started', owner: 'fallback_worker_agent' },
      { from: 'executing_fallback', to: 'awaiting_qa', trigger: 'fallback_worker_submits_result', owner: 'fallback_worker_agent' },
      { from: 'human_review_required', to: 'closed_human', trigger: 'human_approves_or_takes_over', owner: 'human_reviewer' },
      { from: 'human_review_required', to: 'blocked', trigger: 'human_marks_blocked', owner: 'human_reviewer' },
      { from: 'human_review_required', to: 'rejected', trigger: 'human_rejects_resolution', owner: 'human_reviewer' },
    ],
  },
  retryPolicy: {
    maxAutonomousAttempts: 2,
    retryPath: ['primary_worker', 'fallback_worker'],
    requireDifferentStrategyOnRetry: true,
    neverRetryWithoutNewEvidence: true,
    escalateOnRepeatedConnectorFailure: true,
  },
  completionCriteria: [
    'Denial appeal status is clearly established.',
    'Appeal submitted with required documentation if appeal deadline is open.',
    'Upheld denials are documented and routed to write-off or patient responsibility.',
    'No unresolved payer ambiguity remains.',
    'Confidence and QA checks meet the lane threshold.',
  ],
  evidenceTypes: [
    'denial_inquiry_submitted',
    'denial_inquiry_response',
    'appeal_eligibility_checked',
    'appeal_submitted',
    'appeal_approved',
    'appeal_denied_final',
    'information_requested_by_payer',
    'documentation_gap_found',
    'qa_decision_recorded',
    'human_resolution_recorded',
  ],
  exceptionInbox: {
    queueKey: 'denial_follow_up_exceptions',
    triageBuckets: [
      'missing_appeal_documentation',
      'appeal_deadline_exceeded',
      'denial_upheld_requires_review',
      'payer_information_request',
      'coverage_dispute',
      'medical_necessity_denial',
      'payer_system_unavailable',
    ],
    allowedHumanActions: [
      'submit_appeal',
      'add_missing_documentation',
      'write_off_claim',
      'assign_patient_responsibility',
      'request_peer_review',
      'escalate_to_second_level_appeal',
      'mark_blocked',
    ],
  },
  endpoints: {
    read: [
      'GET /api/rcm/lanes/denial-follow-up',
      'GET /api/rcm/lanes/denial-follow-up/work-items',
      'GET /api/rcm/queues/denial-follow-up-exceptions',
      'GET /api/rcm/connectors/denial-follow-up',
    ],
    liveMutations: [
      'POST /api/rcm/lanes/denial-follow-up/intake',
      'POST /api/rcm/lanes/denial-follow-up/work-items/:workItemId/run-primary',
      'POST /api/rcm/lanes/denial-follow-up/work-items/:workItemId/execute',
      'POST /api/rcm/lanes/denial-follow-up/work-items/:workItemId/verify',
      'POST /api/rcm/lanes/denial-follow-up/work-items/:workItemId/retry',
      'POST /api/rcm/lanes/denial-follow-up/work-items/:workItemId/escalate',
      'POST /api/rcm/lanes/denial-follow-up/work-items/:workItemId/resolve',
    ],
    plannedMutations: [],
  },
};

const blueprint = {
  vertical: 'rcm',
  stage: 'scaffold',
  positioning:
    'Autonomous revenue cycle management layer where agents work the queue by default and humans resolve exceptions.',
  philosophy:
    'Automation-first on one narrow queue, with human exception handling from day one.',
  billingFamilies: [
    {
      key: 'professional_provider',
      label: 'Professional / provider billing',
      examples: ['physician', 'dental', 'eye', 'ortho'],
      forms: ['CMS-1500'],
    },
    {
      key: 'facility_home_health',
      label: 'Facility / home health billing',
      examples: ['hospital', 'home health', 'dme', 'pas', 'hospice'],
      forms: ['UB-04'],
    },
  ],
  payerMix: ['medicare', 'medicaid', 'private'],
  firstLane: {
    key: 'institutional_claim_status',
    label: 'Institutional claim status + DDE correction',
    reason:
      'Structured, repetitive, high-volume, measurable, and narrow enough to automate without pretending the whole billing stack is solved.',
  },
  serviceModules: [
    {
      key: 'home_health',
      label: 'Home health billing',
      services: [
        'claim_data_entry_validation_transmission',
        'claims_review_follow_up',
        'recovery_collections',
        'patient_eligibility_verification',
        'payment_posting_remittance',
        'reporting_accounting',
      ],
    },
    {
      key: 'hospice',
      label: 'Hospice billing',
      services: [
        'noe_notr_entry',
        'claim_data_entry_validation_transmission',
        'claims_review_follow_up',
        'recovery_collections',
        'patient_eligibility_verification',
        'payment_posting_remittance',
        'reporting_accounting',
      ],
    },
    {
      key: 'dme',
      label: 'DME billing',
      services: [
        'authorizations',
        'data_entry_validation_transmission',
        'claims_review_follow_up',
        'recovery_collections',
        'patient_eligibility_verification',
        'payment_posting_remittance',
        'secondary_claim_billing',
        'reporting_accounting',
      ],
    },
    {
      key: 'pas',
      label: 'PAS billing',
      services: [
        'authorization_program_modifier_verification',
        'data_entry_validation_transmission',
        'claims_review_follow_up',
        'recovery_collections',
        'patient_eligibility_verification',
        'payment_posting_remittance',
        'secondary_claim_billing',
        'reporting_accounting',
      ],
    },
    {
      key: 'physician',
      label: 'Physician billing',
      services: [
        'claim_data_entry_validation_transmission',
        'authorization_number_check',
        'payer_id_validation',
        'claims_review_follow_up',
        'recovery_collections',
        'patient_eligibility_verification',
        'payment_posting_remittance',
        'reporting_accounting',
      ],
    },
  ],
  connectorReality: {
    claimStatus: 'X12 276/277 should be the default automation rail.',
    eligibility: 'HETS 270/271 should be the default Medicare eligibility rail.',
    dde:
      'Treat DDE as a connector family and operator workflow, not as one clean universal API.',
    remittance:
      'ERA 835 and EFT are the payment-posting rails, not AgentPay itself.',
  },
  runtimeStance: {
    borrowFromAgentRuntimes: [
      'durable task flow',
      'specialized sub-agents',
      'event hooks',
      'auditable background work',
    ],
    avoidForHealthcareOps: [
      'one unconstrained general agent controlling the whole queue',
      'broad plugin authority over provider systems',
      'opaque end-to-end autonomy without typed state transitions',
    ],
    preferredModel:
      'Typed workflow engine first, specialized agents second, human approval and exception routing throughout.',
  },
  agentRoles: [
    'router_agent',
    'worker_agent',
    'qa_agent',
    'escalation_agent',
  ],
  managerScreens: [
    'overview',
    'work_queue',
    'work_item_detail',
    'vendor_scorecards',
    'payouts',
  ],
  exceptionReasons: [
    'missing_documentation',
    'credentialing_or_enrollment_gap',
    'coverage_mismatch',
    'portal_or_dde_access_failure',
    'ambiguous_payer_response',
    'underpayment_or_partial_payment',
  ],
  criticalRisks: [
    'Do not try to automate professional billing, home health, hospice, DME, and dental at the same time.',
    'Do not assume DDE is one standard public API. It is a fragmented access pattern that depends on payer, MAC, contractor, and workflow.',
    'Do not confuse payer money movement with AgentPay settlement. Insurance payment still rides existing payer rails such as EFT and ERA.',
    'Do not let humans become generic manual labor inside the product. Human work must only improve automation, not replace the queue model.',
    'Do not ignore enrollment, credentialing, and documentation gates in home health and DME.',
    'Do not let a single general-purpose agent own end-to-end execution across eligibility, claim status, correction, posting, and appeals without typed controls.',
  ],
  automationLadder: {
    automateNow: [
      'eligibility_verification',
      'claim_status_follow_up',
      'payment_posting_reconciliation',
      'secondary_claim_triggering',
      'reporting_scorecards',
    ],
    automateWithHumanExceptions: [
      'claim_data_entry_validation_transmission',
      'dde_correction',
      'authorization_verification',
      'recovery_collections',
      'payer_follow_up',
      'hospice_noe_notr',
    ],
    keepHumanLedInitially: [
      'broad_denial_resolution',
      'complex_document_collection',
      'credentialing_and_enrollment_changes',
      'appeals_with_judgment',
      'portal_access_exception_handling',
    ],
  },
  autonomyLoop: {
    objective:
      'Move each work item through a typed multi-agent loop where the system retries within bounded rules, escalates cleanly, and learns from outcomes without losing auditability.',
    phases: [
      {
        key: 'intake',
        owner: 'router_agent',
        outputs: ['lane_selection', 'playbook_version', 'priority', 'eligibility_for_auto_execution'],
      },
      {
        key: 'execute',
        owner: 'worker_agent',
        outputs: ['proposed_resolution', 'evidence_bundle', 'confidence_score'],
      },
      {
        key: 'verify',
        owner: 'qa_agent',
        outputs: ['approve_auto_close', 'retry_with_next_worker', 'escalate'],
      },
      {
        key: 'recover',
        owner: 'fallback_worker_agent',
        outputs: ['second_attempt_resolution', 'connector_failover', 'route_to_human'],
      },
      {
        key: 'resolve',
        owner: 'escalation_agent_or_human',
        outputs: ['closed', 'rejected', 'needs_context', 'new_exception_class'],
      },
      {
        key: 'learn',
        owner: 'policy_and_playbook_loop',
        outputs: ['threshold_update', 'prompt_patch', 'new_rule_candidate', 'connector_fix_backlog'],
      },
    ],
    retryPolicy: {
      maxAutonomousAttemptsPerLane: 2,
      requireDifferentStrategyOnRetry: true,
      neverRetryWithoutNewEvidence: true,
      escalateAfterRepeatedConnectorFailure: true,
    },
    selfLearningGuardrails: [
      'Never let agents silently edit production playbooks.',
      'Route proposed rule changes into review queues before activation.',
      'Learn from receipts, approvals, rejections, and exception classes rather than from vague conversational memory.',
      'Separate online threshold tuning from offline prompt and playbook updates.',
    ],
    stateMachineOutcomes: ['auto_closed', 'retry_scheduled', 'human_review_required', 'blocked', 'rejected'],
  },
  laneContracts: {
    claimStatus: claimStatusLaneContract,
    eligibility: eligibilityLaneContract,
    denialFollowUp: denialFollowUpLaneContract,
    priorAuth: priorAuthLaneContract,
  },
};

const plannedRoutes: string[] = [];

function notYet(c: Context<{ Bindings: Env; Variables: Variables }>, feature: string) {
  return c.json(
    {
      status: 'planned',
      feature,
      stage: 'scaffold',
      recommendedStartLane: blueprint.firstLane.key,
    },
    501,
  );
}

router.get('/', (c) =>
  c.json({
    ...blueprint,
    routes: {
      live: [
        'GET /api/rcm',
        'GET /api/rcm/blueprint',
        'GET /api/rcm/autonomy-loop',
        // Claim status lane
        'GET /api/rcm/lanes/claim-status',
        'GET /api/rcm/lanes/claim-status/work-items',
        'GET /api/rcm/queues/claim-status-exceptions',
        'GET /api/rcm/connectors/claim-status',
        'POST /api/rcm/lanes/claim-status/intake',
        'POST /api/rcm/lanes/claim-status/work-items/:workItemId/run-primary',
        'POST /api/rcm/lanes/claim-status/work-items/:workItemId/run-fallback',
        'POST /api/rcm/lanes/claim-status/work-items/:workItemId/execute',
        'POST /api/rcm/lanes/claim-status/work-items/:workItemId/verify',
        'POST /api/rcm/lanes/claim-status/work-items/:workItemId/retry',
        'POST /api/rcm/lanes/claim-status/work-items/:workItemId/escalate',
        'POST /api/rcm/lanes/claim-status/work-items/:workItemId/resolve',
        // Eligibility lane
        'GET /api/rcm/lanes/eligibility',
        'GET /api/rcm/lanes/eligibility/work-items',
        'GET /api/rcm/queues/eligibility-exceptions',
        'GET /api/rcm/connectors/eligibility',
        'POST /api/rcm/lanes/eligibility/intake',
        'POST /api/rcm/lanes/eligibility/work-items/:workItemId/run-primary',
        'POST /api/rcm/lanes/eligibility/work-items/:workItemId/run-fallback',
        'POST /api/rcm/lanes/eligibility/work-items/:workItemId/execute',
        'POST /api/rcm/lanes/eligibility/work-items/:workItemId/verify',
        'POST /api/rcm/lanes/eligibility/work-items/:workItemId/retry',
        'POST /api/rcm/lanes/eligibility/work-items/:workItemId/escalate',
        'POST /api/rcm/lanes/eligibility/work-items/:workItemId/resolve',
        // Denial follow-up lane
        'GET /api/rcm/lanes/denial-follow-up',
        'GET /api/rcm/lanes/denial-follow-up/work-items',
        'GET /api/rcm/queues/denial-follow-up-exceptions',
        'GET /api/rcm/connectors/denial-follow-up',
        'POST /api/rcm/lanes/denial-follow-up/intake',
        'POST /api/rcm/lanes/denial-follow-up/work-items/:workItemId/run-primary',
        'POST /api/rcm/lanes/denial-follow-up/work-items/:workItemId/execute',
        'POST /api/rcm/lanes/denial-follow-up/work-items/:workItemId/verify',
        'POST /api/rcm/lanes/denial-follow-up/work-items/:workItemId/retry',
        'POST /api/rcm/lanes/denial-follow-up/work-items/:workItemId/escalate',
        'POST /api/rcm/lanes/denial-follow-up/work-items/:workItemId/resolve',
        // Prior auth follow-up lane
        'GET /api/rcm/lanes/prior-auth-follow-up',
        'GET /api/rcm/connectors/prior-auth-follow-up',
        'GET /api/rcm/lanes/prior-auth-follow-up/work-items',
        'GET /api/rcm/queues/prior-auth-follow-up-exceptions',
        'POST /api/rcm/lanes/prior-auth-follow-up/intake',
        'POST /api/rcm/lanes/prior-auth-follow-up/work-items/:workItemId/run-primary',
        'POST /api/rcm/lanes/prior-auth-follow-up/work-items/:workItemId/execute',
        'POST /api/rcm/lanes/prior-auth-follow-up/work-items/:workItemId/verify',
        'POST /api/rcm/lanes/prior-auth-follow-up/work-items/:workItemId/retry',
        'POST /api/rcm/lanes/prior-auth-follow-up/work-items/:workItemId/escalate',
        'POST /api/rcm/lanes/prior-auth-follow-up/work-items/:workItemId/resolve',
        // ERA 835 lane
        'GET /api/rcm/lanes/era-835',
        'GET /api/rcm/connectors/era-835',
        'GET /api/rcm/lanes/era-835/work-items',
        'GET /api/rcm/queues/era-835-exceptions',
        'POST /api/rcm/lanes/era-835/intake',
        'POST /api/rcm/lanes/era-835/work-items/:workItemId/run-primary',
        'POST /api/rcm/lanes/era-835/work-items/:workItemId/execute',
        'POST /api/rcm/lanes/era-835/work-items/:workItemId/verify',
        'POST /api/rcm/lanes/era-835/work-items/:workItemId/resolve',
        // Cross-lane reads
        'GET /api/rcm/workspaces',
        'GET /api/rcm/work-items',
        'GET /api/rcm/services',
        'GET /api/rcm/vendors',
        'GET /api/rcm/payouts',
        'GET /api/rcm/metrics/overview',
        'GET /api/rcm/metrics/queues',
        'GET /api/rcm/metrics/payouts',
        // Operator onboarding (workspace + work-item CRUD)
        'POST /api/rcm/workspaces',
        'PATCH /api/rcm/workspaces/:workspaceId',
        'POST /api/rcm/work-items',
        'PATCH /api/rcm/work-items/:workItemId',
        'POST /api/rcm/work-items/:workItemId/assign',
        'POST /api/rcm/work-items/:workItemId/evidence',
        'POST /api/rcm/work-items/:workItemId/submit',
        'POST /api/rcm/work-items/:workItemId/approve',
        'POST /api/rcm/work-items/:workItemId/reject',
        // Milestone fee capture
        'POST /api/rcm/work-items/:workItemId/milestones',
        'POST /api/rcm/work-items/:workItemId/milestones/:milestoneId/release',
      ],
      planned: plannedRoutes,
    },
  }),
);

router.get('/blueprint', authenticateApiKey, (c) => c.json(blueprint));

router.get('/autonomy-loop', authenticateApiKey, (c) =>
  c.json({
    stage: 'scaffold',
    autonomyLoop: blueprint.autonomyLoop,
    message:
      'Use multiple specialized agents in a typed loop. Allow bounded retries and fallbacks, then escalate cleanly. Learn from outcomes, not from uncontrolled runtime drift.',
  }),
);

router.get('/lanes/claim-status', authenticateApiKey, (c) =>
  c.json({
    stage: 'live',
    contract: claimStatusLaneContract,
    message:
      'This is the exact implementation contract for the first live lane: intake schema, state machine, agent payloads, retry logic, and exception inbox shape.',
  }),
);

router.get('/connectors/claim-status', authenticateApiKey, (c) =>
  c.json({
    stage: 'live',
    lane: claimStatusLaneContract.laneKey,
    connectors: getClaimStatusConnectorAvailability(c.env),
    message:
      'X12 276/277 is the primary autonomous rail. Portal and DDE stay bounded fallback paths until credential custody and operator controls are production-ready.',
  }),
);

// ─── Eligibility lane — read routes ──────────────────────────────────────────

router.get('/lanes/eligibility', authenticateApiKey, (c) =>
  c.json({
    stage: 'live',
    contract: eligibilityLaneContract,
    message:
      'This is the implementation contract for the eligibility verification lane: intake schema, state machine, agent payloads, retry policy, and exception inbox shape.',
  }),
);

router.get('/connectors/eligibility', authenticateApiKey, (c) =>
  c.json({
    stage: 'live',
    lane: eligibilityLaneContract.laneKey,
    connectors: getEligibilityConnectorAvailability(c.env),
    message:
      'X12 270/271 (HETS) is the primary autonomous rail for eligibility verification. Portal fallback stays human-led until credential vaulting is production-ready.',
  }),
);

router.get('/lanes/eligibility/work-items', authenticateApiKey, async (c) => {
  const merchant = c.get('merchant');
  const sql = createDb(c.env);
  const status = c.req.query('status');
  const workspaceId = c.req.query('workspaceId');
  const limit = parseLimit(c.req.query('limit'), 50, 200);

  if (workspaceId && !isUuid(workspaceId)) {
    sql.end().catch(() => {});
    return validationResponse(c, ['"workspaceId" must be a valid UUID']);
  }

  try {
    const rows = await sql<WorkItemRow[]>`
      SELECT
        w.id,
        w.workspace_id          AS "workspaceId",
        ws.name                 AS "workspaceName",
        w.assigned_agent_id     AS "assignedAgentId",
        w.work_type             AS "workType",
        w.form_type             AS "formType",
        w.title,
        w.payer_name            AS "payerName",
        w.coverage_type         AS "coverageType",
        w.patient_ref           AS "patientRef",
        w.provider_ref          AS "providerRef",
        w.claim_ref             AS "claimRef",
        w.source_system         AS "sourceSystem",
        w.amount_at_risk        AS "amountAtRisk",
        w.confidence_pct        AS "confidencePct",
        w.priority,
        w.status,
        w.requires_human_review AS "requiresHumanReview",
        w.due_at                AS "dueAt",
        w.submitted_at          AS "submittedAt",
        w.completed_at          AS "completedAt",
        w.metadata,
        w.created_at            AS "createdAt",
        w.updated_at            AS "updatedAt"
      FROM rcm_work_items w
      JOIN rcm_workspaces ws ON ws.id = w.workspace_id
      WHERE w.merchant_id = ${merchant.id}
        AND w.work_type = ${eligibilityLaneContract.laneKey}
        AND (${status ?? null}::text IS NULL OR w.status = ${status ?? null})
        AND (${workspaceId ?? null}::uuid IS NULL OR w.workspace_id = ${workspaceId ?? null})
      ORDER BY
        CASE w.priority
          WHEN 'urgent' THEN 1
          WHEN 'high' THEN 2
          WHEN 'normal' THEN 3
          ELSE 4
        END,
        w.created_at DESC
      LIMIT ${limit}
    `;

    return c.json({
      stage: 'live',
      lane: eligibilityLaneContract.laneKey,
      count: rows.length,
      items: rows.map(mapEligibilityWorkItem),
    });
  } catch (err: unknown) {
    console.error('[rcm] eligibility work-items error:', err instanceof Error ? err.message : err);
    return c.json({ error: 'Failed to fetch eligibility work items' }, 500);
  } finally {
    sql.end().catch(() => {});
  }
});

router.get('/queues/eligibility-exceptions', authenticateApiKey, async (c) => {
  const merchant = c.get('merchant');
  const sql = createDb(c.env);
  const severity = c.req.query('severity');
  const limit = parseLimit(c.req.query('limit'), 50, 200);

  try {
    const rows = await sql<ExceptionQueueRow[]>`
      SELECT
        e.id,
        e.work_item_id          AS "workItemId",
        ws.name                 AS "workspaceName",
        w.payer_name            AS "payerName",
        w.claim_ref             AS "claimRef",
        w.priority,
        e.exception_type        AS "exceptionType",
        e.severity,
        e.reason_code           AS "reasonCode",
        e.summary,
        w.confidence_pct        AS "confidencePct",
        w.amount_at_risk        AS "amountAtRisk",
        e.payload,
        e.created_at            AS "openedAt"
      FROM rcm_exceptions e
      JOIN rcm_work_items w ON w.id = e.work_item_id
      JOIN rcm_workspaces ws ON ws.id = w.workspace_id
      WHERE w.merchant_id = ${merchant.id}
        AND w.work_type = ${eligibilityLaneContract.laneKey}
        AND e.resolved_at IS NULL
        AND (${severity ?? null}::text IS NULL OR e.severity = ${severity ?? null})
      ORDER BY
        CASE e.severity
          WHEN 'critical' THEN 1
          WHEN 'high' THEN 2
          WHEN 'normal' THEN 3
          ELSE 4
        END,
        e.created_at ASC
      LIMIT ${limit}
    `;

    return c.json({
      stage: 'live',
      queueKey: eligibilityLaneContract.exceptionInbox.queueKey,
      count: rows.length,
      items: rows.map((row) => {
        const { exceptionId, workItemId, workspaceName, payerName, priority, exceptionType,
                severity, reasonCode, summary, confidencePct, amountAtRisk, requiredContextFields,
                recommendedHumanAction, assignedReviewer, slaAt, openedAt, payload } = mapException(row);
        return {
          exceptionId,
          workItemId,
          workspaceName,
          payerName,
          /** claim_ref column stores the member/subscriber ID for eligibility work items. */
          memberId: row.claimRef,
          priority,
          exceptionType,
          severity,
          reasonCode,
          summary,
          confidencePct,
          amountAtRisk,
          requiredContextFields,
          recommendedHumanAction,
          assignedReviewer,
          slaAt,
          openedAt,
          payload,
        };
      }),
    });
  } catch (err: unknown) {
    console.error('[rcm] eligibility exception queue error:', err instanceof Error ? err.message : err);
    return c.json({ error: 'Failed to fetch eligibility exception queue' }, 500);
  } finally {
    sql.end().catch(() => {});
  }
});

router.get('/lanes/claim-status/work-items', authenticateApiKey, async (c) => {
  const merchant = c.get('merchant');
  const sql = createDb(c.env);
  const status = c.req.query('status');
  const workspaceId = c.req.query('workspaceId');
  const limit = parseLimit(c.req.query('limit'), 50, 200);

  if (workspaceId && !isUuid(workspaceId)) {
    sql.end().catch(() => {});
    return validationResponse(c, ['"workspaceId" must be a valid UUID']);
  }

  try {
    const rows = await sql<WorkItemRow[]>`
      SELECT
        w.id,
        w.workspace_id          AS "workspaceId",
        ws.name                 AS "workspaceName",
        w.assigned_agent_id     AS "assignedAgentId",
        w.work_type             AS "workType",
        w.form_type             AS "formType",
        w.title,
        w.payer_name            AS "payerName",
        w.coverage_type         AS "coverageType",
        w.patient_ref           AS "patientRef",
        w.provider_ref          AS "providerRef",
        w.claim_ref             AS "claimRef",
        w.source_system         AS "sourceSystem",
        w.amount_at_risk        AS "amountAtRisk",
        w.confidence_pct        AS "confidencePct",
        w.priority,
        w.status,
        w.requires_human_review AS "requiresHumanReview",
        w.due_at                AS "dueAt",
        w.submitted_at          AS "submittedAt",
        w.completed_at          AS "completedAt",
        w.metadata,
        w.created_at            AS "createdAt",
        w.updated_at            AS "updatedAt"
      FROM rcm_work_items w
      JOIN rcm_workspaces ws ON ws.id = w.workspace_id
      WHERE w.merchant_id = ${merchant.id}
        AND w.work_type = ${claimStatusLaneContract.laneKey}
        AND (${status ?? null}::text IS NULL OR w.status = ${status ?? null})
        AND (${workspaceId ?? null}::uuid IS NULL OR w.workspace_id = ${workspaceId ?? null})
      ORDER BY
        CASE w.priority
          WHEN 'urgent' THEN 1
          WHEN 'high' THEN 2
          WHEN 'normal' THEN 3
          ELSE 4
        END,
        w.created_at DESC
      LIMIT ${limit}
    `;

    return c.json({
      stage: 'live',
      lane: claimStatusLaneContract.laneKey,
      count: rows.length,
      items: rows.map(mapWorkItem),
    });
  } catch (err: unknown) {
    console.error('[rcm] claim-status work-items error:', err instanceof Error ? err.message : err);
    return c.json({ error: 'Failed to fetch claim-status work items' }, 500);
  } finally {
    sql.end().catch(() => {});
  }
});

router.get('/queues/claim-status-exceptions', authenticateApiKey, async (c) => {
  const merchant = c.get('merchant');
  const sql = createDb(c.env);
  const severity = c.req.query('severity');
  const limit = parseLimit(c.req.query('limit'), 50, 200);

  try {
    const rows = await sql<ExceptionQueueRow[]>`
      SELECT
        e.id,
        e.work_item_id          AS "workItemId",
        ws.name                 AS "workspaceName",
        w.payer_name            AS "payerName",
        w.claim_ref             AS "claimRef",
        w.priority,
        e.exception_type        AS "exceptionType",
        e.severity,
        e.reason_code           AS "reasonCode",
        e.summary,
        w.confidence_pct        AS "confidencePct",
        w.amount_at_risk        AS "amountAtRisk",
        e.payload,
        e.created_at            AS "openedAt"
      FROM rcm_exceptions e
      JOIN rcm_work_items w ON w.id = e.work_item_id
      JOIN rcm_workspaces ws ON ws.id = w.workspace_id
      WHERE w.merchant_id = ${merchant.id}
        AND w.work_type = ${claimStatusLaneContract.laneKey}
        AND e.resolved_at IS NULL
        AND (${severity ?? null}::text IS NULL OR e.severity = ${severity ?? null})
      ORDER BY
        CASE e.severity
          WHEN 'critical' THEN 1
          WHEN 'high' THEN 2
          WHEN 'normal' THEN 3
          ELSE 4
        END,
        e.created_at ASC
      LIMIT ${limit}
    `;

    return c.json({
      stage: 'live',
      queueKey: claimStatusLaneContract.exceptionInbox.queueKey,
      count: rows.length,
      items: rows.map(mapException),
    });
  } catch (err: unknown) {
    console.error('[rcm] claim-status exception queue error:', err instanceof Error ? err.message : err);
    return c.json({ error: 'Failed to fetch claim-status exception queue' }, 500);
  } finally {
    sql.end().catch(() => {});
  }
});

router.post('/lanes/claim-status/intake', authenticateApiKey, async (c) => {
  const merchant = c.get('merchant');
  let body: Record<string, unknown>;

  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const metadata = asObject(body['metadata']);
  const details: string[] = [];
  const workspaceId = typeof body['workspaceId'] === 'string' ? body['workspaceId'] : '';
  const title = typeof body['title'] === 'string' ? body['title'].trim() : '';
  const workType = typeof body['workType'] === 'string' ? body['workType'] : '';
  const billingDomain = typeof body['billingDomain'] === 'string' ? body['billingDomain'] : '';
  const formType = typeof body['formType'] === 'string' ? body['formType'] : '';
  const payerName = typeof body['payerName'] === 'string' ? body['payerName'].trim() : '';
  const coverageType = typeof body['coverageType'] === 'string' ? body['coverageType'].trim() : '';
  const patientRef = typeof body['patientRef'] === 'string' ? body['patientRef'].trim() : '';
  const providerRef = typeof body['providerRef'] === 'string' ? body['providerRef'].trim() : '';
  const encounterRef = typeof body['encounterRef'] === 'string' ? body['encounterRef'].trim() : null;
  const claimRef = typeof body['claimRef'] === 'string' ? body['claimRef'].trim() : '';
  const sourceSystem = typeof body['sourceSystem'] === 'string' ? body['sourceSystem'].trim() : '';
  const priority = normalizePriority(body['priority']);
  const dueAt = parseDateString(body['dueAt']);
  const amountAtRisk = parsePositiveAmount(body['amountAtRisk']);
  const supportingDocRefs = Array.isArray(metadata['supportingDocRefs'])
    ? metadata['supportingDocRefs'].filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    : [];
  const providerContactEmail =
    typeof metadata['providerContactEmail'] === 'string' ? metadata['providerContactEmail'].trim() : '';
  const originalSubmissionDate = parseDateString(metadata['originalSubmissionDate']);

  if (!workspaceId || !isUuid(workspaceId)) details.push('"workspaceId" must be a valid UUID');
  if (!title) details.push('"title" is required');
  if (workType !== claimStatusLaneContract.laneKey) {
    details.push(`"workType" must be "${claimStatusLaneContract.laneKey}"`);
  }
  if (!claimStatusLaneContract.supportedDomains.includes(billingDomain)) {
    details.push(`"billingDomain" must be one of: ${claimStatusLaneContract.supportedDomains.join(', ')}`);
  }
  if (!claimStatusLaneContract.supportedForms.includes(formType)) {
    details.push(`"formType" must be one of: ${claimStatusLaneContract.supportedForms.join(', ')}`);
  }
  if (!payerName) details.push('"payerName" is required');
  if (!coverageType) details.push('"coverageType" is required');
  if (!patientRef) details.push('"patientRef" is required');
  if (!providerRef) details.push('"providerRef" is required');
  if (!claimRef) details.push('"claimRef" is required');
  if (!sourceSystem) details.push('"sourceSystem" is required');
  if (!dueAt) details.push('"dueAt" must be a valid ISO date');
  if (amountAtRisk === null) details.push('"amountAtRisk" must be a positive number');
  if (supportingDocRefs.length === 0) details.push('"metadata.supportingDocRefs" must contain at least one reference');
  if (!providerContactEmail || !isValidEmail(providerContactEmail)) {
    details.push('"metadata.providerContactEmail" must be a valid email');
  }
  if (!originalSubmissionDate) {
    details.push('"metadata.originalSubmissionDate" must be a valid ISO date');
  }

  if (details.length > 0) return validationResponse(c, details);

  const workItemId = crypto.randomUUID();
  const sql = createDb(c.env);

  try {
    const result = await sql.begin(async (tx: any) => {
      const workspace = await getOwnedWorkspace(tx, merchant.id, workspaceId);
      if (!workspace) {
        throw new Error('WORKSPACE_NOT_FOUND');
      }

      const workItemMetadata = {
        ...metadata,
        laneKey: claimStatusLaneContract.laneKey,
        contractVersion: claimStatusLaneContract.version,
        playbookVersion: typeof metadata['playbookVersion'] === 'string' ? metadata['playbookVersion'] : 'claim_status_v1',
        autoExecuteAllowed: metadata['autoExecuteAllowed'] !== false,
        connectorPlan: {
          primary: 'x12_276_277',
          fallback: ['portal', 'dde'],
        },
        routing: {
          laneSelection: claimStatusLaneContract.laneKey,
          priorityBand: priority,
          routingReason: 'structured_claim_status_lane',
        },
        attemptHistory: [],
      };

      await tx`
        INSERT INTO rcm_work_items (
          id,
          workspace_id,
          merchant_id,
          work_type,
          billing_domain,
          form_type,
          title,
          payer_name,
          coverage_type,
          patient_ref,
          provider_ref,
          encounter_ref,
          claim_ref,
          source_system,
          amount_at_risk,
          priority,
          status,
          requires_human_review,
          due_at,
          metadata,
          created_at,
          updated_at
        )
        VALUES (
          ${workItemId},
          ${workspaceId},
          ${merchant.id},
          ${claimStatusLaneContract.laneKey},
          ${billingDomain},
          ${formType},
          ${title},
          ${payerName},
          ${coverageType},
          ${patientRef},
          ${providerRef},
          ${encounterRef},
          ${claimRef},
          ${sourceSystem},
          ${amountAtRisk},
          ${priority},
          'routed',
          false,
          ${dueAt},
          ${jsonb(workItemMetadata)}::jsonb,
          NOW(),
          NOW()
        )
      `;

      await insertEvidence(
        tx,
        workItemId,
        [
          {
            actorType: 'router_agent',
            actorRef: 'claim_status_router',
            evidenceType: 'router_decision_recorded',
            payload: {
              laneSelection: claimStatusLaneContract.laneKey,
              routingReason: 'structured_claim_status_lane',
              autoExecuteAllowed: workItemMetadata.autoExecuteAllowed,
              connectorPlan: workItemMetadata.connectorPlan,
            },
          },
        ],
        'router_agent',
        'claim_status_router',
      );

      const row = await getOwnedClaimStatusWorkItem(tx, merchant.id, workItemId);
      if (!row) throw new Error('WORK_ITEM_NOT_FOUND');
      return {
        workspaceName: workspace.name,
        workItem: mapWorkItem(row),
      };
    });

    return c.json(
      {
        stage: 'live',
        lane: claimStatusLaneContract.laneKey,
        nextState: 'routed',
        nextAction: 'execute_primary',
        workspaceName: result.workspaceName,
        workItem: result.workItem,
      },
      201,
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === 'WORKSPACE_NOT_FOUND') {
      return c.json({ error: 'Workspace not found' }, 404);
    }
    console.error('[rcm] claim-status intake error:', message);
    return c.json({ error: 'Failed to create claim-status work item' }, 500);
  } finally {
    sql.end().catch(() => {});
  }
});

router.post('/lanes/claim-status/work-items/:workItemId/run-primary', authenticateApiKey, async (c) => {
  const merchant = c.get('merchant');
  const workItemId = c.req.param('workItemId') ?? '';
  if (!isUuid(workItemId)) {
    return validationResponse(c, ['"workItemId" must be a valid UUID']);
  }

  let body: Record<string, unknown> = {};
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }

  const connectorKey = (typeof body['connectorKey'] === 'string' ? body['connectorKey'] : 'x12_276_277') as ClaimStatusConnectorKey;
  const playbookVersion =
    typeof body['playbookVersion'] === 'string' && body['playbookVersion'].trim()
      ? body['playbookVersion'].trim()
      : 'claim_status_v1';
  const strategy =
    typeof body['strategy'] === 'string' && body['strategy'].trim()
      ? body['strategy'].trim()
      : connectorKey;
  const autoRoute = body['autoRoute'] !== false;
  const agentId = typeof body['agentId'] === 'string' ? body['agentId'] : null;
  const qaActorRef =
    typeof body['qaActorRef'] === 'string' && body['qaActorRef'].trim()
      ? body['qaActorRef'].trim()
      : 'claim_status_policy_loop';

  const details: string[] = [];
  if (connectorKey !== 'x12_276_277') {
    details.push('"connectorKey" must be "x12_276_277" for primary execution');
  }
  if (agentId && !isUuid(agentId)) {
    details.push('"agentId" must be a valid UUID');
  }
  if (details.length > 0) return validationResponse(c, details);

  const sql = createDb(c.env);
  try {
    const row = await getOwnedClaimStatusWorkItem(sql, merchant.id, workItemId);
    if (!row) return c.json({ error: 'Work item not found' }, 404);
    if (row.status !== 'routed') {
      return c.json({ error: 'Claim-status work item must be in "routed" before autonomous run' }, 409);
    }

    const connectorResult = await runClaimStatusConnector(
      c.env,
      connectorKey,
      connectorInputFromWorkItem(row),
    );

    const persisted = await sql.begin(async (tx: any) =>
      persistClaimStatusConnectorRun(tx, merchant.id, workItemId, {
        attemptRole: 'primary_worker',
        agentId,
        qaActorRef,
        playbookVersion,
        strategy,
        connectorResult,
        autoRoute,
      }),
    );

    return c.json({
      stage: 'live',
      autoRoute,
      nextState: persisted.nextState,
      connector: {
        key: connectorResult.connectorKey,
        mode: connectorResult.mode,
        statusCode: connectorResult.statusCode,
        statusLabel: connectorResult.statusLabel,
        traceId: connectorResult.connectorTraceId,
        summary: connectorResult.summary,
      },
      workItem: persisted.workItem,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === 'WORK_ITEM_NOT_FOUND') return c.json({ error: 'Work item not found' }, 404);
    if (message === 'INVALID_STATE') {
      return c.json({ error: 'Claim-status work item must be in "routed" before autonomous run' }, 409);
    }
    if (message === 'ATTEMPTS_EXHAUSTED') {
      return c.json({ error: 'Autonomous attempt limit reached for this work item' }, 409);
    }
    console.error('[rcm] claim-status run-primary error:', message);
    return c.json({ error: 'Failed to run primary claim-status connector' }, 500);
  } finally {
    sql.end().catch(() => {});
  }
});

router.post('/lanes/claim-status/work-items/:workItemId/run-fallback', authenticateApiKey, async (c) => {
  const merchant = c.get('merchant');
  const workItemId = c.req.param('workItemId') ?? '';
  if (!isUuid(workItemId)) {
    return validationResponse(c, ['"workItemId" must be a valid UUID']);
  }

  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const connectorKey = (
    typeof body['connectorKey'] === 'string' ? body['connectorKey'] : 'dde'
  ) as ClaimStatusConnectorKey;
  const playbookVersion =
    typeof body['playbookVersion'] === 'string' && body['playbookVersion'].trim()
      ? body['playbookVersion'].trim()
      : 'claim_status_v1';
  const strategy =
    typeof body['alternativeStrategy'] === 'string' && body['alternativeStrategy'].trim()
      ? body['alternativeStrategy'].trim()
      : '';
  const autoRoute = body['autoRoute'] !== false;
  const agentId = typeof body['agentId'] === 'string' ? body['agentId'] : null;
  const qaActorRef =
    typeof body['qaActorRef'] === 'string' && body['qaActorRef'].trim()
      ? body['qaActorRef'].trim()
      : 'claim_status_policy_loop';

  const details: string[] = [];
  if (!['x12_276_277', 'portal', 'dde'].includes(connectorKey)) {
    details.push('"connectorKey" must be one of: x12_276_277, portal, dde');
  }
  if (!strategy) details.push('"alternativeStrategy" is required');
  if (agentId && !isUuid(agentId)) details.push('"agentId" must be a valid UUID');
  if (details.length > 0) return validationResponse(c, details);

  const sql = createDb(c.env);
  try {
    const row = await getOwnedClaimStatusWorkItem(sql, merchant.id, workItemId);
    if (!row) return c.json({ error: 'Work item not found' }, 404);
    if (row.status !== 'retry_pending') {
      return c.json({ error: 'Claim-status work item must be in "retry_pending" before fallback run' }, 409);
    }

    const connectorResult = await runClaimStatusConnector(
      c.env,
      connectorKey,
      connectorInputFromWorkItem(row),
    );

    const persisted = await sql.begin(async (tx: any) =>
      persistClaimStatusConnectorRun(tx, merchant.id, workItemId, {
        attemptRole: 'fallback_worker',
        agentId,
        qaActorRef,
        playbookVersion,
        strategy,
        connectorResult,
        autoRoute,
      }),
    );

    return c.json({
      stage: 'live',
      autoRoute,
      nextState: persisted.nextState,
      connector: {
        key: connectorResult.connectorKey,
        mode: connectorResult.mode,
        statusCode: connectorResult.statusCode,
        statusLabel: connectorResult.statusLabel,
        traceId: connectorResult.connectorTraceId,
        summary: connectorResult.summary,
      },
      workItem: persisted.workItem,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === 'WORK_ITEM_NOT_FOUND') return c.json({ error: 'Work item not found' }, 404);
    if (message === 'INVALID_STATE') {
      return c.json({ error: 'Claim-status work item must be in "retry_pending" before fallback run' }, 409);
    }
    if (message === 'NO_PRIOR_ATTEMPT') {
      return c.json({ error: 'Fallback connector run requires a prior primary attempt' }, 409);
    }
    if (message === 'ATTEMPTS_EXHAUSTED') {
      return c.json({ error: 'Autonomous attempt limit reached for this work item' }, 409);
    }
    if (message === 'SAME_STRATEGY') {
      return c.json({ error: 'Fallback connector run must use a different strategy or connector' }, 409);
    }
    console.error('[rcm] claim-status run-fallback error:', message);
    return c.json({ error: 'Failed to run fallback claim-status connector' }, 500);
  } finally {
    sql.end().catch(() => {});
  }
});

router.post('/lanes/claim-status/work-items/:workItemId/execute', authenticateApiKey, async (c) => {
  const merchant = c.get('merchant');
  const workItemId = c.req.param('workItemId') ?? '';
  if (!isUuid(workItemId)) {
    return validationResponse(c, ['"workItemId" must be a valid UUID']);
  }

  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const details: string[] = [];
  const attemptRole = body['attemptRole'];
  const playbookVersion = typeof body['playbookVersion'] === 'string' ? body['playbookVersion'].trim() : '';
  const connectorStrategy = typeof body['connectorStrategy'] === 'string' ? body['connectorStrategy'].trim() : '';
  const proposedResolution = typeof body['proposedResolution'] === 'string' ? body['proposedResolution'].trim() : '';
  const resolutionReasonCode =
    typeof body['resolutionReasonCode'] === 'string' ? body['resolutionReasonCode'].trim() : '';
  const confidencePct = parseConfidence(body['confidencePct']);
  const evidenceInput = Array.isArray(body['evidence']) ? body['evidence'] : [];
  const agentId = typeof body['agentId'] === 'string' ? body['agentId'] : null;
  const nextBestAction = typeof body['nextBestAction'] === 'string' ? body['nextBestAction'].trim() : null;

  if (attemptRole !== 'primary_worker') details.push('"attemptRole" must be "primary_worker"');
  if (!playbookVersion) details.push('"playbookVersion" is required');
  if (!connectorStrategy) details.push('"connectorStrategy" is required');
  if (!proposedResolution) details.push('"proposedResolution" is required');
  if (!resolutionReasonCode) details.push('"resolutionReasonCode" is required');
  if (confidencePct === null) details.push('"confidencePct" must be a number between 0 and 100');
  if (agentId && !isUuid(agentId)) details.push('"agentId" must be a valid UUID');
  if (evidenceInput.length === 0) details.push('"evidence" must contain at least one evidence record');

  const evidence = evidenceInput
    .map((entry) => {
      const item = asObject(entry);
      return {
        actorType: typeof item['actorType'] === 'string' ? item['actorType'] : 'worker_agent',
        actorRef:
          typeof item['actorRef'] === 'string'
            ? item['actorRef']
            : agentId ?? 'claim_status_primary_worker',
        evidenceType: typeof item['evidenceType'] === 'string' ? item['evidenceType'] : '',
        payload: item['payload'],
      } satisfies EvidenceInput;
    })
    .filter((item) => item.evidenceType.length > 0);

  if (evidence.length !== evidenceInput.length) {
    details.push('Each evidence item must include "evidenceType"');
  }

  if (details.length > 0) return validationResponse(c, details);

  const sql = createDb(c.env);
  try {
    const result = await sql.begin(async (tx: any) => {
      const row = await getOwnedClaimStatusWorkItemForUpdate(tx, merchant.id, workItemId);
      if (!row) throw new Error('WORK_ITEM_NOT_FOUND');
      if (row.status !== 'routed') throw new Error('INVALID_STATE');

      const metadata = parseJsonb<JsonRecord>(row.metadata, {});
      const attempts = getAttemptHistory(metadata);
      if (attempts.length >= claimStatusLaneContract.retryPolicy.maxAutonomousAttempts) {
        throw new Error('ATTEMPTS_EXHAUSTED');
      }

      const nextAttempt = {
        attemptNumber: attempts.length + 1,
        attemptRole,
        strategy: connectorStrategy,
        playbookVersion,
        proposedResolution,
        resolutionReasonCode,
        confidencePct,
        nextBestAction,
        submittedAt: new Date().toISOString(),
        evidenceTypes: evidence.map((item) => item.evidenceType),
      };

      const updatedMetadata = {
        ...metadata,
        playbookVersion,
        lastExecution: nextAttempt,
        attemptHistory: [...attempts, nextAttempt],
      };

      await tx`
        UPDATE rcm_work_items
        SET
          assigned_agent_id = ${agentId},
          confidence_pct = ${confidencePct},
          status = 'awaiting_qa',
          submitted_at = NOW(),
          metadata = ${jsonb(updatedMetadata)}::jsonb,
          updated_at = NOW()
        WHERE id = ${workItemId}
      `;

      await insertEvidence(
        tx,
        workItemId,
        [
          ...evidence,
          {
            actorType: 'worker_agent',
            actorRef: agentId ?? 'claim_status_primary_worker',
            evidenceType: 'execution_resolution_proposed',
            payload: nextAttempt,
          },
        ],
        'worker_agent',
        agentId ?? 'claim_status_primary_worker',
      );

      const updated = await getOwnedClaimStatusWorkItem(tx, merchant.id, workItemId);
      if (!updated) throw new Error('WORK_ITEM_NOT_FOUND');
      return mapWorkItem(updated);
    });

    return c.json({
      stage: 'live',
      nextState: 'awaiting_qa',
      nextAction: 'qa_verify',
      workItem: result,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === 'WORK_ITEM_NOT_FOUND') return c.json({ error: 'Work item not found' }, 404);
    if (message === 'INVALID_STATE') {
      return c.json({ error: 'Claim-status work item must be in "routed" before execute' }, 409);
    }
    if (message === 'ATTEMPTS_EXHAUSTED') {
      return c.json({ error: 'Autonomous attempt limit reached for this lane' }, 409);
    }
    console.error('[rcm] claim-status execute error:', message);
    return c.json({ error: 'Failed to execute claim-status work item' }, 500);
  } finally {
    sql.end().catch(() => {});
  }
});

router.post('/lanes/claim-status/work-items/:workItemId/verify', authenticateApiKey, async (c) => {
  const merchant = c.get('merchant');
  const workItemId = c.req.param('workItemId') ?? '';
  if (!isUuid(workItemId)) {
    return validationResponse(c, ['"workItemId" must be a valid UUID']);
  }

  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const details: string[] = [];
  const qaDecision = typeof body['qaDecision'] === 'string' ? body['qaDecision'] : '';
  const qaReasonCode = typeof body['qaReasonCode'] === 'string' ? body['qaReasonCode'].trim() : '';
  const agentId = typeof body['agentId'] === 'string' ? body['agentId'] : null;
  const exceptionType = typeof body['exceptionType'] === 'string' ? body['exceptionType'] : '';
  const summary = typeof body['summary'] === 'string' ? body['summary'].trim() : '';
  const recommendedHumanAction =
    typeof body['recommendedHumanAction'] === 'string' ? body['recommendedHumanAction'].trim() : '';
  const severity =
    typeof body['severity'] === 'string' && ['critical', 'high', 'normal', 'low'].includes(body['severity'])
      ? (body['severity'] as string)
      : 'normal';
  const requiredContextFields = Array.isArray(body['requiredContextFields'])
    ? body['requiredContextFields'].filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    : [];
  const notes = typeof body['notes'] === 'string' ? body['notes'].trim() : null;

  if (!['approve_auto_close', 'retry_with_next_worker', 'escalate'].includes(qaDecision)) {
    details.push('"qaDecision" must be one of: approve_auto_close, retry_with_next_worker, escalate');
  }
  if (!qaReasonCode) details.push('"qaReasonCode" is required');
  if (agentId && !isUuid(agentId)) details.push('"agentId" must be a valid UUID');
  if (qaDecision === 'escalate') {
    if (!claimStatusLaneContract.exceptionInbox.triageBuckets.includes(exceptionType)) {
      details.push(
        `"exceptionType" must be one of: ${claimStatusLaneContract.exceptionInbox.triageBuckets.join(', ')}`,
      );
    }
    if (!summary) details.push('"summary" is required when escalating');
    if (!recommendedHumanAction) details.push('"recommendedHumanAction" is required when escalating');
  }

  if (details.length > 0) return validationResponse(c, details);

  const sql = createDb(c.env);
  try {
    const result = await sql.begin(async (tx: any) => {
      const row = await getOwnedClaimStatusWorkItemForUpdate(tx, merchant.id, workItemId);
      if (!row) throw new Error('WORK_ITEM_NOT_FOUND');
      if (row.status !== 'awaiting_qa') throw new Error('INVALID_STATE');

      const metadata = parseJsonb<JsonRecord>(row.metadata, {});
      const attempts = getAttemptHistory(metadata);
      if (qaDecision === 'retry_with_next_worker' && attempts.length >= claimStatusLaneContract.retryPolicy.maxAutonomousAttempts) {
        throw new Error('ATTEMPTS_EXHAUSTED');
      }

      const qaPayload = {
        qaDecision,
        qaReasonCode,
        reviewedAt: new Date().toISOString(),
        reviewerAgentId: agentId,
      };

      const nextMetadata = {
        ...metadata,
        lastQaDecision: qaPayload,
      };

      let nextState = 'awaiting_qa';

      if (qaDecision === 'approve_auto_close') {
        nextState = 'closed_auto';
        await tx`
          UPDATE rcm_work_items
          SET
            status = 'closed_auto',
            requires_human_review = false,
            completed_at = NOW(),
            metadata = ${jsonb(nextMetadata)}::jsonb,
            updated_at = NOW()
          WHERE id = ${workItemId}
        `;
        await resolveOpenExceptions(tx, workItemId);
      } else if (qaDecision === 'retry_with_next_worker') {
        nextState = 'retry_pending';
        await tx`
          UPDATE rcm_work_items
          SET
            status = 'retry_pending',
            metadata = ${jsonb(nextMetadata)}::jsonb,
            updated_at = NOW()
          WHERE id = ${workItemId}
        `;
      } else {
        nextState = 'human_review_required';
        const payload = {
          requiredContextFields,
          recommendedHumanAction,
          notes,
          qaReasonCode,
          lastAttempt: attempts[attempts.length - 1] ?? null,
        };
        await upsertOpenException(tx, workItemId, {
          exceptionType,
          severity,
          reasonCode: qaReasonCode,
          summary,
          payload,
        });
        await tx`
          UPDATE rcm_work_items
          SET
            status = 'human_review_required',
            requires_human_review = true,
            metadata = ${jsonb(nextMetadata)}::jsonb,
            updated_at = NOW()
          WHERE id = ${workItemId}
        `;
      }

      await insertEvidence(
        tx,
        workItemId,
        [
          {
            actorType: 'qa_agent',
            actorRef: agentId ?? 'claim_status_qa',
            evidenceType: 'qa_decision_recorded',
            payload: {
              ...qaPayload,
              exceptionType: qaDecision === 'escalate' ? exceptionType : null,
            },
          },
        ],
        'qa_agent',
        agentId ?? 'claim_status_qa',
      );

      const updated = await getOwnedClaimStatusWorkItem(tx, merchant.id, workItemId);
      if (!updated) throw new Error('WORK_ITEM_NOT_FOUND');

      return {
        nextState,
        workItem: mapWorkItem(updated),
      };
    });

    return c.json({
      stage: 'live',
      nextState: result.nextState,
      workItem: result.workItem,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === 'WORK_ITEM_NOT_FOUND') return c.json({ error: 'Work item not found' }, 404);
    if (message === 'INVALID_STATE') {
      return c.json({ error: 'Claim-status work item must be in "awaiting_qa" before verify' }, 409);
    }
    if (message === 'ATTEMPTS_EXHAUSTED') {
      return c.json({ error: 'Fallback retry is no longer allowed for this work item' }, 409);
    }
    console.error('[rcm] claim-status verify error:', message);
    return c.json({ error: 'Failed to verify claim-status work item' }, 500);
  } finally {
    sql.end().catch(() => {});
  }
});

router.post('/lanes/claim-status/work-items/:workItemId/retry', authenticateApiKey, async (c) => {
  const merchant = c.get('merchant');
  const workItemId = c.req.param('workItemId') ?? '';
  if (!isUuid(workItemId)) {
    return validationResponse(c, ['"workItemId" must be a valid UUID']);
  }

  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const details: string[] = [];
  const playbookVersion = typeof body['playbookVersion'] === 'string' ? body['playbookVersion'].trim() : '';
  const connectorStrategy = typeof body['connectorStrategy'] === 'string' ? body['connectorStrategy'].trim() : '';
  const alternativeStrategy = typeof body['alternativeStrategy'] === 'string' ? body['alternativeStrategy'].trim() : '';
  const fallbackResolution = typeof body['fallbackResolution'] === 'string' ? body['fallbackResolution'].trim() : '';
  const fallbackReasonCode = typeof body['fallbackReasonCode'] === 'string' ? body['fallbackReasonCode'].trim() : '';
  const confidencePct = parseConfidence(body['confidencePct']);
  const evidenceInput = Array.isArray(body['evidence']) ? body['evidence'] : [];
  const agentId = typeof body['agentId'] === 'string' ? body['agentId'] : null;

  if (!playbookVersion) details.push('"playbookVersion" is required');
  if (!connectorStrategy) details.push('"connectorStrategy" is required');
  if (!alternativeStrategy) details.push('"alternativeStrategy" is required');
  if (!fallbackResolution) details.push('"fallbackResolution" is required');
  if (!fallbackReasonCode) details.push('"fallbackReasonCode" is required');
  if (confidencePct === null) details.push('"confidencePct" must be a number between 0 and 100');
  if (agentId && !isUuid(agentId)) details.push('"agentId" must be a valid UUID');
  if (evidenceInput.length === 0) details.push('"evidence" must contain at least one evidence record');

  const evidence = evidenceInput
    .map((entry) => {
      const item = asObject(entry);
      return {
        actorType: typeof item['actorType'] === 'string' ? item['actorType'] : 'fallback_worker_agent',
        actorRef:
          typeof item['actorRef'] === 'string'
            ? item['actorRef']
            : agentId ?? 'claim_status_fallback_worker',
        evidenceType: typeof item['evidenceType'] === 'string' ? item['evidenceType'] : '',
        payload: item['payload'],
      } satisfies EvidenceInput;
    })
    .filter((item) => item.evidenceType.length > 0);

  if (evidence.length !== evidenceInput.length) {
    details.push('Each evidence item must include "evidenceType"');
  }

  if (details.length > 0) return validationResponse(c, details);

  const sql = createDb(c.env);
  try {
    const result = await sql.begin(async (tx: any) => {
      const row = await getOwnedClaimStatusWorkItemForUpdate(tx, merchant.id, workItemId);
      if (!row) throw new Error('WORK_ITEM_NOT_FOUND');
      if (row.status !== 'retry_pending') throw new Error('INVALID_STATE');

      const metadata = parseJsonb<JsonRecord>(row.metadata, {});
      const attempts = getAttemptHistory(metadata);
      if (attempts.length === 0) throw new Error('NO_PRIOR_ATTEMPT');
      if (attempts.length >= claimStatusLaneContract.retryPolicy.maxAutonomousAttempts) {
        throw new Error('ATTEMPTS_EXHAUSTED');
      }

      const previousAttempt = attempts[attempts.length - 1];
      const previousStrategy =
        typeof previousAttempt['strategy'] === 'string' ? previousAttempt['strategy'] : '';
      const previousConnector =
        typeof previousAttempt['connectorStrategy'] === 'string'
          ? previousAttempt['connectorStrategy']
          : previousStrategy;

      if (claimStatusLaneContract.retryPolicy.requireDifferentStrategyOnRetry) {
        const strategyChanged = alternativeStrategy !== previousStrategy;
        const connectorChanged = connectorStrategy !== previousConnector;
        if (!strategyChanged && !connectorChanged) {
          throw new Error('SAME_STRATEGY');
        }
      }

      const nextAttempt = {
        attemptNumber: attempts.length + 1,
        attemptRole: 'fallback_worker',
        strategy: alternativeStrategy,
        connectorStrategy,
        playbookVersion,
        fallbackResolution,
        fallbackReasonCode,
        confidencePct,
        submittedAt: new Date().toISOString(),
        evidenceTypes: evidence.map((item) => item.evidenceType),
      };

      const nextMetadata = {
        ...metadata,
        playbookVersion,
        lastExecution: nextAttempt,
        attemptHistory: [...attempts, nextAttempt],
      };

      await tx`
        UPDATE rcm_work_items
        SET
          assigned_agent_id = ${agentId},
          confidence_pct = ${confidencePct},
          status = 'awaiting_qa',
          submitted_at = NOW(),
          metadata = ${jsonb(nextMetadata)}::jsonb,
          updated_at = NOW()
        WHERE id = ${workItemId}
      `;

      await insertEvidence(
        tx,
        workItemId,
        [
          ...evidence,
          {
            actorType: 'fallback_worker_agent',
            actorRef: agentId ?? 'claim_status_fallback_worker',
            evidenceType: 'fallback_execution_submitted',
            payload: nextAttempt,
          },
        ],
        'fallback_worker_agent',
        agentId ?? 'claim_status_fallback_worker',
      );

      const updated = await getOwnedClaimStatusWorkItem(tx, merchant.id, workItemId);
      if (!updated) throw new Error('WORK_ITEM_NOT_FOUND');
      return mapWorkItem(updated);
    });

    return c.json({
      stage: 'live',
      nextState: 'awaiting_qa',
      nextAction: 'qa_verify',
      workItem: result,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === 'WORK_ITEM_NOT_FOUND') return c.json({ error: 'Work item not found' }, 404);
    if (message === 'INVALID_STATE') {
      return c.json({ error: 'Claim-status work item must be in "retry_pending" before retry' }, 409);
    }
    if (message === 'NO_PRIOR_ATTEMPT') {
      return c.json({ error: 'Fallback retry requires a prior autonomous attempt' }, 409);
    }
    if (message === 'ATTEMPTS_EXHAUSTED') {
      return c.json({ error: 'Autonomous attempt limit reached for this work item' }, 409);
    }
    if (message === 'SAME_STRATEGY') {
      return c.json({ error: 'Fallback retry must use a different strategy or connector path' }, 409);
    }
    console.error('[rcm] claim-status retry error:', message);
    return c.json({ error: 'Failed to submit fallback retry' }, 500);
  } finally {
    sql.end().catch(() => {});
  }
});

router.post('/lanes/claim-status/work-items/:workItemId/escalate', authenticateApiKey, async (c) => {
  const merchant = c.get('merchant');
  const workItemId = c.req.param('workItemId') ?? '';
  if (!isUuid(workItemId)) {
    return validationResponse(c, ['"workItemId" must be a valid UUID']);
  }

  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const details: string[] = [];
  const exceptionType = typeof body['exceptionType'] === 'string' ? body['exceptionType'] : '';
  const summary = typeof body['summary'] === 'string' ? body['summary'].trim() : '';
  const reasonCode = typeof body['reasonCode'] === 'string' ? body['reasonCode'].trim() : '';
  const recommendedHumanAction =
    typeof body['recommendedHumanAction'] === 'string' ? body['recommendedHumanAction'].trim() : '';
  const assignedReviewer =
    typeof body['assignedReviewer'] === 'string' ? body['assignedReviewer'].trim() : null;
  const notes = typeof body['notes'] === 'string' ? body['notes'].trim() : null;
  const agentId = typeof body['agentId'] === 'string' ? body['agentId'] : null;
  const severity =
    typeof body['severity'] === 'string' && ['critical', 'high', 'normal', 'low'].includes(body['severity'])
      ? (body['severity'] as string)
      : 'normal';
  const requiredContextFields = Array.isArray(body['requiredContextFields'])
    ? body['requiredContextFields'].filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    : [];
  const slaAt = parseDateString(body['slaAt']) ?? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  if (!claimStatusLaneContract.exceptionInbox.triageBuckets.includes(exceptionType)) {
    details.push(`"exceptionType" must be one of: ${claimStatusLaneContract.exceptionInbox.triageBuckets.join(', ')}`);
  }
  if (!summary) details.push('"summary" is required');
  if (!reasonCode) details.push('"reasonCode" is required');
  if (!recommendedHumanAction) details.push('"recommendedHumanAction" is required');
  if (agentId && !isUuid(agentId)) details.push('"agentId" must be a valid UUID');

  if (details.length > 0) return validationResponse(c, details);

  const sql = createDb(c.env);
  try {
    const result = await sql.begin(async (tx: any) => {
      const row = await getOwnedClaimStatusWorkItemForUpdate(tx, merchant.id, workItemId);
      if (!row) throw new Error('WORK_ITEM_NOT_FOUND');
      if (claimStatusLaneContract.stateMachine.terminalStates.includes(row.status)) {
        throw new Error('TERMINAL_STATE');
      }

      const payload = {
        requiredContextFields,
        recommendedHumanAction,
        assignedReviewer,
        slaAt,
        notes,
      };
      await upsertOpenException(tx, workItemId, {
        exceptionType,
        severity,
        reasonCode,
        summary,
        payload,
      });

      const metadata = parseJsonb<JsonRecord>(row.metadata, {});
      await tx`
        UPDATE rcm_work_items
        SET
          status = 'human_review_required',
          requires_human_review = true,
          metadata = ${jsonb({
            ...metadata,
            lastEscalation: {
              exceptionType,
              reasonCode,
              recommendedHumanAction,
              assignedReviewer,
              escalatedAt: new Date().toISOString(),
            },
          })}::jsonb,
          updated_at = NOW()
        WHERE id = ${workItemId}
      `;

      await insertEvidence(
        tx,
        workItemId,
        [
          {
            actorType: 'escalation_agent',
            actorRef: agentId ?? 'claim_status_escalation',
            evidenceType: 'escalation_packet_created',
            payload: {
              exceptionType,
              reasonCode,
              summary,
              ...payload,
            },
          },
        ],
        'escalation_agent',
        agentId ?? 'claim_status_escalation',
      );

      const updated = await getOwnedClaimStatusWorkItem(tx, merchant.id, workItemId);
      if (!updated) throw new Error('WORK_ITEM_NOT_FOUND');
      return mapWorkItem(updated);
    });

    return c.json({
      stage: 'live',
      nextState: 'human_review_required',
      workItem: result,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === 'WORK_ITEM_NOT_FOUND') return c.json({ error: 'Work item not found' }, 404);
    if (message === 'TERMINAL_STATE') {
      return c.json({ error: 'Terminal claim-status work items cannot be escalated again' }, 409);
    }
    console.error('[rcm] claim-status escalate error:', message);
    return c.json({ error: 'Failed to escalate claim-status work item' }, 500);
  } finally {
    sql.end().catch(() => {});
  }
});

router.post('/lanes/claim-status/work-items/:workItemId/resolve', authenticateApiKey, async (c) => {
  const merchant = c.get('merchant');
  const workItemId = c.req.param('workItemId') ?? '';
  if (!isUuid(workItemId)) {
    return validationResponse(c, ['"workItemId" must be a valid UUID']);
  }

  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const details: string[] = [];
  const action = typeof body['action'] === 'string' ? body['action'] : '';
  const reviewerRef = typeof body['reviewerRef'] === 'string' ? body['reviewerRef'].trim() : 'human_reviewer';
  const summary = typeof body['summary'] === 'string' ? body['summary'].trim() : null;
  const addedContext = asObject(body['addedContext']);
  const ruleCandidate = asObject(body['ruleCandidate']);
  const exceptionType = typeof body['exceptionType'] === 'string' ? body['exceptionType'] : null;

  if (!claimStatusLaneContract.exceptionInbox.allowedHumanActions.includes(action)) {
    details.push(
      `"action" must be one of: ${claimStatusLaneContract.exceptionInbox.allowedHumanActions.join(', ')}`,
    );
  }
  if (action === 'add_missing_context' && Object.keys(addedContext).length === 0) {
    details.push('"addedContext" is required for add_missing_context');
  }
  if (action === 'classify_new_exception_type' && !exceptionType) {
    details.push('"exceptionType" is required for classify_new_exception_type');
  }

  if (details.length > 0) return validationResponse(c, details);

  const sql = createDb(c.env);
  try {
    const result = await sql.begin(async (tx: any) => {
      const row = await getOwnedClaimStatusWorkItemForUpdate(tx, merchant.id, workItemId);
      if (!row) throw new Error('WORK_ITEM_NOT_FOUND');
      if (claimStatusLaneContract.stateMachine.terminalStates.includes(row.status)) {
        throw new Error('TERMINAL_STATE');
      }

      const exceptionManagedStates = new Set(['human_review_required', 'blocked']);
      if (!exceptionManagedStates.has(row.status)) {
        throw new Error('INVALID_STATE');
      }

      const metadata = parseJsonb<JsonRecord>(row.metadata, {});
      const nowIso = new Date().toISOString();
      let nextStatus = row.status;
      let evidenceType = 'human_resolution_recorded';

      if (action === 'approve_closure' || action === 'take_over_case') {
        nextStatus = 'closed_human';
        await tx`
          UPDATE rcm_work_items
          SET
            status = 'closed_human',
            requires_human_review = false,
            completed_at = NOW(),
            metadata = ${jsonb({
              ...metadata,
              lastHumanDecision: {
                action,
                reviewerRef,
                summary,
                decidedAt: nowIso,
              },
            })}::jsonb,
            updated_at = NOW()
          WHERE id = ${workItemId}
        `;
        await tx`
          UPDATE rcm_exceptions
          SET resolved_at = NOW()
          WHERE work_item_id = ${workItemId}
            AND resolved_at IS NULL
        `;
      } else if (action === 'reject_closure') {
        nextStatus = 'rejected';
        await tx`
          UPDATE rcm_work_items
          SET
            status = 'rejected',
            requires_human_review = false,
            metadata = ${jsonb({
              ...metadata,
              lastHumanDecision: {
                action,
                reviewerRef,
                summary,
                decidedAt: nowIso,
              },
            })}::jsonb,
            updated_at = NOW()
          WHERE id = ${workItemId}
        `;
        await tx`
          UPDATE rcm_exceptions
          SET resolved_at = NOW()
          WHERE work_item_id = ${workItemId}
            AND resolved_at IS NULL
        `;
      } else if (action === 'mark_blocked') {
        nextStatus = 'blocked';
        await tx`
          UPDATE rcm_work_items
          SET
            status = 'blocked',
            requires_human_review = true,
            metadata = ${jsonb({
              ...metadata,
              lastHumanDecision: {
                action,
                reviewerRef,
                summary,
                decidedAt: nowIso,
              },
            })}::jsonb,
            updated_at = NOW()
          WHERE id = ${workItemId}
        `;
      } else if (action === 'add_missing_context') {
        nextStatus = 'routed';
        evidenceType = 'human_context_added';
        const humanProvidedContext = asObject(metadata['humanProvidedContext']);
        await tx`
          UPDATE rcm_work_items
          SET
            status = 'routed',
            requires_human_review = false,
            metadata = ${jsonb({
              ...metadata,
              humanProvidedContext: {
                ...humanProvidedContext,
                ...addedContext,
              },
              lastHumanDecision: {
                action,
                reviewerRef,
                summary,
                decidedAt: nowIso,
              },
            })}::jsonb,
            updated_at = NOW()
          WHERE id = ${workItemId}
        `;
        await tx`
          UPDATE rcm_exceptions
          SET resolved_at = NOW()
          WHERE work_item_id = ${workItemId}
            AND resolved_at IS NULL
        `;
      } else if (action === 'propose_rule_candidate') {
        nextStatus = row.status;
        await tx`
          UPDATE rcm_work_items
          SET
            metadata = ${jsonb({
              ...metadata,
              pendingRuleCandidate: {
                ...ruleCandidate,
                reviewerRef,
                summary,
                proposedAt: nowIso,
              },
            })}::jsonb,
            updated_at = NOW()
          WHERE id = ${workItemId}
        `;
      } else if (action === 'classify_new_exception_type') {
        nextStatus = row.status;
        const unresolved = await getLatestOpenExceptionForUpdate(tx, workItemId);
        if (!unresolved) throw new Error('NO_OPEN_EXCEPTION');
        await tx`
          UPDATE rcm_exceptions
          SET
            exception_type = ${exceptionType},
            reason_code = ${summary ?? 'human_reclassified'},
            payload = COALESCE(payload, '{}'::jsonb) || ${jsonb({
              reclassifiedBy: reviewerRef,
              reclassifiedAt: nowIso,
            })}::jsonb
          WHERE id = ${unresolved.id}
        `;
      }

      await insertEvidence(
        tx,
        workItemId,
        [
          {
            actorType: 'human_reviewer',
            actorRef: reviewerRef,
            evidenceType,
            payload: {
              action,
              summary,
              addedContext: Object.keys(addedContext).length > 0 ? addedContext : null,
              ruleCandidate: Object.keys(ruleCandidate).length > 0 ? ruleCandidate : null,
              exceptionType,
              decidedAt: nowIso,
            },
          },
        ],
        'human_reviewer',
        reviewerRef,
      );

      const updated = await getOwnedClaimStatusWorkItem(tx, merchant.id, workItemId);
      if (!updated) throw new Error('WORK_ITEM_NOT_FOUND');
      return {
        nextState: nextStatus,
        workItem: mapWorkItem(updated),
      };
    });

    return c.json({
      stage: 'live',
      nextState: result.nextState,
      workItem: result.workItem,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === 'WORK_ITEM_NOT_FOUND') return c.json({ error: 'Work item not found' }, 404);
    if (message === 'TERMINAL_STATE') {
      return c.json({ error: 'Terminal claim-status work items cannot be resolved again' }, 409);
    }
    if (message === 'INVALID_STATE') {
      return c.json({ error: 'Human resolution is only allowed while the case is in the exception inbox' }, 409);
    }
    if (message === 'NO_OPEN_EXCEPTION') {
      return c.json({ error: 'No open exception exists for this work item' }, 409);
    }
    console.error('[rcm] claim-status resolve error:', message);
    return c.json({ error: 'Failed to resolve claim-status work item' }, 500);
  } finally {
    sql.end().catch(() => {});
  }
});

// ─── Eligibility lane — mutation routes ──────────────────────────────────────

router.post('/lanes/eligibility/intake', authenticateApiKey, async (c) => {
  const merchant = c.get('merchant');
  let body: Record<string, unknown>;

  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const metadata = asObject(body['metadata']);
  const details: string[] = [];

  const workspaceId = typeof body['workspaceId'] === 'string' ? body['workspaceId'] : '';
  const title = typeof body['title'] === 'string' ? body['title'].trim() : '';
  const workType = typeof body['workType'] === 'string' ? body['workType'] : '';
  const billingDomain = typeof body['billingDomain'] === 'string' ? body['billingDomain'] : '';
  const formType = typeof body['formType'] === 'string' ? body['formType'] : '';
  const payerName = typeof body['payerName'] === 'string' ? body['payerName'].trim() : '';
  const coverageType = typeof body['coverageType'] === 'string' ? body['coverageType'].trim() : '';
  const patientRef = typeof body['patientRef'] === 'string' ? body['patientRef'].trim() : '';
  const providerRef = typeof body['providerRef'] === 'string' ? body['providerRef'].trim() : '';
  const encounterRef = typeof body['encounterRef'] === 'string' ? body['encounterRef'].trim() : null;
  const sourceSystem = typeof body['sourceSystem'] === 'string' ? body['sourceSystem'].trim() : '';
  const priority = normalizePriority(body['priority']);
  const dueAt = parseDateString(body['dueAt']);
  const amountAtRisk = parsePositiveAmount(body['amountAtRisk']); // optional for eligibility

  // Eligibility-specific metadata fields
  const memberId = typeof metadata['memberId'] === 'string' ? metadata['memberId'].trim() : '';
  const providerNpi = typeof metadata['providerNpi'] === 'string' ? metadata['providerNpi'].trim() : '';
  const dateOfService = parseDateString(metadata['dateOfService']);
  const serviceTypeCodes = Array.isArray(metadata['serviceTypeCodes'])
    ? metadata['serviceTypeCodes'].filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
    : [];

  if (!workspaceId || !isUuid(workspaceId)) details.push('"workspaceId" must be a valid UUID');
  if (!title) details.push('"title" is required');
  if (workType !== eligibilityLaneContract.laneKey) {
    details.push(`"workType" must be "${eligibilityLaneContract.laneKey}"`);
  }
  if (!eligibilityLaneContract.supportedDomains.includes(billingDomain)) {
    details.push(`"billingDomain" must be one of: ${eligibilityLaneContract.supportedDomains.join(', ')}`);
  }
  if (!eligibilityLaneContract.supportedForms.includes(formType)) {
    details.push(`"formType" must be one of: ${eligibilityLaneContract.supportedForms.join(', ')}`);
  }
  if (!payerName) details.push('"payerName" is required');
  if (!coverageType) details.push('"coverageType" is required');
  if (!patientRef) details.push('"patientRef" is required');
  if (!providerRef) details.push('"providerRef" is required');
  if (!sourceSystem) details.push('"sourceSystem" is required');
  if (!dueAt) details.push('"dueAt" must be a valid ISO date');
  if (!memberId) details.push('"metadata.memberId" is required');
  if (!providerNpi) details.push('"metadata.providerNpi" is required');
  if (!dateOfService) details.push('"metadata.dateOfService" must be a valid ISO date');
  if (serviceTypeCodes.length === 0) {
    details.push('"metadata.serviceTypeCodes" must contain at least one X12 service type code');
  }

  if (details.length > 0) return validationResponse(c, details);

  const workItemId = crypto.randomUUID();
  const sql = createDb(c.env);

  try {
    const result = await sql.begin(async (tx: any) => {
      const workspace = await getOwnedWorkspace(tx, merchant.id, workspaceId);
      if (!workspace) throw new Error('WORKSPACE_NOT_FOUND');

      const workItemMetadata = {
        ...metadata,
        laneKey: eligibilityLaneContract.laneKey,
        contractVersion: eligibilityLaneContract.version,
        playbookVersion:
          typeof metadata['playbookVersion'] === 'string'
            ? metadata['playbookVersion']
            : 'eligibility_v1',
        autoExecuteAllowed: metadata['autoExecuteAllowed'] !== false,
        // Eligibility-specific fields stored in metadata for connector access
        memberId,
        providerNpi,
        dateOfService,
        serviceTypeCodes,
        payerId: typeof metadata['payerId'] === 'string' ? metadata['payerId'] : null,
        connectorPlan: {
          primary: 'x12_270_271',
          fallback: ['portal'],
        },
        routing: {
          laneSelection: eligibilityLaneContract.laneKey,
          priorityBand: priority,
          routingReason: 'structured_eligibility_lane',
        },
        attemptHistory: [],
      };

      await tx`
        INSERT INTO rcm_work_items (
          id,
          workspace_id,
          merchant_id,
          work_type,
          billing_domain,
          form_type,
          title,
          payer_name,
          coverage_type,
          patient_ref,
          provider_ref,
          encounter_ref,
          claim_ref,
          source_system,
          amount_at_risk,
          priority,
          status,
          requires_human_review,
          due_at,
          metadata,
          created_at,
          updated_at
        )
        VALUES (
          ${workItemId},
          ${workspaceId},
          ${merchant.id},
          ${eligibilityLaneContract.laneKey},
          ${billingDomain},
          ${formType},
          ${title},
          ${payerName},
          ${coverageType},
          ${patientRef},
          ${providerRef},
          ${encounterRef},
          ${memberId},
          ${sourceSystem},
          ${amountAtRisk},
          ${priority},
          'routed',
          false,
          ${dueAt},
          ${jsonb(workItemMetadata)}::jsonb,
          NOW(),
          NOW()
        )
      `;

      await insertEvidence(
        tx,
        workItemId,
        [
          {
            actorType: 'router_agent',
            actorRef: 'eligibility_router',
            evidenceType: 'router_decision_recorded',
            payload: {
              laneSelection: eligibilityLaneContract.laneKey,
              routingReason: 'structured_eligibility_lane',
              autoExecuteAllowed: workItemMetadata.autoExecuteAllowed,
              connectorPlan: workItemMetadata.connectorPlan,
              memberId,
              providerNpi,
              dateOfService,
              serviceTypeCodeCount: serviceTypeCodes.length,
            },
          },
        ],
        'router_agent',
        'eligibility_router',
      );

      const row = await getOwnedEligibilityWorkItem(tx, merchant.id, workItemId);
      if (!row) throw new Error('WORK_ITEM_NOT_FOUND');
      return {
        workspaceName: workspace.name,
        workItem: mapEligibilityWorkItem(row),
      };
    });

    return c.json(
      {
        stage: 'live',
        lane: eligibilityLaneContract.laneKey,
        nextState: 'routed',
        nextAction: 'execute_primary',
        workspaceName: result.workspaceName,
        workItem: result.workItem,
      },
      201,
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === 'WORKSPACE_NOT_FOUND') {
      return c.json({ error: 'Workspace not found' }, 404);
    }
    console.error('[rcm] eligibility intake error:', message);
    return c.json({ error: 'Failed to create eligibility work item' }, 500);
  } finally {
    sql.end().catch(() => {});
  }
});

router.post('/lanes/eligibility/work-items/:workItemId/run-primary', authenticateApiKey, async (c) => {
  const merchant = c.get('merchant');
  const workItemId = c.req.param('workItemId') ?? '';
  if (!isUuid(workItemId)) {
    return validationResponse(c, ['"workItemId" must be a valid UUID']);
  }

  let body: Record<string, unknown> = {};
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }

  const connectorKey = (
    typeof body['connectorKey'] === 'string' ? body['connectorKey'] : 'x12_270_271'
  ) as EligibilityConnectorKey;
  const playbookVersion =
    typeof body['playbookVersion'] === 'string' && body['playbookVersion'].trim()
      ? body['playbookVersion'].trim()
      : 'eligibility_v1';
  const strategy =
    typeof body['strategy'] === 'string' && body['strategy'].trim()
      ? body['strategy'].trim()
      : connectorKey;
  const autoRoute = body['autoRoute'] !== false;
  const agentId = typeof body['agentId'] === 'string' ? body['agentId'] : null;
  const qaActorRef =
    typeof body['qaActorRef'] === 'string' && body['qaActorRef'].trim()
      ? body['qaActorRef'].trim()
      : 'eligibility_policy_loop';

  const details: string[] = [];
  if (connectorKey !== 'x12_270_271') {
    details.push('"connectorKey" must be "x12_270_271" for primary execution');
  }
  if (agentId && !isUuid(agentId)) details.push('"agentId" must be a valid UUID');
  if (details.length > 0) return validationResponse(c, details);

  const sql = createDb(c.env);
  try {
    const row = await getOwnedEligibilityWorkItem(sql, merchant.id, workItemId);
    if (!row) return c.json({ error: 'Work item not found' }, 404);
    if (row.status !== 'routed') {
      return c.json({ error: 'Eligibility work item must be in "routed" before autonomous run' }, 409);
    }

    const connectorResult = await runEligibilityConnector(
      c.env,
      connectorKey,
      eligibilityConnectorInputFromWorkItem(row),
    );

    const persisted = await sql.begin(async (tx: any) =>
      persistEligibilityConnectorRun(tx, merchant.id, workItemId, {
        attemptRole: 'primary_worker',
        agentId,
        qaActorRef,
        playbookVersion,
        strategy,
        connectorResult,
        autoRoute,
      }),
    );

    return c.json({
      stage: 'live',
      autoRoute,
      nextState: persisted.nextState,
      connector: {
        key: connectorResult.connectorKey,
        mode: connectorResult.mode,
        statusCode: connectorResult.statusCode,
        statusLabel: connectorResult.statusLabel,
        traceId: connectorResult.connectorTraceId,
        summary: connectorResult.summary,
      },
      workItem: persisted.workItem,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === 'WORK_ITEM_NOT_FOUND') return c.json({ error: 'Work item not found' }, 404);
    if (message === 'INVALID_STATE') {
      return c.json({ error: 'Eligibility work item must be in "routed" before autonomous run' }, 409);
    }
    if (message === 'ATTEMPTS_EXHAUSTED') {
      return c.json({ error: 'Autonomous attempt limit reached for this work item' }, 409);
    }
    console.error('[rcm] eligibility run-primary error:', message);
    return c.json({ error: 'Failed to run primary eligibility connector' }, 500);
  } finally {
    sql.end().catch(() => {});
  }
});

router.post('/lanes/eligibility/work-items/:workItemId/run-fallback', authenticateApiKey, async (c) => {
  const merchant = c.get('merchant');
  const workItemId = c.req.param('workItemId') ?? '';
  if (!isUuid(workItemId)) {
    return validationResponse(c, ['"workItemId" must be a valid UUID']);
  }

  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const connectorKey = (
    typeof body['connectorKey'] === 'string' ? body['connectorKey'] : 'portal'
  ) as EligibilityConnectorKey;
  const playbookVersion =
    typeof body['playbookVersion'] === 'string' && body['playbookVersion'].trim()
      ? body['playbookVersion'].trim()
      : 'eligibility_v1';
  const strategy =
    typeof body['alternativeStrategy'] === 'string' && body['alternativeStrategy'].trim()
      ? body['alternativeStrategy'].trim()
      : '';
  const autoRoute = body['autoRoute'] !== false;
  const agentId = typeof body['agentId'] === 'string' ? body['agentId'] : null;
  const qaActorRef =
    typeof body['qaActorRef'] === 'string' && body['qaActorRef'].trim()
      ? body['qaActorRef'].trim()
      : 'eligibility_policy_loop';

  const details: string[] = [];
  if (!['x12_270_271', 'portal'].includes(connectorKey)) {
    details.push('"connectorKey" must be one of: x12_270_271, portal');
  }
  if (!strategy) details.push('"alternativeStrategy" is required');
  if (agentId && !isUuid(agentId)) details.push('"agentId" must be a valid UUID');
  if (details.length > 0) return validationResponse(c, details);

  const sql = createDb(c.env);
  try {
    const row = await getOwnedEligibilityWorkItem(sql, merchant.id, workItemId);
    if (!row) return c.json({ error: 'Work item not found' }, 404);
    if (row.status !== 'retry_pending') {
      return c.json({ error: 'Eligibility work item must be in "retry_pending" before fallback run' }, 409);
    }

    const connectorResult = await runEligibilityConnector(
      c.env,
      connectorKey,
      eligibilityConnectorInputFromWorkItem(row),
    );

    const persisted = await sql.begin(async (tx: any) =>
      persistEligibilityConnectorRun(tx, merchant.id, workItemId, {
        attemptRole: 'fallback_worker',
        agentId,
        qaActorRef,
        playbookVersion,
        strategy,
        connectorResult,
        autoRoute,
      }),
    );

    return c.json({
      stage: 'live',
      autoRoute,
      nextState: persisted.nextState,
      connector: {
        key: connectorResult.connectorKey,
        mode: connectorResult.mode,
        statusCode: connectorResult.statusCode,
        statusLabel: connectorResult.statusLabel,
        traceId: connectorResult.connectorTraceId,
        summary: connectorResult.summary,
      },
      workItem: persisted.workItem,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === 'WORK_ITEM_NOT_FOUND') return c.json({ error: 'Work item not found' }, 404);
    if (message === 'INVALID_STATE') {
      return c.json({ error: 'Eligibility work item must be in "retry_pending" before fallback run' }, 409);
    }
    if (message === 'NO_PRIOR_ATTEMPT') {
      return c.json({ error: 'Fallback connector run requires a prior primary attempt' }, 409);
    }
    if (message === 'ATTEMPTS_EXHAUSTED') {
      return c.json({ error: 'Autonomous attempt limit reached for this work item' }, 409);
    }
    if (message === 'SAME_STRATEGY') {
      return c.json({ error: 'Fallback connector run must use a different strategy or connector' }, 409);
    }
    console.error('[rcm] eligibility run-fallback error:', message);
    return c.json({ error: 'Failed to run fallback eligibility connector' }, 500);
  } finally {
    sql.end().catch(() => {});
  }
});

router.post('/lanes/eligibility/work-items/:workItemId/execute', authenticateApiKey, async (c) => {
  const merchant = c.get('merchant');
  const workItemId = c.req.param('workItemId') ?? '';
  if (!isUuid(workItemId)) {
    return validationResponse(c, ['"workItemId" must be a valid UUID']);
  }

  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const details: string[] = [];
  const attemptRole = body['attemptRole'];
  const playbookVersion = typeof body['playbookVersion'] === 'string' ? body['playbookVersion'].trim() : '';
  const connectorStrategy = typeof body['connectorStrategy'] === 'string' ? body['connectorStrategy'].trim() : '';
  const proposedResolution = typeof body['proposedResolution'] === 'string' ? body['proposedResolution'].trim() : '';
  const resolutionReasonCode =
    typeof body['resolutionReasonCode'] === 'string' ? body['resolutionReasonCode'].trim() : '';
  const confidencePct = parseConfidence(body['confidencePct']);
  const evidenceInput = Array.isArray(body['evidence']) ? body['evidence'] : [];
  const agentId = typeof body['agentId'] === 'string' ? body['agentId'] : null;
  const nextBestAction = typeof body['nextBestAction'] === 'string' ? body['nextBestAction'].trim() : null;

  if (attemptRole !== 'primary_worker') details.push('"attemptRole" must be "primary_worker"');
  if (!playbookVersion) details.push('"playbookVersion" is required');
  if (!connectorStrategy) details.push('"connectorStrategy" is required');
  if (!proposedResolution) details.push('"proposedResolution" is required');
  if (!resolutionReasonCode) details.push('"resolutionReasonCode" is required');
  if (confidencePct === null) details.push('"confidencePct" must be a number between 0 and 100');
  if (agentId && !isUuid(agentId)) details.push('"agentId" must be a valid UUID');
  if (evidenceInput.length === 0) details.push('"evidence" must contain at least one evidence record');

  const evidence = evidenceInput
    .map((entry) => {
      const item = asObject(entry);
      return {
        actorType: typeof item['actorType'] === 'string' ? item['actorType'] : 'worker_agent',
        actorRef:
          typeof item['actorRef'] === 'string'
            ? item['actorRef']
            : agentId ?? 'eligibility_primary_worker',
        evidenceType: typeof item['evidenceType'] === 'string' ? item['evidenceType'] : '',
        payload: item['payload'],
      } satisfies EvidenceInput;
    })
    .filter((item) => item.evidenceType.length > 0);

  if (evidence.length !== evidenceInput.length) {
    details.push('Each evidence item must include "evidenceType"');
  }
  if (details.length > 0) return validationResponse(c, details);

  const sql = createDb(c.env);
  try {
    const result = await sql.begin(async (tx: any) => {
      const row = await getOwnedEligibilityWorkItemForUpdate(tx, merchant.id, workItemId);
      if (!row) throw new Error('WORK_ITEM_NOT_FOUND');
      if (row.status !== 'routed') throw new Error('INVALID_STATE');

      const metadata = parseJsonb<JsonRecord>(row.metadata, {});
      const attempts = getAttemptHistory(metadata);
      if (attempts.length >= eligibilityLaneContract.retryPolicy.maxAutonomousAttempts) {
        throw new Error('ATTEMPTS_EXHAUSTED');
      }

      const nextAttempt = {
        attemptNumber: attempts.length + 1,
        attemptRole,
        strategy: connectorStrategy,
        playbookVersion,
        proposedResolution,
        resolutionReasonCode,
        confidencePct,
        nextBestAction,
        submittedAt: new Date().toISOString(),
        evidenceTypes: evidence.map((item) => item.evidenceType),
      };

      const updatedMetadata = {
        ...metadata,
        playbookVersion,
        lastExecution: nextAttempt,
        attemptHistory: [...attempts, nextAttempt],
      };

      await tx`
        UPDATE rcm_work_items
        SET
          assigned_agent_id = ${agentId},
          confidence_pct = ${confidencePct},
          status = 'awaiting_qa',
          submitted_at = NOW(),
          metadata = ${jsonb(updatedMetadata)}::jsonb,
          updated_at = NOW()
        WHERE id = ${workItemId}
      `;

      await insertEvidence(
        tx,
        workItemId,
        [
          ...evidence,
          {
            actorType: 'worker_agent',
            actorRef: agentId ?? 'eligibility_primary_worker',
            evidenceType: 'execution_resolution_proposed',
            payload: nextAttempt,
          },
        ],
        'worker_agent',
        agentId ?? 'eligibility_primary_worker',
      );

      const updated = await getOwnedEligibilityWorkItem(tx, merchant.id, workItemId);
      if (!updated) throw new Error('WORK_ITEM_NOT_FOUND');
      return mapEligibilityWorkItem(updated);
    });

    return c.json({
      stage: 'live',
      nextState: 'awaiting_qa',
      nextAction: 'qa_verify',
      workItem: result,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === 'WORK_ITEM_NOT_FOUND') return c.json({ error: 'Work item not found' }, 404);
    if (message === 'INVALID_STATE') {
      return c.json({ error: 'Eligibility work item must be in "routed" before execute' }, 409);
    }
    if (message === 'ATTEMPTS_EXHAUSTED') {
      return c.json({ error: 'Autonomous attempt limit reached for this lane' }, 409);
    }
    console.error('[rcm] eligibility execute error:', message);
    return c.json({ error: 'Failed to execute eligibility work item' }, 500);
  } finally {
    sql.end().catch(() => {});
  }
});

router.post('/lanes/eligibility/work-items/:workItemId/verify', authenticateApiKey, async (c) => {
  const merchant = c.get('merchant');
  const workItemId = c.req.param('workItemId') ?? '';
  if (!isUuid(workItemId)) {
    return validationResponse(c, ['"workItemId" must be a valid UUID']);
  }

  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const details: string[] = [];
  const qaDecision = typeof body['qaDecision'] === 'string' ? body['qaDecision'] : '';
  const qaReasonCode = typeof body['qaReasonCode'] === 'string' ? body['qaReasonCode'].trim() : '';
  const agentId = typeof body['agentId'] === 'string' ? body['agentId'] : null;
  const exceptionType = typeof body['exceptionType'] === 'string' ? body['exceptionType'] : '';
  const summary = typeof body['summary'] === 'string' ? body['summary'].trim() : '';
  const recommendedHumanAction =
    typeof body['recommendedHumanAction'] === 'string' ? body['recommendedHumanAction'].trim() : '';
  const severity =
    typeof body['severity'] === 'string' && ['critical', 'high', 'normal', 'low'].includes(body['severity'])
      ? (body['severity'] as string)
      : 'normal';
  const requiredContextFields = Array.isArray(body['requiredContextFields'])
    ? body['requiredContextFields'].filter(
        (entry): entry is string => typeof entry === 'string' && entry.trim().length > 0,
      )
    : [];
  const notes = typeof body['notes'] === 'string' ? body['notes'].trim() : null;

  if (!['approve_auto_close', 'retry_with_next_worker', 'escalate'].includes(qaDecision)) {
    details.push('"qaDecision" must be one of: approve_auto_close, retry_with_next_worker, escalate');
  }
  if (!qaReasonCode) details.push('"qaReasonCode" is required');
  if (agentId && !isUuid(agentId)) details.push('"agentId" must be a valid UUID');
  if (qaDecision === 'escalate') {
    if (!eligibilityLaneContract.exceptionInbox.triageBuckets.includes(exceptionType)) {
      details.push(
        `"exceptionType" must be one of: ${eligibilityLaneContract.exceptionInbox.triageBuckets.join(', ')}`,
      );
    }
    if (!summary) details.push('"summary" is required when escalating');
    if (!recommendedHumanAction) details.push('"recommendedHumanAction" is required when escalating');
  }
  if (details.length > 0) return validationResponse(c, details);

  const sql = createDb(c.env);
  try {
    const result = await sql.begin(async (tx: any) => {
      const row = await getOwnedEligibilityWorkItemForUpdate(tx, merchant.id, workItemId);
      if (!row) throw new Error('WORK_ITEM_NOT_FOUND');
      if (row.status !== 'awaiting_qa') throw new Error('INVALID_STATE');

      const metadata = parseJsonb<JsonRecord>(row.metadata, {});
      const attempts = getAttemptHistory(metadata);
      if (
        qaDecision === 'retry_with_next_worker' &&
        attempts.length >= eligibilityLaneContract.retryPolicy.maxAutonomousAttempts
      ) {
        throw new Error('ATTEMPTS_EXHAUSTED');
      }

      const qaPayload = {
        qaDecision,
        qaReasonCode,
        reviewedAt: new Date().toISOString(),
        reviewerAgentId: agentId,
      };

      const nextMetadata = { ...metadata, lastQaDecision: qaPayload };
      let nextState = 'awaiting_qa';

      if (qaDecision === 'approve_auto_close') {
        nextState = 'closed_auto';
        await tx`
          UPDATE rcm_work_items
          SET
            status = 'closed_auto',
            requires_human_review = false,
            completed_at = NOW(),
            metadata = ${jsonb(nextMetadata)}::jsonb,
            updated_at = NOW()
          WHERE id = ${workItemId}
        `;
        await resolveOpenExceptions(tx, workItemId);
      } else if (qaDecision === 'retry_with_next_worker') {
        nextState = 'retry_pending';
        await tx`
          UPDATE rcm_work_items
          SET
            status = 'retry_pending',
            metadata = ${jsonb(nextMetadata)}::jsonb,
            updated_at = NOW()
          WHERE id = ${workItemId}
        `;
      } else {
        nextState = 'human_review_required';
        const payload = {
          requiredContextFields,
          recommendedHumanAction,
          notes,
          qaReasonCode,
          lastAttempt: attempts[attempts.length - 1] ?? null,
        };
        await upsertOpenException(tx, workItemId, {
          exceptionType,
          severity,
          reasonCode: qaReasonCode,
          summary,
          payload,
        });
        await tx`
          UPDATE rcm_work_items
          SET
            status = 'human_review_required',
            requires_human_review = true,
            metadata = ${jsonb(nextMetadata)}::jsonb,
            updated_at = NOW()
          WHERE id = ${workItemId}
        `;
      }

      await insertEvidence(
        tx,
        workItemId,
        [
          {
            actorType: 'qa_agent',
            actorRef: agentId ?? 'eligibility_qa',
            evidenceType: 'qa_decision_recorded',
            payload: {
              ...qaPayload,
              exceptionType: qaDecision === 'escalate' ? exceptionType : null,
            },
          },
        ],
        'qa_agent',
        agentId ?? 'eligibility_qa',
      );

      const updated = await getOwnedEligibilityWorkItem(tx, merchant.id, workItemId);
      if (!updated) throw new Error('WORK_ITEM_NOT_FOUND');
      return { nextState, workItem: mapEligibilityWorkItem(updated) };
    });

    return c.json({ stage: 'live', nextState: result.nextState, workItem: result.workItem });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === 'WORK_ITEM_NOT_FOUND') return c.json({ error: 'Work item not found' }, 404);
    if (message === 'INVALID_STATE') {
      return c.json({ error: 'Eligibility work item must be in "awaiting_qa" before verify' }, 409);
    }
    if (message === 'ATTEMPTS_EXHAUSTED') {
      return c.json({ error: 'Fallback retry is no longer allowed for this work item' }, 409);
    }
    console.error('[rcm] eligibility verify error:', message);
    return c.json({ error: 'Failed to verify eligibility work item' }, 500);
  } finally {
    sql.end().catch(() => {});
  }
});

router.post('/lanes/eligibility/work-items/:workItemId/retry', authenticateApiKey, async (c) => {
  const merchant = c.get('merchant');
  const workItemId = c.req.param('workItemId') ?? '';
  if (!isUuid(workItemId)) {
    return validationResponse(c, ['"workItemId" must be a valid UUID']);
  }

  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const details: string[] = [];
  const playbookVersion = typeof body['playbookVersion'] === 'string' ? body['playbookVersion'].trim() : '';
  const connectorStrategy = typeof body['connectorStrategy'] === 'string' ? body['connectorStrategy'].trim() : '';
  const alternativeStrategy = typeof body['alternativeStrategy'] === 'string' ? body['alternativeStrategy'].trim() : '';
  const fallbackResolution = typeof body['fallbackResolution'] === 'string' ? body['fallbackResolution'].trim() : '';
  const fallbackReasonCode = typeof body['fallbackReasonCode'] === 'string' ? body['fallbackReasonCode'].trim() : '';
  const confidencePct = parseConfidence(body['confidencePct']);
  const evidenceInput = Array.isArray(body['evidence']) ? body['evidence'] : [];
  const agentId = typeof body['agentId'] === 'string' ? body['agentId'] : null;

  if (!playbookVersion) details.push('"playbookVersion" is required');
  if (!connectorStrategy) details.push('"connectorStrategy" is required');
  if (!alternativeStrategy) details.push('"alternativeStrategy" is required');
  if (!fallbackResolution) details.push('"fallbackResolution" is required');
  if (!fallbackReasonCode) details.push('"fallbackReasonCode" is required');
  if (confidencePct === null) details.push('"confidencePct" must be a number between 0 and 100');
  if (agentId && !isUuid(agentId)) details.push('"agentId" must be a valid UUID');
  if (evidenceInput.length === 0) details.push('"evidence" must contain at least one evidence record');

  const evidence = evidenceInput
    .map((entry) => {
      const item = asObject(entry);
      return {
        actorType: typeof item['actorType'] === 'string' ? item['actorType'] : 'fallback_worker_agent',
        actorRef:
          typeof item['actorRef'] === 'string'
            ? item['actorRef']
            : agentId ?? 'eligibility_fallback_worker',
        evidenceType: typeof item['evidenceType'] === 'string' ? item['evidenceType'] : '',
        payload: item['payload'],
      } satisfies EvidenceInput;
    })
    .filter((item) => item.evidenceType.length > 0);

  if (evidence.length !== evidenceInput.length) {
    details.push('Each evidence item must include "evidenceType"');
  }
  if (details.length > 0) return validationResponse(c, details);

  const sql = createDb(c.env);
  try {
    const result = await sql.begin(async (tx: any) => {
      const row = await getOwnedEligibilityWorkItemForUpdate(tx, merchant.id, workItemId);
      if (!row) throw new Error('WORK_ITEM_NOT_FOUND');
      if (row.status !== 'retry_pending') throw new Error('INVALID_STATE');

      const metadata = parseJsonb<JsonRecord>(row.metadata, {});
      const attempts = getAttemptHistory(metadata);
      if (attempts.length === 0) throw new Error('NO_PRIOR_ATTEMPT');
      if (attempts.length >= eligibilityLaneContract.retryPolicy.maxAutonomousAttempts) {
        throw new Error('ATTEMPTS_EXHAUSTED');
      }

      const previousAttempt = attempts[attempts.length - 1];
      const previousStrategy =
        typeof previousAttempt['strategy'] === 'string' ? previousAttempt['strategy'] : '';
      const previousConnector =
        typeof previousAttempt['connectorStrategy'] === 'string'
          ? previousAttempt['connectorStrategy']
          : previousStrategy;

      if (eligibilityLaneContract.retryPolicy.requireDifferentStrategyOnRetry) {
        const strategyChanged = alternativeStrategy !== previousStrategy;
        const connectorChanged = connectorStrategy !== previousConnector;
        if (!strategyChanged && !connectorChanged) throw new Error('SAME_STRATEGY');
      }

      const nextAttempt = {
        attemptNumber: attempts.length + 1,
        attemptRole: 'fallback_worker',
        strategy: alternativeStrategy,
        connectorStrategy,
        playbookVersion,
        fallbackResolution,
        fallbackReasonCode,
        confidencePct,
        submittedAt: new Date().toISOString(),
        evidenceTypes: evidence.map((item) => item.evidenceType),
      };

      const nextMetadata = {
        ...metadata,
        playbookVersion,
        lastExecution: nextAttempt,
        attemptHistory: [...attempts, nextAttempt],
      };

      await tx`
        UPDATE rcm_work_items
        SET
          assigned_agent_id = ${agentId},
          confidence_pct = ${confidencePct},
          status = 'awaiting_qa',
          submitted_at = NOW(),
          metadata = ${jsonb(nextMetadata)}::jsonb,
          updated_at = NOW()
        WHERE id = ${workItemId}
      `;

      await insertEvidence(
        tx,
        workItemId,
        [
          ...evidence,
          {
            actorType: 'fallback_worker_agent',
            actorRef: agentId ?? 'eligibility_fallback_worker',
            evidenceType: 'fallback_execution_submitted',
            payload: nextAttempt,
          },
        ],
        'fallback_worker_agent',
        agentId ?? 'eligibility_fallback_worker',
      );

      const updated = await getOwnedEligibilityWorkItem(tx, merchant.id, workItemId);
      if (!updated) throw new Error('WORK_ITEM_NOT_FOUND');
      return mapEligibilityWorkItem(updated);
    });

    return c.json({ stage: 'live', nextState: 'awaiting_qa', nextAction: 'qa_verify', workItem: result });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === 'WORK_ITEM_NOT_FOUND') return c.json({ error: 'Work item not found' }, 404);
    if (message === 'INVALID_STATE') {
      return c.json({ error: 'Eligibility work item must be in "retry_pending" before retry' }, 409);
    }
    if (message === 'NO_PRIOR_ATTEMPT') {
      return c.json({ error: 'Fallback retry requires a prior autonomous attempt' }, 409);
    }
    if (message === 'ATTEMPTS_EXHAUSTED') {
      return c.json({ error: 'Autonomous attempt limit reached for this work item' }, 409);
    }
    if (message === 'SAME_STRATEGY') {
      return c.json({ error: 'Fallback retry must use a different strategy or connector path' }, 409);
    }
    console.error('[rcm] eligibility retry error:', message);
    return c.json({ error: 'Failed to submit eligibility fallback retry' }, 500);
  } finally {
    sql.end().catch(() => {});
  }
});

router.post('/lanes/eligibility/work-items/:workItemId/escalate', authenticateApiKey, async (c) => {
  const merchant = c.get('merchant');
  const workItemId = c.req.param('workItemId') ?? '';
  if (!isUuid(workItemId)) {
    return validationResponse(c, ['"workItemId" must be a valid UUID']);
  }

  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const details: string[] = [];
  const exceptionType = typeof body['exceptionType'] === 'string' ? body['exceptionType'] : '';
  const summary = typeof body['summary'] === 'string' ? body['summary'].trim() : '';
  const reasonCode = typeof body['reasonCode'] === 'string' ? body['reasonCode'].trim() : '';
  const recommendedHumanAction =
    typeof body['recommendedHumanAction'] === 'string' ? body['recommendedHumanAction'].trim() : '';
  const assignedReviewer =
    typeof body['assignedReviewer'] === 'string' ? body['assignedReviewer'].trim() : null;
  const notes = typeof body['notes'] === 'string' ? body['notes'].trim() : null;
  const agentId = typeof body['agentId'] === 'string' ? body['agentId'] : null;
  const severity =
    typeof body['severity'] === 'string' && ['critical', 'high', 'normal', 'low'].includes(body['severity'])
      ? (body['severity'] as string)
      : 'normal';
  const requiredContextFields = Array.isArray(body['requiredContextFields'])
    ? body['requiredContextFields'].filter(
        (entry): entry is string => typeof entry === 'string' && entry.trim().length > 0,
      )
    : [];
  const slaAt =
    parseDateString(body['slaAt']) ?? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  if (!eligibilityLaneContract.exceptionInbox.triageBuckets.includes(exceptionType)) {
    details.push(
      `"exceptionType" must be one of: ${eligibilityLaneContract.exceptionInbox.triageBuckets.join(', ')}`,
    );
  }
  if (!summary) details.push('"summary" is required');
  if (!reasonCode) details.push('"reasonCode" is required');
  if (!recommendedHumanAction) details.push('"recommendedHumanAction" is required');
  if (agentId && !isUuid(agentId)) details.push('"agentId" must be a valid UUID');
  if (details.length > 0) return validationResponse(c, details);

  const sql = createDb(c.env);
  try {
    const result = await sql.begin(async (tx: any) => {
      const row = await getOwnedEligibilityWorkItemForUpdate(tx, merchant.id, workItemId);
      if (!row) throw new Error('WORK_ITEM_NOT_FOUND');
      if (eligibilityLaneContract.stateMachine.terminalStates.includes(row.status)) {
        throw new Error('TERMINAL_STATE');
      }

      const payload = { requiredContextFields, recommendedHumanAction, assignedReviewer, slaAt, notes };
      await upsertOpenException(tx, workItemId, {
        exceptionType,
        severity,
        reasonCode,
        summary,
        payload,
      });

      const metadata = parseJsonb<JsonRecord>(row.metadata, {});
      await tx`
        UPDATE rcm_work_items
        SET
          status = 'human_review_required',
          requires_human_review = true,
          metadata = ${jsonb({
            ...metadata,
            lastEscalation: {
              exceptionType,
              reasonCode,
              recommendedHumanAction,
              assignedReviewer,
              escalatedAt: new Date().toISOString(),
            },
          })}::jsonb,
          updated_at = NOW()
        WHERE id = ${workItemId}
      `;

      await insertEvidence(
        tx,
        workItemId,
        [
          {
            actorType: 'escalation_agent',
            actorRef: agentId ?? 'eligibility_escalation',
            evidenceType: 'escalation_packet_created',
            payload: { exceptionType, reasonCode, summary, ...payload },
          },
        ],
        'escalation_agent',
        agentId ?? 'eligibility_escalation',
      );

      const updated = await getOwnedEligibilityWorkItem(tx, merchant.id, workItemId);
      if (!updated) throw new Error('WORK_ITEM_NOT_FOUND');
      return mapEligibilityWorkItem(updated);
    });

    return c.json({ stage: 'live', nextState: 'human_review_required', workItem: result });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === 'WORK_ITEM_NOT_FOUND') return c.json({ error: 'Work item not found' }, 404);
    if (message === 'TERMINAL_STATE') {
      return c.json({ error: 'Terminal eligibility work items cannot be escalated again' }, 409);
    }
    console.error('[rcm] eligibility escalate error:', message);
    return c.json({ error: 'Failed to escalate eligibility work item' }, 500);
  } finally {
    sql.end().catch(() => {});
  }
});

router.post('/lanes/eligibility/work-items/:workItemId/resolve', authenticateApiKey, async (c) => {
  const merchant = c.get('merchant');
  const workItemId = c.req.param('workItemId') ?? '';
  if (!isUuid(workItemId)) {
    return validationResponse(c, ['"workItemId" must be a valid UUID']);
  }

  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const details: string[] = [];
  const action = typeof body['action'] === 'string' ? body['action'] : '';
  const reviewerRef = typeof body['reviewerRef'] === 'string' ? body['reviewerRef'].trim() : 'human_reviewer';
  const summary = typeof body['summary'] === 'string' ? body['summary'].trim() : null;
  const addedContext = asObject(body['addedContext']);
  const ruleCandidate = asObject(body['ruleCandidate']);
  const exceptionType = typeof body['exceptionType'] === 'string' ? body['exceptionType'] : null;

  if (!eligibilityLaneContract.exceptionInbox.allowedHumanActions.includes(action)) {
    details.push(
      `"action" must be one of: ${eligibilityLaneContract.exceptionInbox.allowedHumanActions.join(', ')}`,
    );
  }
  if (action === 'add_missing_context' && Object.keys(addedContext).length === 0) {
    details.push('"addedContext" is required for add_missing_context');
  }
  if (action === 'classify_new_exception_type' && !exceptionType) {
    details.push('"exceptionType" is required for classify_new_exception_type');
  }
  if (details.length > 0) return validationResponse(c, details);

  const sql = createDb(c.env);
  try {
    const result = await sql.begin(async (tx: any) => {
      const row = await getOwnedEligibilityWorkItemForUpdate(tx, merchant.id, workItemId);
      if (!row) throw new Error('WORK_ITEM_NOT_FOUND');
      if (eligibilityLaneContract.stateMachine.terminalStates.includes(row.status)) {
        throw new Error('TERMINAL_STATE');
      }

      const exceptionManagedStates = new Set(['human_review_required', 'blocked']);
      if (!exceptionManagedStates.has(row.status)) throw new Error('INVALID_STATE');

      const metadata = parseJsonb<JsonRecord>(row.metadata, {});
      const nowIso = new Date().toISOString();
      let nextStatus = row.status;
      let evidenceType = 'human_resolution_recorded';

      if (action === 'approve_closure' || action === 'take_over_case') {
        nextStatus = 'closed_human';
        await tx`
          UPDATE rcm_work_items
          SET
            status = 'closed_human',
            requires_human_review = false,
            completed_at = NOW(),
            metadata = ${jsonb({
              ...metadata,
              lastHumanDecision: { action, reviewerRef, summary, decidedAt: nowIso },
            })}::jsonb,
            updated_at = NOW()
          WHERE id = ${workItemId}
        `;
        await tx`
          UPDATE rcm_exceptions
          SET resolved_at = NOW()
          WHERE work_item_id = ${workItemId} AND resolved_at IS NULL
        `;
      } else if (action === 'reject_closure') {
        nextStatus = 'rejected';
        await tx`
          UPDATE rcm_work_items
          SET
            status = 'rejected',
            requires_human_review = false,
            metadata = ${jsonb({
              ...metadata,
              lastHumanDecision: { action, reviewerRef, summary, decidedAt: nowIso },
            })}::jsonb,
            updated_at = NOW()
          WHERE id = ${workItemId}
        `;
        await tx`
          UPDATE rcm_exceptions
          SET resolved_at = NOW()
          WHERE work_item_id = ${workItemId} AND resolved_at IS NULL
        `;
      } else if (action === 'mark_blocked') {
        nextStatus = 'blocked';
        await tx`
          UPDATE rcm_work_items
          SET
            status = 'blocked',
            requires_human_review = true,
            metadata = ${jsonb({
              ...metadata,
              lastHumanDecision: { action, reviewerRef, summary, decidedAt: nowIso },
            })}::jsonb,
            updated_at = NOW()
          WHERE id = ${workItemId}
        `;
      } else if (action === 'add_missing_context') {
        nextStatus = 'routed';
        evidenceType = 'human_context_added';
        const humanProvidedContext = asObject(metadata['humanProvidedContext']);
        await tx`
          UPDATE rcm_work_items
          SET
            status = 'routed',
            requires_human_review = false,
            metadata = ${jsonb({
              ...metadata,
              humanProvidedContext: { ...humanProvidedContext, ...addedContext },
              lastHumanDecision: { action, reviewerRef, summary, decidedAt: nowIso },
            })}::jsonb,
            updated_at = NOW()
          WHERE id = ${workItemId}
        `;
        await tx`
          UPDATE rcm_exceptions
          SET resolved_at = NOW()
          WHERE work_item_id = ${workItemId} AND resolved_at IS NULL
        `;
      } else if (action === 'propose_rule_candidate') {
        nextStatus = row.status;
        await tx`
          UPDATE rcm_work_items
          SET
            metadata = ${jsonb({
              ...metadata,
              pendingRuleCandidate: {
                ...ruleCandidate,
                reviewerRef,
                summary,
                proposedAt: nowIso,
              },
            })}::jsonb,
            updated_at = NOW()
          WHERE id = ${workItemId}
        `;
      } else if (action === 'classify_new_exception_type') {
        nextStatus = row.status;
        const unresolved = await getLatestOpenExceptionForUpdate(tx, workItemId);
        if (!unresolved) throw new Error('NO_OPEN_EXCEPTION');
        await tx`
          UPDATE rcm_exceptions
          SET
            exception_type = ${exceptionType},
            reason_code = ${summary ?? 'human_reclassified'},
            payload = COALESCE(payload, '{}'::jsonb) || ${jsonb({
              reclassifiedBy: reviewerRef,
              reclassifiedAt: nowIso,
            })}::jsonb
          WHERE id = ${unresolved.id}
        `;
      }

      await insertEvidence(
        tx,
        workItemId,
        [
          {
            actorType: 'human_reviewer',
            actorRef: reviewerRef,
            evidenceType,
            payload: {
              action,
              summary,
              addedContext: Object.keys(addedContext).length > 0 ? addedContext : null,
              ruleCandidate: Object.keys(ruleCandidate).length > 0 ? ruleCandidate : null,
              exceptionType,
              decidedAt: nowIso,
            },
          },
        ],
        'human_reviewer',
        reviewerRef,
      );

      const updated = await getOwnedEligibilityWorkItem(tx, merchant.id, workItemId);
      if (!updated) throw new Error('WORK_ITEM_NOT_FOUND');
      return { nextState: nextStatus, workItem: mapEligibilityWorkItem(updated) };
    });

    return c.json({ stage: 'live', nextState: result.nextState, workItem: result.workItem });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === 'WORK_ITEM_NOT_FOUND') return c.json({ error: 'Work item not found' }, 404);
    if (message === 'TERMINAL_STATE') {
      return c.json({ error: 'Terminal eligibility work items cannot be resolved again' }, 409);
    }
    if (message === 'INVALID_STATE') {
      return c.json({ error: 'Human resolution is only allowed while the case is in the exception inbox' }, 409);
    }
    if (message === 'NO_OPEN_EXCEPTION') {
      return c.json({ error: 'No open exception exists for this work item' }, 409);
    }
    console.error('[rcm] eligibility resolve error:', message);
    return c.json({ error: 'Failed to resolve eligibility work item' }, 500);
  } finally {
    sql.end().catch(() => {});
  }
});

router.get('/services', authenticateApiKey, (c) =>
  c.json({
    stage: 'scaffold',
    modules: blueprint.serviceModules,
    automationLadder: blueprint.automationLadder,
    message:
      'Automate the full outsourced billing bundle over time, but start with the repeatable rails first and keep exception-heavy judgment work behind humans.',
  }),
);

router.get('/workspaces', authenticateApiKey, async (c) => {
  const merchant = c.get('merchant');
  const sql = createDb(c.env);

  try {
    const rows = await sql<
      Array<{
        id: string;
        name: string;
        legalName: string | null;
        workspaceType: string;
        specialty: string | null;
        timezone: string | null;
        status: string;
        approvalPolicy: unknown;
        config: unknown;
        createdAt: Date | string;
        updatedAt: Date | string;
        openWorkItems: number;
        humanReviewCount: number;
        amountAtRiskOpen: string | number | null;
      }>
    >`
      SELECT
        ws.id,
        ws.name,
        ws.legal_name      AS "legalName",
        ws.workspace_type  AS "workspaceType",
        ws.specialty,
        ws.timezone,
        ws.status,
        ws.approval_policy AS "approvalPolicy",
        ws.config,
        ws.created_at      AS "createdAt",
        ws.updated_at      AS "updatedAt",
        COUNT(w.id) FILTER (
          WHERE w.status NOT IN ('closed_auto', 'closed_human', 'blocked', 'rejected')
        )::int AS "openWorkItems",
        COUNT(w.id) FILTER (WHERE w.status = 'human_review_required')::int AS "humanReviewCount",
        COALESCE(
          SUM(w.amount_at_risk) FILTER (
            WHERE w.status NOT IN ('closed_auto', 'closed_human', 'blocked', 'rejected')
          ),
          0
        ) AS "amountAtRiskOpen"
      FROM rcm_workspaces ws
      LEFT JOIN rcm_work_items w ON w.workspace_id = ws.id
      WHERE ws.merchant_id = ${merchant.id}
      GROUP BY
        ws.id,
        ws.name,
        ws.legal_name,
        ws.workspace_type,
        ws.specialty,
        ws.timezone,
        ws.status,
        ws.approval_policy,
        ws.config,
        ws.created_at,
        ws.updated_at
      ORDER BY ws.created_at DESC
    `;

    return c.json({
      stage: 'live',
      count: rows.length,
      items: rows.map((row) => ({
        workspaceId: row.id,
        name: row.name,
        legalName: row.legalName,
        workspaceType: row.workspaceType,
        specialty: row.specialty,
        timezone: row.timezone,
        status: row.status,
        approvalPolicy: parseJsonb<JsonRecord>(row.approvalPolicy, {}),
        config: parseJsonb<JsonRecord>(row.config, {}),
        openWorkItems: row.openWorkItems,
        humanReviewCount: row.humanReviewCount,
        amountAtRiskOpen: row.amountAtRiskOpen === null ? 0 : Number(row.amountAtRiskOpen),
        createdAt: toIso(row.createdAt),
        updatedAt: toIso(row.updatedAt),
      })),
      defaultWorkspaceShape: {
        workspaceType: 'facility_rcm',
        specialty: 'home_health',
        payerMix: blueprint.payerMix,
      },
    });
  } catch (err: unknown) {
    console.error('[rcm] workspaces error:', err instanceof Error ? err.message : err);
    return c.json({ error: 'Failed to fetch RCM workspaces' }, 500);
  } finally {
    sql.end().catch(() => {});
  }
});

router.get('/work-items', authenticateApiKey, async (c) => {
  const merchant = c.get('merchant');
  const sql = createDb(c.env);
  const status = c.req.query('status');
  const workType = c.req.query('workType');
  const workspaceId = c.req.query('workspaceId');
  const limit = parseLimit(c.req.query('limit'), 100, 250);

  if (workspaceId && !isUuid(workspaceId)) {
    sql.end().catch(() => {});
    return validationResponse(c, ['"workspaceId" must be a valid UUID']);
  }

  try {
    const rows = await sql<WorkItemRow[]>`
      SELECT
        w.id,
        w.workspace_id          AS "workspaceId",
        ws.name                 AS "workspaceName",
        w.assigned_agent_id     AS "assignedAgentId",
        w.work_type             AS "workType",
        w.form_type             AS "formType",
        w.title,
        w.payer_name            AS "payerName",
        w.coverage_type         AS "coverageType",
        w.patient_ref           AS "patientRef",
        w.provider_ref          AS "providerRef",
        w.claim_ref             AS "claimRef",
        w.source_system         AS "sourceSystem",
        w.amount_at_risk        AS "amountAtRisk",
        w.confidence_pct        AS "confidencePct",
        w.priority,
        w.status,
        w.requires_human_review AS "requiresHumanReview",
        w.due_at                AS "dueAt",
        w.submitted_at          AS "submittedAt",
        w.completed_at          AS "completedAt",
        w.metadata,
        w.created_at            AS "createdAt",
        w.updated_at            AS "updatedAt"
      FROM rcm_work_items w
      JOIN rcm_workspaces ws ON ws.id = w.workspace_id
      WHERE w.merchant_id = ${merchant.id}
        AND (${status ?? null}::text IS NULL OR w.status = ${status ?? null})
        AND (${workType ?? null}::text IS NULL OR w.work_type = ${workType ?? null})
        AND (${workspaceId ?? null}::uuid IS NULL OR w.workspace_id = ${workspaceId ?? null})
      ORDER BY
        CASE w.priority
          WHEN 'urgent' THEN 1
          WHEN 'high' THEN 2
          WHEN 'normal' THEN 3
          ELSE 4
        END,
        w.created_at DESC
      LIMIT ${limit}
    `;

    return c.json({
      stage: 'live',
      count: rows.length,
      items: rows.map(mapWorkItem),
      firstLane: blueprint.firstLane,
      suggestedFields: [
        'patientRef',
        'providerRef',
        'claimRef',
        'payerName',
        'coverageType',
        'formType',
        'sourceSystem',
        'amountAtRisk',
        'dueAt',
      ],
    });
  } catch (err: unknown) {
    console.error('[rcm] work-items error:', err instanceof Error ? err.message : err);
    return c.json({ error: 'Failed to fetch RCM work items' }, 500);
  } finally {
    sql.end().catch(() => {});
  }
});

router.get('/vendors', authenticateApiKey, (c) =>
  c.json({
    items: [],
    stage: 'scaffold',
    scorecardDimensions: [
      'closure_rate',
      'escalation_rate',
      'avg_turnaround_mins',
      'supervisor_acceptance_rate',
      'released_amount',
    ],
  }),
);

router.get('/payouts', authenticateApiKey, (c) =>
  c.json({
    items: [],
    stage: 'scaffold',
    monetization: {
      basePlatformFee: 'workspace_or_client_level',
      workflowUsageFee: ['claim_status_case', 'dde_correction', 'denial_follow_up'],
      outcomeFee: ['recovered_denial', 'resolved_correction', 'underpayment_recovery'],
    },
  }),
);

router.get('/metrics/overview', authenticateApiKey, async (c) => {
  const merchant = c.get('merchant');
  const sql = createDb(c.env);

  try {
    const [summary] = await sql<
      Array<{
        totalWorkItems: number;
        openWorkItems: number;
        autoClosedCount: number;
        humanClosedCount: number;
        blockedCount: number;
        rejectedCount: number;
        humanReviewCount: number;
        amountAtRiskOpen: string | number | null;
        avgConfidencePct: string | number | null;
        claimStatusItems: number;
        claimStatusOpen: number;
      }>
    >`
      SELECT
        COUNT(*)::int AS "totalWorkItems",
        COUNT(*) FILTER (
          WHERE status NOT IN ('closed_auto', 'closed_human', 'blocked', 'rejected')
        )::int AS "openWorkItems",
        COUNT(*) FILTER (WHERE status = 'closed_auto')::int AS "autoClosedCount",
        COUNT(*) FILTER (WHERE status = 'closed_human')::int AS "humanClosedCount",
        COUNT(*) FILTER (WHERE status = 'blocked')::int AS "blockedCount",
        COUNT(*) FILTER (WHERE status = 'rejected')::int AS "rejectedCount",
        COUNT(*) FILTER (WHERE status = 'human_review_required')::int AS "humanReviewCount",
        COALESCE(
          SUM(amount_at_risk) FILTER (
            WHERE status NOT IN ('closed_auto', 'closed_human', 'blocked', 'rejected')
          ),
          0
        ) AS "amountAtRiskOpen",
        ROUND(AVG(confidence_pct) FILTER (WHERE confidence_pct IS NOT NULL), 1) AS "avgConfidencePct",
        COUNT(*) FILTER (WHERE work_type = ${claimStatusLaneContract.laneKey})::int AS "claimStatusItems",
        COUNT(*) FILTER (
          WHERE work_type = ${claimStatusLaneContract.laneKey}
            AND status NOT IN ('closed_auto', 'closed_human', 'blocked', 'rejected')
        )::int AS "claimStatusOpen"
      FROM rcm_work_items
      WHERE merchant_id = ${merchant.id}
    `;

    const [exceptions] = await sql<Array<{ openExceptionCount: number; highSeverityCount: number }>>`
      SELECT
        COUNT(*)::int AS "openExceptionCount",
        COUNT(*) FILTER (WHERE e.severity IN ('critical', 'high'))::int AS "highSeverityCount"
      FROM rcm_exceptions e
      JOIN rcm_work_items w ON w.id = e.work_item_id
      WHERE w.merchant_id = ${merchant.id}
        AND e.resolved_at IS NULL
    `;

    const [workspaces] = await sql<Array<{ workspaceCount: number }>>`
      SELECT COUNT(*)::int AS "workspaceCount"
      FROM rcm_workspaces
      WHERE merchant_id = ${merchant.id}
    `;

    const resolvedTotal =
      (summary?.autoClosedCount ?? 0) +
      (summary?.humanClosedCount ?? 0) +
      (summary?.blockedCount ?? 0) +
      (summary?.rejectedCount ?? 0);
    const autoClosedPct = resolvedTotal > 0
      ? Number((((summary?.autoClosedCount ?? 0) / resolvedTotal) * 100).toFixed(1))
      : 0;
    const humanInterventionPct = (summary?.totalWorkItems ?? 0) > 0
      ? Number((((summary?.humanReviewCount ?? 0) / (summary?.totalWorkItems ?? 0)) * 100).toFixed(1))
      : 0;

    return c.json({
      stage: 'live',
      queue: {
        totalWorkItems: summary?.totalWorkItems ?? 0,
        totalOpen: summary?.openWorkItems ?? 0,
        autoClosedCount: summary?.autoClosedCount ?? 0,
        humanClosedCount: summary?.humanClosedCount ?? 0,
        blockedCount: summary?.blockedCount ?? 0,
        rejectedCount: summary?.rejectedCount ?? 0,
        humanReviewCount: summary?.humanReviewCount ?? 0,
        openExceptionCount: exceptions?.openExceptionCount ?? 0,
        highSeverityExceptionCount: exceptions?.highSeverityCount ?? 0,
        amountAtRiskOpen: Number(summary?.amountAtRiskOpen ?? 0),
        avgConfidencePct: summary?.avgConfidencePct === null ? null : Number(summary?.avgConfidencePct),
        autoClosedPct,
        humanInterventionPct,
      },
      workspaces: {
        count: workspaces?.workspaceCount ?? 0,
      },
      firstLane: {
        ...blueprint.firstLane,
        totalItems: summary?.claimStatusItems ?? 0,
        openItems: summary?.claimStatusOpen ?? 0,
        openExceptions: exceptions?.openExceptionCount ?? 0,
      },
    });
  } catch (err: unknown) {
    console.error('[rcm] metrics overview error:', err instanceof Error ? err.message : err);
    return c.json({ error: 'Failed to fetch RCM overview metrics' }, 500);
  } finally {
    sql.end().catch(() => {});
  }
});

router.get('/metrics/queues', authenticateApiKey, async (c) => {
  const merchant = c.get('merchant');
  const sql = createDb(c.env);

  try {
    const [claimStatus] = await sql<
      Array<{ totalCount: number; openCount: number; exceptionCount: number; autoClosedCount: number }>
    >`
      SELECT
        COUNT(*)::int AS "totalCount",
        COUNT(*) FILTER (
          WHERE w.status NOT IN ('closed_auto', 'closed_human', 'blocked', 'rejected')
        )::int AS "openCount",
        COUNT(*) FILTER (WHERE w.status = 'closed_auto')::int AS "autoClosedCount",
        (
          SELECT COUNT(*)::int
          FROM rcm_exceptions e
          WHERE e.work_item_id = ANY(
            SELECT id
            FROM rcm_work_items
            WHERE merchant_id = ${merchant.id}
              AND work_type = ${claimStatusLaneContract.laneKey}
          )
            AND e.resolved_at IS NULL
        ) AS "exceptionCount"
      FROM rcm_work_items w
      WHERE w.merchant_id = ${merchant.id}
        AND w.work_type = ${claimStatusLaneContract.laneKey}
    `;

    const [eligibility] = await sql<
      Array<{ totalCount: number; openCount: number; exceptionCount: number; autoClosedCount: number }>
    >`
      SELECT
        COUNT(*)::int AS "totalCount",
        COUNT(*) FILTER (
          WHERE w.status NOT IN ('closed_auto', 'closed_human', 'blocked', 'rejected')
        )::int AS "openCount",
        COUNT(*) FILTER (WHERE w.status = 'closed_auto')::int AS "autoClosedCount",
        (
          SELECT COUNT(*)::int
          FROM rcm_exceptions e
          WHERE e.work_item_id = ANY(
            SELECT id
            FROM rcm_work_items
            WHERE merchant_id = ${merchant.id}
              AND work_type = ${eligibilityLaneContract.laneKey}
          )
            AND e.resolved_at IS NULL
        ) AS "exceptionCount"
      FROM rcm_work_items w
      WHERE w.merchant_id = ${merchant.id}
        AND w.work_type = ${eligibilityLaneContract.laneKey}
    `;

    return c.json({
      stage: 'live',
      queues: [
        {
          key: 'institutional_claim_status',
          label: 'Claim status',
          status: 'live',
          totalCount: claimStatus?.totalCount ?? 0,
          openCount: claimStatus?.openCount ?? 0,
          exceptionCount: claimStatus?.exceptionCount ?? 0,
          autoClosedCount: claimStatus?.autoClosedCount ?? 0,
        },
        {
          key: 'eligibility_verification',
          label: 'Eligibility verification',
          status: 'live',
          totalCount: eligibility?.totalCount ?? 0,
          openCount: eligibility?.openCount ?? 0,
          exceptionCount: eligibility?.exceptionCount ?? 0,
          autoClosedCount: eligibility?.autoClosedCount ?? 0,
        },
        { key: 'dde_correction', label: 'DDE correction', status: 'build_next' },
        { key: 'denial_follow_up', label: 'Denial follow-up', status: 'phase_two' },
        { key: 'prior_auth_follow_up', label: 'Prior auth follow-up', status: 'phase_two' },
        { key: 'posting_exceptions', label: 'Payment posting exceptions', status: 'phase_two' },
      ],
    });
  } catch (err: unknown) {
    console.error('[rcm] metrics queues error:', err instanceof Error ? err.message : err);
    return c.json({ error: 'Failed to fetch RCM queue metrics' }, 500);
  } finally {
    sql.end().catch(() => {});
  }
});

router.get('/metrics/payouts', authenticateApiKey, (c) =>
  c.json({
    stage: 'scaffold',
    payoutModel: {
      milestoneRelease: true,
      feeLedgerBacked: true,
      settlementObject: 'payment_intent',
    },
  }),
);

// ---------------------------------------------------------------------------
// Operator onboarding: workspace management
// ---------------------------------------------------------------------------

router.post('/workspaces', authenticateApiKey, async (c) => {
  const merchant = c.get('merchant');

  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const name = typeof body['name'] === 'string' ? body['name'].trim() : '';
  const legalName = typeof body['legalName'] === 'string' ? body['legalName'].trim() : null;
  const workspaceType =
    typeof body['workspaceType'] === 'string' && body['workspaceType'].trim()
      ? body['workspaceType'].trim()
      : 'facility_rcm';
  const specialty = typeof body['specialty'] === 'string' ? body['specialty'].trim() : null;
  const timezone =
    typeof body['timezone'] === 'string' && body['timezone'].trim()
      ? body['timezone'].trim()
      : 'America/New_York';
  const approvalPolicy = asObject(body['approvalPolicy']);
  const config = asObject(body['config']);

  const details: string[] = [];
  if (!name) details.push('"name" is required');
  if (details.length > 0) return validationResponse(c, details);

  const workspaceId = crypto.randomUUID();
  const sql = createDb(c.env);

  try {
    await sql`
      INSERT INTO rcm_workspaces (
        id, merchant_id, name, legal_name, workspace_type,
        specialty, timezone, status, approval_policy, config, created_at, updated_at
      ) VALUES (
        ${workspaceId}, ${merchant.id}, ${name}, ${legalName}, ${workspaceType},
        ${specialty}, ${timezone}, 'active',
        ${jsonb(approvalPolicy)}::jsonb, ${jsonb(config)}::jsonb, NOW(), NOW()
      )
    `;

    const rows = await sql<
      Array<{
        id: string;
        name: string;
        legalName: string | null;
        workspaceType: string;
        specialty: string | null;
        timezone: string | null;
        status: string;
        approvalPolicy: unknown;
        config: unknown;
        createdAt: Date | string;
        updatedAt: Date | string;
      }>
    >`
      SELECT id, name, legal_name AS "legalName", workspace_type AS "workspaceType",
             specialty, timezone, status, approval_policy AS "approvalPolicy", config,
             created_at AS "createdAt", updated_at AS "updatedAt"
      FROM rcm_workspaces WHERE id = ${workspaceId}
    `;
    const row = rows[0];

    return c.json(
      {
        stage: 'live',
        workspaceId: row.id,
        name: row.name,
        legalName: row.legalName,
        workspaceType: row.workspaceType,
        specialty: row.specialty,
        timezone: row.timezone,
        status: row.status,
        approvalPolicy: parseJsonb<JsonRecord>(row.approvalPolicy, {}),
        config: parseJsonb<JsonRecord>(row.config, {}),
        createdAt: toIso(row.createdAt),
        updatedAt: toIso(row.updatedAt),
      },
      201,
    );
  } catch (err: unknown) {
    console.error('[rcm] create_workspace error:', err instanceof Error ? err.message : err);
    return c.json({ error: 'Failed to create workspace' }, 500);
  } finally {
    sql.end().catch(() => {});
  }
});

router.patch('/workspaces/:workspaceId', authenticateApiKey, async (c) => {
  const merchant = c.get('merchant');
  const workspaceId = c.req.param('workspaceId') ?? '';
  if (!isUuid(workspaceId)) return validationResponse(c, ['"workspaceId" must be a valid UUID']);

  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const sql = createDb(c.env);

  try {
    type WorkspaceRow = {
      id: string;
      name: string;
      legalName: string | null;
      workspaceType: string;
      specialty: string | null;
      timezone: string | null;
      status: string;
      approvalPolicy: unknown;
      config: unknown;
      createdAt: Date | string;
      updatedAt: Date | string;
    };

    const existing = await sql<WorkspaceRow[]>`
      SELECT id, name, legal_name AS "legalName", workspace_type AS "workspaceType",
             specialty, timezone, status, approval_policy AS "approvalPolicy", config,
             created_at AS "createdAt", updated_at AS "updatedAt"
      FROM rcm_workspaces
      WHERE id = ${workspaceId} AND merchant_id = ${merchant.id}
      LIMIT 1
    `;
    if (!existing[0]) return c.json({ error: 'Workspace not found' }, 404);
    const e = existing[0];

    const name = typeof body['name'] === 'string' && body['name'].trim() ? body['name'].trim() : e.name;
    const legalName = 'legalName' in body
      ? (typeof body['legalName'] === 'string' ? body['legalName'].trim() || null : null)
      : e.legalName;
    const specialty = 'specialty' in body
      ? (typeof body['specialty'] === 'string' ? body['specialty'].trim() || null : null)
      : e.specialty;
    const timezone = typeof body['timezone'] === 'string' && body['timezone'].trim()
      ? body['timezone'].trim()
      : e.timezone;
    const status = typeof body['status'] === 'string' && ['active', 'suspended', 'closed'].includes(body['status'])
      ? body['status']
      : e.status;
    const approvalPolicy = 'approvalPolicy' in body ? asObject(body['approvalPolicy']) : parseJsonb<JsonRecord>(e.approvalPolicy, {});
    const config = 'config' in body ? asObject(body['config']) : parseJsonb<JsonRecord>(e.config, {});

    await sql`
      UPDATE rcm_workspaces SET
        name            = ${name},
        legal_name      = ${legalName},
        specialty       = ${specialty},
        timezone        = ${timezone},
        status          = ${status},
        approval_policy = ${jsonb(approvalPolicy)}::jsonb,
        config          = ${jsonb(config)}::jsonb,
        updated_at      = NOW()
      WHERE id = ${workspaceId} AND merchant_id = ${merchant.id}
    `;

    const rows = await sql<WorkspaceRow[]>`
      SELECT id, name, legal_name AS "legalName", workspace_type AS "workspaceType",
             specialty, timezone, status, approval_policy AS "approvalPolicy", config,
             created_at AS "createdAt", updated_at AS "updatedAt"
      FROM rcm_workspaces WHERE id = ${workspaceId}
    `;
    const row = rows[0];

    return c.json({
      stage: 'live',
      workspaceId: row.id,
      name: row.name,
      legalName: row.legalName,
      workspaceType: row.workspaceType,
      specialty: row.specialty,
      timezone: row.timezone,
      status: row.status,
      approvalPolicy: parseJsonb<JsonRecord>(row.approvalPolicy, {}),
      config: parseJsonb<JsonRecord>(row.config, {}),
      createdAt: toIso(row.createdAt),
      updatedAt: toIso(row.updatedAt),
    });
  } catch (err: unknown) {
    console.error('[rcm] update_workspace error:', err instanceof Error ? err.message : err);
    return c.json({ error: 'Failed to update workspace' }, 500);
  } finally {
    sql.end().catch(() => {});
  }
});

// ---------------------------------------------------------------------------
// Generic work-item lifecycle (cross-lane operator API)
// ---------------------------------------------------------------------------

router.post('/work-items', authenticateApiKey, async (c) => {
  const merchant = c.get('merchant');

  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const workspaceId = typeof body['workspaceId'] === 'string' ? body['workspaceId'] : '';
  const workType = typeof body['workType'] === 'string' ? body['workType'].trim() : '';
  const title = typeof body['title'] === 'string' ? body['title'].trim() : '';
  const billingDomain = typeof body['billingDomain'] === 'string' ? body['billingDomain'].trim() : 'facility';
  const formType = typeof body['formType'] === 'string' ? body['formType'].trim() : null;
  const payerName = typeof body['payerName'] === 'string' ? body['payerName'].trim() : null;
  const coverageType = typeof body['coverageType'] === 'string' ? body['coverageType'].trim() : null;
  const patientRef = typeof body['patientRef'] === 'string' ? body['patientRef'].trim() : null;
  const providerRef = typeof body['providerRef'] === 'string' ? body['providerRef'].trim() : null;
  const encounterRef = typeof body['encounterRef'] === 'string' ? body['encounterRef'].trim() : null;
  const claimRef = typeof body['claimRef'] === 'string' ? body['claimRef'].trim() : null;
  const sourceSystem = typeof body['sourceSystem'] === 'string' ? body['sourceSystem'].trim() : null;
  const priority = normalizePriority(body['priority']);
  const dueAt = parseDateString(body['dueAt']);
  const amountAtRisk = 'amountAtRisk' in body ? parsePositiveAmount(body['amountAtRisk']) : null;
  const metadata = asObject(body['metadata']);

  const details: string[] = [];
  if (!workspaceId || !isUuid(workspaceId)) details.push('"workspaceId" must be a valid UUID');
  if (!workType) details.push('"workType" is required');
  if (!title) details.push('"title" is required');
  if ('amountAtRisk' in body && body['amountAtRisk'] !== null && amountAtRisk === null) {
    details.push('"amountAtRisk" must be a positive number');
  }
  if (details.length > 0) return validationResponse(c, details);

  const workItemId = crypto.randomUUID();
  const sql = createDb(c.env);

  try {
    const workspace = await getOwnedWorkspace(sql, merchant.id, workspaceId);
    if (!workspace) return c.json({ error: 'Workspace not found' }, 404);

    await sql`
      INSERT INTO rcm_work_items (
        id, workspace_id, merchant_id, work_type, billing_domain, form_type,
        title, payer_name, coverage_type, patient_ref, provider_ref,
        encounter_ref, claim_ref, source_system, amount_at_risk, priority,
        status, requires_human_review, due_at, metadata, created_at, updated_at
      ) VALUES (
        ${workItemId}, ${workspaceId}, ${merchant.id}, ${workType}, ${billingDomain}, ${formType},
        ${title}, ${payerName}, ${coverageType}, ${patientRef}, ${providerRef},
        ${encounterRef}, ${claimRef}, ${sourceSystem}, ${amountAtRisk ?? null}, ${priority},
        'new', false, ${dueAt}, ${jsonb(metadata)}::jsonb, NOW(), NOW()
      )
    `;

    const rows = await sql<WorkItemRow[]>`
      SELECT w.id, w.workspace_id AS "workspaceId", ws.name AS "workspaceName",
             w.assigned_agent_id AS "assignedAgentId", w.work_type AS "workType",
             w.form_type AS "formType", w.title, w.payer_name AS "payerName",
             w.coverage_type AS "coverageType", w.patient_ref AS "patientRef",
             w.provider_ref AS "providerRef", w.claim_ref AS "claimRef",
             w.source_system AS "sourceSystem", w.amount_at_risk AS "amountAtRisk",
             w.confidence_pct AS "confidencePct", w.priority, w.status,
             w.requires_human_review AS "requiresHumanReview", w.due_at AS "dueAt",
             w.submitted_at AS "submittedAt", w.completed_at AS "completedAt",
             w.metadata, w.created_at AS "createdAt", w.updated_at AS "updatedAt"
      FROM rcm_work_items w
      JOIN rcm_workspaces ws ON ws.id = w.workspace_id
      WHERE w.id = ${workItemId}
    `;

    return c.json({ stage: 'live', workItem: mapWorkItem(rows[0]) }, 201);
  } catch (err: unknown) {
    console.error('[rcm] create_work_item error:', err instanceof Error ? err.message : err);
    return c.json({ error: 'Failed to create work item' }, 500);
  } finally {
    sql.end().catch(() => {});
  }
});

router.patch('/work-items/:workItemId', authenticateApiKey, async (c) => {
  const merchant = c.get('merchant');
  const workItemId = c.req.param('workItemId') ?? '';
  if (!isUuid(workItemId)) return validationResponse(c, ['"workItemId" must be a valid UUID']);

  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const sql = createDb(c.env);

  try {
    const existing = await sql<Array<{ id: string; status: string; title: string; payerName: string | null; coverageType: string | null; priority: string; dueAt: Date | string | null; amountAtRisk: string | number | null }>>`
      SELECT id, status, title, payer_name AS "payerName", coverage_type AS "coverageType",
             priority, due_at AS "dueAt", amount_at_risk AS "amountAtRisk"
      FROM rcm_work_items
      WHERE id = ${workItemId} AND merchant_id = ${merchant.id}
      LIMIT 1
    `;
    if (!existing[0]) return c.json({ error: 'Work item not found' }, 404);
    const e = existing[0];

    const terminalStatuses = ['closed_auto', 'closed_human', 'rejected'];
    if (terminalStatuses.includes(e.status)) {
      return c.json({ error: 'Terminal work items cannot be updated' }, 409);
    }

    const title = typeof body['title'] === 'string' && body['title'].trim()
      ? body['title'].trim() : e.title;
    const payerName = 'payerName' in body
      ? (typeof body['payerName'] === 'string' ? body['payerName'].trim() || null : null)
      : e.payerName;
    const coverageType = 'coverageType' in body
      ? (typeof body['coverageType'] === 'string' ? body['coverageType'].trim() || null : null)
      : e.coverageType;
    const priority = typeof body['priority'] === 'string'
      ? normalizePriority(body['priority']) : e.priority;
    const dueAt = 'dueAt' in body ? parseDateString(body['dueAt']) : toIso(e.dueAt);
    const newAmount = 'amountAtRisk' in body ? parsePositiveAmount(body['amountAtRisk']) : undefined;

    if ('amountAtRisk' in body && body['amountAtRisk'] !== null && newAmount === null) {
      return validationResponse(c, ['"amountAtRisk" must be a positive number']);
    }

    const amountAtRisk = newAmount !== undefined ? newAmount : (e.amountAtRisk === null ? null : Number(e.amountAtRisk));

    await sql`
      UPDATE rcm_work_items SET
        title          = ${title},
        payer_name     = ${payerName},
        coverage_type  = ${coverageType},
        priority       = ${priority},
        due_at         = ${dueAt},
        amount_at_risk = ${amountAtRisk},
        updated_at     = NOW()
      WHERE id = ${workItemId} AND merchant_id = ${merchant.id}
    `;

    const rows = await sql<WorkItemRow[]>`
      SELECT w.id, w.workspace_id AS "workspaceId", ws.name AS "workspaceName",
             w.assigned_agent_id AS "assignedAgentId", w.work_type AS "workType",
             w.form_type AS "formType", w.title, w.payer_name AS "payerName",
             w.coverage_type AS "coverageType", w.patient_ref AS "patientRef",
             w.provider_ref AS "providerRef", w.claim_ref AS "claimRef",
             w.source_system AS "sourceSystem", w.amount_at_risk AS "amountAtRisk",
             w.confidence_pct AS "confidencePct", w.priority, w.status,
             w.requires_human_review AS "requiresHumanReview", w.due_at AS "dueAt",
             w.submitted_at AS "submittedAt", w.completed_at AS "completedAt",
             w.metadata, w.created_at AS "createdAt", w.updated_at AS "updatedAt"
      FROM rcm_work_items w
      JOIN rcm_workspaces ws ON ws.id = w.workspace_id
      WHERE w.id = ${workItemId}
    `;

    return c.json({ stage: 'live', workItem: mapWorkItem(rows[0]) });
  } catch (err: unknown) {
    console.error('[rcm] update_work_item error:', err instanceof Error ? err.message : err);
    return c.json({ error: 'Failed to update work item' }, 500);
  } finally {
    sql.end().catch(() => {});
  }
});

router.post('/work-items/:workItemId/assign', authenticateApiKey, async (c) => {
  const merchant = c.get('merchant');
  const workItemId = c.req.param('workItemId') ?? '';
  if (!isUuid(workItemId)) return validationResponse(c, ['"workItemId" must be a valid UUID']);

  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const agentId = typeof body['agentId'] === 'string' ? body['agentId'] : null;
  if (agentId !== null && !isUuid(agentId)) {
    return validationResponse(c, ['"agentId" must be a valid UUID or null']);
  }

  const sql = createDb(c.env);

  try {
    const existing = await sql<Array<{ id: string }>>`
      SELECT id FROM rcm_work_items
      WHERE id = ${workItemId} AND merchant_id = ${merchant.id}
      LIMIT 1
    `;
    if (!existing[0]) return c.json({ error: 'Work item not found' }, 404);

    await sql`
      UPDATE rcm_work_items
      SET assigned_agent_id = ${agentId}, updated_at = NOW()
      WHERE id = ${workItemId} AND merchant_id = ${merchant.id}
    `;

    await insertEvidence(
      sql,
      workItemId,
      [{ evidenceType: 'agent_assigned', payload: { agentId, assignedAt: new Date().toISOString() } }],
      'operator',
      'rcm_operator',
    );

    return c.json({ stage: 'live', workItemId, assignedAgentId: agentId });
  } catch (err: unknown) {
    console.error('[rcm] assign_work_item error:', err instanceof Error ? err.message : err);
    return c.json({ error: 'Failed to assign work item' }, 500);
  } finally {
    sql.end().catch(() => {});
  }
});

router.post('/work-items/:workItemId/evidence', authenticateApiKey, async (c) => {
  const merchant = c.get('merchant');
  const workItemId = c.req.param('workItemId') ?? '';
  if (!isUuid(workItemId)) return validationResponse(c, ['"workItemId" must be a valid UUID']);

  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const evidenceInput = Array.isArray(body['evidence']) ? body['evidence'] : [];
  if (evidenceInput.length === 0) {
    return validationResponse(c, ['"evidence" must contain at least one evidence record']);
  }

  const items: EvidenceInput[] = evidenceInput
    .map((entry) => {
      const item = asObject(entry);
      return {
        actorType: typeof item['actorType'] === 'string' ? item['actorType'] : 'operator',
        actorRef: typeof item['actorRef'] === 'string' ? item['actorRef'] : 'rcm_operator',
        evidenceType: typeof item['evidenceType'] === 'string' ? item['evidenceType'] : '',
        payload: item['payload'],
      };
    })
    .filter((item) => item.evidenceType.length > 0);

  if (items.length !== evidenceInput.length) {
    return validationResponse(c, ['Each evidence item must include "evidenceType"']);
  }

  const sql = createDb(c.env);

  try {
    const existing = await sql<Array<{ id: string }>>`
      SELECT id FROM rcm_work_items
      WHERE id = ${workItemId} AND merchant_id = ${merchant.id}
      LIMIT 1
    `;
    if (!existing[0]) return c.json({ error: 'Work item not found' }, 404);

    await insertEvidence(sql, workItemId, items, 'operator', 'rcm_operator');

    return c.json({ stage: 'live', workItemId, appended: items.length });
  } catch (err: unknown) {
    console.error('[rcm] append_evidence error:', err instanceof Error ? err.message : err);
    return c.json({ error: 'Failed to append evidence' }, 500);
  } finally {
    sql.end().catch(() => {});
  }
});

router.post('/work-items/:workItemId/submit', authenticateApiKey, async (c) => {
  const merchant = c.get('merchant');
  const workItemId = c.req.param('workItemId') ?? '';
  if (!isUuid(workItemId)) return validationResponse(c, ['"workItemId" must be a valid UUID']);

  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }

  const agentId = typeof body['agentId'] === 'string' ? body['agentId'] : null;
  if (agentId !== null && !isUuid(agentId)) {
    return validationResponse(c, ['"agentId" must be a valid UUID']);
  }

  const sql = createDb(c.env);

  try {
    const rows = await sql<Array<{ id: string; status: string }>>`
      SELECT id, status FROM rcm_work_items
      WHERE id = ${workItemId} AND merchant_id = ${merchant.id}
      LIMIT 1
      FOR UPDATE
    `;
    const row = rows[0];
    if (!row) return c.json({ error: 'Work item not found' }, 404);

    const allowedStatuses = ['new', 'routed', 'retry_pending'];
    if (!allowedStatuses.includes(row.status)) {
      return c.json({ error: 'Work item must be in new, routed, or retry_pending to submit' }, 409);
    }

    await sql`
      UPDATE rcm_work_items
      SET
        status       = 'awaiting_qa',
        assigned_agent_id = ${agentId ?? sql`assigned_agent_id`},
        submitted_at = NOW(),
        updated_at   = NOW()
      WHERE id = ${workItemId} AND merchant_id = ${merchant.id}
    `;

    await insertEvidence(
      sql,
      workItemId,
      [{ evidenceType: 'manual_submit', payload: { agentId, submittedAt: new Date().toISOString() } }],
      'operator',
      agentId ?? 'rcm_operator',
    );

    return c.json({ stage: 'live', nextState: 'awaiting_qa', workItemId });
  } catch (err: unknown) {
    console.error('[rcm] submit_work_item error:', err instanceof Error ? err.message : err);
    return c.json({ error: 'Failed to submit work item' }, 500);
  } finally {
    sql.end().catch(() => {});
  }
});

router.post('/work-items/:workItemId/approve', authenticateApiKey, async (c) => {
  const merchant = c.get('merchant');
  const workItemId = c.req.param('workItemId') ?? '';
  if (!isUuid(workItemId)) return validationResponse(c, ['"workItemId" must be a valid UUID']);

  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }

  const reviewerRef = typeof body['reviewerRef'] === 'string' && body['reviewerRef'].trim()
    ? body['reviewerRef'].trim()
    : 'operator';
  const summary = typeof body['summary'] === 'string' ? body['summary'].trim() : null;

  const sql = createDb(c.env);

  try {
    const result = await sql.begin(async (tx: any) => {
      const rows = await tx<Array<{ id: string; status: string; assignedAgentId: string | null; workspaceId: string }>>`
        SELECT id, status, assigned_agent_id AS "assignedAgentId", workspace_id AS "workspaceId"
        FROM rcm_work_items
        WHERE id = ${workItemId} AND merchant_id = ${merchant.id}
        LIMIT 1
        FOR UPDATE
      `;
      const row = rows[0];
      if (!row) throw new Error('WORK_ITEM_NOT_FOUND');

      const allowedStatuses = ['awaiting_qa', 'human_review_required'];
      if (!allowedStatuses.includes(row.status)) {
        throw new Error('INVALID_STATE');
      }

      const nowIso = new Date().toISOString();

      await tx`
        UPDATE rcm_work_items
        SET
          status       = 'closed_human',
          completed_at = NOW(),
          updated_at   = NOW()
        WHERE id = ${workItemId} AND merchant_id = ${merchant.id}
      `;

      await insertEvidence(
        tx,
        workItemId,
        [{ actorType: 'human_reviewer', actorRef: reviewerRef, evidenceType: 'human_approved', payload: { summary, decidedAt: nowIso } }],
        'human_reviewer',
        reviewerRef,
      );

      // Update vendor scorecard for the assigned agent if present
      if (row.assignedAgentId) {
        await upsertVendorMetric(tx, merchant.id, row.assignedAgentId, { approved: 1 });
      }

      return { nextState: 'closed_human' };
    });

    return c.json({ stage: 'live', nextState: result.nextState, workItemId });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === 'WORK_ITEM_NOT_FOUND') return c.json({ error: 'Work item not found' }, 404);
    if (message === 'INVALID_STATE') {
      return c.json({ error: 'Work item must be in awaiting_qa or human_review_required to approve' }, 409);
    }
    console.error('[rcm] approve_work_item error:', message);
    return c.json({ error: 'Failed to approve work item' }, 500);
  } finally {
    sql.end().catch(() => {});
  }
});

router.post('/work-items/:workItemId/reject', authenticateApiKey, async (c) => {
  const merchant = c.get('merchant');
  const workItemId = c.req.param('workItemId') ?? '';
  if (!isUuid(workItemId)) return validationResponse(c, ['"workItemId" must be a valid UUID']);

  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }

  const reviewerRef = typeof body['reviewerRef'] === 'string' && body['reviewerRef'].trim()
    ? body['reviewerRef'].trim()
    : 'operator';
  const reason = typeof body['reason'] === 'string' ? body['reason'].trim() : null;

  const sql = createDb(c.env);

  try {
    const result = await sql.begin(async (tx: any) => {
      const rows = await tx<Array<{ id: string; status: string; assignedAgentId: string | null }>>`
        SELECT id, status, assigned_agent_id AS "assignedAgentId"
        FROM rcm_work_items
        WHERE id = ${workItemId} AND merchant_id = ${merchant.id}
        LIMIT 1
        FOR UPDATE
      `;
      const row = rows[0];
      if (!row) throw new Error('WORK_ITEM_NOT_FOUND');

      const allowedStatuses = ['awaiting_qa', 'human_review_required'];
      if (!allowedStatuses.includes(row.status)) {
        throw new Error('INVALID_STATE');
      }

      const nowIso = new Date().toISOString();

      await tx`
        UPDATE rcm_work_items
        SET
          status       = 'rejected',
          completed_at = NOW(),
          updated_at   = NOW()
        WHERE id = ${workItemId} AND merchant_id = ${merchant.id}
      `;

      await insertEvidence(
        tx,
        workItemId,
        [{ actorType: 'human_reviewer', actorRef: reviewerRef, evidenceType: 'human_rejected', payload: { reason, decidedAt: nowIso } }],
        'human_reviewer',
        reviewerRef,
      );

      if (row.assignedAgentId) {
        await upsertVendorMetric(tx, merchant.id, row.assignedAgentId, { rejected: 1 });
      }

      return { nextState: 'rejected' };
    });

    return c.json({ stage: 'live', nextState: result.nextState, workItemId });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === 'WORK_ITEM_NOT_FOUND') return c.json({ error: 'Work item not found' }, 404);
    if (message === 'INVALID_STATE') {
      return c.json({ error: 'Work item must be in awaiting_qa or human_review_required to reject' }, 409);
    }
    console.error('[rcm] reject_work_item error:', message);
    return c.json({ error: 'Failed to reject work item' }, 500);
  } finally {
    sql.end().catch(() => {});
  }
});

// ---------------------------------------------------------------------------
// Milestone fee capture
// ---------------------------------------------------------------------------

router.post('/work-items/:workItemId/milestones', authenticateApiKey, async (c) => {
  const merchant = c.get('merchant');
  const workItemId = c.req.param('workItemId') ?? '';
  if (!isUuid(workItemId)) return validationResponse(c, ['"workItemId" must be a valid UUID']);

  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const name = typeof body['name'] === 'string' ? body['name'].trim() : '';
  const amount = parsePositiveAmount(body['amount']);
  const successCriteria = asObject(body['successCriteria']);

  const details: string[] = [];
  if (!name) details.push('"name" is required');
  if (amount === null) details.push('"amount" must be a positive number');
  if (details.length > 0) return validationResponse(c, details);

  const sql = createDb(c.env);

  try {
    const existing = await sql<Array<{ id: string }>>`
      SELECT id FROM rcm_work_items
      WHERE id = ${workItemId} AND merchant_id = ${merchant.id}
      LIMIT 1
    `;
    if (!existing[0]) return c.json({ error: 'Work item not found' }, 404);

    const milestoneId = crypto.randomUUID();
    await sql`
      INSERT INTO rcm_milestones (id, work_item_id, name, amount, status, success_criteria, created_at, updated_at)
      VALUES (${milestoneId}, ${workItemId}, ${name}, ${amount}, 'pending', ${jsonb(successCriteria)}::jsonb, NOW(), NOW())
    `;

    const rows = await sql<
      Array<{
        id: string;
        workItemId: string;
        name: string;
        amount: string;
        status: string;
        successCriteria: unknown;
        paymentIntentId: string | null;
        releasedAt: Date | string | null;
        createdAt: Date | string;
        updatedAt: Date | string;
      }>
    >`
      SELECT id, work_item_id AS "workItemId", name, amount, status,
             success_criteria AS "successCriteria", payment_intent_id AS "paymentIntentId",
             released_at AS "releasedAt", created_at AS "createdAt", updated_at AS "updatedAt"
      FROM rcm_milestones WHERE id = ${milestoneId}
    `;
    const row = rows[0];

    return c.json(
      {
        stage: 'live',
        milestoneId: row.id,
        workItemId: row.workItemId,
        name: row.name,
        amount: Number(row.amount),
        status: row.status,
        successCriteria: parseJsonb<JsonRecord>(row.successCriteria, {}),
        paymentIntentId: row.paymentIntentId,
        releasedAt: toIso(row.releasedAt),
        createdAt: toIso(row.createdAt),
        updatedAt: toIso(row.updatedAt),
      },
      201,
    );
  } catch (err: unknown) {
    console.error('[rcm] create_milestone error:', err instanceof Error ? err.message : err);
    return c.json({ error: 'Failed to create milestone' }, 500);
  } finally {
    sql.end().catch(() => {});
  }
});

router.post('/work-items/:workItemId/milestones/:milestoneId/release', authenticateApiKey, async (c) => {
  const merchant = c.get('merchant');
  const workItemId = c.req.param('workItemId') ?? '';
  const milestoneId = c.req.param('milestoneId') ?? '';

  const idErrors: string[] = [];
  if (!isUuid(workItemId)) idErrors.push('"workItemId" must be a valid UUID');
  if (!isUuid(milestoneId)) idErrors.push('"milestoneId" must be a valid UUID');
  if (idErrors.length > 0) return validationResponse(c, idErrors);

  const sql = createDb(c.env);

  try {
    const result = await sql.begin(async (tx: any) => {
      // Verify work item ownership
      const wiRows = await tx<Array<{ id: string; status: string }>>`
        SELECT id, status FROM rcm_work_items
        WHERE id = ${workItemId} AND merchant_id = ${merchant.id}
        LIMIT 1
        FOR UPDATE
      `;
      if (!wiRows[0]) throw new Error('WORK_ITEM_NOT_FOUND');

      // Verify milestone belongs to work item
      const msRows = await tx<
        Array<{
          id: string;
          workItemId: string;
          name: string;
          amount: string;
          status: string;
          successCriteria: unknown;
          paymentIntentId: string | null;
        }>
      >`
        SELECT id, work_item_id AS "workItemId", name, amount, status,
               success_criteria AS "successCriteria", payment_intent_id AS "paymentIntentId"
        FROM rcm_milestones
        WHERE id = ${milestoneId} AND work_item_id = ${workItemId}
        LIMIT 1
        FOR UPDATE
      `;
      const ms = msRows[0];
      if (!ms) throw new Error('MILESTONE_NOT_FOUND');
      if (ms.status !== 'pending') throw new Error('ALREADY_RELEASED');

      // Create a payment_intent as the fee event record
      const intentId = crypto.randomUUID();
      const verificationToken = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      const amount = Number(ms.amount);

      await tx`
        INSERT INTO payment_intents (
          id, merchant_id, amount, currency, status, protocol,
          verification_token, expires_at, metadata, created_at, updated_at
        ) VALUES (
          ${intentId}, ${merchant.id}, ${amount}, 'USD', 'rcm_milestone_release', 'rcm',
          ${verificationToken}, ${expiresAt},
          ${jsonb({
            source: 'rcm_milestone_release',
            milestoneId,
            workItemId,
            milestoneName: ms.name,
          })}::jsonb,
          NOW(), NOW()
        )
      `;

      await tx`
        UPDATE rcm_milestones
        SET
          status             = 'released',
          payment_intent_id  = ${intentId},
          released_at        = NOW(),
          updated_at         = NOW()
        WHERE id = ${milestoneId}
      `;

      await insertEvidence(
        tx,
        workItemId,
        [{
          actorType: 'system',
          actorRef: 'rcm_milestone_engine',
          evidenceType: 'milestone_released',
          payload: { milestoneId, intentId, amount, releasedAt: new Date().toISOString() },
        }],
        'system',
        'rcm_milestone_engine',
      );

      return { intentId, verificationToken, amount };
    });

    return c.json({
      stage: 'live',
      milestoneId,
      workItemId,
      status: 'released',
      feeEvent: {
        paymentIntentId: result.intentId,
        amount: result.amount,
        currency: 'USD',
        verificationToken: result.verificationToken,
      },
      releasedAt: new Date().toISOString(),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === 'WORK_ITEM_NOT_FOUND') return c.json({ error: 'Work item not found' }, 404);
    if (message === 'MILESTONE_NOT_FOUND') return c.json({ error: 'Milestone not found' }, 404);
    if (message === 'ALREADY_RELEASED') return c.json({ error: 'Milestone has already been released' }, 409);
    console.error('[rcm] release_milestone error:', message);
    return c.json({ error: 'Failed to release milestone' }, 500);
  } finally {
    sql.end().catch(() => {});
  }
});

// ─── Denial follow-up lane — DB helpers ──────────────────────────────────────

async function getOwnedDenialWorkItem(sql: Sql, merchantId: string, workItemId: string) {
  const rows = await sql<WorkItemRow[]>`
    SELECT
      w.id,
      w.workspace_id         AS "workspaceId",
      ws.name                AS "workspaceName",
      w.assigned_agent_id    AS "assignedAgentId",
      w.work_type            AS "workType",
      w.form_type            AS "formType",
      w.title,
      w.payer_name           AS "payerName",
      w.coverage_type        AS "coverageType",
      w.patient_ref          AS "patientRef",
      w.provider_ref         AS "providerRef",
      w.claim_ref            AS "claimRef",
      w.source_system        AS "sourceSystem",
      w.amount_at_risk       AS "amountAtRisk",
      w.confidence_pct       AS "confidencePct",
      w.priority,
      w.status,
      w.requires_human_review AS "requiresHumanReview",
      w.due_at               AS "dueAt",
      w.submitted_at         AS "submittedAt",
      w.completed_at         AS "completedAt",
      w.metadata,
      w.created_at           AS "createdAt",
      w.updated_at           AS "updatedAt"
    FROM rcm_work_items w
    JOIN rcm_workspaces ws ON ws.id = w.workspace_id
    WHERE w.id = ${workItemId}
      AND w.merchant_id = ${merchantId}
      AND w.work_type = ${denialFollowUpLaneContract.laneKey}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

async function getOwnedDenialWorkItemForUpdate(sql: Sql, merchantId: string, workItemId: string) {
  const rows = await sql<WorkItemRow[]>`
    SELECT
      w.id,
      w.workspace_id         AS "workspaceId",
      ws.name                AS "workspaceName",
      w.assigned_agent_id    AS "assignedAgentId",
      w.work_type            AS "workType",
      w.form_type            AS "formType",
      w.title,
      w.payer_name           AS "payerName",
      w.coverage_type        AS "coverageType",
      w.patient_ref          AS "patientRef",
      w.provider_ref         AS "providerRef",
      w.claim_ref            AS "claimRef",
      w.source_system        AS "sourceSystem",
      w.amount_at_risk       AS "amountAtRisk",
      w.confidence_pct       AS "confidencePct",
      w.priority,
      w.status,
      w.requires_human_review AS "requiresHumanReview",
      w.due_at               AS "dueAt",
      w.submitted_at         AS "submittedAt",
      w.completed_at         AS "completedAt",
      w.metadata,
      w.created_at           AS "createdAt",
      w.updated_at           AS "updatedAt"
    FROM rcm_work_items w
    JOIN rcm_workspaces ws ON ws.id = w.workspace_id
    WHERE w.id = ${workItemId}
      AND w.merchant_id = ${merchantId}
      AND w.work_type = ${denialFollowUpLaneContract.laneKey}
    LIMIT 1
    FOR UPDATE
  `;
  return rows[0] ?? null;
}

function mapDenialWorkItem(row: WorkItemRow) {
  const base = mapWorkItem(row);
  const metadata = parseJsonb<JsonRecord>(row.metadata, {});
  return {
    ...base,
    denialReasonCode: typeof metadata['denialReasonCode'] === 'string' ? metadata['denialReasonCode'] : null,
    denialDate: typeof metadata['denialDate'] === 'string' ? metadata['denialDate'] : null,
    appealDeadline: typeof metadata['appealDeadline'] === 'string' ? metadata['appealDeadline'] : null,
    appealLevel: typeof metadata['appealLevel'] === 'string' ? metadata['appealLevel'] : null,
  };
}

function denialFollowUpConnectorInputFromWorkItem(row: WorkItemRow): DenialFollowUpConnectorExecutionInput {
  const metadata = parseJsonb<JsonRecord>(row.metadata, {});
  return {
    workItemId: row.id,
    claimRef: row.claimRef ?? '',
    payerName: row.payerName ?? '',
    coverageType: row.coverageType ?? '',
    patientRef: row.patientRef ?? '',
    providerRef: row.providerRef ?? '',
    denialReasonCode: typeof metadata['denialReasonCode'] === 'string' ? metadata['denialReasonCode'] : '',
    denialDate: typeof metadata['denialDate'] === 'string' ? metadata['denialDate'] : '',
    appealDeadline: typeof metadata['appealDeadline'] === 'string' ? metadata['appealDeadline'] : '',
    formType: row.formType ?? '',
    sourceSystem: row.sourceSystem ?? '',
    amountAtRisk: row.amountAtRisk === null ? null : Number(row.amountAtRisk),
    metadata,
  };
}

function defaultExceptionForDenialConnector(result: DenialFollowUpConnectorExecution): DenialFollowUpExceptionSuggestion {
  return (
    result.exceptionSuggestion ?? {
      exceptionType: 'denial_upheld_requires_review',
      severity: 'high',
      summary: result.summary,
      recommendedHumanAction: 'Review denial status and decide on appeal or write-off.',
      requiredContextFields: ['denial_final_reason', 'appeal_documentation'],
      reasonCode: result.resolutionReasonCode,
    }
  );
}

function denialQaDecisionForRecommendation(
  recommendation: DenialFollowUpAutoQaRecommendation,
): 'approve_auto_close' | 'escalate' {
  return recommendation === 'close_auto' ? 'approve_auto_close' : 'escalate';
}

async function persistDenialConnectorRun(
  sql: any,
  merchantId: string,
  workItemId: string,
  params: {
    attemptRole: 'primary_worker' | 'fallback_worker';
    agentId: string | null;
    qaActorRef: string;
    playbookVersion: string;
    strategy: string;
    connectorResult: DenialFollowUpConnectorExecution;
    autoRoute: boolean;
  },
) {
  const row = await getOwnedDenialWorkItemForUpdate(sql, merchantId, workItemId);
  if (!row) throw new Error('WORK_ITEM_NOT_FOUND');

  const expectedStatus = params.attemptRole === 'primary_worker' ? 'routed' : 'retry_pending';
  if (row.status !== expectedStatus) throw new Error('INVALID_STATE');

  const metadata = parseJsonb<JsonRecord>(row.metadata, {});
  const attempts = getAttemptHistory(metadata);
  if (attempts.length >= denialFollowUpLaneContract.retryPolicy.maxAutonomousAttempts) {
    throw new Error('ATTEMPTS_EXHAUSTED');
  }

  if (params.attemptRole === 'fallback_worker') {
    if (attempts.length === 0) throw new Error('NO_PRIOR_ATTEMPT');
    const previousAttempt = attempts[attempts.length - 1];
    const previousStrategy = typeof previousAttempt['strategy'] === 'string' ? previousAttempt['strategy'] : '';
    const previousConnector = typeof previousAttempt['connectorStrategy'] === 'string' ? previousAttempt['connectorStrategy'] : previousStrategy;
    const strategyChanged = params.strategy !== previousStrategy;
    const connectorChanged = params.connectorResult.connectorKey !== previousConnector;
    if (denialFollowUpLaneContract.retryPolicy.requireDifferentStrategyOnRetry && !strategyChanged && !connectorChanged) {
      throw new Error('SAME_STRATEGY');
    }
  }

  const attemptSummary = {
    attemptNumber: attempts.length + 1,
    attemptRole: params.attemptRole,
    strategy: params.strategy,
    connectorStrategy: params.connectorResult.connectorKey,
    connectorMode: params.connectorResult.mode,
    playbookVersion: params.playbookVersion,
    proposedResolution: params.connectorResult.proposedResolution,
    resolutionReasonCode: params.connectorResult.resolutionReasonCode,
    confidencePct: params.connectorResult.confidencePct,
    nextBestAction: params.connectorResult.nextBestAction,
    submittedAt: params.connectorResult.performedAt,
    connectorTraceId: params.connectorResult.connectorTraceId,
    statusCode: params.connectorResult.statusCode,
    statusLabel: params.connectorResult.statusLabel,
    appealEligible: params.connectorResult.appealEligible,
    appealDeadlineStatus: params.connectorResult.appealDeadlineStatus,
    evidenceTypes: params.connectorResult.evidence.map((item) => item.evidenceType),
  };

  const updatedMetadata = {
    ...metadata,
    playbookVersion: params.playbookVersion,
    lastExecution: attemptSummary,
    lastConnectorRun: {
      connectorKey: params.connectorResult.connectorKey,
      mode: params.connectorResult.mode,
      statusCode: params.connectorResult.statusCode,
      statusLabel: params.connectorResult.statusLabel,
      traceId: params.connectorResult.connectorTraceId,
      summary: params.connectorResult.summary,
      performedAt: params.connectorResult.performedAt,
    },
    attemptHistory: [...attempts, attemptSummary],
  };

  const workerActorType = params.attemptRole === 'primary_worker' ? 'worker_agent' : 'fallback_worker_agent';
  const workerActorRef =
    params.agentId ??
    (params.attemptRole === 'primary_worker' ? 'denial_connector_primary' : 'denial_connector_fallback');

  let nextState = 'awaiting_qa';
  if (params.autoRoute) {
    nextState =
      params.connectorResult.autoQaRecommendation === 'close_auto'
        ? 'closed_auto'
        : params.connectorResult.autoQaRecommendation === 'human_review_required'
          ? 'human_review_required'
          : 'awaiting_qa';
  }

  if (nextState === 'closed_auto') {
    await sql`
      UPDATE rcm_work_items
      SET
        assigned_agent_id = ${params.agentId},
        confidence_pct = ${params.connectorResult.confidencePct},
        status = 'closed_auto',
        requires_human_review = false,
        submitted_at = NOW(),
        completed_at = NOW(),
        metadata = ${jsonb(updatedMetadata)}::jsonb,
        updated_at = NOW()
      WHERE id = ${workItemId}
    `;
    await resolveOpenExceptions(sql, workItemId);
  } else if (nextState === 'human_review_required') {
    const exception = defaultExceptionForDenialConnector(params.connectorResult);
    await upsertOpenException(sql, workItemId, {
      exceptionType: exception.exceptionType,
      severity: exception.severity,
      reasonCode: exception.reasonCode,
      summary: exception.summary,
      payload: {
        requiredContextFields: exception.requiredContextFields,
        recommendedHumanAction: exception.recommendedHumanAction,
        connectorKey: params.connectorResult.connectorKey,
        connectorMode: params.connectorResult.mode,
        appealEligible: params.connectorResult.appealEligible,
        appealDeadlineStatus: params.connectorResult.appealDeadlineStatus,
      },
    });
    await sql`
      UPDATE rcm_work_items
      SET
        assigned_agent_id = ${params.agentId},
        confidence_pct = ${params.connectorResult.confidencePct},
        status = 'human_review_required',
        requires_human_review = true,
        submitted_at = NOW(),
        metadata = ${jsonb(updatedMetadata)}::jsonb,
        updated_at = NOW()
      WHERE id = ${workItemId}
    `;
  } else {
    await sql`
      UPDATE rcm_work_items
      SET
        assigned_agent_id = ${params.agentId},
        confidence_pct = ${params.connectorResult.confidencePct},
        status = 'awaiting_qa',
        requires_human_review = false,
        submitted_at = NOW(),
        metadata = ${jsonb(updatedMetadata)}::jsonb,
        updated_at = NOW()
      WHERE id = ${workItemId}
    `;
  }

  await insertEvidence(
    sql,
    workItemId,
    [
      ...params.connectorResult.evidence.map((item) => ({
        ...item,
        actorType: item.actorType ?? workerActorType,
        actorRef: item.actorRef ?? workerActorRef,
      })),
      {
        actorType: workerActorType,
        actorRef: workerActorRef,
        evidenceType:
          params.attemptRole === 'primary_worker'
            ? 'execution_resolution_proposed'
            : 'fallback_execution_submitted',
        payload: attemptSummary,
      },
    ],
    workerActorType,
    workerActorRef,
  );

  if (params.autoRoute && nextState !== 'awaiting_qa') {
    await insertEvidence(
      sql,
      workItemId,
      [
        {
          actorType: 'qa_agent',
          actorRef: params.qaActorRef,
          evidenceType: 'qa_decision_recorded',
          payload: {
            qaDecision: denialQaDecisionForRecommendation(params.connectorResult.autoQaRecommendation),
            qaReasonCode:
              params.connectorResult.autoQaRecommendation === 'close_auto'
                ? 'connector_policy_auto_close'
                : defaultExceptionForDenialConnector(params.connectorResult).reasonCode,
            source: 'connector_policy_loop',
            reviewedAt: new Date().toISOString(),
          },
        },
      ],
      'qa_agent',
      params.qaActorRef,
    );
  }

  const updated = await getOwnedDenialWorkItem(sql, merchantId, workItemId);
  if (!updated) throw new Error('WORK_ITEM_NOT_FOUND');
  return { nextState, workItem: mapDenialWorkItem(updated) };
}

// ─── Denial follow-up lane — read routes ─────────────────────────────────────

router.get('/lanes/denial-follow-up', authenticateApiKey, (c) =>
  c.json({
    stage: 'live',
    contract: denialFollowUpLaneContract,
    message:
      'Denial follow-up lane: autonomous appeal eligibility checking, denial status inquiry, and appeal submission via X12 276/277 with appeal-intent metadata.',
  }),
);

router.get('/connectors/denial-follow-up', authenticateApiKey, (c) =>
  c.json({
    stage: 'live',
    lane: denialFollowUpLaneContract.laneKey,
    connectors: getDenialFollowUpConnectorAvailability(c.env),
    message:
      'X12 appeal inquiry is the primary autonomous rail. Portal fallback stays human-led until credential vaulting is production-ready.',
  }),
);

router.get('/lanes/denial-follow-up/work-items', authenticateApiKey, async (c) => {
  const merchant = c.get('merchant');
  const sql = createDb(c.env);
  const status = c.req.query('status');
  const workspaceId = c.req.query('workspaceId');
  const limit = parseLimit(c.req.query('limit'), 50, 200);

  if (workspaceId && !isUuid(workspaceId)) {
    sql.end().catch(() => {});
    return validationResponse(c, ['"workspaceId" must be a valid UUID']);
  }

  try {
    const rows = await sql<WorkItemRow[]>`
      SELECT
        w.id,
        w.workspace_id          AS "workspaceId",
        ws.name                 AS "workspaceName",
        w.assigned_agent_id     AS "assignedAgentId",
        w.work_type             AS "workType",
        w.form_type             AS "formType",
        w.title,
        w.payer_name            AS "payerName",
        w.coverage_type         AS "coverageType",
        w.patient_ref           AS "patientRef",
        w.provider_ref          AS "providerRef",
        w.claim_ref             AS "claimRef",
        w.source_system         AS "sourceSystem",
        w.amount_at_risk        AS "amountAtRisk",
        w.confidence_pct        AS "confidencePct",
        w.priority,
        w.status,
        w.requires_human_review AS "requiresHumanReview",
        w.due_at                AS "dueAt",
        w.submitted_at          AS "submittedAt",
        w.completed_at          AS "completedAt",
        w.metadata,
        w.created_at            AS "createdAt",
        w.updated_at            AS "updatedAt"
      FROM rcm_work_items w
      JOIN rcm_workspaces ws ON ws.id = w.workspace_id
      WHERE w.merchant_id = ${merchant.id}
        AND w.work_type = ${denialFollowUpLaneContract.laneKey}
        AND (${status ?? null}::text IS NULL OR w.status = ${status ?? null})
        AND (${workspaceId ?? null}::uuid IS NULL OR w.workspace_id = ${workspaceId ?? null})
      ORDER BY
        CASE w.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'normal' THEN 3 ELSE 4 END,
        w.created_at DESC
      LIMIT ${limit}
    `;
    return c.json({ stage: 'live', lane: denialFollowUpLaneContract.laneKey, count: rows.length, items: rows.map(mapDenialWorkItem) });
  } catch (err: unknown) {
    console.error('[rcm] denial-follow-up work-items error:', err instanceof Error ? err.message : err);
    return c.json({ error: 'Failed to fetch denial-follow-up work items' }, 500);
  } finally {
    sql.end().catch(() => {});
  }
});

router.get('/queues/denial-follow-up-exceptions', authenticateApiKey, async (c) => {
  const merchant = c.get('merchant');
  const sql = createDb(c.env);
  const severity = c.req.query('severity');
  const limit = parseLimit(c.req.query('limit'), 50, 200);

  try {
    const rows = await sql<ExceptionQueueRow[]>`
      SELECT
        e.id,
        e.work_item_id          AS "workItemId",
        ws.name                 AS "workspaceName",
        w.payer_name            AS "payerName",
        w.claim_ref             AS "claimRef",
        w.priority,
        e.exception_type        AS "exceptionType",
        e.severity,
        e.reason_code           AS "reasonCode",
        e.summary,
        w.confidence_pct        AS "confidencePct",
        w.amount_at_risk        AS "amountAtRisk",
        e.payload,
        e.created_at            AS "openedAt"
      FROM rcm_exceptions e
      JOIN rcm_work_items w ON w.id = e.work_item_id
      JOIN rcm_workspaces ws ON ws.id = w.workspace_id
      WHERE w.merchant_id = ${merchant.id}
        AND w.work_type = ${denialFollowUpLaneContract.laneKey}
        AND e.resolved_at IS NULL
        AND (${severity ?? null}::text IS NULL OR e.severity = ${severity ?? null})
      ORDER BY
        CASE e.severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'normal' THEN 3 ELSE 4 END,
        e.created_at ASC
      LIMIT ${limit}
    `;
    return c.json({ stage: 'live', queueKey: denialFollowUpLaneContract.exceptionInbox.queueKey, count: rows.length, items: rows.map(mapException) });
  } catch (err: unknown) {
    console.error('[rcm] denial-follow-up exception queue error:', err instanceof Error ? err.message : err);
    return c.json({ error: 'Failed to fetch denial-follow-up exception queue' }, 500);
  } finally {
    sql.end().catch(() => {});
  }
});

// ─── Denial follow-up lane — intake ──────────────────────────────────────────

router.post('/lanes/denial-follow-up/intake', authenticateApiKey, async (c) => {
  const merchant = c.get('merchant');
  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const metadata = asObject(body['metadata']);
  const details: string[] = [];

  const workspaceId = typeof body['workspaceId'] === 'string' ? body['workspaceId'] : '';
  const title = typeof body['title'] === 'string' ? body['title'].trim() : '';
  const workType = typeof body['workType'] === 'string' ? body['workType'] : '';
  const billingDomain = typeof body['billingDomain'] === 'string' ? body['billingDomain'] : '';
  const formType = typeof body['formType'] === 'string' ? body['formType'] : '';
  const payerName = typeof body['payerName'] === 'string' ? body['payerName'].trim() : '';
  const coverageType = typeof body['coverageType'] === 'string' ? body['coverageType'].trim() : '';
  const patientRef = typeof body['patientRef'] === 'string' ? body['patientRef'].trim() : '';
  const providerRef = typeof body['providerRef'] === 'string' ? body['providerRef'].trim() : '';
  const encounterRef = typeof body['encounterRef'] === 'string' ? body['encounterRef'].trim() : null;
  const claimRef = typeof body['claimRef'] === 'string' ? body['claimRef'].trim() : '';
  const sourceSystem = typeof body['sourceSystem'] === 'string' ? body['sourceSystem'].trim() : '';
  const priority = normalizePriority(body['priority']);
  const dueAt = parseDateString(body['dueAt']);
  const amountAtRisk = parsePositiveAmount(body['amountAtRisk']);

  // Denial-specific metadata
  const denialReasonCode = typeof metadata['denialReasonCode'] === 'string' ? metadata['denialReasonCode'].trim() : '';
  const denialDate = parseDateString(metadata['denialDate']);
  const appealDeadline = parseDateString(metadata['appealDeadline']);

  if (!workspaceId || !isUuid(workspaceId)) details.push('"workspaceId" must be a valid UUID');
  if (!title) details.push('"title" is required');
  if (workType !== denialFollowUpLaneContract.laneKey) {
    details.push(`"workType" must be "${denialFollowUpLaneContract.laneKey}"`);
  }
  if (!denialFollowUpLaneContract.supportedDomains.includes(billingDomain)) {
    details.push(`"billingDomain" must be one of: ${denialFollowUpLaneContract.supportedDomains.join(', ')}`);
  }
  if (!denialFollowUpLaneContract.supportedForms.includes(formType)) {
    details.push(`"formType" must be one of: ${denialFollowUpLaneContract.supportedForms.join(', ')}`);
  }
  if (!payerName) details.push('"payerName" is required');
  if (!coverageType) details.push('"coverageType" is required');
  if (!patientRef) details.push('"patientRef" is required');
  if (!providerRef) details.push('"providerRef" is required');
  if (!claimRef) details.push('"claimRef" is required');
  if (!sourceSystem) details.push('"sourceSystem" is required');
  if (!dueAt) details.push('"dueAt" must be a valid ISO date');
  if (!amountAtRisk) details.push('"amountAtRisk" must be a positive number');
  if (!denialReasonCode) details.push('"metadata.denialReasonCode" is required');
  if (!denialDate) details.push('"metadata.denialDate" must be a valid ISO date');
  if (!appealDeadline) details.push('"metadata.appealDeadline" must be a valid ISO date');

  if (details.length > 0) return validationResponse(c, details);

  const workItemId = crypto.randomUUID();
  const sql = createDb(c.env);

  try {
    const result = await sql.begin(async (tx: any) => {
      const workspace = await getOwnedWorkspace(tx, merchant.id, workspaceId);
      if (!workspace) throw new Error('WORKSPACE_NOT_FOUND');

      const workItemMetadata = {
        ...metadata,
        laneKey: denialFollowUpLaneContract.laneKey,
        contractVersion: denialFollowUpLaneContract.version,
        playbookVersion:
          typeof metadata['playbookVersion'] === 'string' ? metadata['playbookVersion'] : 'denial_follow_up_v1',
        autoExecuteAllowed: metadata['autoExecuteAllowed'] !== false,
        denialReasonCode,
        denialDate,
        appealDeadline,
        appealLevel: typeof metadata['appealLevel'] === 'string' ? metadata['appealLevel'] : 'first',
        connectorPlan: { primary: 'x12_appeal_inquiry', fallback: ['portal'] },
        routing: {
          laneSelection: denialFollowUpLaneContract.laneKey,
          priorityBand: priority,
          routingReason: 'structured_denial_follow_up_lane',
        },
        attemptHistory: [],
      };

      await tx`
        INSERT INTO rcm_work_items (
          id, workspace_id, merchant_id, work_type, billing_domain, form_type, title,
          payer_name, coverage_type, patient_ref, provider_ref, encounter_ref, claim_ref,
          source_system, amount_at_risk, priority, status, requires_human_review, due_at,
          metadata, created_at, updated_at
        )
        VALUES (
          ${workItemId}, ${workspaceId}, ${merchant.id}, ${denialFollowUpLaneContract.laneKey},
          ${billingDomain}, ${formType}, ${title}, ${payerName}, ${coverageType},
          ${patientRef}, ${providerRef}, ${encounterRef}, ${claimRef},
          ${sourceSystem}, ${amountAtRisk}, ${priority}, 'routed', false, ${dueAt},
          ${jsonb(workItemMetadata)}::jsonb, NOW(), NOW()
        )
      `;

      await insertEvidence(
        tx,
        workItemId,
        [
          {
            actorType: 'router_agent',
            actorRef: 'denial_follow_up_lane_router',
            evidenceType: 'router_decision_recorded',
            payload: {
              laneSelection: denialFollowUpLaneContract.laneKey,
              denialReasonCode,
              denialDate,
              appealDeadline,
              routingReason: 'structured_denial_follow_up_lane',
              autoExecuteAllowed: workItemMetadata.autoExecuteAllowed,
            },
          },
        ],
        'router_agent',
        'denial_follow_up_lane_router',
      );

      const inserted = await getOwnedDenialWorkItem(tx, merchant.id, workItemId);
      if (!inserted) throw new Error('WORK_ITEM_NOT_FOUND');
      return { workItem: mapDenialWorkItem(inserted) };
    });

    return c.json({ stage: 'live', lane: denialFollowUpLaneContract.laneKey, status: 'routed', workItemId, workItem: result.workItem }, 201);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === 'WORKSPACE_NOT_FOUND') return c.json({ error: 'Workspace not found' }, 404);
    console.error('[rcm] denial-follow-up intake error:', message);
    return c.json({ error: 'Failed to create denial-follow-up work item' }, 500);
  } finally {
    sql.end().catch(() => {});
  }
});

// ─── Denial follow-up lane — run-primary ─────────────────────────────────────

router.post('/lanes/denial-follow-up/work-items/:workItemId/run-primary', authenticateApiKey, async (c) => {
  const merchant = c.get('merchant');
  const workItemId = c.req.param('workItemId') ?? '';
  if (!isUuid(workItemId)) return validationResponse(c, ['"workItemId" must be a valid UUID']);

  let body: Record<string, unknown>;
  try { body = await c.req.json(); } catch { body = {}; }

  const connectorKey = (body['connectorKey'] as DenialFollowUpConnectorKey | undefined) ?? 'x12_appeal_inquiry';
  const playbookVersion = (typeof body['playbookVersion'] === 'string' ? body['playbookVersion'] : 'denial_follow_up_v1');
  const strategy = (typeof body['strategy'] === 'string' ? body['strategy'] : connectorKey);
  const autoRoute = body['autoRoute'] !== false;
  const agentId = (typeof body['agentId'] === 'string' ? body['agentId'] : null);
  const qaActorRef = (typeof body['qaActorRef'] === 'string' ? body['qaActorRef'] : 'denial_follow_up_policy_loop');

  const details: string[] = [];
  if (!['x12_appeal_inquiry', 'portal'].includes(connectorKey)) {
    details.push('"connectorKey" must be "x12_appeal_inquiry" for primary execution');
  }
  if (agentId && !isUuid(agentId)) details.push('"agentId" must be a valid UUID');
  if (details.length > 0) return validationResponse(c, details);

  const sql = createDb(c.env);
  try {
    const row = await getOwnedDenialWorkItem(sql, merchant.id, workItemId);
    if (!row) return c.json({ error: 'Work item not found' }, 404);
    if (row.status !== 'routed') {
      return c.json({ error: 'Denial follow-up work item must be in "routed" before autonomous run' }, 409);
    }

    const connectorResult = await runDenialFollowUpConnector(c.env, connectorKey, denialFollowUpConnectorInputFromWorkItem(row));

    const persisted = await sql.begin(async (tx: any) =>
      persistDenialConnectorRun(tx, merchant.id, workItemId, {
        attemptRole: 'primary_worker',
        agentId,
        qaActorRef,
        playbookVersion,
        strategy,
        connectorResult,
        autoRoute,
      }),
    );

    return c.json({
      stage: 'live',
      autoRoute,
      nextState: persisted.nextState,
      connector: {
        key: connectorResult.connectorKey,
        mode: connectorResult.mode,
        statusCode: connectorResult.statusCode,
        statusLabel: connectorResult.statusLabel,
        appealEligible: connectorResult.appealEligible,
        appealDeadlineStatus: connectorResult.appealDeadlineStatus,
        traceId: connectorResult.connectorTraceId,
        summary: connectorResult.summary,
      },
      workItem: persisted.workItem,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === 'WORK_ITEM_NOT_FOUND') return c.json({ error: 'Work item not found' }, 404);
    if (message === 'INVALID_STATE') return c.json({ error: 'Denial follow-up work item must be in "routed" before autonomous run' }, 409);
    if (message === 'ATTEMPTS_EXHAUSTED') return c.json({ error: 'Autonomous attempt limit reached' }, 409);
    console.error('[rcm] denial-follow-up run-primary error:', message);
    return c.json({ error: 'Failed to run primary denial follow-up connector' }, 500);
  } finally {
    sql.end().catch(() => {});
  }
});

// ─── Denial follow-up lane — execute ─────────────────────────────────────────

router.post('/lanes/denial-follow-up/work-items/:workItemId/execute', authenticateApiKey, async (c) => {
  const merchant = c.get('merchant');
  const workItemId = c.req.param('workItemId') ?? '';
  if (!isUuid(workItemId)) return validationResponse(c, ['"workItemId" must be a valid UUID']);

  let body: Record<string, unknown>;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON body' }, 400); }

  const details: string[] = [];
  const proposedResolution = typeof body['proposedResolution'] === 'string' ? body['proposedResolution'].trim() : '';
  const resolutionReasonCode = typeof body['resolutionReasonCode'] === 'string' ? body['resolutionReasonCode'].trim() : '';
  const confidencePct = parseConfidence(body['confidencePct']);
  const evidence = Array.isArray(body['evidence']) ? body['evidence'] : [];
  const agentId = typeof body['agentId'] === 'string' ? body['agentId'] : null;
  const playbookVersion = typeof body['playbookVersion'] === 'string' ? body['playbookVersion'] : 'denial_follow_up_v1';
  const connectorStrategy = typeof body['connectorStrategy'] === 'string' ? body['connectorStrategy'] : 'x12_appeal_inquiry';

  if (!proposedResolution) details.push('"proposedResolution" is required');
  if (!resolutionReasonCode) details.push('"resolutionReasonCode" is required');
  if (confidencePct === null) details.push('"confidencePct" must be a number 0-100');
  if (evidence.length === 0) details.push('"evidence" must contain at least one item');
  if (agentId && !isUuid(agentId)) details.push('"agentId" must be a valid UUID');
  if (details.length > 0) return validationResponse(c, details);

  const sql = createDb(c.env);
  try {
    const row = await getOwnedDenialWorkItem(sql, merchant.id, workItemId);
    if (!row) return c.json({ error: 'Work item not found' }, 404);
    if (row.status !== 'routed') return c.json({ error: 'Denial follow-up work item must be in "routed" to execute' }, 409);

    const metadata = parseJsonb<JsonRecord>(row.metadata, {});
    const attempts = getAttemptHistory(metadata);
    if (attempts.length >= denialFollowUpLaneContract.retryPolicy.maxAutonomousAttempts) {
      return c.json({ error: 'Autonomous attempt limit reached' }, 409);
    }

    const attempt = {
      attemptNumber: attempts.length + 1,
      attemptRole: 'primary_worker',
      playbookVersion,
      connectorStrategy,
      proposedResolution,
      resolutionReasonCode,
      confidencePct,
      submittedAt: new Date().toISOString(),
    };
    const updatedMetadata = { ...metadata, lastExecution: attempt, attemptHistory: [...attempts, attempt] };

    await sql`
      UPDATE rcm_work_items
      SET
        assigned_agent_id = ${agentId},
        confidence_pct = ${confidencePct},
        status = 'awaiting_qa',
        requires_human_review = false,
        submitted_at = NOW(),
        metadata = ${jsonb(updatedMetadata)}::jsonb,
        updated_at = NOW()
      WHERE id = ${workItemId}
    `;

    await insertEvidence(sql, workItemId, [
      ...evidence.map((item: unknown) => {
        const base = typeof item === 'object' && item ? item as Record<string, unknown> : {};
        return {
          actorType: typeof base['actorType'] === 'string' ? base['actorType'] : 'worker_agent',
          actorRef: typeof base['actorRef'] === 'string' ? base['actorRef'] : (agentId ?? 'denial_follow_up_worker'),
          evidenceType: typeof base['evidenceType'] === 'string' ? base['evidenceType'] : 'supporting_evidence',
          payload: typeof base['payload'] === 'object' ? (base['payload'] as Record<string, unknown>) : base,
        };
      }),
      { actorType: 'worker_agent', actorRef: agentId ?? 'denial_follow_up_worker', evidenceType: 'execution_resolution_proposed', payload: attempt },
    ], 'worker_agent', agentId ?? 'denial_follow_up_worker');

    const updated = await getOwnedDenialWorkItem(sql, merchant.id, workItemId);
    return c.json({ stage: 'live', status: 'awaiting_qa', nextAction: 'qa_verify', workItem: mapDenialWorkItem(updated!) });
  } catch (err: unknown) {
    console.error('[rcm] denial-follow-up execute error:', err instanceof Error ? err.message : err);
    return c.json({ error: 'Failed to execute denial follow-up work item' }, 500);
  } finally {
    sql.end().catch(() => {});
  }
});

// ─── Denial follow-up lane — verify ──────────────────────────────────────────

router.post('/lanes/denial-follow-up/work-items/:workItemId/verify', authenticateApiKey, async (c) => {
  const merchant = c.get('merchant');
  const workItemId = c.req.param('workItemId') ?? '';
  if (!isUuid(workItemId)) return validationResponse(c, ['"workItemId" must be a valid UUID']);

  let body: Record<string, unknown>;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON body' }, 400); }

  const details: string[] = [];
  const qaDecision = typeof body['qaDecision'] === 'string' ? body['qaDecision'] : '';
  const qaReasonCode = typeof body['qaReasonCode'] === 'string' ? body['qaReasonCode'].trim() : '';
  const agentId = typeof body['agentId'] === 'string' ? body['agentId'] : null;
  const validDecisions = ['approve_auto_close', 'retry_with_next_worker', 'escalate'];

  if (!validDecisions.includes(qaDecision)) details.push(`"qaDecision" must be one of: ${validDecisions.join(', ')}`);
  if (!qaReasonCode) details.push('"qaReasonCode" is required');
  if (agentId && !isUuid(agentId)) details.push('"agentId" must be a valid UUID');
  if (details.length > 0) return validationResponse(c, details);

  const sql = createDb(c.env);
  try {
    const row = await getOwnedDenialWorkItem(sql, merchant.id, workItemId);
    if (!row) return c.json({ error: 'Work item not found' }, 404);
    if (row.status !== 'awaiting_qa') return c.json({ error: 'Work item must be in "awaiting_qa" to verify' }, 409);

    const metadata = parseJsonb<JsonRecord>(row.metadata, {});
    const qaPayload = { qaDecision, qaReasonCode, source: 'manual', reviewedAt: new Date().toISOString() };
    const nextMetadata = { ...metadata, lastQaDecision: qaPayload };

    if (qaDecision === 'approve_auto_close') {
      await sql`
        UPDATE rcm_work_items SET status = 'closed_auto', requires_human_review = false, completed_at = NOW(), metadata = ${jsonb(nextMetadata)}::jsonb, updated_at = NOW()
        WHERE id = ${workItemId} AND status = 'awaiting_qa'
      `;
      await resolveOpenExceptions(sql, workItemId);
    } else if (qaDecision === 'retry_with_next_worker') {
      await sql`
        UPDATE rcm_work_items SET status = 'retry_pending', metadata = ${jsonb(nextMetadata)}::jsonb, updated_at = NOW()
        WHERE id = ${workItemId} AND status = 'awaiting_qa'
      `;
    } else {
      const exceptionType = typeof body['exceptionType'] === 'string' ? body['exceptionType'] : 'denial_upheld_requires_review';
      const summary = typeof body['summary'] === 'string' ? body['summary'] : 'QA escalated denial case for human review.';
      await upsertOpenException(sql, workItemId, {
        exceptionType, severity: typeof body['severity'] === 'string' ? body['severity'] : 'high',
        reasonCode: qaReasonCode, summary,
        payload: { qaDecision, qaReasonCode, recommendedHumanAction: typeof body['recommendedHumanAction'] === 'string' ? body['recommendedHumanAction'] : null },
      });
      await sql`
        UPDATE rcm_work_items SET status = 'human_review_required', requires_human_review = true, metadata = ${jsonb(nextMetadata)}::jsonb, updated_at = NOW()
        WHERE id = ${workItemId} AND status = 'awaiting_qa'
      `;
    }

    await insertEvidence(sql, workItemId, [{ actorType: 'qa_agent', actorRef: agentId ?? 'denial_qa_agent', evidenceType: 'qa_decision_recorded', payload: qaPayload }], 'qa_agent', agentId ?? 'denial_qa_agent');
    const updated = await getOwnedDenialWorkItem(sql, merchant.id, workItemId);
    return c.json({ stage: 'live', qaDecision, workItem: mapDenialWorkItem(updated!) });
  } catch (err: unknown) {
    console.error('[rcm] denial-follow-up verify error:', err instanceof Error ? err.message : err);
    return c.json({ error: 'Failed to verify denial follow-up work item' }, 500);
  } finally {
    sql.end().catch(() => {});
  }
});

// ─── Denial follow-up lane — retry ───────────────────────────────────────────

router.post('/lanes/denial-follow-up/work-items/:workItemId/retry', authenticateApiKey, async (c) => {
  const merchant = c.get('merchant');
  const workItemId = c.req.param('workItemId') ?? '';
  if (!isUuid(workItemId)) return validationResponse(c, ['"workItemId" must be a valid UUID']);

  let body: Record<string, unknown>;
  try { body = await c.req.json(); } catch { body = {}; }

  const connectorKey = (body['connectorKey'] as DenialFollowUpConnectorKey | undefined) ?? 'x12_appeal_inquiry';
  const playbookVersion = typeof body['playbookVersion'] === 'string' ? body['playbookVersion'] : 'denial_follow_up_v1';
  const strategy = typeof body['strategy'] === 'string' ? body['strategy'] : connectorKey;
  const autoRoute = body['autoRoute'] !== false;
  const agentId = typeof body['agentId'] === 'string' ? body['agentId'] : null;

  const sql = createDb(c.env);
  try {
    const row = await getOwnedDenialWorkItem(sql, merchant.id, workItemId);
    if (!row) return c.json({ error: 'Work item not found' }, 404);
    if (row.status !== 'retry_pending') return c.json({ error: 'Work item must be in "retry_pending" to retry' }, 409);

    const connectorResult = await runDenialFollowUpConnector(c.env, connectorKey, denialFollowUpConnectorInputFromWorkItem(row));

    const persisted = await sql.begin(async (tx: any) =>
      persistDenialConnectorRun(tx, merchant.id, workItemId, {
        attemptRole: 'fallback_worker',
        agentId,
        qaActorRef: 'denial_follow_up_policy_loop',
        playbookVersion,
        strategy,
        connectorResult,
        autoRoute,
      }),
    );

    return c.json({ stage: 'live', autoRoute, nextState: persisted.nextState, connector: { key: connectorResult.connectorKey, mode: connectorResult.mode, statusCode: connectorResult.statusCode, appealEligible: connectorResult.appealEligible }, workItem: persisted.workItem });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === 'WORK_ITEM_NOT_FOUND') return c.json({ error: 'Work item not found' }, 404);
    if (message === 'INVALID_STATE') return c.json({ error: 'Work item must be in "retry_pending" to retry' }, 409);
    if (message === 'ATTEMPTS_EXHAUSTED') return c.json({ error: 'Autonomous attempt limit reached' }, 409);
    if (message === 'SAME_STRATEGY') return c.json({ error: 'Retry must use a different connector strategy' }, 409);
    console.error('[rcm] denial-follow-up retry error:', message);
    return c.json({ error: 'Failed to retry denial follow-up work item' }, 500);
  } finally {
    sql.end().catch(() => {});
  }
});

// ─── Denial follow-up lane — escalate / resolve ───────────────────────────────

router.post('/lanes/denial-follow-up/work-items/:workItemId/escalate', authenticateApiKey, async (c) => {
  const merchant = c.get('merchant');
  const workItemId = c.req.param('workItemId') ?? '';
  if (!isUuid(workItemId)) return validationResponse(c, ['"workItemId" must be a valid UUID']);

  let body: Record<string, unknown>;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON body' }, 400); }

  const exceptionType = typeof body['exceptionType'] === 'string' ? body['exceptionType'] : 'denial_upheld_requires_review';
  const severity = typeof body['severity'] === 'string' ? body['severity'] : 'high';
  const summary = typeof body['summary'] === 'string' ? body['summary'].trim() : '';
  const recommendedHumanAction = typeof body['recommendedHumanAction'] === 'string' ? body['recommendedHumanAction'] : '';
  const reasonCode = typeof body['reasonCode'] === 'string' ? body['reasonCode'] : 'manual_escalation';

  if (!summary) return validationResponse(c, ['"summary" is required']);

  const sql = createDb(c.env);
  try {
    const row = await getOwnedDenialWorkItem(sql, merchant.id, workItemId);
    if (!row) return c.json({ error: 'Work item not found' }, 404);
    if (['closed_auto', 'closed_human', 'rejected', 'blocked'].includes(row.status)) {
      return c.json({ error: 'Cannot escalate a terminal work item' }, 409);
    }

    await upsertOpenException(sql, workItemId, { exceptionType, severity, reasonCode, summary, payload: { recommendedHumanAction } });
    await sql`
      UPDATE rcm_work_items SET status = 'human_review_required', requires_human_review = true, updated_at = NOW()
      WHERE id = ${workItemId}
    `;
    await insertEvidence(sql, workItemId, [{ actorType: 'escalation_agent', actorRef: 'denial_escalation', evidenceType: 'qa_decision_recorded', payload: { qaDecision: 'escalate', reasonCode, summary } }], 'escalation_agent', 'denial_escalation');

    const updated = await getOwnedDenialWorkItem(sql, merchant.id, workItemId);
    return c.json({ stage: 'live', status: 'human_review_required', workItem: mapDenialWorkItem(updated!) });
  } catch (err: unknown) {
    console.error('[rcm] denial-follow-up escalate error:', err instanceof Error ? err.message : err);
    return c.json({ error: 'Failed to escalate denial follow-up work item' }, 500);
  } finally {
    sql.end().catch(() => {});
  }
});

router.post('/lanes/denial-follow-up/work-items/:workItemId/resolve', authenticateApiKey, async (c) => {
  const merchant = c.get('merchant');
  const workItemId = c.req.param('workItemId') ?? '';
  if (!isUuid(workItemId)) return validationResponse(c, ['"workItemId" must be a valid UUID']);

  let body: Record<string, unknown>;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON body' }, 400); }

  const resolution = typeof body['resolution'] === 'string' ? body['resolution'] : '';
  const notes = typeof body['notes'] === 'string' ? body['notes'] : '';
  if (!resolution) return validationResponse(c, ['"resolution" is required (approve_closure | reject_closure | mark_blocked)']);

  const sql = createDb(c.env);
  try {
    const row = await getOwnedDenialWorkItem(sql, merchant.id, workItemId);
    if (!row) return c.json({ error: 'Work item not found' }, 404);
    if (row.status !== 'human_review_required') return c.json({ error: 'Work item must be in "human_review_required" to resolve' }, 409);

    let newStatus = 'closed_human';
    if (resolution === 'reject_closure') newStatus = 'rejected';
    else if (resolution === 'mark_blocked') newStatus = 'blocked';

    const metadata = parseJsonb<JsonRecord>(row.metadata, {});
    const updatedMetadata = { ...metadata, humanResolution: { resolution, notes, resolvedAt: new Date().toISOString() } };
    await sql`
      UPDATE rcm_work_items SET status = ${newStatus}, requires_human_review = false, completed_at = NOW(), metadata = ${jsonb(updatedMetadata)}::jsonb, updated_at = NOW()
      WHERE id = ${workItemId}
    `;
    if (newStatus === 'closed_human') await resolveOpenExceptions(sql, workItemId);

    await insertEvidence(sql, workItemId, [{ actorType: 'human_reviewer', actorRef: 'denial_human_resolver', evidenceType: 'human_resolution_recorded', payload: { resolution, notes } }], 'human_reviewer', 'denial_human_resolver');
    const updated = await getOwnedDenialWorkItem(sql, merchant.id, workItemId);
    return c.json({ stage: 'live', status: newStatus, workItem: mapDenialWorkItem(updated!) });
  } catch (err: unknown) {
    console.error('[rcm] denial-follow-up resolve error:', err instanceof Error ? err.message : err);
    return c.json({ error: 'Failed to resolve denial follow-up work item' }, 500);
  } finally {
    sql.end().catch(() => {});
  }
});

// ─── Prior auth follow-up lane — helpers ─────────────────────────────────────

async function getOwnedPriorAuthWorkItem(sql: Sql, merchantId: string, workItemId: string) {
  const rows = await sql<WorkItemRow[]>`
    SELECT
      w.id, w.workspace_id AS "workspaceId", ws.name AS "workspaceName",
      w.assigned_agent_id AS "assignedAgentId", w.work_type AS "workType",
      w.form_type AS "formType", w.title, w.payer_name AS "payerName",
      w.coverage_type AS "coverageType", w.patient_ref AS "patientRef",
      w.provider_ref AS "providerRef", w.claim_ref AS "claimRef",
      w.source_system AS "sourceSystem", w.amount_at_risk AS "amountAtRisk",
      w.confidence_pct AS "confidencePct", w.priority, w.status,
      w.requires_human_review AS "requiresHumanReview", w.due_at AS "dueAt",
      w.submitted_at AS "submittedAt", w.completed_at AS "completedAt",
      w.metadata, w.created_at AS "createdAt", w.updated_at AS "updatedAt"
    FROM rcm_work_items w
    JOIN rcm_workspaces ws ON ws.id = w.workspace_id
    WHERE w.id = ${workItemId} AND w.merchant_id = ${merchantId}
      AND w.work_type = ${PRIOR_AUTH_LANE_KEY}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

async function getOwnedPriorAuthWorkItemForUpdate(sql: Sql, merchantId: string, workItemId: string) {
  const rows = await sql<WorkItemRow[]>`
    SELECT
      w.id, w.workspace_id AS "workspaceId", ws.name AS "workspaceName",
      w.assigned_agent_id AS "assignedAgentId", w.work_type AS "workType",
      w.form_type AS "formType", w.title, w.payer_name AS "payerName",
      w.coverage_type AS "coverageType", w.patient_ref AS "patientRef",
      w.provider_ref AS "providerRef", w.claim_ref AS "claimRef",
      w.source_system AS "sourceSystem", w.amount_at_risk AS "amountAtRisk",
      w.confidence_pct AS "confidencePct", w.priority, w.status,
      w.requires_human_review AS "requiresHumanReview", w.due_at AS "dueAt",
      w.submitted_at AS "submittedAt", w.completed_at AS "completedAt",
      w.metadata, w.created_at AS "createdAt", w.updated_at AS "updatedAt"
    FROM rcm_work_items w
    JOIN rcm_workspaces ws ON ws.id = w.workspace_id
    WHERE w.id = ${workItemId} AND w.merchant_id = ${merchantId}
      AND w.work_type = ${PRIOR_AUTH_LANE_KEY}
    LIMIT 1 FOR UPDATE
  `;
  return rows[0] ?? null;
}

function mapPriorAuthWorkItem(row: WorkItemRow) {
  const base = mapWorkItem(row);
  const metadata = parseJsonb<JsonRecord>(row.metadata, {});
  return {
    ...base,
    procedureCode: typeof metadata['procedureCode'] === 'string' ? metadata['procedureCode'] : null,
    diagnosisCode: typeof metadata['diagnosisCode'] === 'string' ? metadata['diagnosisCode'] : null,
    serviceStartDate: typeof metadata['serviceStartDate'] === 'string' ? metadata['serviceStartDate'] : null,
    serviceEndDate: typeof metadata['serviceEndDate'] === 'string' ? metadata['serviceEndDate'] : null,
    authRef: typeof metadata['authRef'] === 'string' ? metadata['authRef'] : null,
    urgencyFlag: metadata['urgencyFlag'] === true,
  };
}

function priorAuthConnectorInputFromWorkItem(row: WorkItemRow): PriorAuthConnectorExecutionInput {
  const metadata = parseJsonb<JsonRecord>(row.metadata, {});
  return {
    workItemId: row.id,
    claimRef: row.claimRef ?? '',
    payerName: row.payerName ?? '',
    payerId: typeof metadata['payerId'] === 'string' ? metadata['payerId'] : null,
    patientRef: row.patientRef ?? '',
    providerRef: row.providerRef ?? '',
    npi: typeof metadata['npi'] === 'string' ? metadata['npi'] : null,
    procedureCode: typeof metadata['procedureCode'] === 'string' ? metadata['procedureCode'] : '',
    diagnosisCode: typeof metadata['diagnosisCode'] === 'string' ? metadata['diagnosisCode'] : '',
    serviceStartDate: typeof metadata['serviceStartDate'] === 'string' ? metadata['serviceStartDate'] : '',
    serviceEndDate: typeof metadata['serviceEndDate'] === 'string' ? metadata['serviceEndDate'] : null,
    placeOfService: typeof metadata['placeOfService'] === 'string' ? metadata['placeOfService'] : '11',
    authRef: typeof metadata['authRef'] === 'string' ? metadata['authRef'] : null,
    urgencyFlag: metadata['urgencyFlag'] === true,
    formType: row.formType ?? '',
    sourceSystem: row.sourceSystem ?? '',
    metadata,
  };
}

// ─── Prior auth follow-up lane — routes ──────────────────────────────────────

router.get('/lanes/prior-auth-follow-up', authenticateApiKey, (c) =>
  c.json({
    stage: 'live',
    contract: priorAuthLaneContract,
    message: 'Prior auth follow-up lane: autonomous X12 278 prior authorization inquiry, approval status, denial detection, and human escalation.',
  }),
);

router.get('/connectors/prior-auth-follow-up', authenticateApiKey, (c) =>
  c.json({
    stage: 'live',
    lane: priorAuthLaneContract.laneKey,
    connectors: getPriorAuthConnectorAvailability(c.env),
    message: 'X12 278 is the primary autonomous rail. Portal submission stays human-led until credential vaulting is production-ready.',
  }),
);

router.get('/lanes/prior-auth-follow-up/work-items', authenticateApiKey, async (c) => {
  const merchant = c.get('merchant');
  const sql = createDb(c.env);
  const status = c.req.query('status');
  const workspaceId = c.req.query('workspaceId');
  const limit = parseLimit(c.req.query('limit'), 50, 200);
  if (workspaceId && !isUuid(workspaceId)) { sql.end().catch(() => {}); return validationResponse(c, ['"workspaceId" must be a valid UUID']); }
  try {
    const rows = await sql<WorkItemRow[]>`
      SELECT w.id, w.workspace_id AS "workspaceId", ws.name AS "workspaceName",
        w.assigned_agent_id AS "assignedAgentId", w.work_type AS "workType",
        w.form_type AS "formType", w.title, w.payer_name AS "payerName",
        w.coverage_type AS "coverageType", w.patient_ref AS "patientRef",
        w.provider_ref AS "providerRef", w.claim_ref AS "claimRef",
        w.source_system AS "sourceSystem", w.amount_at_risk AS "amountAtRisk",
        w.confidence_pct AS "confidencePct", w.priority, w.status,
        w.requires_human_review AS "requiresHumanReview", w.due_at AS "dueAt",
        w.submitted_at AS "submittedAt", w.completed_at AS "completedAt",
        w.metadata, w.created_at AS "createdAt", w.updated_at AS "updatedAt"
      FROM rcm_work_items w JOIN rcm_workspaces ws ON ws.id = w.workspace_id
      WHERE w.merchant_id = ${merchant.id} AND w.work_type = ${PRIOR_AUTH_LANE_KEY}
        AND (${status ?? null}::text IS NULL OR w.status = ${status ?? null})
        AND (${workspaceId ?? null}::uuid IS NULL OR w.workspace_id = ${workspaceId ?? null})
      ORDER BY CASE w.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'normal' THEN 3 ELSE 4 END, w.created_at DESC
      LIMIT ${limit}
    `;
    return c.json({ stage: 'live', lane: PRIOR_AUTH_LANE_KEY, count: rows.length, items: rows.map(mapPriorAuthWorkItem) });
  } catch (err: unknown) {
    console.error('[rcm] prior-auth work-items error:', err instanceof Error ? err.message : err);
    return c.json({ error: 'Failed to fetch prior-auth work items' }, 500);
  } finally { sql.end().catch(() => {}); }
});

router.get('/queues/prior-auth-follow-up-exceptions', authenticateApiKey, async (c) => {
  const merchant = c.get('merchant');
  const sql = createDb(c.env);
  const severity = c.req.query('severity');
  const limit = parseLimit(c.req.query('limit'), 50, 200);
  try {
    const rows = await sql<ExceptionQueueRow[]>`
      SELECT e.id, e.work_item_id AS "workItemId", ws.name AS "workspaceName",
        w.payer_name AS "payerName", w.claim_ref AS "claimRef", w.priority,
        e.exception_type AS "exceptionType", e.severity, e.reason_code AS "reasonCode",
        e.summary, w.confidence_pct AS "confidencePct", w.amount_at_risk AS "amountAtRisk",
        e.payload, e.created_at AS "openedAt"
      FROM rcm_exceptions e
      JOIN rcm_work_items w ON w.id = e.work_item_id
      JOIN rcm_workspaces ws ON ws.id = w.workspace_id
      WHERE w.merchant_id = ${merchant.id} AND w.work_type = ${PRIOR_AUTH_LANE_KEY}
        AND e.resolved_at IS NULL
        AND (${severity ?? null}::text IS NULL OR e.severity = ${severity ?? null})
      ORDER BY CASE e.severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'normal' THEN 3 ELSE 4 END, e.created_at ASC
      LIMIT ${limit}
    `;
    return c.json({ stage: 'live', queueKey: priorAuthLaneContract.exceptionInbox.queueKey, count: rows.length, items: rows.map(mapException) });
  } catch (err: unknown) {
    console.error('[rcm] prior-auth exception queue error:', err instanceof Error ? err.message : err);
    return c.json({ error: 'Failed to fetch prior-auth exception queue' }, 500);
  } finally { sql.end().catch(() => {}); }
});

// ─── Prior auth follow-up lane — intake ──────────────────────────────────────

router.post('/lanes/prior-auth-follow-up/intake', authenticateApiKey, async (c) => {
  const merchant = c.get('merchant');
  let body: Record<string, unknown>;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON body' }, 400); }

  const metadata = asObject(body['metadata']);
  const details: string[] = [];

  const workspaceId = typeof body['workspaceId'] === 'string' ? body['workspaceId'] : '';
  const title = typeof body['title'] === 'string' ? body['title'].trim() : '';
  const workType = typeof body['workType'] === 'string' ? body['workType'] : '';
  const billingDomain = typeof body['billingDomain'] === 'string' ? body['billingDomain'] : '';
  const formType = typeof body['formType'] === 'string' ? body['formType'] : '';
  const payerName = typeof body['payerName'] === 'string' ? body['payerName'].trim() : '';
  const coverageType = typeof body['coverageType'] === 'string' ? body['coverageType'].trim() : '';
  const patientRef = typeof body['patientRef'] === 'string' ? body['patientRef'].trim() : '';
  const providerRef = typeof body['providerRef'] === 'string' ? body['providerRef'].trim() : '';
  const claimRef = typeof body['claimRef'] === 'string' ? body['claimRef'].trim() : '';
  const sourceSystem = typeof body['sourceSystem'] === 'string' ? body['sourceSystem'].trim() : '';
  const priority = normalizePriority(body['priority']);
  const dueAt = parseDateString(body['dueAt']);
  const amountAtRisk = parsePositiveAmount(body['amountAtRisk']);
  const procedureCode = typeof metadata['procedureCode'] === 'string' ? metadata['procedureCode'].trim() : '';
  const diagnosisCode = typeof metadata['diagnosisCode'] === 'string' ? metadata['diagnosisCode'].trim() : '';
  const serviceStartDate = parseDateString(metadata['serviceStartDate']);
  const urgencyFlag = metadata['urgencyFlag'] === true;

  if (!workspaceId || !isUuid(workspaceId)) details.push('"workspaceId" must be a valid UUID');
  if (!title) details.push('"title" is required');
  if (workType !== PRIOR_AUTH_LANE_KEY) details.push(`"workType" must be "${PRIOR_AUTH_LANE_KEY}"`);
  if (!priorAuthLaneContract.supportedDomains.includes(billingDomain)) details.push(`"billingDomain" must be one of: ${priorAuthLaneContract.supportedDomains.join(', ')}`);
  if (!priorAuthLaneContract.supportedForms.includes(formType)) details.push(`"formType" must be one of: ${priorAuthLaneContract.supportedForms.join(', ')}`);
  if (!payerName) details.push('"payerName" is required');
  if (!coverageType) details.push('"coverageType" is required');
  if (!patientRef) details.push('"patientRef" is required');
  if (!providerRef) details.push('"providerRef" is required');
  if (!claimRef) details.push('"claimRef" is required');
  if (!sourceSystem) details.push('"sourceSystem" is required');
  if (!dueAt) details.push('"dueAt" must be a valid ISO date');
  if (!amountAtRisk) details.push('"amountAtRisk" must be a positive number');
  if (!procedureCode) details.push('"metadata.procedureCode" is required');
  if (!diagnosisCode) details.push('"metadata.diagnosisCode" is required');
  if (!serviceStartDate) details.push('"metadata.serviceStartDate" must be a valid ISO date');

  if (details.length > 0) return validationResponse(c, details);

  const workItemId = crypto.randomUUID();
  const sql = createDb(c.env);
  try {
    const result = await sql.begin(async (tx: any) => {
      const workspace = await getOwnedWorkspace(tx, merchant.id, workspaceId);
      if (!workspace) throw new Error('WORKSPACE_NOT_FOUND');

      const workItemMetadata = {
        ...metadata,
        laneKey: PRIOR_AUTH_LANE_KEY,
        contractVersion: priorAuthLaneContract.version,
        procedureCode,
        diagnosisCode,
        serviceStartDate,
        serviceEndDate: parseDateString(metadata['serviceEndDate']) ?? null,
        placeOfService: typeof metadata['placeOfService'] === 'string' ? metadata['placeOfService'] : '11',
        authRef: typeof metadata['authRef'] === 'string' ? metadata['authRef'] : null,
        urgencyFlag,
        autoExecuteAllowed: metadata['autoExecuteAllowed'] !== false,
        connectorPlan: { primary: 'x12_278', fallback: ['portal_submission'] },
        routing: { laneSelection: PRIOR_AUTH_LANE_KEY, priorityBand: priority, routingReason: 'structured_prior_auth_follow_up_lane' },
        attemptHistory: [],
      };

      await tx`
        INSERT INTO rcm_work_items (
          id, workspace_id, merchant_id, work_type, billing_domain, form_type, title,
          payer_name, coverage_type, patient_ref, provider_ref, claim_ref,
          source_system, amount_at_risk, priority, status, requires_human_review, due_at,
          metadata, created_at, updated_at
        ) VALUES (
          ${workItemId}, ${workspaceId}, ${merchant.id}, ${PRIOR_AUTH_LANE_KEY},
          ${billingDomain}, ${formType}, ${title}, ${payerName}, ${coverageType},
          ${patientRef}, ${providerRef}, ${claimRef},
          ${sourceSystem}, ${amountAtRisk}, ${priority}, 'routed', ${urgencyFlag}, ${dueAt},
          ${jsonb(workItemMetadata)}::jsonb, NOW(), NOW()
        )
      `;

      await insertEvidence(tx, workItemId, [{
        actorType: 'router_agent', actorRef: 'prior_auth_lane_router',
        evidenceType: 'router_decision_recorded',
        payload: { laneSelection: PRIOR_AUTH_LANE_KEY, procedureCode, diagnosisCode, serviceStartDate, urgencyFlag, routingReason: 'structured_prior_auth_follow_up_lane' },
      }], 'router_agent', 'prior_auth_lane_router');

      const inserted = await getOwnedPriorAuthWorkItem(tx, merchant.id, workItemId);
      if (!inserted) throw new Error('WORK_ITEM_NOT_FOUND');
      return { workItem: mapPriorAuthWorkItem(inserted) };
    });

    return c.json({ stage: 'live', lane: PRIOR_AUTH_LANE_KEY, status: 'routed', workItemId, workItem: result.workItem }, 201);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === 'WORKSPACE_NOT_FOUND') return c.json({ error: 'Workspace not found' }, 404);
    console.error('[rcm] prior-auth intake error:', message);
    return c.json({ error: 'Failed to create prior-auth work item' }, 500);
  } finally { sql.end().catch(() => {}); }
});

// ─── Prior auth follow-up lane — run-primary ─────────────────────────────────

router.post('/lanes/prior-auth-follow-up/work-items/:workItemId/run-primary', authenticateApiKey, async (c) => {
  const merchant = c.get('merchant');
  const workItemId = c.req.param('workItemId') ?? '';
  if (!isUuid(workItemId)) return validationResponse(c, ['"workItemId" must be a valid UUID']);

  let body: Record<string, unknown>;
  try { body = await c.req.json(); } catch { body = {}; }

  const connectorKey = (body['connectorKey'] as PriorAuthConnectorKey | undefined) ?? 'x12_278';
  const autoRoute = body['autoRoute'] !== false;

  const sql = createDb(c.env);
  try {
    const row = await getOwnedPriorAuthWorkItem(sql, merchant.id, workItemId);
    if (!row) return c.json({ error: 'Work item not found' }, 404);
    if (row.status !== 'routed') return c.json({ error: 'Prior auth work item must be in "routed" before autonomous run' }, 409);

    const connectorResult = await runPriorAuthConnector(c.env, connectorKey, priorAuthConnectorInputFromWorkItem(row));

    let newStatus: string;
    if (autoRoute) {
      if (connectorResult.autoQaRecommendation === 'close_auto') newStatus = 'closed_auto';
      else if (connectorResult.autoQaRecommendation === 'human_review_required') newStatus = 'human_review_required';
      else newStatus = 'awaiting_qa';
    } else {
      newStatus = 'awaiting_qa';
    }

    const meta = parseJsonb<JsonRecord>(row.metadata, {});
    const updatedMetadata = { ...meta, lastConnectorRun: { connectorKey: connectorResult.connectorKey, mode: connectorResult.mode, statusCode: connectorResult.statusCode, authDetails: connectorResult.authDetails } };

    await sql`
      UPDATE rcm_work_items SET status = ${newStatus}, confidence_pct = ${connectorResult.confidencePct},
        submitted_at = NOW(), ${newStatus === 'closed_auto' ? sql`completed_at = NOW(),` : sql``}
        metadata = ${jsonb(updatedMetadata)}::jsonb, updated_at = NOW()
      WHERE id = ${workItemId}
    `;
    await insertEvidence(sql, workItemId, connectorResult.evidence.map((e) => ({ ...e, actorType: e.actorType ?? 'worker_agent', actorRef: e.actorRef ?? 'prior_auth_connector' })), 'worker_agent', 'prior_auth_connector');

    const updated = await getOwnedPriorAuthWorkItem(sql, merchant.id, workItemId);
    return c.json({ stage: 'live', autoRoute, nextState: newStatus, connector: { key: connectorResult.connectorKey, mode: connectorResult.mode, statusCode: connectorResult.statusCode, statusLabel: connectorResult.statusLabel, traceId: connectorResult.connectorTraceId, summary: connectorResult.summary }, workItem: mapPriorAuthWorkItem(updated!) });
  } catch (err: unknown) {
    console.error('[rcm] prior-auth run-primary error:', err instanceof Error ? err.message : err);
    return c.json({ error: 'Failed to run primary prior-auth connector' }, 500);
  } finally { sql.end().catch(() => {}); }
});

// ─── Prior auth follow-up lane — execute ─────────────────────────────────────

router.post('/lanes/prior-auth-follow-up/work-items/:workItemId/execute', authenticateApiKey, async (c) => {
  const merchant = c.get('merchant');
  const workItemId = c.req.param('workItemId') ?? '';
  if (!isUuid(workItemId)) return validationResponse(c, ['"workItemId" must be a valid UUID']);

  let body: Record<string, unknown>;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON body' }, 400); }

  const additionalInfo = typeof body['additionalInfo'] === 'string' ? body['additionalInfo'].trim() : '';
  const notes = typeof body['notes'] === 'string' ? body['notes'] : '';
  if (!additionalInfo) return validationResponse(c, ['"additionalInfo" is required']);

  const sql = createDb(c.env);
  try {
    const row = await getOwnedPriorAuthWorkItem(sql, merchant.id, workItemId);
    if (!row) return c.json({ error: 'Work item not found' }, 404);
    if (!['awaiting_qa', 'human_review_required'].includes(row.status)) return c.json({ error: 'Work item must be in "awaiting_qa" or "human_review_required" to submit additional info' }, 409);

    const meta = parseJsonb<JsonRecord>(row.metadata, {});
    const updatedMetadata = { ...meta, additionalInfoSubmitted: { additionalInfo, notes, submittedAt: new Date().toISOString() } };
    await sql`UPDATE rcm_work_items SET metadata = ${jsonb(updatedMetadata)}::jsonb, updated_at = NOW() WHERE id = ${workItemId}`;
    await insertEvidence(sql, workItemId, [{ actorType: 'human_worker', actorRef: 'prior_auth_worker', evidenceType: 'additional_info_submitted', payload: { additionalInfo, notes } }], 'human_worker', 'prior_auth_worker');
    const updated = await getOwnedPriorAuthWorkItem(sql, merchant.id, workItemId);
    return c.json({ stage: 'live', workItem: mapPriorAuthWorkItem(updated!) });
  } catch (err: unknown) {
    console.error('[rcm] prior-auth execute error:', err instanceof Error ? err.message : err);
    return c.json({ error: 'Failed to execute prior-auth work item' }, 500);
  } finally { sql.end().catch(() => {}); }
});

// ─── Prior auth follow-up lane — verify ──────────────────────────────────────

router.post('/lanes/prior-auth-follow-up/work-items/:workItemId/verify', authenticateApiKey, async (c) => {
  const merchant = c.get('merchant');
  const workItemId = c.req.param('workItemId') ?? '';
  if (!isUuid(workItemId)) return validationResponse(c, ['"workItemId" must be a valid UUID']);

  let body: Record<string, unknown>;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON body' }, 400); }

  const decision = typeof body['decision'] === 'string' ? body['decision'] : '';
  const notes = typeof body['notes'] === 'string' ? body['notes'] : '';
  if (!['approve_auto_close', 'retry', 'escalate'].includes(decision)) return validationResponse(c, ['"decision" must be "approve_auto_close", "retry", or "escalate"']);

  const sql = createDb(c.env);
  try {
    const row = await getOwnedPriorAuthWorkItemForUpdate(sql, merchant.id, workItemId);
    if (!row) return c.json({ error: 'Work item not found' }, 404);
    if (row.status !== 'awaiting_qa') return c.json({ error: 'Work item must be in "awaiting_qa" to verify' }, 409);

    let newStatus: string;
    if (decision === 'approve_auto_close') newStatus = 'closed_auto';
    else if (decision === 'retry') newStatus = 'retry_pending';
    else newStatus = 'human_review_required';

    await sql`
      UPDATE rcm_work_items SET status = ${newStatus},
        ${newStatus === 'closed_auto' ? sql`completed_at = NOW(),` : sql``}
        requires_human_review = ${newStatus === 'human_review_required'},
        updated_at = NOW()
      WHERE id = ${workItemId}
    `;
    if (newStatus === 'closed_auto') await resolveOpenExceptions(sql, workItemId);
    await insertEvidence(sql, workItemId, [{ actorType: 'qa_reviewer', actorRef: 'prior_auth_qa', evidenceType: 'qa_decision_recorded', payload: { decision, notes } }], 'qa_reviewer', 'prior_auth_qa');
    const updated = await getOwnedPriorAuthWorkItem(sql, merchant.id, workItemId);
    return c.json({ stage: 'live', nextState: newStatus, workItem: mapPriorAuthWorkItem(updated!) });
  } catch (err: unknown) {
    console.error('[rcm] prior-auth verify error:', err instanceof Error ? err.message : err);
    return c.json({ error: 'Failed to verify prior-auth work item' }, 500);
  } finally { sql.end().catch(() => {}); }
});

// ─── Prior auth follow-up lane — retry ───────────────────────────────────────

router.post('/lanes/prior-auth-follow-up/work-items/:workItemId/retry', authenticateApiKey, async (c) => {
  const merchant = c.get('merchant');
  const workItemId = c.req.param('workItemId') ?? '';
  if (!isUuid(workItemId)) return validationResponse(c, ['"workItemId" must be a valid UUID']);

  let body: Record<string, unknown>;
  try { body = await c.req.json(); } catch { body = {}; }

  const connectorKey = (body['connectorKey'] as PriorAuthConnectorKey | undefined) ?? 'x12_278';
  const sql = createDb(c.env);
  try {
    const row = await getOwnedPriorAuthWorkItem(sql, merchant.id, workItemId);
    if (!row) return c.json({ error: 'Work item not found' }, 404);
    if (row.status !== 'retry_pending') return c.json({ error: 'Work item must be in "retry_pending" to retry' }, 409);

    const meta = parseJsonb<JsonRecord>(row.metadata, {});
    const attemptHistory = Array.isArray(meta['attemptHistory']) ? meta['attemptHistory'] : [];
    if (attemptHistory.length >= priorAuthLaneContract.autonomyLimits.maxAutonomousAttempts) {
      await sql`UPDATE rcm_work_items SET status = 'human_review_required', requires_human_review = true, updated_at = NOW() WHERE id = ${workItemId}`;
      return c.json({ stage: 'live', nextState: 'human_review_required', reason: 'attempts_exhausted' });
    }

    const connectorResult = await runPriorAuthConnector(c.env, connectorKey, priorAuthConnectorInputFromWorkItem(row));
    const newStatus = connectorResult.autoQaRecommendation === 'close_auto' ? 'closed_auto' : connectorResult.autoQaRecommendation === 'human_review_required' ? 'human_review_required' : 'awaiting_qa';
    const updatedMetadata = { ...meta, attemptHistory: [...attemptHistory, { connectorKey: connectorResult.connectorKey, statusCode: connectorResult.statusCode, attemptedAt: connectorResult.performedAt }] };

    await sql`
      UPDATE rcm_work_items SET status = ${newStatus}, confidence_pct = ${connectorResult.confidencePct},
        ${newStatus === 'closed_auto' ? sql`completed_at = NOW(),` : sql``}
        metadata = ${jsonb(updatedMetadata)}::jsonb, updated_at = NOW()
      WHERE id = ${workItemId}
    `;
    await insertEvidence(sql, workItemId, connectorResult.evidence.map((e) => ({ ...e, actorType: e.actorType ?? 'worker_agent', actorRef: e.actorRef ?? 'prior_auth_connector' })), 'worker_agent', 'prior_auth_connector');
    const updated = await getOwnedPriorAuthWorkItem(sql, merchant.id, workItemId);
    return c.json({ stage: 'live', nextState: newStatus, connector: { key: connectorResult.connectorKey, statusCode: connectorResult.statusCode, summary: connectorResult.summary }, workItem: mapPriorAuthWorkItem(updated!) });
  } catch (err: unknown) {
    console.error('[rcm] prior-auth retry error:', err instanceof Error ? err.message : err);
    return c.json({ error: 'Failed to retry prior-auth connector' }, 500);
  } finally { sql.end().catch(() => {}); }
});

// ─── Prior auth follow-up lane — escalate ────────────────────────────────────

router.post('/lanes/prior-auth-follow-up/work-items/:workItemId/escalate', authenticateApiKey, async (c) => {
  const merchant = c.get('merchant');
  const workItemId = c.req.param('workItemId') ?? '';
  if (!isUuid(workItemId)) return validationResponse(c, ['"workItemId" must be a valid UUID']);

  let body: Record<string, unknown>;
  try { body = await c.req.json(); } catch { body = {}; }

  const escalationReason = typeof body['escalationReason'] === 'string' ? body['escalationReason'] : 'manual_escalation';
  const notes = typeof body['notes'] === 'string' ? body['notes'] : '';

  const sql = createDb(c.env);
  try {
    const row = await getOwnedPriorAuthWorkItem(sql, merchant.id, workItemId);
    if (!row) return c.json({ error: 'Work item not found' }, 404);
    if (['closed_auto', 'closed_human', 'blocked'].includes(row.status)) return c.json({ error: 'Cannot escalate a closed work item' }, 409);

    await sql`UPDATE rcm_work_items SET status = 'human_review_required', requires_human_review = true, updated_at = NOW() WHERE id = ${workItemId}`;
    await insertEvidence(sql, workItemId, [{ actorType: 'operator', actorRef: 'prior_auth_escalator', evidenceType: 'manual_escalation', payload: { escalationReason, notes } }], 'operator', 'prior_auth_escalator');
    const updated = await getOwnedPriorAuthWorkItem(sql, merchant.id, workItemId);
    return c.json({ stage: 'live', nextState: 'human_review_required', workItem: mapPriorAuthWorkItem(updated!) });
  } catch (err: unknown) {
    console.error('[rcm] prior-auth escalate error:', err instanceof Error ? err.message : err);
    return c.json({ error: 'Failed to escalate prior-auth work item' }, 500);
  } finally { sql.end().catch(() => {}); }
});

// ─── Prior auth follow-up lane — resolve ─────────────────────────────────────

router.post('/lanes/prior-auth-follow-up/work-items/:workItemId/resolve', authenticateApiKey, async (c) => {
  const merchant = c.get('merchant');
  const workItemId = c.req.param('workItemId') ?? '';
  if (!isUuid(workItemId)) return validationResponse(c, ['"workItemId" must be a valid UUID']);

  let body: Record<string, unknown>;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON body' }, 400); }

  const resolution = typeof body['resolution'] === 'string' ? body['resolution'] : '';
  const notes = typeof body['notes'] === 'string' ? body['notes'] : '';
  if (!['approved', 'denied', 'mark_blocked'].includes(resolution)) return validationResponse(c, ['"resolution" must be "approved", "denied", or "mark_blocked"']);

  const sql = createDb(c.env);
  try {
    const row = await getOwnedPriorAuthWorkItem(sql, merchant.id, workItemId);
    if (!row) return c.json({ error: 'Work item not found' }, 404);
    if (row.status !== 'human_review_required') return c.json({ error: 'Work item must be in "human_review_required" to resolve' }, 409);

    const newStatus = resolution === 'mark_blocked' ? 'blocked' : 'closed_human';
    const meta = parseJsonb<JsonRecord>(row.metadata, {});
    const updatedMetadata = { ...meta, humanResolution: { resolution, notes, resolvedAt: new Date().toISOString() } };
    await sql`UPDATE rcm_work_items SET status = ${newStatus}, requires_human_review = false, completed_at = NOW(), metadata = ${jsonb(updatedMetadata)}::jsonb, updated_at = NOW() WHERE id = ${workItemId}`;
    if (newStatus === 'closed_human') await resolveOpenExceptions(sql, workItemId);
    await insertEvidence(sql, workItemId, [{ actorType: 'human_reviewer', actorRef: 'prior_auth_resolver', evidenceType: 'human_resolution_recorded', payload: { resolution, notes } }], 'human_reviewer', 'prior_auth_resolver');
    const updated = await getOwnedPriorAuthWorkItem(sql, merchant.id, workItemId);
    return c.json({ stage: 'live', status: newStatus, workItem: mapPriorAuthWorkItem(updated!) });
  } catch (err: unknown) {
    console.error('[rcm] prior-auth resolve error:', err instanceof Error ? err.message : err);
    return c.json({ error: 'Failed to resolve prior-auth work item' }, 500);
  } finally { sql.end().catch(() => {}); }
});

// ─── ERA 835 lane — routes (scaffold) ────────────────────────────────────────

router.get('/lanes/era-835', authenticateApiKey, (c) =>
  c.json({
    stage: 'scaffold',
    laneKey: 'era_835',
    version: 'v1',
    description: 'ERA 835 Electronic Remittance Advice processing: parse payments, match claims, post adjustments, detect underpayments.',
    connectors: getEra835ConnectorAvailability(c.env),
    note: 'ERA 835 parsing and payment posting are planned for Phase 2. Intake and simulation connector are available now.',
  }),
);

router.get('/connectors/era-835', authenticateApiKey, (c) =>
  c.json({
    stage: 'scaffold',
    lane: 'era_835',
    connectors: getEra835ConnectorAvailability(c.env),
    message: 'ERA 835 clearinghouse connector is in simulation mode. Full X12 835 parsing coming in Phase 2.',
  }),
);

router.post('/lanes/era-835/intake', authenticateApiKey, async (c) => {
  const merchant = c.get('merchant');
  let body: Record<string, unknown>;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON body' }, 400); }

  const details: string[] = [];
  const workspaceId = typeof body['workspaceId'] === 'string' ? body['workspaceId'] : '';
  const title = typeof body['title'] === 'string' ? body['title'].trim() : '';
  const payerName = typeof body['payerName'] === 'string' ? body['payerName'].trim() : '';
  const claimRef = typeof body['claimRef'] === 'string' ? body['claimRef'].trim() : '';
  const metadata = asObject(body['metadata']);
  const eraRef = typeof metadata['eraRef'] === 'string' ? metadata['eraRef'].trim() : '';
  const checkAmount = parsePositiveAmount(metadata['checkAmount']);
  const priority = normalizePriority(body['priority']);
  const dueAt = parseDateString(body['dueAt'] ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString());

  if (!workspaceId || !isUuid(workspaceId)) details.push('"workspaceId" must be a valid UUID');
  if (!title) details.push('"title" is required');
  if (!payerName) details.push('"payerName" is required');
  if (!claimRef) details.push('"claimRef" is required');
  if (!eraRef) details.push('"metadata.eraRef" is required');
  if (details.length > 0) return validationResponse(c, details);

  const workItemId = crypto.randomUUID();
  const sql = createDb(c.env);
  try {
    const result = await sql.begin(async (tx: any) => {
      const workspace = await getOwnedWorkspace(tx, merchant.id, workspaceId);
      if (!workspace) throw new Error('WORKSPACE_NOT_FOUND');

      const workItemMetadata = {
        ...metadata,
        laneKey: 'era_835',
        contractVersion: 'v1',
        eraRef,
        checkAmount: checkAmount ?? null,
        connectorPlan: { primary: 'x12_835_clearinghouse', fallback: ['direct_sftp'] },
        attemptHistory: [],
      };

      await tx`
        INSERT INTO rcm_work_items (id, workspace_id, merchant_id, work_type, billing_domain, form_type, title, payer_name, coverage_type, patient_ref, provider_ref, claim_ref, source_system, amount_at_risk, priority, status, requires_human_review, due_at, metadata, created_at, updated_at)
        VALUES (${workItemId}, ${workspaceId}, ${merchant.id}, 'era_835', ${typeof body['billingDomain'] === 'string' ? body['billingDomain'] : 'facility'}, ${typeof body['formType'] === 'string' ? body['formType'] : 'ERA'}, ${title}, ${payerName}, ${typeof body['coverageType'] === 'string' ? body['coverageType'] : 'medical'}, ${typeof body['patientRef'] === 'string' ? body['patientRef'] : ''}, ${typeof body['providerRef'] === 'string' ? body['providerRef'] : ''}, ${claimRef}, ${typeof body['sourceSystem'] === 'string' ? body['sourceSystem'] : 'unknown'}, ${checkAmount}, ${priority}, 'routed', false, ${dueAt}, ${jsonb(workItemMetadata)}::jsonb, NOW(), NOW())
      `;
      await insertEvidence(tx, workItemId, [{ actorType: 'router_agent', actorRef: 'era_835_router', evidenceType: 'router_decision_recorded', payload: { eraRef, checkAmount, payerName } }], 'router_agent', 'era_835_router');
      const inserted = await tx<WorkItemRow[]>`SELECT w.id, w.workspace_id AS "workspaceId", ws.name AS "workspaceName", w.assigned_agent_id AS "assignedAgentId", w.work_type AS "workType", w.form_type AS "formType", w.title, w.payer_name AS "payerName", w.coverage_type AS "coverageType", w.patient_ref AS "patientRef", w.provider_ref AS "providerRef", w.claim_ref AS "claimRef", w.source_system AS "sourceSystem", w.amount_at_risk AS "amountAtRisk", w.confidence_pct AS "confidencePct", w.priority, w.status, w.requires_human_review AS "requiresHumanReview", w.due_at AS "dueAt", w.submitted_at AS "submittedAt", w.completed_at AS "completedAt", w.metadata, w.created_at AS "createdAt", w.updated_at AS "updatedAt" FROM rcm_work_items w JOIN rcm_workspaces ws ON ws.id = w.workspace_id WHERE w.id = ${workItemId} LIMIT 1`;
      return { workItem: mapWorkItem(inserted[0]!) };
    });

    return c.json({ lane: 'era_835', status: 'routed', workItemId, workItem: result.workItem }, 201);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === 'WORKSPACE_NOT_FOUND') return c.json({ error: 'Workspace not found' }, 404);
    console.error('[rcm] era-835 intake error:', message);
    return c.json({ error: 'Failed to create ERA 835 work item' }, 500);
  } finally {
    sql.end().catch(() => {});
  }
});

router.post('/lanes/era-835/work-items/:workItemId/run-primary', authenticateApiKey, async (c) => {
  const merchant = c.get('merchant');
  const workItemId = c.req.param('workItemId') ?? '';
  if (!isUuid(workItemId)) return validationResponse(c, ['"workItemId" must be a valid UUID']);

  const sql = createDb(c.env);
  try {
    const rows = await sql<WorkItemRow[]>`
      SELECT w.id, w.workspace_id AS "workspaceId", ws.name AS "workspaceName", w.assigned_agent_id AS "assignedAgentId", w.work_type AS "workType", w.form_type AS "formType", w.title, w.payer_name AS "payerName", w.coverage_type AS "coverageType", w.patient_ref AS "patientRef", w.provider_ref AS "providerRef", w.claim_ref AS "claimRef", w.source_system AS "sourceSystem", w.amount_at_risk AS "amountAtRisk", w.confidence_pct AS "confidencePct", w.priority, w.status, w.requires_human_review AS "requiresHumanReview", w.due_at AS "dueAt", w.submitted_at AS "submittedAt", w.completed_at AS "completedAt", w.metadata, w.created_at AS "createdAt", w.updated_at AS "updatedAt"
      FROM rcm_work_items w JOIN rcm_workspaces ws ON ws.id = w.workspace_id
      WHERE w.id = ${workItemId} AND w.merchant_id = ${merchant.id} AND w.work_type = 'era_835' LIMIT 1
    `;
    const row = rows[0];
    if (!row) return c.json({ error: 'Work item not found' }, 404);
    if (row.status !== 'routed') return c.json({ error: 'ERA 835 work item must be in "routed" before autonomous run' }, 409);

    const meta = parseJsonb<JsonRecord>(row.metadata, {});
    const input: Era835ConnectorExecutionInput = {
      workItemId: row.id,
      claimRef: row.claimRef ?? '',
      eraRef: typeof meta['eraRef'] === 'string' ? meta['eraRef'] : '',
      payerName: row.payerName ?? '',
      payerId: typeof meta['payerId'] === 'string' ? meta['payerId'] : null,
      patientRef: row.patientRef ?? '',
      providerRef: row.providerRef ?? '',
      npi: typeof meta['npi'] === 'string' ? meta['npi'] : null,
      checkDate: typeof meta['checkDate'] === 'string' ? meta['checkDate'] : null,
      checkAmount: row.amountAtRisk ? Number(row.amountAtRisk) : null,
      formType: row.formType ?? '',
      sourceSystem: row.sourceSystem ?? '',
      metadata: meta,
    };

    const connectorResult = await runEra835Connector(c.env, 'x12_835_clearinghouse', input);

    const newStatus = connectorResult.autoQaRecommendation === 'close_auto' ? 'closed_auto' : connectorResult.autoQaRecommendation === 'human_review_required' ? 'human_review_required' : 'awaiting_qa';
    const updatedMetadata = { ...meta, lastConnectorRun: { connectorKey: connectorResult.connectorKey, mode: connectorResult.mode, statusCode: connectorResult.statusCode, paymentDetails: connectorResult.paymentDetails } };

    await sql`
      UPDATE rcm_work_items SET status = ${newStatus}, confidence_pct = ${connectorResult.confidencePct}, submitted_at = NOW(), ${newStatus === 'closed_auto' ? sql`completed_at = NOW(),` : sql``} metadata = ${jsonb(updatedMetadata)}::jsonb, updated_at = NOW()
      WHERE id = ${workItemId}
    `;
    await insertEvidence(sql, workItemId, connectorResult.evidence.map((e) => ({ ...e, actorType: e.actorType ?? 'worker_agent', actorRef: e.actorRef ?? 'era_835_connector' })), 'worker_agent', 'era_835_connector');

    return c.json({ nextState: newStatus, connector: { key: connectorResult.connectorKey, mode: connectorResult.mode, statusCode: connectorResult.statusCode, paymentDetails: connectorResult.paymentDetails, summary: connectorResult.summary } });
  } catch (err: unknown) {
    console.error('[rcm] era-835 run-primary error:', err instanceof Error ? err.message : err);
    return c.json({ error: 'Failed to run ERA 835 connector' }, 500);
  } finally {
    sql.end().catch(() => {});
  }
});

// ─── ERA 835 lane — work-items queue ─────────────────────────────────────────

router.get('/lanes/era-835/work-items', authenticateApiKey, async (c) => {
  const merchant = c.get('merchant');
  const sql = createDb(c.env);
  const status = c.req.query('status');
  const workspaceId = c.req.query('workspaceId');
  const limit = parseLimit(c.req.query('limit'), 50, 200);
  if (workspaceId && !isUuid(workspaceId)) { sql.end().catch(() => {}); return validationResponse(c, ['"workspaceId" must be a valid UUID']); }
  try {
    const rows = await sql<WorkItemRow[]>`
      SELECT w.id, w.workspace_id AS "workspaceId", ws.name AS "workspaceName",
        w.assigned_agent_id AS "assignedAgentId", w.work_type AS "workType",
        w.form_type AS "formType", w.title, w.payer_name AS "payerName",
        w.coverage_type AS "coverageType", w.patient_ref AS "patientRef",
        w.provider_ref AS "providerRef", w.claim_ref AS "claimRef",
        w.source_system AS "sourceSystem", w.amount_at_risk AS "amountAtRisk",
        w.confidence_pct AS "confidencePct", w.priority, w.status,
        w.requires_human_review AS "requiresHumanReview", w.due_at AS "dueAt",
        w.submitted_at AS "submittedAt", w.completed_at AS "completedAt",
        w.metadata, w.created_at AS "createdAt", w.updated_at AS "updatedAt"
      FROM rcm_work_items w JOIN rcm_workspaces ws ON ws.id = w.workspace_id
      WHERE w.merchant_id = ${merchant.id} AND w.work_type = 'era_835'
        AND (${status ?? null}::text IS NULL OR w.status = ${status ?? null})
        AND (${workspaceId ?? null}::uuid IS NULL OR w.workspace_id = ${workspaceId ?? null})
      ORDER BY CASE w.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'normal' THEN 3 ELSE 4 END, w.created_at DESC
      LIMIT ${limit}
    `;
    return c.json({ stage: 'live', lane: 'era_835', count: rows.length, items: rows.map(mapWorkItem) });
  } catch (err: unknown) {
    console.error('[rcm] era-835 work-items error:', err instanceof Error ? err.message : err);
    return c.json({ error: 'Failed to fetch ERA 835 work items' }, 500);
  } finally { sql.end().catch(() => {}); }
});

// ─── ERA 835 lane — exception queue ──────────────────────────────────────────

router.get('/queues/era-835-exceptions', authenticateApiKey, async (c) => {
  const merchant = c.get('merchant');
  const sql = createDb(c.env);
  const severity = c.req.query('severity');
  const limit = parseLimit(c.req.query('limit'), 50, 200);
  try {
    const rows = await sql<ExceptionQueueRow[]>`
      SELECT e.id, e.work_item_id AS "workItemId", ws.name AS "workspaceName",
        w.payer_name AS "payerName", w.claim_ref AS "claimRef", w.priority,
        e.exception_type AS "exceptionType", e.severity, e.reason_code AS "reasonCode",
        e.summary, w.confidence_pct AS "confidencePct", w.amount_at_risk AS "amountAtRisk",
        e.payload, e.created_at AS "openedAt"
      FROM rcm_exceptions e
      JOIN rcm_work_items w ON w.id = e.work_item_id
      JOIN rcm_workspaces ws ON ws.id = w.workspace_id
      WHERE w.merchant_id = ${merchant.id} AND w.work_type = 'era_835'
        AND e.resolved_at IS NULL
        AND (${severity ?? null}::text IS NULL OR e.severity = ${severity ?? null})
      ORDER BY CASE e.severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'normal' THEN 3 ELSE 4 END, e.created_at ASC
      LIMIT ${limit}
    `;
    return c.json({ stage: 'live', queueKey: 'era_835_exceptions', count: rows.length, items: rows.map(mapException) });
  } catch (err: unknown) {
    console.error('[rcm] era-835 exception queue error:', err instanceof Error ? err.message : err);
    return c.json({ error: 'Failed to fetch ERA 835 exception queue' }, 500);
  } finally { sql.end().catch(() => {}); }
});

// ─── ERA 835 lane — execute ───────────────────────────────────────────────────

router.post('/lanes/era-835/work-items/:workItemId/execute', authenticateApiKey, async (c) => {
  const merchant = c.get('merchant');
  const workItemId = c.req.param('workItemId') ?? '';
  if (!isUuid(workItemId)) return validationResponse(c, ['"workItemId" must be a valid UUID']);

  let body: Record<string, unknown>;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON body' }, 400); }

  const resolution = typeof body['resolution'] === 'string' ? body['resolution'].trim() : '';
  const paymentAmount = parsePositiveAmount(body['paymentAmount']);
  const notes = typeof body['notes'] === 'string' ? body['notes'] : '';
  const details: string[] = [];
  if (!resolution) details.push('"resolution" is required');
  if (!paymentAmount) details.push('"paymentAmount" must be a positive number');
  if (details.length > 0) return validationResponse(c, details);

  const sql = createDb(c.env);
  try {
    const rows = await sql<WorkItemRow[]>`SELECT w.id, w.workspace_id AS "workspaceId", ws.name AS "workspaceName", w.assigned_agent_id AS "assignedAgentId", w.work_type AS "workType", w.form_type AS "formType", w.title, w.payer_name AS "payerName", w.coverage_type AS "coverageType", w.patient_ref AS "patientRef", w.provider_ref AS "providerRef", w.claim_ref AS "claimRef", w.source_system AS "sourceSystem", w.amount_at_risk AS "amountAtRisk", w.confidence_pct AS "confidencePct", w.priority, w.status, w.requires_human_review AS "requiresHumanReview", w.due_at AS "dueAt", w.submitted_at AS "submittedAt", w.completed_at AS "completedAt", w.metadata, w.created_at AS "createdAt", w.updated_at AS "updatedAt" FROM rcm_work_items w JOIN rcm_workspaces ws ON ws.id = w.workspace_id WHERE w.id = ${workItemId} AND w.merchant_id = ${merchant.id} AND w.work_type = 'era_835' LIMIT 1`;
    const row = rows[0];
    if (!row) return c.json({ error: 'Work item not found' }, 404);
    if (!['awaiting_qa', 'human_review_required'].includes(row.status)) return c.json({ error: 'Work item must be in "awaiting_qa" or "human_review_required" to execute' }, 409);

    const meta = parseJsonb<JsonRecord>(row.metadata, {});
    const updatedMetadata = { ...meta, workerExecution: { resolution, paymentAmount, notes, executedAt: new Date().toISOString() } };
    await sql`UPDATE rcm_work_items SET metadata = ${jsonb(updatedMetadata)}::jsonb, updated_at = NOW() WHERE id = ${workItemId}`;
    await insertEvidence(sql, workItemId, [{ actorType: 'human_worker', actorRef: 'era_835_worker', evidenceType: 'payment_posting_submitted', payload: { resolution, paymentAmount, notes } }], 'human_worker', 'era_835_worker');
    const updated = await sql<WorkItemRow[]>`SELECT w.id, w.workspace_id AS "workspaceId", ws.name AS "workspaceName", w.assigned_agent_id AS "assignedAgentId", w.work_type AS "workType", w.form_type AS "formType", w.title, w.payer_name AS "payerName", w.coverage_type AS "coverageType", w.patient_ref AS "patientRef", w.provider_ref AS "providerRef", w.claim_ref AS "claimRef", w.source_system AS "sourceSystem", w.amount_at_risk AS "amountAtRisk", w.confidence_pct AS "confidencePct", w.priority, w.status, w.requires_human_review AS "requiresHumanReview", w.due_at AS "dueAt", w.submitted_at AS "submittedAt", w.completed_at AS "completedAt", w.metadata, w.created_at AS "createdAt", w.updated_at AS "updatedAt" FROM rcm_work_items w JOIN rcm_workspaces ws ON ws.id = w.workspace_id WHERE w.id = ${workItemId} LIMIT 1`;
    return c.json({ stage: 'live', workItem: mapWorkItem(updated[0]!) });
  } catch (err: unknown) {
    console.error('[rcm] era-835 execute error:', err instanceof Error ? err.message : err);
    return c.json({ error: 'Failed to execute ERA 835 work item' }, 500);
  } finally { sql.end().catch(() => {}); }
});

// ─── ERA 835 lane — verify ────────────────────────────────────────────────────

router.post('/lanes/era-835/work-items/:workItemId/verify', authenticateApiKey, async (c) => {
  const merchant = c.get('merchant');
  const workItemId = c.req.param('workItemId') ?? '';
  if (!isUuid(workItemId)) return validationResponse(c, ['"workItemId" must be a valid UUID']);

  let body: Record<string, unknown>;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON body' }, 400); }

  const decision = typeof body['decision'] === 'string' ? body['decision'] : '';
  const notes = typeof body['notes'] === 'string' ? body['notes'] : '';
  if (!['approve_auto_close', 'retry', 'escalate'].includes(decision)) return validationResponse(c, ['"decision" must be "approve_auto_close", "retry", or "escalate"']);

  const sql = createDb(c.env);
  try {
    const rows = await sql<WorkItemRow[]>`SELECT w.id, w.workspace_id AS "workspaceId", ws.name AS "workspaceName", w.assigned_agent_id AS "assignedAgentId", w.work_type AS "workType", w.form_type AS "formType", w.title, w.payer_name AS "payerName", w.coverage_type AS "coverageType", w.patient_ref AS "patientRef", w.provider_ref AS "providerRef", w.claim_ref AS "claimRef", w.source_system AS "sourceSystem", w.amount_at_risk AS "amountAtRisk", w.confidence_pct AS "confidencePct", w.priority, w.status, w.requires_human_review AS "requiresHumanReview", w.due_at AS "dueAt", w.submitted_at AS "submittedAt", w.completed_at AS "completedAt", w.metadata, w.created_at AS "createdAt", w.updated_at AS "updatedAt" FROM rcm_work_items w JOIN rcm_workspaces ws ON ws.id = w.workspace_id WHERE w.id = ${workItemId} AND w.merchant_id = ${merchant.id} AND w.work_type = 'era_835' LIMIT 1`;
    const row = rows[0];
    if (!row) return c.json({ error: 'Work item not found' }, 404);
    if (row.status !== 'awaiting_qa') return c.json({ error: 'Work item must be in "awaiting_qa" to verify' }, 409);

    const newStatus = decision === 'approve_auto_close' ? 'closed_auto' : decision === 'retry' ? 'retry_pending' : 'human_review_required';
    await sql`UPDATE rcm_work_items SET status = ${newStatus}, ${newStatus === 'closed_auto' ? sql`completed_at = NOW(),` : sql``} requires_human_review = ${newStatus === 'human_review_required'}, updated_at = NOW() WHERE id = ${workItemId}`;
    if (newStatus === 'closed_auto') await resolveOpenExceptions(sql, workItemId);
    await insertEvidence(sql, workItemId, [{ actorType: 'qa_reviewer', actorRef: 'era_835_qa', evidenceType: 'qa_decision_recorded', payload: { decision, notes } }], 'qa_reviewer', 'era_835_qa');
    return c.json({ stage: 'live', nextState: newStatus });
  } catch (err: unknown) {
    console.error('[rcm] era-835 verify error:', err instanceof Error ? err.message : err);
    return c.json({ error: 'Failed to verify ERA 835 work item' }, 500);
  } finally { sql.end().catch(() => {}); }
});

// ─── ERA 835 lane — resolve ───────────────────────────────────────────────────

router.post('/lanes/era-835/work-items/:workItemId/resolve', authenticateApiKey, async (c) => {
  const merchant = c.get('merchant');
  const workItemId = c.req.param('workItemId') ?? '';
  if (!isUuid(workItemId)) return validationResponse(c, ['"workItemId" must be a valid UUID']);

  let body: Record<string, unknown>;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON body' }, 400); }

  const resolution = typeof body['resolution'] === 'string' ? body['resolution'] : '';
  const notes = typeof body['notes'] === 'string' ? body['notes'] : '';
  if (!['payment_posted', 'rejected', 'blocked'].includes(resolution)) return validationResponse(c, ['"resolution" must be "payment_posted", "rejected", or "blocked"']);

  const sql = createDb(c.env);
  try {
    const rows = await sql<WorkItemRow[]>`SELECT w.id, w.workspace_id AS "workspaceId", ws.name AS "workspaceName", w.assigned_agent_id AS "assignedAgentId", w.work_type AS "workType", w.form_type AS "formType", w.title, w.payer_name AS "payerName", w.coverage_type AS "coverageType", w.patient_ref AS "patientRef", w.provider_ref AS "providerRef", w.claim_ref AS "claimRef", w.source_system AS "sourceSystem", w.amount_at_risk AS "amountAtRisk", w.confidence_pct AS "confidencePct", w.priority, w.status, w.requires_human_review AS "requiresHumanReview", w.due_at AS "dueAt", w.submitted_at AS "submittedAt", w.completed_at AS "completedAt", w.metadata, w.created_at AS "createdAt", w.updated_at AS "updatedAt" FROM rcm_work_items w JOIN rcm_workspaces ws ON ws.id = w.workspace_id WHERE w.id = ${workItemId} AND w.merchant_id = ${merchant.id} AND w.work_type = 'era_835' LIMIT 1`;
    const row = rows[0];
    if (!row) return c.json({ error: 'Work item not found' }, 404);
    if (row.status !== 'human_review_required') return c.json({ error: 'Work item must be in "human_review_required" to resolve' }, 409);

    const newStatus = resolution === 'blocked' ? 'blocked' : resolution === 'rejected' ? 'rejected' : 'closed_human';
    const meta = parseJsonb<JsonRecord>(row.metadata, {});
    const updatedMetadata = { ...meta, humanResolution: { resolution, notes, resolvedAt: new Date().toISOString() } };
    await sql`UPDATE rcm_work_items SET status = ${newStatus}, requires_human_review = false, completed_at = NOW(), metadata = ${jsonb(updatedMetadata)}::jsonb, updated_at = NOW() WHERE id = ${workItemId}`;
    if (newStatus === 'closed_human') await resolveOpenExceptions(sql, workItemId);
    await insertEvidence(sql, workItemId, [{ actorType: 'human_reviewer', actorRef: 'era_835_resolver', evidenceType: 'human_resolution_recorded', payload: { resolution, notes } }], 'human_reviewer', 'era_835_resolver');
    return c.json({ stage: 'live', status: newStatus });
  } catch (err: unknown) {
    console.error('[rcm] era-835 resolve error:', err instanceof Error ? err.message : err);
    return c.json({ error: 'Failed to resolve ERA 835 work item' }, 500);
  } finally { sql.end().catch(() => {}); }
});

// ---------------------------------------------------------------------------
// Billing — Setup Intent + mandate + off-session charge
//
// ─── DB migration required ─────────────────────────────────────────────────
//
// Run once against your Supabase Direct connection (port 5432):
//
// CREATE TABLE IF NOT EXISTS principal_mandates (
//   id                   uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
//   principal_id         text    NOT NULL,
//   workspace_id         uuid    REFERENCES rcm_workspaces(id) ON DELETE CASCADE,
//   stripe_pm_id         text    NOT NULL,
//   stripe_customer_id   text,
//   mandate_ref          text,
//   scope                text    NOT NULL DEFAULT 'rcm_milestones',
//   max_amount_pence     integer,
//   approved_at          timestamptz NOT NULL DEFAULT now(),
//   expires_at           timestamptz,
//   revoked_at           timestamptz,
//   created_at           timestamptz NOT NULL DEFAULT now()
// );
//
// CREATE INDEX IF NOT EXISTS principal_mandates_principal_idx
//   ON principal_mandates (principal_id);
// CREATE INDEX IF NOT EXISTS principal_mandates_workspace_idx
//   ON principal_mandates (workspace_id);
//
// Also add to rcm_milestones table if not present:
//   ALTER TABLE rcm_milestones ADD COLUMN IF NOT EXISTS billing_ref text;
//   ALTER TABLE rcm_milestones ADD COLUMN IF NOT EXISTS billed_at timestamptz;
// ───────────────────────────────────────────────────────────────────────────

function getRcmStripe(env: Env): Stripe {
  if (!env.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY not configured');
  return new Stripe(env.STRIPE_SECRET_KEY, {
    httpClient: Stripe.createFetchHttpClient(),
  });
}

/** GET /api/rcm/workspaces/:workspaceId/billing — mandate status for a workspace */
router.get('/workspaces/:workspaceId/billing', authenticateApiKey, async (c) => {
  const merchant = c.get('merchant');
  const workspaceId = c.req.param('workspaceId')!;

  const sql = createDb(c.env);
  try {
    // Verify workspace belongs to merchant
    const ws = await sql<Array<{ id: string }>>`
      SELECT id FROM rcm_workspaces
      WHERE id = ${workspaceId} AND merchant_id = ${merchant.id}
      LIMIT 1
    `;
    if (!ws.length) return c.json({ error: 'Workspace not found' }, 404);

    const mandates = await sql<Array<{
      id: string; stripe_pm_id: string; scope: string;
      max_amount_pence: number | null; approved_at: Date;
      expires_at: Date | null; revoked_at: Date | null; created_at: Date;
    }>>`
      SELECT id, stripe_pm_id, scope, max_amount_pence, approved_at, expires_at, revoked_at, created_at
      FROM principal_mandates
      WHERE workspace_id = ${workspaceId}
        AND revoked_at IS NULL
      ORDER BY created_at DESC
    `;

    return c.json({ workspaceId, mandates });
  } catch (err) {
    console.error('[rcm] GET /workspaces/:id/billing error:', err instanceof Error ? err.message : err);
    return c.json({ error: 'Failed to fetch billing status' }, 500);
  } finally { sql.end().catch(() => {}); }
});

/** POST /api/rcm/workspaces/:workspaceId/setup-billing — create Setup Intent for mandate */
router.post('/workspaces/:workspaceId/setup-billing', authenticateApiKey, async (c) => {
  if (!c.env.STRIPE_SECRET_KEY) return c.json({ error: 'Stripe not configured' }, 503);

  const merchant = c.get('merchant');
  const workspaceId = c.req.param('workspaceId')!;

  let body: { principalId?: unknown } = {};
  try { body = await c.req.json(); } catch {}

  const { principalId } = body;
  if (typeof principalId !== 'string' || !principalId.trim()) {
    return c.json({ error: 'principalId is required' }, 400);
  }

  const sql = createDb(c.env);
  try {
    const ws = await sql<Array<{ id: string }>>`
      SELECT id FROM rcm_workspaces
      WHERE id = ${workspaceId} AND merchant_id = ${merchant.id}
      LIMIT 1
    `;
    if (!ws.length) return c.json({ error: 'Workspace not found' }, 404);

    // Find or create Stripe customer for this principal
    const existingCust = await sql<Array<{ stripe_customer_id: string }>>`
      SELECT stripe_customer_id
      FROM principal_mandates
      WHERE principal_id = ${principalId.trim()}
        AND stripe_customer_id IS NOT NULL
      LIMIT 1
    `;

    const stripe = getRcmStripe(c.env);
    let customerId: string;
    if (existingCust.length && existingCust[0].stripe_customer_id) {
      customerId = existingCust[0].stripe_customer_id;
    } else {
      const customer = await stripe.customers.create({
        metadata: { agentpay_principal_id: principalId.trim(), workspace_id: workspaceId },
      });
      customerId = customer.id;
    }

    const setupIntent = await stripe.setupIntents.create({
      customer: customerId,
      usage: 'off_session',
      metadata: {
        agentpay_principal_id: principalId.trim(),
        workspace_id: workspaceId,
        scope: 'rcm_milestones',
      },
    });

    return c.json({
      clientSecret: setupIntent.client_secret,
      setupIntentId: setupIntent.id,
      customerId,
    }, 201);
  } catch (err) {
    console.error('[rcm] POST /workspaces/:id/setup-billing error:', err instanceof Error ? err.message : err);
    return c.json({ error: 'Failed to create setup intent' }, 500);
  } finally { sql.end().catch(() => {}); }
});

/** POST /api/rcm/workspaces/:workspaceId/confirm-billing — store mandate after setup completes */
router.post('/workspaces/:workspaceId/confirm-billing', authenticateApiKey, async (c) => {
  if (!c.env.STRIPE_SECRET_KEY) return c.json({ error: 'Stripe not configured' }, 503);

  const merchant = c.get('merchant');
  const workspaceId = c.req.param('workspaceId')!;

  let body: { principalId?: unknown; paymentMethodId?: unknown; setupIntentId?: unknown; maxAmountPence?: unknown } = {};
  try { body = await c.req.json(); } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const { principalId, paymentMethodId, maxAmountPence } = body;
  if (typeof principalId !== 'string' || !principalId.trim()) {
    return c.json({ error: 'principalId is required' }, 400);
  }
  if (typeof paymentMethodId !== 'string' || !paymentMethodId.trim()) {
    return c.json({ error: 'paymentMethodId is required' }, 400);
  }

  const stripe = getRcmStripe(c.env);
  const sql = createDb(c.env);
  try {
    const ws = await sql<Array<{ id: string }>>`
      SELECT id FROM rcm_workspaces
      WHERE id = ${workspaceId} AND merchant_id = ${merchant.id}
      LIMIT 1
    `;
    if (!ws.length) return c.json({ error: 'Workspace not found' }, 404);

    const pm = await stripe.paymentMethods.retrieve(paymentMethodId.trim());
    const customerId = pm.customer
      ? (typeof pm.customer === 'string' ? pm.customer : pm.customer.id)
      : null;

    if (customerId && !pm.customer) {
      await stripe.paymentMethods.attach(paymentMethodId.trim(), { customer: customerId });
    }

    const mandateAmount = typeof maxAmountPence === 'number' && Number.isInteger(maxAmountPence)
      ? maxAmountPence
      : null;

    const rows = await sql<Array<{ id: string; approved_at: Date }>>`
      INSERT INTO principal_mandates (
        principal_id,
        workspace_id,
        stripe_pm_id,
        stripe_customer_id,
        scope,
        max_amount_pence
      ) VALUES (
        ${principalId.trim()},
        ${workspaceId},
        ${paymentMethodId.trim()},
        ${customerId},
        'rcm_milestones',
        ${mandateAmount}
      )
      RETURNING id, approved_at
    `;

    const row = rows[0];
    return c.json({
      mandateId: row.id,
      workspaceId,
      principalId: principalId.trim(),
      paymentMethodId: paymentMethodId.trim(),
      last4: pm.card?.last4 ?? null,
      brand: pm.card?.brand ?? null,
      approvedAt: row.approved_at,
    });
  } catch (err) {
    console.error('[rcm] POST /workspaces/:id/confirm-billing error:', err instanceof Error ? err.message : err);
    return c.json({ error: 'Failed to confirm billing mandate' }, 500);
  } finally { sql.end().catch(() => {}); }
});

/** POST /api/rcm/workspaces/:workspaceId/charge — off-session charge for a completed milestone */
router.post('/workspaces/:workspaceId/charge', authenticateApiKey, async (c) => {
  if (!c.env.STRIPE_SECRET_KEY) return c.json({ error: 'Stripe not configured' }, 503);

  const merchant = c.get('merchant');
  const workspaceId = c.req.param('workspaceId')!;

  let body: { milestoneId?: unknown; amountPence?: unknown; currency?: unknown; description?: unknown } = {};
  try { body = await c.req.json(); } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const { milestoneId, amountPence, currency, description } = body;
  if (typeof milestoneId !== 'string' || !milestoneId.trim()) {
    return c.json({ error: 'milestoneId is required' }, 400);
  }
  if (!Number.isInteger(amountPence) || (amountPence as number) <= 0) {
    return c.json({ error: 'amountPence must be a positive integer' }, 400);
  }

  const ccy = typeof currency === 'string' && currency.trim().length === 3
    ? currency.trim().toLowerCase()
    : 'gbp';
  const desc = typeof description === 'string' ? description.trim() : `AgentPay RCM milestone ${milestoneId}`;

  const stripe = getRcmStripe(c.env);
  const sql = createDb(c.env);
  try {
    // Verify workspace ownership
    const ws = await sql<Array<{ id: string }>>`
      SELECT id FROM rcm_workspaces
      WHERE id = ${workspaceId} AND merchant_id = ${merchant.id}
      LIMIT 1
    `;
    if (!ws.length) return c.json({ error: 'Workspace not found' }, 404);

    // Find active mandate for this workspace
    const mandates = await sql<Array<{ id: string; stripe_pm_id: string; stripe_customer_id: string | null; max_amount_pence: number | null }>>`
      SELECT id, stripe_pm_id, stripe_customer_id, max_amount_pence
      FROM principal_mandates
      WHERE workspace_id = ${workspaceId}
        AND scope = 'rcm_milestones'
        AND revoked_at IS NULL
        AND (expires_at IS NULL OR expires_at > now())
      ORDER BY created_at DESC
      LIMIT 1
    `;

    if (!mandates.length) {
      return c.json({ error: 'No active billing mandate for this workspace. Call /setup-billing first.' }, 402);
    }

    const mandate = mandates[0];

    // Check max amount limit
    if (mandate.max_amount_pence && (amountPence as number) > mandate.max_amount_pence) {
      return c.json({
        error: `Charge of ${amountPence} exceeds mandate limit of ${mandate.max_amount_pence}`,
      }, 422);
    }

    if (!mandate.stripe_customer_id) {
      return c.json({ error: 'Mandate has no Stripe customer — re-run setup-billing' }, 422);
    }

    // Create off-session PaymentIntent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountPence as number,
      currency: ccy,
      customer: mandate.stripe_customer_id,
      payment_method: mandate.stripe_pm_id,
      off_session: true,
      confirm: true,
      description: desc,
      metadata: {
        workspace_id: workspaceId,
        milestone_id: milestoneId.trim(),
        mandate_id: mandate.id,
      },
    });

    // Mark milestone as billed if payment succeeded or requires further action
    if (paymentIntent.status === 'succeeded') {
      await sql`
        UPDATE rcm_milestones
        SET billing_ref = ${paymentIntent.id},
            billed_at   = now()
        WHERE id = ${milestoneId.trim()}
      `.catch(() => {}); // non-fatal — webhook will also update
    }

    return c.json({
      chargeId: paymentIntent.id,
      status: paymentIntent.status,
      amountPence: paymentIntent.amount,
      currency: paymentIntent.currency,
      milestoneId: milestoneId.trim(),
    });
  } catch (err: any) {
    // Stripe card errors (card_declined, insufficient_funds, etc.) — return 402
    if (err?.type === 'StripeCardError') {
      return c.json({ error: err.message, code: err.code }, 402);
    }
    console.error('[rcm] POST /workspaces/:id/charge error:', err instanceof Error ? err.message : err);
    return c.json({ error: 'Failed to charge milestone' }, 500);
  } finally { sql.end().catch(() => {}); }
});

export { router as rcmRouter };
