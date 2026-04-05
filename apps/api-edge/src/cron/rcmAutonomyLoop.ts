/**
 * RCM Autonomy Loop — runs every 2 minutes via Cloudflare Cron Trigger.
 *
 * Picks up work items in actionable states and drives them through the state
 * machine without requiring a human operator to call each HTTP endpoint.
 *
 * Phase 1 (this file):
 *   routed        → connector run → closed_auto | human_review_required | awaiting_qa
 *   awaiting_qa   → Claude Haiku QA → closed_auto | retry_pending | human_review_required
 *   retry_pending → fallback connector (different strategy) → awaiting_qa
 *
 * Connectors supported: institutional_claim_status, eligibility_verification,
 *                        denial_follow_up
 */

import type { Env } from '../types';
import { createDb, parseJsonb } from '../lib/db';
import { runClaimStatusConnector } from '../lib/rcmClaimStatusConnector';
import { runEligibilityConnector } from '../lib/rcmEligibilityConnector';
import { runDenialFollowUpConnector } from '../lib/rcmDenialFollowUpConnector';
import type {
  ClaimStatusConnectorExecution,
  ClaimStatusConnectorExecutionInput,
} from '../lib/rcmClaimStatusConnector';
import type {
  EligibilityConnectorExecution,
  EligibilityConnectorExecutionInput,
} from '../lib/rcmEligibilityConnector';
import type {
  DenialFollowUpConnectorExecution,
  DenialFollowUpConnectorExecutionInput,
} from '../lib/rcmDenialFollowUpConnector';

// ─── Types ────────────────────────────────────────────────────────────────────

type JsonRecord = Record<string, unknown>;

interface LoopWorkItem {
  id: string;
  merchantId: string;
  workspaceId: string;
  workType: string;
  claimRef: string | null;
  payerName: string | null;
  coverageType: string | null;
  patientRef: string | null;
  providerRef: string | null;
  formType: string | null;
  sourceSystem: string | null;
  amountAtRisk: string | null;
  metadata: unknown;
  priority: string;
  status: string;
}

type AnyConnectorExecution =
  | ClaimStatusConnectorExecution
  | EligibilityConnectorExecution
  | DenialFollowUpConnectorExecution;

// ─── Constants ────────────────────────────────────────────────────────────────

/** Maximum work items processed per cron invocation — keeps each run < 30s. */
const BATCH_ROUTED = 10;
const BATCH_AWAITING_QA = 10;
const BATCH_RETRY = 5;

/** Minimum age of an awaiting_qa item before the cron picks it up (allows manual review first). */
const AWAITING_QA_MIN_AGE_MINUTES = 5;

/** Minimum age of a retry_pending item before the cron runs the fallback. */
const RETRY_MIN_AGE_MINUTES = 30;

const SUPPORTED_WORK_TYPES = [
  'institutional_claim_status',
  'eligibility_verification',
  'denial_follow_up',
] as const;

const CLAUDE_HAIKU_MODEL = 'claude-haiku-4-5-20251001';

// ─── Public entry point ───────────────────────────────────────────────────────

