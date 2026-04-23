import type { Env } from '../types';

export type ClaimStatusConnectorKey = 'x12_276_277' | 'portal' | 'dde';
export type ClaimStatusConnectorMode = 'remote' | 'simulation' | 'manual';
export type ClaimStatusAutoQaRecommendation =
  | 'close_auto'
  | 'awaiting_qa'
  | 'human_review_required';

export interface ClaimStatusConnectorEvidence {
  actorType?: string;
  actorRef?: string;
  evidenceType: string;
  payload?: unknown;
}

export interface ClaimStatusExceptionSuggestion {
  exceptionType:
    | 'missing_documentation'
    | 'credentialing_or_enrollment_gap'
    | 'coverage_mismatch'
    | 'portal_or_dde_access_failure'
    | 'ambiguous_payer_response'
    | 'underpayment_or_partial_payment';
  severity: 'low' | 'normal' | 'high' | 'critical';
  summary: string;
  recommendedHumanAction: string;
  requiredContextFields: string[];
  reasonCode: string;
}

export interface ClaimStatusConnectorAvailability {
  key: ClaimStatusConnectorKey;
  label: string;
  status: 'live' | 'simulation' | 'manual_fallback';
  mode: ClaimStatusConnectorMode;
  configured: boolean;
  capabilities: string[];
  notes: string;
}

export interface ClaimStatusConnectorExecutionInput {
  workItemId: string;
  claimRef: string;
  payerName: string;
  coverageType: string;
  patientRef: string;
  providerRef: string;
  formType: string;
  sourceSystem: string;
  amountAtRisk: number | null;
  metadata: Record<string, unknown>;
}

export interface ClaimStatusConnectorExecution {
  connectorKey: ClaimStatusConnectorKey;
  mode: ClaimStatusConnectorMode;
  performedAt: string;
  strategy: string;
  statusCode: string;
  statusLabel: string;
  connectorTraceId: string | null;
  proposedResolution: string;
  resolutionReasonCode: string;
  confidencePct: number;
  nextBestAction: string;
  autoQaRecommendation: ClaimStatusAutoQaRecommendation;
  evidence: ClaimStatusConnectorEvidence[];
  exceptionSuggestion?: ClaimStatusExceptionSuggestion;
  summary: string;
  rawResponse: Record<string, unknown>;
}

type NormalizedStatus =
  | 'processed'
  | 'paid'
  | 'pending'
  | 'additional_information_required'
  | 'denied'
  | 'rejected'
  | 'partial_paid'
  | 'transport_failed';

type RemoteConnectorResponse = {
  statusCode?: string;
  statusLabel?: string;
  summary?: string;
  reasonCode?: string;
  traceId?: string;
  amountPaid?: number | string | null;
  payerMessage?: string;
  requiredContextFields?: string[];
  recommendedHumanAction?: string;
  rawResponse?: Record<string, unknown>;
};

const DEFAULT_TIMEOUT_MS = 12000;

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function pickString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function pickNumber(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) {
      return Number(value);
    }
  }
  return null;
}

function normalizeStatusCode(rawStatus: string | null): {
  normalized: NormalizedStatus;
  statusCode: string;
  statusLabel: string;
} {
  const status = (rawStatus ?? '').trim().toLowerCase().replace(/\s+/g, '_');

  if (['accepted', 'processed', 'claim_processed', 'finalized'].includes(status)) {
    return { normalized: 'processed', statusCode: 'processed', statusLabel: 'Processed' };
  }
  if (['paid', 'payment_issued', 'claim_paid'].includes(status)) {
    return { normalized: 'paid', statusCode: 'paid', statusLabel: 'Paid' };
  }
  if (['pending', 'in_process', 'received', 'claim_in_process'].includes(status)) {
    return { normalized: 'pending', statusCode: 'pending', statusLabel: 'In process' };
  }
  if (
    ['additional_information_required', 'documentation_required', 'needs_docs', 'attachment_needed'].includes(
      status,
    )
  ) {
    return {
      normalized: 'additional_information_required',
      statusCode: 'additional_information_required',
      statusLabel: 'Additional information required',
    };
  }
  if (['denied', 'non_covered', 'coverage_denied'].includes(status)) {
    return { normalized: 'denied', statusCode: 'denied', statusLabel: 'Denied' };
  }
  if (['rejected', 'rejected_front_end', 'invalid_submission'].includes(status)) {
    return { normalized: 'rejected', statusCode: 'rejected', statusLabel: 'Rejected' };
  }
  if (['partial_paid', 'underpaid', 'partial_payment'].includes(status)) {
    return { normalized: 'partial_paid', statusCode: 'partial_paid', statusLabel: 'Partial payment' };
  }
  if (['transport_failed', 'connector_failed', 'unreachable'].includes(status)) {
    return { normalized: 'transport_failed', statusCode: 'transport_failed', statusLabel: 'Connector failure' };
  }

  return { normalized: 'pending', statusCode: 'pending', statusLabel: 'In process' };
}

