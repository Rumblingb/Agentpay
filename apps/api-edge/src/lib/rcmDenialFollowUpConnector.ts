/**
 * RCM Denial Follow-up Connector
 *
 * Drives autonomous denial management for the denial_follow_up lane.
 * Reuses the X12 276/277 claim-status inquiry pattern but focuses on
 * appeal eligibility, denial reason validation, and re-submission paths.
 *
 * Connector keys:
 *   x12_appeal_inquiry  — X12 276/277 with appeal-intent metadata (primary)
 *   portal              — Manual payer portal (manual fallback, blocked on credential vault)
 *
 * Status codes:
 *   appealed              — appeal submitted and acknowledged
 *   under_review          — denial under payer review
 *   appeal_approved       — appeal approved, claim re-processing
 *   appeal_denied         — appeal denied, further action needed
 *   information_requested — payer requires additional documentation
 *   re_submitted          — claim corrected and re-submitted
 *   upheld                — denial upheld after review
 */

import type { Env } from '../types';

// ─── Types ────────────────────────────────────────────────────────────────────

export type DenialFollowUpConnectorKey = 'x12_appeal_inquiry' | 'portal';
export type DenialFollowUpConnectorMode = 'remote' | 'simulation' | 'manual';
export type DenialFollowUpAutoQaRecommendation =
  | 'close_auto'
  | 'awaiting_qa'
  | 'human_review_required';

export type DenialFollowUpStatusCode =
  | 'appealed'
  | 'under_review'
  | 'appeal_approved'
  | 'appeal_denied'
  | 'information_requested'
  | 're_submitted'
  | 'upheld';

export interface DenialFollowUpConnectorEvidence {
  actorType?: string;
  actorRef?: string;
  evidenceType: string;
  payload?: unknown;
}

export interface DenialFollowUpExceptionSuggestion {
  exceptionType:
    | 'missing_appeal_documentation'
    | 'appeal_deadline_exceeded'
    | 'denial_upheld_requires_review'
    | 'payer_information_request'
    | 'coverage_dispute'
    | 'medical_necessity_denial'
    | 'payer_system_unavailable';
  severity: 'low' | 'normal' | 'high' | 'critical';
  summary: string;
  recommendedHumanAction: string;
  requiredContextFields: string[];
  reasonCode: string;
}

export interface DenialFollowUpConnectorAvailability {
  key: DenialFollowUpConnectorKey;
  label: string;
  status: 'live' | 'simulation' | 'manual_fallback';
  mode: DenialFollowUpConnectorMode;
  configured: boolean;
  capabilities: string[];
  notes: string;
}

export interface DenialFollowUpConnectorExecutionInput {
  workItemId: string;
  claimRef: string;
  payerName: string;
  coverageType: string;
  patientRef: string;
  providerRef: string;
  denialReasonCode: string;
  denialDate: string;
  appealDeadline: string;
  formType: string;
  sourceSystem: string;
  amountAtRisk: number | null;
  metadata: Record<string, unknown>;
}

export interface DenialFollowUpConnectorExecution {
  connectorKey: DenialFollowUpConnectorKey;
  mode: DenialFollowUpConnectorMode;
  performedAt: string;
  strategy: string;
  statusCode: DenialFollowUpStatusCode;
  statusLabel: string;
  connectorTraceId: string | null;
  proposedResolution: string;
  resolutionReasonCode: string;
  confidencePct: number;
  nextBestAction: string;
  autoQaRecommendation: DenialFollowUpAutoQaRecommendation;
  appealEligible: boolean;
  appealDeadlineStatus: 'open' | 'closing_soon' | 'expired' | 'unknown';
  evidence: DenialFollowUpConnectorEvidence[];
  exceptionSuggestion?: DenialFollowUpExceptionSuggestion;
  summary: string;
  rawResponse: Record<string, unknown>;
}

// ─── Availability ─────────────────────────────────────────────────────────────