export async function runRcmAutonomyLoop(env: Env): Promise<void> {
  const sql = createDb(env);
  try {
    // Phase 1: pick up routed items and run primary connector
    const routedItems = await sql<LoopWorkItem[]>`
      SELECT
        id,
        merchant_id    AS "merchantId",
        workspace_id   AS "workspaceId",
        work_type      AS "workType",
        claim_ref      AS "claimRef",
        payer_name     AS "payerName",
        coverage_type  AS "coverageType",
        patient_ref    AS "patientRef",
        provider_ref   AS "providerRef",
        form_type      AS "formType",
        source_system  AS "sourceSystem",
        amount_at_risk AS "amountAtRisk",
        metadata,
        priority,
        status
      FROM rcm_work_items
      WHERE status = 'routed'
        AND work_type = ANY(${sql.array(SUPPORTED_WORK_TYPES as unknown as string[])})
      ORDER BY
        CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
        created_at ASC
      LIMIT ${BATCH_ROUTED}
    `;

    for (const item of routedItems) {
      try {
        await processRoutedItem(sql, env, item);
      } catch (err) {
        console.error('[rcm-loop] routed item error', item.id, err instanceof Error ? err.message : err);
      }
    }

    // Phase 2: pick up awaiting_qa items and run Claude QA agent
    const qaItems = await sql<LoopWorkItem[]>`
      SELECT
        id,
        merchant_id    AS "merchantId",
        workspace_id   AS "workspaceId",
        work_type      AS "workType",
        claim_ref      AS "claimRef",
        payer_name     AS "payerName",
        coverage_type  AS "coverageType",
        patient_ref    AS "patientRef",
        provider_ref   AS "providerRef",
        form_type      AS "formType",
        source_system  AS "sourceSystem",
        amount_at_risk AS "amountAtRisk",
        metadata,
        priority,
        status
      FROM rcm_work_items
      WHERE status = 'awaiting_qa'
        AND work_type = ANY(${sql.array(SUPPORTED_WORK_TYPES as unknown as string[])})
        AND updated_at < NOW() - INTERVAL '${sql(String(AWAITING_QA_MIN_AGE_MINUTES))} minutes'
      ORDER BY created_at ASC
      LIMIT ${BATCH_AWAITING_QA}
    `;

    for (const item of qaItems) {
      try {
        await processAwaitingQaItem(sql, env, item);
      } catch (err) {
        console.error('[rcm-loop] qa item error', item.id, err instanceof Error ? err.message : err);
      }
    }

    // Phase 3: pick up retry_pending items and run fallback connector
    const retryItems = await sql<LoopWorkItem[]>`
      SELECT
        id,
        merchant_id    AS "merchantId",
        workspace_id   AS "workspaceId",
        work_type      AS "workType",
        claim_ref      AS "claimRef",
        payer_name     AS "payerName",
        coverage_type  AS "coverageType",
        patient_ref    AS "patientRef",
        provider_ref   AS "providerRef",
        form_type      AS "formType",
        source_system  AS "sourceSystem",
        amount_at_risk AS "amountAtRisk",
        metadata,
        priority,
        status
      FROM rcm_work_items
      WHERE status = 'retry_pending'
        AND work_type = ANY(${sql.array(SUPPORTED_WORK_TYPES as unknown as string[])})
        AND updated_at < NOW() - INTERVAL '${sql(String(RETRY_MIN_AGE_MINUTES))} minutes'
      ORDER BY created_at ASC
      LIMIT ${BATCH_RETRY}
    `;

    for (const item of retryItems) {
      try {
        await processRetryItem(sql, env, item);
      } catch (err) {
        console.error('[rcm-loop] retry item error', item.id, err instanceof Error ? err.message : err);
      }
    }
  } finally {
    await sql.end();
  }
}

// ─── Phase 1: process routed item ─────────────────────────────────────────────

async function processRoutedItem(sql: ReturnType<typeof createDb>, env: Env, item: LoopWorkItem): Promise<void> {
  // Claim the item with optimistic locking — skip if another process got there first
  const claimed = await sql`
    UPDATE rcm_work_items
    SET updated_at = NOW()
    WHERE id = ${item.id} AND status = 'routed'
    RETURNING id
  `;
  if (claimed.length === 0) return; // already picked up

  const metadata = parseJsonb<JsonRecord>(item.metadata, {});
  const attempts = getAttemptHistory(metadata);

  // Run the appropriate connector
  let connectorResult: AnyConnectorExecution;
  try {
    connectorResult = await runConnector(env, item, 'primary_worker', attempts);
  } catch (err) {
    // Connector error — escalate to human review
    await escalateToHumanReview(sql, item, {
      exceptionType: 'ambiguous_payer_response',
      severity: 'high',
      reasonCode: 'connector_execution_failed',
      summary: `Primary connector failed: ${err instanceof Error ? err.message : String(err)}`,
      payload: { error: err instanceof Error ? err.message : String(err), workType: item.workType },
    });
    return;
  }

  const attemptSummary = buildAttemptSummary(connectorResult, attempts.length + 1, 'primary_worker');
  const updatedMetadata = buildUpdatedMetadata(metadata, attemptSummary, connectorResult);

  const { autoQaRecommendation } = connectorResult as { autoQaRecommendation: string };

  if (autoQaRecommendation === 'close_auto') {
    await closeAuto(sql, item, connectorResult, updatedMetadata, 'connector_policy_auto_close', 'primary_worker');
  } else if (autoQaRecommendation === 'human_review_required') {
    const suggestion = getExceptionSuggestion(connectorResult);
    await escalateWithConnectorSuggestion(sql, item, connectorResult, updatedMetadata, suggestion, 'primary_worker');
  } else {
    // awaiting_qa — transition and immediately run Claude QA if key is available
    await sql`
      UPDATE rcm_work_items
      SET
        confidence_pct = ${connectorResult.confidencePct},
        status = 'awaiting_qa',
        requires_human_review = false,
        submitted_at = NOW(),
        metadata = ${jsonb(updatedMetadata)}::jsonb,
        updated_at = NOW()
      WHERE id = ${item.id}
    `;
    await insertEvidenceBatch(sql, item.id, buildConnectorEvidence(connectorResult, 'execution_resolution_proposed', 'primary_worker'));

    // Immediately run Claude QA so items don't wait for the next cron tick
    if (env.ANTHROPIC_API_KEY) {
      const qaDecision = await callClaudeQaAgent(env, item.workType, connectorResult, updatedMetadata);
      await applyQaDecision(sql, item, qaDecision, connectorResult, updatedMetadata);
    }
  }
}