function deterministicSimulation(
  input: ClaimStatusConnectorExecutionInput,
): RemoteConnectorResponse {
  const metadata = asObject(input.metadata);
  const connectorSimulation = asObject(metadata['connectorSimulation']);
  const x12Simulation = asObject(connectorSimulation['x12_276_277']);

  const explicitStatus = pickString(
    x12Simulation['statusCode'],
    x12Simulation['status'],
    x12Simulation['claimStatus'],
  );
  if (explicitStatus) {
    return {
      statusCode: explicitStatus,
      statusLabel: pickString(x12Simulation['statusLabel']) ?? undefined,
      summary: pickString(x12Simulation['summary']) ?? undefined,
      reasonCode: pickString(x12Simulation['reasonCode']) ?? undefined,
      traceId: pickString(x12Simulation['traceId']) ?? undefined,
      amountPaid: pickNumber(x12Simulation['amountPaid']),
      payerMessage: pickString(x12Simulation['payerMessage']) ?? undefined,
      requiredContextFields: Array.isArray(x12Simulation['requiredContextFields'])
        ? x12Simulation['requiredContextFields'].filter(
            (value): value is string => typeof value === 'string' && value.trim().length > 0,
          )
        : undefined,
      recommendedHumanAction: pickString(x12Simulation['recommendedHumanAction']) ?? undefined,
      rawResponse: x12Simulation,
    };
  }

  const claimRef = input.claimRef.toUpperCase();
  if (claimRef.includes('PAID') || claimRef.includes('PROC')) {
    return {
      statusCode: 'paid',
      summary: '276/277 returned a paid / processed claim status.',
      amountPaid: input.amountAtRisk ?? 0,
    };
  }
  if (claimRef.includes('PEND') || claimRef.includes('IP')) {
    return {
      statusCode: 'pending',
      summary: '276/277 returned an in-process claim status.',
    };
  }
  if (claimRef.includes('DOC') || claimRef.includes('ATT')) {
    return {
      statusCode: 'additional_information_required',
      summary: '276/277 indicates supporting documentation is still required.',
      reasonCode: 'documentation_gap_detected',
      requiredContextFields: ['supporting_attachment_bundle', 'provider_signature_packet'],
      recommendedHumanAction: 'Collect the missing document set and re-run the lane.',
    };
  }
  if (claimRef.includes('DENY') || claimRef.includes('NOCOV')) {
    return {
      statusCode: 'denied',
      summary: '276/277 indicates the claim is denied or not covered.',
      reasonCode: 'payer_status_requires_follow_up',
      recommendedHumanAction: 'Route to denial follow-up or coverage review.',
    };
  }
  if (claimRef.includes('REJ') || claimRef.includes('FRONT')) {
    return {
      statusCode: 'rejected',
      summary: '276/277 indicates the claim was rejected before payer processing.',
      reasonCode: 'submission_rejected',
      recommendedHumanAction: 'Review submission details and correction path.',
    };
  }
  if (claimRef.includes('PART') || claimRef.includes('UNDER')) {
    return {
      statusCode: 'partial_paid',
      summary: '276/277 indicates only partial payment has been issued.',
      reasonCode: 'underpayment_detected',
      amountPaid: input.amountAtRisk ? input.amountAtRisk * 0.95 : null,
      recommendedHumanAction: 'Review remittance and underpayment recovery path.',
    };
  }

  const hash = Array.from(claimRef).reduce((acc, char) => acc + char.charCodeAt(0), 0) % 4;
  if (hash === 0) {
    return {
      statusCode: 'processed',
      summary: '276/277 returned a processed status.',
    };
  }
  if (hash === 1) {
    return {
      statusCode: 'pending',
      summary: '276/277 returned an in-process status.',
    };
  }
  if (hash === 2) {
    return {
      statusCode: 'additional_information_required',
      summary: '276/277 indicates additional information is required.',
      reasonCode: 'documentation_gap_detected',
      requiredContextFields: ['supporting_attachment_bundle'],
      recommendedHumanAction: 'Collect missing documents and re-run.',
    };
  }
  return {
    statusCode: 'denied',
    summary: '276/277 indicates the claim requires payer-side follow-up.',
    reasonCode: 'payer_status_requires_follow_up',
    recommendedHumanAction: 'Move into exception review.',
  };
}