export function getDenialFollowUpConnectorAvailability(
  env: Env,
): DenialFollowUpConnectorAvailability[] {
  const x12Configured = Boolean(
    env.RCM_X12_CLAIM_STATUS_API_URL && env.RCM_X12_CLAIM_STATUS_API_KEY,
  );

  return [
    {
      key: 'x12_appeal_inquiry',
      label: 'X12 Appeal Inquiry (276/277)',
      status: x12Configured ? 'live' : 'simulation',
      mode: x12Configured ? 'remote' : 'simulation',
      configured: x12Configured,
      capabilities: [
        'denial_status_lookup',
        'appeal_eligibility_check',
        'appeal_deadline_validation',
        'information_request_detection',
        'auto_appeal_submission',
      ],
      notes: x12Configured
        ? 'Live X12 276/277 appeal inquiry via configured clearinghouse.'
        : 'Simulation mode — configure RCM_X12_CLAIM_STATUS_API_URL and RCM_X12_CLAIM_STATUS_API_KEY for live mode.',
    },
    {
      key: 'portal',
      label: 'Payer Portal (Manual)',
      status: 'manual_fallback',
      mode: 'manual',
      configured: false,
      capabilities: ['portal_status_lookup'],
      notes:
        'Portal fallback stays human-led until credential vaulting is production-ready. See rcmCredentialVault.ts.',
    },
  ];
}

// ─── Main connector ────────────────────────────────────────────────────────────

export async function runDenialFollowUpConnector(
  env: Env,
  connectorKey: DenialFollowUpConnectorKey,
  input: DenialFollowUpConnectorExecutionInput,
): Promise<DenialFollowUpConnectorExecution> {
  if (connectorKey === 'portal') {
    return portalFallbackExecution(input);
  }

  const x12Url = env.RCM_X12_CLAIM_STATUS_API_URL;
  const x12Key = env.RCM_X12_CLAIM_STATUS_API_KEY;

  if (!x12Url || !x12Key) {
    return simulateDenialFollowUpExecution(input);
  }

  return runRemoteDenialFollowUp(env, x12Url, x12Key, input);
}

// ─── Remote execution ─────────────────────────────────────────────────────────

async function runRemoteDenialFollowUp(
  env: Env,
  baseUrl: string,
  apiKey: string,
  input: DenialFollowUpConnectorExecutionInput,
): Promise<DenialFollowUpConnectorExecution> {
  const timeoutMs = env.RCM_X12_CLAIM_STATUS_TIMEOUT_MS
    ? parseInt(env.RCM_X12_CLAIM_STATUS_TIMEOUT_MS, 10)
    : 20_000;
  const performedAt = new Date().toISOString();
  const traceId = crypto.randomUUID();

  try {
    const resp = await fetch(`${baseUrl}/denial-follow-up/inquiry`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'X-Trace-Id': traceId,
      },
      body: JSON.stringify({
        claimRef: input.claimRef,
        payerName: input.payerName,
        coverageType: input.coverageType,
        patientRef: input.patientRef,
        providerRef: input.providerRef,
        denialReasonCode: input.denialReasonCode,
        denialDate: input.denialDate,
        appealDeadline: input.appealDeadline,
        formType: input.formType,
        sourceSystem: input.sourceSystem,
        amountAtRisk: input.amountAtRisk,
        intentType: 'appeal_follow_up',
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`Remote denial follow-up connector returned ${resp.status}: ${text}`);
    }

    const raw = (await resp.json()) as Record<string, unknown>;
    return mapRemoteResponse(raw, input, performedAt, traceId);
  } catch (err) {
    // Fall back to simulation on transport errors
    console.warn('[rcm-denial] remote connector failed, using simulation:', err instanceof Error ? err.message : err);
    return simulateDenialFollowUpExecution(input);
  }
}