// ─── Phase 2: process awaiting_qa item ────────────────────────────────────────

async function processAwaitingQaItem(sql: ReturnType<typeof createDb>, env: Env, item: LoopWorkItem): Promise<void> {
  if (!env.ANTHROPIC_API_KEY) return;

  const metadata = parseJsonb<JsonRecord>(item.metadata, {});
  const lastExecution = metadata['lastExecution'] as JsonRecord | undefined;

  const qaDecision = await callClaudeQaAgent(env, item.workType, lastExecution ?? {}, metadata);
  await applyQaDecision(sql, item, qaDecision, lastExecution ?? {}, metadata);
}

// ─── Phase 3: process retry_pending item ──────────────────────────────────────

async function processRetryItem(sql: ReturnType<typeof createDb>, env: Env, item: LoopWorkItem): Promise<void> {
  const metadata = parseJsonb<JsonRecord>(item.metadata, {});
  const attempts = getAttemptHistory(metadata);

  if (attempts.length === 0) {
    console.warn('[rcm-loop] retry_pending item has no attempt history', item.id);
    return;
  }

  // Max 2 autonomous attempts
  if (attempts.length >= 2) {
    await escalateToHumanReview(sql, item, {
      exceptionType: 'ambiguous_payer_response',
      severity: 'high',
      reasonCode: 'autonomous_attempts_exhausted',
      summary: 'Maximum autonomous attempts reached. Human review required.',
      payload: { attemptHistory: attempts },
    });
    return;
  }

  const claimed = await sql`
    UPDATE rcm_work_items
    SET updated_at = NOW()
    WHERE id = ${item.id} AND status = 'retry_pending'
    RETURNING id
  `;
  if (claimed.length === 0) return;

  let connectorResult: AnyConnectorExecution;
  try {
    connectorResult = await runConnector(env, item, 'fallback_worker', attempts);
  } catch (err) {
    await escalateToHumanReview(sql, item, {
      exceptionType: 'ambiguous_payer_response',
      severity: 'high',
      reasonCode: 'fallback_connector_failed',
      summary: `Fallback connector failed: ${err instanceof Error ? err.message : String(err)}`,
      payload: { error: err instanceof Error ? err.message : String(err), workType: item.workType },
    });
    return;
  }

  const attemptSummary = buildAttemptSummary(connectorResult, attempts.length + 1, 'fallback_worker');
  const updatedMetadata = buildUpdatedMetadata(metadata, attemptSummary, connectorResult);

  const { autoQaRecommendation } = connectorResult as { autoQaRecommendation: string };

  if (autoQaRecommendation === 'close_auto') {
    await closeAuto(sql, item, connectorResult, updatedMetadata, 'connector_policy_auto_close', 'fallback_worker');
  } else if (autoQaRecommendation === 'human_review_required') {
    const suggestion = getExceptionSuggestion(connectorResult);
    await escalateWithConnectorSuggestion(sql, item, connectorResult, updatedMetadata, suggestion, 'fallback_worker');
  } else {
    await sql`
      UPDATE rcm_work_items
      SET
        confidence_pct = ${connectorResult.confidencePct},
        status = 'awaiting_qa',
        requires_human_review = false,
        submitted_at = NOW(),
        metadata = ${jsonb(updatedMetadata)}::jsonb,
        updated_at = NOW()
      WHERE id = ${item.id}
    `;
    await insertEvidenceBatch(sql, item.id, buildConnectorEvidence(connectorResult, 'fallback_execution_submitted', 'fallback_worker'));

    if (env.ANTHROPIC_API_KEY) {
      const qaDecision = await callClaudeQaAgent(env, item.workType, connectorResult, updatedMetadata);
      await applyQaDecision(sql, item, qaDecision, connectorResult, updatedMetadata);
    }
  }
}

