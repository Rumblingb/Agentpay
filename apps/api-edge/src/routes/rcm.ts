/**
 * RCM routes — /api/rcm/*
 *
 * Thin vertical surface for autonomous hospital / provider billing ops.
 * The first lane now has a live control loop and manager reads, while the
 * broader RCM domain still grows incrementally on top of AgentPay core.
 */

import { Hono, type Context } from 'hono';
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
    requiredContextFields: Array.isArray(payload['requiredContextFields']) ? payload['requiredContextFields'] : [],
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
  const row = await getOwnedClaimStatusWorkItem(sql, merchantId, workItemId);
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
        ${crypto.randomUUID()},
        ${workItemId},
        ${exception.exceptionType},
        ${exception.severity},
        ${exception.reasonCode},
        ${exception.summary},
        ${jsonb({
          requiredContextFields: exception.requiredContextFields,
          recommendedHumanAction: exception.recommendedHumanAction,
          connectorKey: params.connectorResult.connectorKey,
          connectorMode: params.connectorResult.mode,
          connectorTraceId: params.connectorResult.connectorTraceId,
          rawResponse: params.connectorResult.rawResponse,
        })}::jsonb,
        NOW()
      )
    `;
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
  },
};

const plannedRoutes = [
  'POST /api/rcm/workspaces',
  'PATCH /api/rcm/workspaces/:workspaceId',
  'POST /api/rcm/work-items',
  'PATCH /api/rcm/work-items/:workItemId',
  'POST /api/rcm/work-items/:workItemId/assign',
  'POST /api/rcm/work-items/:workItemId/evidence',
  'POST /api/rcm/work-items/:workItemId/submit',
  'POST /api/rcm/work-items/:workItemId/approve',
  'POST /api/rcm/work-items/:workItemId/reject',
  'POST /api/rcm/work-items/:workItemId/milestones',
  'POST /api/rcm/work-items/:workItemId/milestones/:milestoneId/release',
];

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
        'GET /api/rcm/workspaces',
        'GET /api/rcm/work-items',
        'GET /api/rcm/services',
        'GET /api/rcm/vendors',
        'GET /api/rcm/payouts',
        'GET /api/rcm/metrics/overview',
        'GET /api/rcm/metrics/queues',
        'GET /api/rcm/metrics/payouts',
      ],
      planned: plannedRoutes,
    },
  }),
);

router.get('/blueprint', (c) => c.json(blueprint));

router.get('/autonomy-loop', (c) =>
  c.json({
    stage: 'scaffold',
    autonomyLoop: blueprint.autonomyLoop,
    message:
      'Use multiple specialized agents in a typed loop. Allow bounded retries and fallbacks, then escalate cleanly. Learn from outcomes, not from uncontrolled runtime drift.',
  }),
);

router.get('/lanes/claim-status', (c) =>
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
      const row = await getOwnedClaimStatusWorkItem(tx, merchant.id, workItemId);
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
      const row = await getOwnedClaimStatusWorkItem(tx, merchant.id, workItemId);
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
        const exceptionId = crypto.randomUUID();
        const payload = {
          requiredContextFields,
          recommendedHumanAction,
          notes,
          qaReasonCode,
          lastAttempt: attempts[attempts.length - 1] ?? null,
        };
        await tx`
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
            ${exceptionType},
            ${severity},
            ${qaReasonCode},
            ${summary},
            ${jsonb(payload)}::jsonb,
            NOW()
          )
        `;
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
      const row = await getOwnedClaimStatusWorkItem(tx, merchant.id, workItemId);
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
      const row = await getOwnedClaimStatusWorkItem(tx, merchant.id, workItemId);
      if (!row) throw new Error('WORK_ITEM_NOT_FOUND');
      if (claimStatusLaneContract.stateMachine.terminalStates.includes(row.status)) {
        throw new Error('TERMINAL_STATE');
      }

      const exceptionId = crypto.randomUUID();
      const payload = {
        requiredContextFields,
        recommendedHumanAction,
        assignedReviewer,
        slaAt,
        notes,
      };

      await tx`
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
          ${exceptionType},
          ${severity},
          ${reasonCode},
          ${summary},
          ${jsonb(payload)}::jsonb,
          NOW()
        )
      `;

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
      const row = await getOwnedClaimStatusWorkItem(tx, merchant.id, workItemId);
      if (!row) throw new Error('WORK_ITEM_NOT_FOUND');

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
        const unresolved = await tx<Array<{ id: string }>>`
          SELECT id
          FROM rcm_exceptions
          WHERE work_item_id = ${workItemId}
            AND resolved_at IS NULL
          ORDER BY created_at DESC
          LIMIT 1
        `;
        if (!unresolved[0]) throw new Error('NO_OPEN_EXCEPTION');
        await tx`
          UPDATE rcm_exceptions
          SET
            exception_type = ${exceptionType},
            reason_code = ${summary ?? 'human_reclassified'},
            payload = COALESCE(payload, '{}'::jsonb) || ${jsonb({
              reclassifiedBy: reviewerRef,
              reclassifiedAt: nowIso,
            })}::jsonb
          WHERE id = ${unresolved[0].id}
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
    if (message === 'NO_OPEN_EXCEPTION') {
      return c.json({ error: 'No open exception exists for this work item' }, 409);
    }
    console.error('[rcm] claim-status resolve error:', message);
    return c.json({ error: 'Failed to resolve claim-status work item' }, 500);
  } finally {
    sql.end().catch(() => {});
  }
});

router.get('/services', (c) =>
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

router.get('/vendors', (c) =>
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

router.get('/payouts', (c) =>
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

router.get('/metrics/payouts', (c) =>
  c.json({
    stage: 'scaffold',
    payoutModel: {
      milestoneRelease: true,
      feeLedgerBacked: true,
      settlementObject: 'payment_intent',
    },
  }),
);

router.post('/workspaces', (c) => notYet(c, 'create_workspace'));
router.patch('/workspaces/:workspaceId', (c) => notYet(c, 'update_workspace'));
router.post('/work-items', (c) => notYet(c, 'create_work_item'));
router.patch('/work-items/:workItemId', (c) => notYet(c, 'update_work_item'));
router.post('/work-items/:workItemId/assign', (c) => notYet(c, 'assign_work_item'));
router.post('/work-items/:workItemId/evidence', (c) => notYet(c, 'append_evidence'));
router.post('/work-items/:workItemId/submit', (c) => notYet(c, 'submit_work_item'));
router.post('/work-items/:workItemId/approve', (c) => notYet(c, 'approve_work_item'));
router.post('/work-items/:workItemId/reject', (c) => notYet(c, 'reject_work_item'));
router.post('/work-items/:workItemId/milestones', (c) => notYet(c, 'create_milestone'));
router.post('/work-items/:workItemId/milestones/:milestoneId/release', (c) =>
  notYet(c, 'release_milestone'),
);

export { router as rcmRouter };