function mapRemoteResponse(
  raw: Record<string, unknown>,
  input: DenialFollowUpConnectorExecutionInput,
  performedAt: string,
  traceId: string,
): DenialFollowUpConnectorExecution {
  const statusCode = (raw['statusCode'] as DenialFollowUpStatusCode | undefined) ?? 'under_review';
  const confidencePct = typeof raw['confidencePct'] === 'number' ? raw['confidencePct'] : 65;

  return {
    connectorKey: 'x12_appeal_inquiry',
    mode: 'remote',
    performedAt,
    strategy: 'x12_appeal_inquiry',
    statusCode,
    statusLabel: raw['statusLabel'] as string ?? statusCodeToLabel(statusCode),
    connectorTraceId: traceId,
    proposedResolution: raw['proposedResolution'] as string ?? defaultProposedResolution(statusCode),
    resolutionReasonCode: raw['resolutionReasonCode'] as string ?? statusCode,
    confidencePct,
    nextBestAction: raw['nextBestAction'] as string ?? defaultNextBestAction(statusCode),
    autoQaRecommendation: deriveAutoQaRecommendation(statusCode, confidencePct),
    appealEligible: typeof raw['appealEligible'] === 'boolean' ? raw['appealEligible'] : true,
    appealDeadlineStatus: (raw['appealDeadlineStatus'] as DenialFollowUpConnectorExecution['appealDeadlineStatus']) ?? 'unknown',
    evidence: buildEvidenceFromRemote(raw, input),
    exceptionSuggestion: deriveExceptionSuggestion(statusCode, raw),
    summary: raw['summary'] as string ?? `Denial follow-up: ${statusCodeToLabel(statusCode)}`,
    rawResponse: raw,
  };
}

function buildEvidenceFromRemote(
  raw: Record<string, unknown>,
  input: DenialFollowUpConnectorExecutionInput,
): DenialFollowUpConnectorEvidence[] {
  return [
    {
      evidenceType: 'denial_inquiry_submitted',
      payload: { claimRef: input.claimRef, payerName: input.payerName, denialReasonCode: input.denialReasonCode },
    },
    {
      evidenceType: 'denial_inquiry_response',
      payload: { statusCode: raw['statusCode'], statusLabel: raw['statusLabel'], traceId: raw['traceId'] },
    },
  ];
}

// ─── Simulation ───────────────────────────────────────────────────────────────

function simulateDenialFollowUpExecution(
  input: DenialFollowUpConnectorExecutionInput,
): DenialFollowUpConnectorExecution {
  const performedAt = new Date().toISOString();
  const traceId = `sim-denial-${Date.now()}`;

  // Deterministic simulation based on denial reason code
  const { statusCode, confidencePct } = simulatedOutcome(input.denialReasonCode);
  const appealDeadlineStatus = deriveAppealDeadlineStatus(input.appealDeadline);

  return {
    connectorKey: 'x12_appeal_inquiry',
    mode: 'simulation',
    performedAt,
    strategy: 'x12_appeal_inquiry',
    statusCode,
    statusLabel: statusCodeToLabel(statusCode),
    connectorTraceId: traceId,
    proposedResolution: defaultProposedResolution(statusCode),
    resolutionReasonCode: statusCode,
    confidencePct,
    nextBestAction: defaultNextBestAction(statusCode),
    autoQaRecommendation: deriveAutoQaRecommendation(statusCode, confidencePct),
    appealEligible: appealDeadlineStatus !== 'expired',
    appealDeadlineStatus,
    evidence: [
      {
        evidenceType: 'denial_inquiry_submitted',
        payload: { claimRef: input.claimRef, payerName: input.payerName, denialReasonCode: input.denialReasonCode, mode: 'simulation' },
      },
      {
        evidenceType: 'denial_inquiry_response',
        payload: { statusCode, statusLabel: statusCodeToLabel(statusCode), traceId, amountAtRisk: input.amountAtRisk },
      },
    ],
    exceptionSuggestion: deriveExceptionSuggestion(statusCode, { appealDeadlineStatus }),
    summary: `[SIM] Denial follow-up: ${statusCodeToLabel(statusCode)} for claim ${input.claimRef || 'unknown'} (${input.payerName || 'unknown payer'})`,
    rawResponse: {
      simulatedAt: performedAt,
      denialReasonCode: input.denialReasonCode,
      appealDeadline: input.appealDeadline,
    },
  };
}