// ─── Connector dispatcher ─────────────────────────────────────────────────────

async function runConnector(
  env: Env,
  item: LoopWorkItem,
  role: 'primary_worker' | 'fallback_worker',
  attempts: JsonRecord[],
): Promise<AnyConnectorExecution> {
  const previousConnector =
    attempts.length > 0
      ? (attempts[attempts.length - 1]?.['connectorStrategy'] as string | undefined)
      : undefined;

  switch (item.workType) {
    case 'institutional_claim_status': {
      // Fallback uses portal if primary was x12_276_277 (but portal is manual, so we escalate instead)
      const connectorKey = role === 'fallback_worker' && previousConnector === 'x12_276_277'
        ? 'x12_276_277' // retry same connector with different parameters — connector handles internally
        : 'x12_276_277';
      const input: ClaimStatusConnectorExecutionInput = {
        workItemId: item.id,
        claimRef: item.claimRef ?? '',
        payerName: item.payerName ?? '',
        coverageType: item.coverageType ?? '',
        patientRef: item.patientRef ?? '',
        providerRef: item.providerRef ?? '',
        formType: item.formType ?? '',
        sourceSystem: item.sourceSystem ?? '',
        amountAtRisk: item.amountAtRisk ? Number(item.amountAtRisk) : null,
        metadata: parseJsonb<JsonRecord>(item.metadata, {}),
      };
      return runClaimStatusConnector(env, connectorKey, input);
    }

    case 'eligibility_verification': {
      const meta = parseJsonb<JsonRecord>(item.metadata, {});
      const input: EligibilityConnectorExecutionInput = {
        workItemId: item.id,
        memberId: item.claimRef ?? '',
        payerName: item.payerName ?? '',
        payerId: typeof meta['payerId'] === 'string' ? meta['payerId'] : null,
        coverageType: item.coverageType ?? '',
        patientRef: item.patientRef ?? '',
        providerRef: item.providerRef ?? '',
        providerNpi: typeof meta['providerNpi'] === 'string' ? meta['providerNpi'] : '',
        dateOfService: typeof meta['dateOfService'] === 'string' ? meta['dateOfService'] : '',
        serviceTypeCodes: Array.isArray(meta['serviceTypeCodes'])
          ? meta['serviceTypeCodes'].filter((s): s is string => typeof s === 'string')
          : [],
        formType: item.formType ?? '',
        sourceSystem: item.sourceSystem ?? '',
        metadata: meta,
      };
      return runEligibilityConnector(env, 'x12_270_271', input);
    }

    case 'denial_follow_up': {
      const meta = parseJsonb<JsonRecord>(item.metadata, {});
      const input: DenialFollowUpConnectorExecutionInput = {
        workItemId: item.id,
        claimRef: item.claimRef ?? '',
        payerName: item.payerName ?? '',
        coverageType: item.coverageType ?? '',
        patientRef: item.patientRef ?? '',
        providerRef: item.providerRef ?? '',
        denialReasonCode: typeof meta['denialReasonCode'] === 'string' ? meta['denialReasonCode'] : '',
        denialDate: typeof meta['denialDate'] === 'string' ? meta['denialDate'] : '',
        appealDeadline: typeof meta['appealDeadline'] === 'string' ? meta['appealDeadline'] : '',
        formType: item.formType ?? '',
        sourceSystem: item.sourceSystem ?? '',
        amountAtRisk: item.amountAtRisk ? Number(item.amountAtRisk) : null,
        metadata: meta,
      };
      return runDenialFollowUpConnector(env, 'x12_appeal_inquiry', input);
    }

    default:
      throw new Error(`Unsupported work type for autonomy loop: ${item.workType}`);
  }
}