async function runRemoteX12ClaimStatus(
  env: Env,
  input: ClaimStatusConnectorExecutionInput,
): Promise<RemoteConnectorResponse> {
  const apiUrl = env.RCM_X12_CLAIM_STATUS_API_URL;
  const apiKey = env.RCM_X12_CLAIM_STATUS_API_KEY;

  if (!apiUrl || !apiKey) {
    return deterministicSimulation(input);
  }

  const timeoutMsRaw = env.RCM_X12_CLAIM_STATUS_TIMEOUT_MS;
  const timeoutMs =
    typeof timeoutMsRaw === 'string' && Number.isFinite(Number(timeoutMsRaw))
      ? Number(timeoutMsRaw)
      : DEFAULT_TIMEOUT_MS;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const metadata = asObject(input.metadata);
    const body = {
      claimRef: input.claimRef,
      payerName: input.payerName,
      coverageType: input.coverageType,
      patientRef: input.patientRef,
      providerRef: input.providerRef,
      formType: input.formType,
      sourceSystem: input.sourceSystem,
      amountAtRisk: input.amountAtRisk,
      supportingDocRefs: Array.isArray(metadata['supportingDocRefs']) ? metadata['supportingDocRefs'] : [],
      originalSubmissionDate: pickString(metadata['originalSubmissionDate']),
      claimFrequencyCode: pickString(metadata['claimFrequencyCode']),
      macRegion: pickString(metadata['macRegion']),
      portalChannel: pickString(metadata['portalChannel']),
      metadata,
    };

    const response = await fetch(
      `${apiUrl.replace(/\/$/, '')}/claim-status/276-277`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      },
    );

    const json = (await response.json()) as Record<string, unknown>;
    if (!response.ok) {
      return {
        statusCode: 'transport_failed',
        summary: `X12 connector returned ${response.status}.`,
        reasonCode: 'connector_transport_failed',
        recommendedHumanAction: 'Check the connector and route to exception handling if the issue persists.',
        rawResponse: json,
      };
    }

    return {
      statusCode: pickString(json['statusCode'], json['status'], json['claimStatus']) ?? 'pending',
      statusLabel: pickString(json['statusLabel']) ?? undefined,
      summary: pickString(json['summary']) ?? undefined,
      reasonCode: pickString(json['reasonCode']) ?? undefined,
      traceId: pickString(json['traceId'], json['payerTraceId'], json['requestId']) ?? undefined,
      amountPaid: pickNumber(json['amountPaid'], json['paidAmount']),
      payerMessage: pickString(json['payerMessage'], json['message']) ?? undefined,
      requiredContextFields: Array.isArray(json['requiredContextFields'])
        ? json['requiredContextFields'].filter(
            (value): value is string => typeof value === 'string' && value.trim().length > 0,
          )
        : undefined,
      recommendedHumanAction: pickString(json['recommendedHumanAction']) ?? undefined,
      rawResponse: json,
    };
  } catch (err: unknown) {
    return {
      statusCode: 'transport_failed',
      summary: err instanceof Error ? err.message : 'Connector request failed.',
      reasonCode: 'connector_transport_failed',
      recommendedHumanAction: 'Check connector availability and route to exception handling if needed.',
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

function buildExecutionFromStatus(
  connectorKey: ClaimStatusConnectorKey,
  mode: ClaimStatusConnectorMode,
  raw: RemoteConnectorResponse,
): ClaimStatusConnectorExecution {
  const performedAt = new Date().toISOString();
  const normalized = normalizeStatusCode(raw.statusCode ?? null);
  const traceId = raw.traceId ?? `rcm-${connectorKey}-${crypto.randomUUID().slice(0, 8)}`;
  const amountPaid = pickNumber(raw.amountPaid);

  let proposedResolution = '';
  let resolutionReasonCode = raw.reasonCode ?? normalized.statusCode;
  let confidencePct = 70;
  let nextBestAction = 'qa_verify';
  let autoQaRecommendation: ClaimStatusAutoQaRecommendation = 'awaiting_qa';
  let exceptionSuggestion: ClaimStatusExceptionSuggestion | undefined;

  if (normalized.normalized === 'processed' || normalized.normalized === 'paid') {
    proposedResolution = `${normalized.statusLabel} via 276/277. Claim status is clearly established and ready to close without human touch.`;
    resolutionReasonCode = normalized.normalized === 'paid' ? 'claim_paid_confirmed' : 'claim_status_confirmed';
    confidencePct = normalized.normalized === 'paid' ? 95 : 92;
    nextBestAction = 'approve_auto_close';
    autoQaRecommendation = 'close_auto';
  } else if (normalized.normalized === 'pending') {
    proposedResolution = '276/277 confirms the claim is still in payer processing. The status is established, so the queue can close this follow-up cycle automatically.';
    resolutionReasonCode = 'claim_in_process_confirmed';
    confidencePct = 88;
    nextBestAction = 'approve_auto_close';
    autoQaRecommendation = 'close_auto';
  } else if (normalized.normalized === 'additional_information_required') {
    proposedResolution = '276/277 indicates additional documentation or clarification is still required before the claim can progress.';
    resolutionReasonCode = raw.reasonCode ?? 'documentation_gap_detected';
    confidencePct = 74;
    nextBestAction = 'collect_missing_context';
    autoQaRecommendation = 'human_review_required';
    exceptionSuggestion = {
      exceptionType: 'missing_documentation',
      severity: 'high',
      summary: raw.summary ?? 'Additional documentation is required before the claim can progress.',
      recommendedHumanAction:
        raw.recommendedHumanAction ?? 'Collect the missing documentation set and rerun the lane.',
      requiredContextFields: raw.requiredContextFields ?? ['supporting_attachment_bundle'],
      reasonCode: resolutionReasonCode,
    };
  } else if (normalized.normalized === 'partial_paid') {
    proposedResolution = '276/277 indicates payment was issued, but not for the full expected amount. The case should move into human review for underpayment handling.';
    resolutionReasonCode = raw.reasonCode ?? 'underpayment_detected';
    confidencePct = 82;
    nextBestAction = 'review_underpayment';
    autoQaRecommendation = 'human_review_required';
    exceptionSuggestion = {
      exceptionType: 'underpayment_or_partial_payment',
      severity: 'high',
      summary: raw.summary ?? 'Partial payment detected on the claim status response.',
      recommendedHumanAction:
        raw.recommendedHumanAction ?? 'Review remittance and underpayment recovery path.',
      requiredContextFields: raw.requiredContextFields ?? ['era_835_reference'],
      reasonCode: resolutionReasonCode,
    };
  } else if (normalized.normalized === 'denied') {
    proposedResolution = '276/277 indicates the claim is denied or not covered. The lane should stop here and route the case into human follow-up.';
    resolutionReasonCode = raw.reasonCode ?? 'payer_status_requires_follow_up';
    confidencePct = 80;
    nextBestAction = 'route_to_exception_inbox';
    autoQaRecommendation = 'human_review_required';
    exceptionSuggestion = {
      exceptionType: 'coverage_mismatch',
      severity: 'high',
      summary: raw.summary ?? 'Claim was denied or marked not covered by the payer.',
      recommendedHumanAction:
        raw.recommendedHumanAction ?? 'Review denial reason and decide whether to correct or appeal.',
      requiredContextFields: raw.requiredContextFields ?? ['coverage_validation_context'],
      reasonCode: resolutionReasonCode,
    };
  } else if (normalized.normalized === 'rejected') {
    proposedResolution = '276/277 indicates the claim was rejected before payer processing. The system should route this case into correction review.';
    resolutionReasonCode = raw.reasonCode ?? 'submission_rejected';
    confidencePct = 78;
    nextBestAction = 'route_to_exception_inbox';
    autoQaRecommendation = 'human_review_required';
    exceptionSuggestion = {
      exceptionType: 'ambiguous_payer_response',
      severity: 'high',
      summary: raw.summary ?? 'Claim was rejected before payer processing.',
      recommendedHumanAction:
        raw.recommendedHumanAction ?? 'Review claim submission details and determine correction path.',
      requiredContextFields: raw.requiredContextFields ?? ['claim_submission_audit'],
      reasonCode: resolutionReasonCode,
    };
  } else {
    proposedResolution = 'The connector did not return a stable claim status. The queue should route this case into human review.';
    resolutionReasonCode = raw.reasonCode ?? 'connector_transport_failed';
    confidencePct = 42;
    nextBestAction = 'route_to_exception_inbox';
    autoQaRecommendation = 'human_review_required';
    exceptionSuggestion = {
      exceptionType: 'portal_or_dde_access_failure',
      severity: 'high',
      summary: raw.summary ?? 'The connector could not establish a reliable claim status.',
      recommendedHumanAction:
        raw.recommendedHumanAction ?? 'Check connector access and route to manual review if needed.',
      requiredContextFields: raw.requiredContextFields ?? ['connector_access_context'],
      reasonCode: resolutionReasonCode,
    };
  }

  const evidence: ClaimStatusConnectorEvidence[] = [
    {
      evidenceType: 'status_lookup_requested',
      payload: {
        connectorKey,
        mode,
        traceId,
        performedAt,
      },
    },
    {
      evidenceType: 'edi_276_submitted',
      payload: {
        connectorKey,
        mode,
        traceId,
      },
    },
    {
      evidenceType: 'edi_277_received',
      payload: {
        connectorKey,
        mode,
        traceId,
        statusCode: normalized.statusCode,
        statusLabel: normalized.statusLabel,
        amountPaid,
      },
    },
    {
      evidenceType: 'status_lookup_completed',
      payload: {
        connectorKey,
        mode,
        traceId,
        summary: raw.summary ?? proposedResolution,
        payerMessage: raw.payerMessage ?? null,
      },
    },
  ];

  if (normalized.normalized === 'additional_information_required') {
    evidence.push({
      evidenceType: 'documentation_gap_found',
      payload: {
        requiredContextFields: exceptionSuggestion?.requiredContextFields ?? [],
      },
    });
  }

  if (
    normalized.normalized === 'denied' ||
    normalized.normalized === 'rejected' ||
    normalized.normalized === 'transport_failed'
  ) {
    evidence.push({
      evidenceType: 'payer_response_ambiguous',
      payload: {
        statusCode: normalized.statusCode,
        statusLabel: normalized.statusLabel,
        recommendedHumanAction: exceptionSuggestion?.recommendedHumanAction ?? null,
      },
    });
  }

  return {
    connectorKey,
    mode,
    performedAt,
    strategy: connectorKey,
    statusCode: normalized.statusCode,
    statusLabel: raw.statusLabel ?? normalized.statusLabel,
    connectorTraceId: traceId,
    proposedResolution,
    resolutionReasonCode,
    confidencePct,
    nextBestAction,
    autoQaRecommendation,
    evidence,
    exceptionSuggestion,
    summary: raw.summary ?? proposedResolution,
    rawResponse: {
      ...asObject(raw.rawResponse),
      payerMessage: raw.payerMessage ?? null,
      amountPaid,
    },
  };
}

export function getClaimStatusConnectorAvailability(env: Env): ClaimStatusConnectorAvailability[] {
  const x12Configured = Boolean(env.RCM_X12_CLAIM_STATUS_API_URL && env.RCM_X12_CLAIM_STATUS_API_KEY);

  return [
    {
      key: 'x12_276_277',
      label: 'X12 276/277',
      status: x12Configured ? 'live' : 'simulation',
      mode: x12Configured ? 'remote' : 'simulation',
      configured: x12Configured,
      capabilities: ['claim_status_follow_up', 'trace_id_capture', 'auto_close_candidates'],
      notes: x12Configured
        ? 'Remote connector configured and ready to run claim-status lookups.'
        : 'No remote connector credentials detected. Deterministic simulation mode is active so the lane can still run end to end.',
    },
    {
      key: 'portal',
      label: 'Portal fallback',
      status: 'manual_fallback',
      mode: 'manual',
      configured: false,
      capabilities: ['operator_follow_up', 'manual_capture'],
      notes: 'Portal fallback stays human-led until credential vaulting and operator controls are in place.',
    },
    {
      key: 'dde',
      label: 'DDE correction',
      status: 'manual_fallback',
      mode: 'manual',
      configured: false,
      capabilities: ['correction_workflow', 'operator_exception_resolution'],
      notes: 'DDE remains a bounded correction path, not the core product rail.',
    },
  ];
}

export async function runClaimStatusConnector(
  env: Env,
  connectorKey: ClaimStatusConnectorKey,
  input: ClaimStatusConnectorExecutionInput,
): Promise<ClaimStatusConnectorExecution> {
  if (connectorKey !== 'x12_276_277') {
    return buildExecutionFromStatus(connectorKey, 'manual', {
      statusCode: 'transport_failed',
      summary: `${connectorKey} is still a manual fallback path, not an autonomous live connector.`,
      reasonCode: 'manual_fallback_only',
      recommendedHumanAction: 'Route this case to a human operator for fallback handling.',
      requiredContextFields: ['operator_takeover_context'],
    });
  }

  const x12Configured = Boolean(env.RCM_X12_CLAIM_STATUS_API_URL && env.RCM_X12_CLAIM_STATUS_API_KEY);
  const raw = await runRemoteX12ClaimStatus(env, input);
  return buildExecutionFromStatus(
    connectorKey,
    x12Configured ? 'remote' : 'simulation',
    raw,
  );
}