function simulatedOutcome(denialReasonCode: string): { statusCode: DenialFollowUpStatusCode; confidencePct: number } {
  // Deterministic outcome simulation by reason code pattern
  const code = (denialReasonCode ?? '').toLowerCase();
  if (code.startsWith('co-') || code.startsWith('co_')) {
    return { statusCode: 'information_requested', confidencePct: 72 };
  }
  if (code.startsWith('pr-') || code.startsWith('pr_')) {
    return { statusCode: 'under_review', confidencePct: 68 };
  }
  if (code.startsWith('oa-') || code.startsWith('oa_')) {
    return { statusCode: 'appeal_approved', confidencePct: 88 };
  }
  if (code.includes('medical_necessity') || code.includes('medical necessity')) {
    return { statusCode: 'under_review', confidencePct: 60 };
  }
  if (code.includes('timely') || code.includes('deadline')) {
    return { statusCode: 'upheld', confidencePct: 55 };
  }
  // Default: claim under review
  return { statusCode: 'under_review', confidencePct: 70 };
}

// ─── Manual portal fallback ───────────────────────────────────────────────────

function portalFallbackExecution(
  input: DenialFollowUpConnectorExecutionInput,
): DenialFollowUpConnectorExecution {
  return {
    connectorKey: 'portal',
    mode: 'manual',
    performedAt: new Date().toISOString(),
    strategy: 'portal',
    statusCode: 'under_review',
    statusLabel: 'Manual portal review required',
    connectorTraceId: null,
    proposedResolution:
      'Operator must access the payer portal to check denial status and submit an appeal if eligible.',
    resolutionReasonCode: 'manual_portal_review_required',
    confidencePct: 0,
    nextBestAction: 'Operator: log into payer portal and check denial/appeal status.',
    autoQaRecommendation: 'human_review_required',
    appealEligible: true,
    appealDeadlineStatus: 'unknown',
    evidence: [
      {
        evidenceType: 'portal_access_required',
        payload: { claimRef: input.claimRef, payerName: input.payerName, reason: 'credential_vault_not_configured' },
      },
    ],
    exceptionSuggestion: {
      exceptionType: 'payer_system_unavailable',
      severity: 'normal',
      summary: 'Portal fallback requires human operator — credential vault not yet configured.',
      recommendedHumanAction: 'Log into the payer portal and check denial/appeal status manually.',
      requiredContextFields: ['portal_access_credentials', 'portal_login_url'],
      reasonCode: 'credential_vault_pending',
    },
    summary: 'Portal fallback is manual-only until credential vaulting is production-ready.',
    rawResponse: { transport: 'manual', fallback: true },
  };
}

// ─── Pure derivation helpers ──────────────────────────────────────────────────

function statusCodeToLabel(code: DenialFollowUpStatusCode): string {
  const labels: Record<DenialFollowUpStatusCode, string> = {
    appealed: 'Appeal Submitted',
    under_review: 'Under Payer Review',
    appeal_approved: 'Appeal Approved',
    appeal_denied: 'Appeal Denied',
    information_requested: 'Additional Information Requested',
    re_submitted: 'Claim Re-Submitted',
    upheld: 'Denial Upheld',
  };
  return labels[code] ?? code;
}

function defaultProposedResolution(code: DenialFollowUpStatusCode): string {
  const resolutions: Record<DenialFollowUpStatusCode, string> = {
    appealed: 'Appeal has been submitted. Monitor for payer decision within 30 days.',
    under_review: 'Claim is under payer review. No immediate action required.',
    appeal_approved: 'Appeal approved. Confirm re-processing and expected payment timeline.',
    appeal_denied: 'Appeal denied. Evaluate escalation path or second-level appeal.',
    information_requested: 'Payer requires additional documentation. Collect and re-submit promptly.',
    re_submitted: 'Corrected claim submitted. Monitor for confirmation.',
    upheld: 'Denial upheld after review. Evaluate write-off or patient responsibility assignment.',
  };
  return resolutions[code] ?? 'Review denial status and take appropriate action.';
}