// ─── Claude QA agent ──────────────────────────────────────────────────────────

interface QaAgentDecision {
  qaDecision: 'approve_auto_close' | 'retry_with_next_worker' | 'escalate';
  qaReasonCode: string;
}

async function callClaudeQaAgent(
  env: Env,
  workType: string,
  connectorResult: AnyConnectorExecution | JsonRecord,
  workItemMetadata: JsonRecord,
): Promise<QaAgentDecision> {
  const confidencePct =
    typeof (connectorResult as { confidencePct?: number }).confidencePct === 'number'
      ? (connectorResult as { confidencePct: number }).confidencePct
      : 0;
  const attempts = getAttemptHistory(workItemMetadata);

  const systemPrompt = `You are an autonomous QA agent for medical billing RCM (Revenue Cycle Management).
Review connector results and make QA decisions to close claims, request retries, or escalate to humans.
Always respond with valid JSON only — no explanation, no markdown.`;

  const userPrompt = `Work type: ${workType}
Connector result: ${JSON.stringify(connectorResult, null, 2)}
Attempt number: ${attempts.length}
Max autonomous attempts: 2

Decision rules:
- approve_auto_close: confidence >= 75, clear status, no missing documentation, no appeal required
- retry_with_next_worker: confidence < 60 OR ambiguous result AND attempt_number < 2
- escalate: connector failure, missing critical documentation, denial requiring human judgment, OR attempt_number >= 2 with low confidence

Respond with JSON only: {"qaDecision": "approve_auto_close|retry_with_next_worker|escalate", "qaReasonCode": "snake_case_one_word_reason"}`;

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': env.ANTHROPIC_API_KEY!,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: CLAUDE_HAIKU_MODEL,
        max_tokens: 128,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!resp.ok) throw new Error(`Claude QA API ${resp.status}`);

    const data = (await resp.json()) as { content?: Array<{ text?: string }> };
    const text = data?.content?.[0]?.text ?? '';
    const parsed = JSON.parse(text) as Partial<QaAgentDecision>;

    const valid = ['approve_auto_close', 'retry_with_next_worker', 'escalate'];
    if (!valid.includes(parsed.qaDecision ?? '')) throw new Error('Invalid qaDecision');
    if (typeof parsed.qaReasonCode !== 'string') throw new Error('Invalid qaReasonCode');

    return { qaDecision: parsed.qaDecision!, qaReasonCode: parsed.qaReasonCode };
  } catch (err) {
    console.warn('[rcm-loop] Claude QA fallback to threshold logic:', err instanceof Error ? err.message : err);
    // Threshold-based fallback when Claude is unavailable
    if (confidencePct >= 80) return { qaDecision: 'approve_auto_close', qaReasonCode: 'threshold_auto_close' };
    if (confidencePct >= 60 && attempts.length < 2) return { qaDecision: 'retry_with_next_worker', qaReasonCode: 'threshold_retry' };
    return { qaDecision: 'escalate', qaReasonCode: 'threshold_escalate' };
  }
}

// ─── Apply QA decision ────────────────────────────────────────────────────────

async function applyQaDecision(
  sql: ReturnType<typeof createDb>,
  item: LoopWorkItem,
  decision: QaAgentDecision,
  connectorResult: AnyConnectorExecution | JsonRecord,
  metadata: JsonRecord,
): Promise<void> {
  const qaPayload = {
    qaDecision: decision.qaDecision,
    qaReasonCode: decision.qaReasonCode,
    source: 'rcm_autonomy_loop',
    reviewedAt: new Date().toISOString(),
  };
  const nextMetadata = { ...metadata, lastQaDecision: qaPayload };

  if (decision.qaDecision === 'approve_auto_close') {
    await sql`
      UPDATE rcm_work_items
      SET
        status = 'closed_auto',
        requires_human_review = false,
        completed_at = NOW(),
        metadata = ${jsonb(nextMetadata)}::jsonb,
        updated_at = NOW()
      WHERE id = ${item.id} AND status = 'awaiting_qa'
    `;
    await resolveOpenExceptions(sql, item.id);
    await insertEvidenceBatch(sql, item.id, [{
      actorType: 'qa_agent',
      actorRef: 'rcm_autonomy_loop',
      evidenceType: 'qa_decision_recorded',
      payload: qaPayload,
    }]);

  } else if (decision.qaDecision === 'retry_with_next_worker') {
    await sql`
      UPDATE rcm_work_items
      SET
        status = 'retry_pending',
        metadata = ${jsonb(nextMetadata)}::jsonb,
        updated_at = NOW()
      WHERE id = ${item.id} AND status = 'awaiting_qa'
    `;
    await insertEvidenceBatch(sql, item.id, [{
      actorType: 'qa_agent',
      actorRef: 'rcm_autonomy_loop',
      evidenceType: 'qa_decision_recorded',
      payload: qaPayload,
    }]);

  } else {
    // escalate
    const connResult = connectorResult as Partial<{ exceptionSuggestion: JsonRecord; resolutionReasonCode: string; summary: string }>;
    const suggestion = connResult.exceptionSuggestion ?? null;
    await upsertOpenException(sql, item.id, {
      exceptionType:
        typeof (suggestion as JsonRecord | null)?.['exceptionType'] === 'string'
          ? ((suggestion as JsonRecord)['exceptionType'] as string)
          : 'ambiguous_payer_response',
      severity: typeof (suggestion as JsonRecord | null)?.['severity'] === 'string'
        ? ((suggestion as JsonRecord)['severity'] as string)
        : 'high',
      reasonCode: decision.qaReasonCode,
      summary:
        typeof (connResult.summary) === 'string'
          ? connResult.summary
          : 'QA agent escalated for human review.',
      payload: {
        qaDecision: decision.qaDecision,
        qaReasonCode: decision.qaReasonCode,
        source: 'rcm_autonomy_loop',
      },
    });
    await sql`
      UPDATE rcm_work_items
      SET
        status = 'human_review_required',
        requires_human_review = true,
        metadata = ${jsonb(nextMetadata)}::jsonb,
        updated_at = NOW()
      WHERE id = ${item.id} AND status = 'awaiting_qa'
    `;
    await insertEvidenceBatch(sql, item.id, [{
      actorType: 'qa_agent',
      actorRef: 'rcm_autonomy_loop',
      evidenceType: 'qa_decision_recorded',
      payload: qaPayload,
    }]);
  }
}

// ─── DB helpers (loop-local equivalents of rcm.ts private helpers) ────────────

async function closeAuto(
  sql: ReturnType<typeof createDb>,
  item: LoopWorkItem,
  connectorResult: AnyConnectorExecution,
  updatedMetadata: JsonRecord,
  qaReasonCode: string,
  role: string,
): Promise<void> {
  await sql`
    UPDATE rcm_work_items
    SET
      confidence_pct = ${connectorResult.confidencePct},
      status = 'closed_auto',
      requires_human_review = false,
      submitted_at = NOW(),
      completed_at = NOW(),
      metadata = ${jsonb(updatedMetadata)}::jsonb,
      updated_at = NOW()
    WHERE id = ${item.id}
  `;
  await resolveOpenExceptions(sql, item.id);
  const evidenceRole = role === 'primary_worker' ? 'execution_resolution_proposed' : 'fallback_execution_submitted';
  await insertEvidenceBatch(sql, item.id, [
    ...buildConnectorEvidence(connectorResult, evidenceRole, role),
    {
      actorType: 'qa_agent',
      actorRef: 'rcm_autonomy_loop',
      evidenceType: 'qa_decision_recorded',
      payload: {
        qaDecision: 'approve_auto_close',
        qaReasonCode,
        source: 'connector_policy_loop',
        reviewedAt: new Date().toISOString(),
      },
    },
  ]);
}