function defaultNextBestAction(code: DenialFollowUpStatusCode): string {
  const actions: Record<DenialFollowUpStatusCode, string> = {
    appealed: 'Monitor appeal status',
    under_review: 'Follow up in 15 days if no decision',
    appeal_approved: 'Confirm payment posting',
    appeal_denied: 'Evaluate second-level appeal',
    information_requested: 'Collect missing documentation',
    re_submitted: 'Monitor for acceptance confirmation',
    upheld: 'Review for write-off or patient assignment',
  };
  return actions[code] ?? 'Review and take action';
}

function deriveAutoQaRecommendation(
  code: DenialFollowUpStatusCode,
  confidencePct: number,
): DenialFollowUpAutoQaRecommendation {
  // High-confidence resolved states → auto-close
  if ((code === 'appeal_approved' || code === 're_submitted') && confidencePct >= 80) {
    return 'close_auto';
  }
  // Upheld denial or denial → human review
  if (code === 'upheld' || code === 'appeal_denied') {
    return 'human_review_required';
  }
  // Information requested → human review (can't auto-fulfill)
  if (code === 'information_requested') {
    return 'human_review_required';
  }
  // Under review or appealed with sufficient confidence → awaiting QA
  return 'awaiting_qa';
}

function deriveExceptionSuggestion(
  code: DenialFollowUpStatusCode,
  raw: Record<string, unknown>,
): DenialFollowUpExceptionSuggestion | undefined {
  if (code === 'information_requested') {
    return {
      exceptionType: 'payer_information_request',
      severity: 'high',
      summary: 'Payer requires additional documentation before processing the appeal.',
      recommendedHumanAction: 'Collect missing documentation and re-submit to payer.',
      requiredContextFields: ['missing_documentation_list', 'submission_deadline'],
      reasonCode: 'information_request_from_payer',
    };
  }
  if (code === 'appeal_denied' || code === 'upheld') {
    return {
      exceptionType: 'denial_upheld_requires_review',
      severity: 'high',
      summary: 'Denial upheld after appeal. Human judgment required for next steps.',
      recommendedHumanAction: 'Evaluate second-level appeal, write-off, or patient responsibility.',
      requiredContextFields: ['denial_final_reason', 'write_off_authorization'],
      reasonCode: 'denial_upheld',
    };
  }
  const deadlineStatus = raw['appealDeadlineStatus'];
  if (deadlineStatus === 'expired') {
    return {
      exceptionType: 'appeal_deadline_exceeded',
      severity: 'critical',
      summary: 'Appeal deadline has passed. Autonomous appeal submission is no longer possible.',
      recommendedHumanAction: 'Contact payer for late appeal exception or evaluate write-off.',
      requiredContextFields: ['payer_late_appeal_policy'],
      reasonCode: 'appeal_deadline_expired',
    };
  }
  if (deadlineStatus === 'closing_soon') {
    return {
      exceptionType: 'appeal_deadline_exceeded',
      severity: 'critical',
      summary: 'Appeal deadline is closing soon. Immediate action required.',
      recommendedHumanAction: 'Submit appeal documentation immediately to meet deadline.',
      requiredContextFields: ['appeal_documentation', 'appeal_deadline_date'],
      reasonCode: 'appeal_deadline_imminent',
    };
  }
  return undefined;
}

function deriveAppealDeadlineStatus(
  appealDeadline: string,
): DenialFollowUpConnectorExecution['appealDeadlineStatus'] {
  if (!appealDeadline) return 'unknown';
  const deadline = new Date(appealDeadline);
  if (isNaN(deadline.getTime())) return 'unknown';
  const now = new Date();
  const diffMs = deadline.getTime() - now.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  if (diffDays < 0) return 'expired';
  if (diffDays <= 7) return 'closing_soon';
  return 'open';
}