async function escalateWithConnectorSuggestion(
  sql: ReturnType<typeof createDb>,
  item: LoopWorkItem,
  connectorResult: AnyConnectorExecution,
  updatedMetadata: JsonRecord,
  suggestion: JsonRecord,
  role: string,
): Promise<void> {
  await upsertOpenException(sql, item.id, {
    exceptionType: typeof suggestion['exceptionType'] === 'string' ? suggestion['exceptionType'] : 'ambiguous_payer_response',
    severity: typeof suggestion['severity'] === 'string' ? suggestion['severity'] : 'high',
    reasonCode: typeof suggestion['reasonCode'] === 'string' ? suggestion['reasonCode'] : 'connector_policy_escalation',
    summary: typeof suggestion['summary'] === 'string' ? suggestion['summary'] : 'Connector requires human review.',
    payload: {
      requiredContextFields: suggestion['requiredContextFields'] ?? [],
      recommendedHumanAction: suggestion['recommendedHumanAction'] ?? 'Review and resolve manually.',
      connectorKey: connectorResult.connectorKey,
      connectorMode: connectorResult.mode,
      connectorTraceId: connectorResult.connectorTraceId,
    },
  });
  await sql`
    UPDATE rcm_work_items
    SET
      confidence_pct = ${connectorResult.confidencePct},
      status = 'human_review_required',
      requires_human_review = true,
      submitted_at = NOW(),
      metadata = ${jsonb(updatedMetadata)}::jsonb,
      updated_at = NOW()
    WHERE id = ${item.id}
  `;
  const evidenceRole = role === 'primary_worker' ? 'execution_resolution_proposed' : 'fallback_execution_submitted';
  await insertEvidenceBatch(sql, item.id, buildConnectorEvidence(connectorResult, evidenceRole, role));
}

async function escalateToHumanReview(
  sql: ReturnType<typeof createDb>,
  item: LoopWorkItem,
  params: { exceptionType: string; severity: string; reasonCode: string; summary: string; payload: JsonRecord },
): Promise<void> {
  await upsertOpenException(sql, item.id, params);
  await sql`
    UPDATE rcm_work_items
    SET
      status = 'human_review_required',
      requires_human_review = true,
      updated_at = NOW()
    WHERE id = ${item.id}
  `;
  await insertEvidenceBatch(sql, item.id, [{
    actorType: 'qa_agent',
    actorRef: 'rcm_autonomy_loop',
    evidenceType: 'qa_decision_recorded',
    payload: { qaDecision: 'escalate', qaReasonCode: params.reasonCode, source: 'rcm_autonomy_loop' },
  }]);
}

async function insertEvidenceBatch(
  sql: ReturnType<typeof createDb>,
  workItemId: string,
  items: Array<{ actorType?: string; actorRef?: string; evidenceType: string; payload?: unknown }>,
): Promise<void> {
  for (const item of items) {
    await sql`
      INSERT INTO rcm_work_item_evidence
        (id, work_item_id, actor_type, actor_ref, evidence_type, payload, created_at)
      VALUES
        (
          ${crypto.randomUUID()},
          ${workItemId},
          ${item.actorType ?? 'system'},
          ${item.actorRef ?? 'rcm_autonomy_loop'},
          ${item.evidenceType},
          ${jsonb(item.payload ?? {})}::jsonb,
          NOW()
        )
    `;
  }
}

async function resolveOpenExceptions(sql: ReturnType<typeof createDb>, workItemId: string): Promise<void> {
  await sql`
    UPDATE rcm_exceptions
    SET resolved_at = NOW()
    WHERE work_item_id = ${workItemId}
      AND resolved_at IS NULL
  `;
}

async function upsertOpenException(
  sql: ReturnType<typeof createDb>,
  workItemId: string,
  params: { exceptionType: string; severity: string; reasonCode: string; summary: string; payload: JsonRecord },
): Promise<void> {
  const existing = await sql<Array<{ id: string }>>`
    SELECT id
    FROM rcm_exceptions
    WHERE work_item_id = ${workItemId}
      AND resolved_at IS NULL
    ORDER BY created_at DESC
    LIMIT 1
  `;
  if (existing[0]) {
    await sql`
      UPDATE rcm_exceptions
      SET
        exception_type = ${params.exceptionType},
        severity = ${params.severity},
        reason_code = ${params.reasonCode},
        summary = ${params.summary},
        payload = ${jsonb(params.payload)}::jsonb
      WHERE id = ${existing[0].id}
    `;
  } else {
    await sql`
      INSERT INTO rcm_exceptions (id, work_item_id, exception_type, severity, reason_code, summary, payload, created_at)
      VALUES (
        ${crypto.randomUUID()},
        ${workItemId},
        ${params.exceptionType},
        ${params.severity},
        ${params.reasonCode},
        ${params.summary},
        ${jsonb(params.payload)}::jsonb,
        NOW()
      )
    `;
  }
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

function jsonb(value: unknown): string {
  return JSON.stringify(value ?? {});
}

function getAttemptHistory(metadata: JsonRecord): JsonRecord[] {
  const attempts = metadata['attemptHistory'];
  return Array.isArray(attempts)
    ? attempts.filter((e): e is JsonRecord => Boolean(e) && typeof e === 'object')
    : [];
}

function buildAttemptSummary(
  result: AnyConnectorExecution,
  attemptNumber: number,
  role: 'primary_worker' | 'fallback_worker',
): JsonRecord {
  return {
    attemptNumber,
    attemptRole: role,
    strategy: result.connectorKey,
    connectorStrategy: result.connectorKey,
    connectorMode: result.mode,
    proposedResolution: result.proposedResolution,
    resolutionReasonCode: result.resolutionReasonCode,
    confidencePct: result.confidencePct,
    submittedAt: result.performedAt,
    connectorTraceId: result.connectorTraceId,
    statusCode: result.statusCode,
    statusLabel: result.statusLabel,
    evidenceTypes: result.evidence.map((e) => e.evidenceType),
  };
}

function buildUpdatedMetadata(
  existing: JsonRecord,
  attemptSummary: JsonRecord,
  result: AnyConnectorExecution,
): JsonRecord {
  const attempts = getAttemptHistory(existing);
  return {
    ...existing,
    lastExecution: attemptSummary,
    lastConnectorRun: {
      connectorKey: result.connectorKey,
      mode: result.mode,
      statusCode: result.statusCode,
      statusLabel: result.statusLabel,
      traceId: result.connectorTraceId,
      summary: result.summary,
      performedAt: result.performedAt,
      source: 'rcm_autonomy_loop',
    },
    attemptHistory: [...attempts, attemptSummary],
  };
}

function buildConnectorEvidence(
  result: AnyConnectorExecution,
  summaryEvidenceType: string,
  role: string,
): Array<{ actorType: string; actorRef: string; evidenceType: string; payload?: unknown }> {
  const workerActorType = role === 'primary_worker' ? 'worker_agent' : 'fallback_worker_agent';
  const workerActorRef = role === 'primary_worker' ? 'rcm_loop_primary' : 'rcm_loop_fallback';
  return [
    ...result.evidence.map((item) => ({
      actorType: item.actorType ?? workerActorType,
      actorRef: item.actorRef ?? workerActorRef,
      evidenceType: item.evidenceType,
      payload: item.payload,
    })),
    {
      actorType: workerActorType,
      actorRef: workerActorRef,
      evidenceType: summaryEvidenceType,
      payload: {
        connectorKey: result.connectorKey,
        mode: result.mode,
        statusCode: result.statusCode,
        statusLabel: result.statusLabel,
        confidencePct: result.confidencePct,
        proposedResolution: result.proposedResolution,
        source: 'rcm_autonomy_loop',
      },
    },
  ];
}

function getExceptionSuggestion(result: AnyConnectorExecution): JsonRecord {
  const suggestion = (result as { exceptionSuggestion?: JsonRecord }).exceptionSuggestion;
  return suggestion ?? {
    exceptionType: 'ambiguous_payer_response',
    severity: 'high',
    summary: result.summary,
    recommendedHumanAction: 'Review the connector result and decide whether to take over or add context.',
    requiredContextFields: ['payer_follow_up_context'],
    reasonCode: result.resolutionReasonCode,
  };
}
