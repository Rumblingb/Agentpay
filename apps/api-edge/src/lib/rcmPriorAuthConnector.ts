/**
 * RCM Prior Auth Connector
 *
 * Drives autonomous prior authorization submission and status inquiry
 * for the prior_auth_follow_up lane via X12 278 or portal fallback.
 *
 * Connector keys:
 *   x12_278          — X12 278 prior auth inquiry (primary)
 *   portal_submission — Manual portal submission (fallback)
 */

import type { Env } from '../types';

// ─── Types ────────────────────────────────────────────────────────────────────

export type PriorAuthConnectorKey = 'x12_278' | 'portal_submission';
export type PriorAuthConnectorMode = 'remote' | 'simulation' | 'manual';
export type PriorAuthStatus =
  | 'approved'
  | 'denied'
  | 'additional_info_required'
  | 'pending_review'
  | 'expired'
  | 'not_required';

export interface PriorAuthConnectorExecutionInput {
  workItemId: string;
  claimRef: string;
  payerName: string;
  payerId: string | null;
  patientRef: string;
  providerRef: string;
  npi: string | null;
  procedureCode: string;
  diagnosisCode: string;
  serviceStartDate: string;
  serviceEndDate: string | null;
  placeOfService: string;
  authRef: string | null;
  urgencyFlag: boolean;
  formType: string;
  sourceSystem: string;
  metadata: Record<string, unknown>;
}

export interface PriorAuthConnectorExecution {
  connectorKey: PriorAuthConnectorKey;
  mode: PriorAuthConnectorMode;
  performedAt: string;
  strategy: string;
  statusCode: PriorAuthStatus;
  statusLabel: string;
  connectorTraceId: string | null;
  proposedResolution: string;
  resolutionReasonCode: string;
  confidencePct: number;
  nextBestAction: string;
  autoQaRecommendation: 'close_auto' | 'awaiting_qa' | 'human_review_required';
  authDetails: {
    authorizationNumber: string | null;
    authorizationStatus: PriorAuthStatus;
    approvedUnits: number | null;
    approvedFromDate: string | null;
    approvedToDate: string | null;
    expiresAt: string | null;
    additionalInfoRequired: string[];
    denialReasonCode: string | null;
  };
  evidence: Array<{ evidenceType: string; payload?: unknown; actorType?: string; actorRef?: string }>;
  summary: string;
  rawResponse: Record<string, unknown>;
}

export interface PriorAuthConnectorAvailability {
  key: PriorAuthConnectorKey;
  label: string;
  status: 'live' | 'simulation' | 'manual_fallback';
  mode: PriorAuthConnectorMode;
  configured: boolean;
  capabilities: string[];
  notes: string;
}

// ─── Lane contract ────────────────────────────────────────────────────────────

export const PRIOR_AUTH_LANE_KEY = 'prior_auth_follow_up' as const;

export const priorAuthLaneContract = {
  laneKey: 'prior_auth_follow_up',
  version: 'v1',
  displayName: 'Prior Auth Follow-up',
  description: 'Autonomous prior authorization submission, status inquiry, and follow-up via X12 278.',
  supportedDomains: ['facility', 'professional'],
  supportedForms: ['PA', 'X12-278'],
  exceptionInbox: {
    queueKey: 'prior_auth_follow_up_exceptions',
    routeToHumanOn: ['denied', 'expired', 'additional_info_required'],
  },
  autonomyLimits: {
    maxAutonomousAttempts: 2,
    requireDifferentStrategyOnRetry: false,
    autoCloseThreshold: 80,
  },
  stateMachine: {
    states: ['routed', 'awaiting_qa', 'retry_pending', 'human_review_required', 'closed_auto', 'closed_human'],
    transitions: [
      { from: 'routed', to: 'awaiting_qa', trigger: 'connector_run_pending_review' },
      { from: 'routed', to: 'closed_auto', trigger: 'connector_run_not_required_or_approved_high_confidence' },
      { from: 'routed', to: 'human_review_required', trigger: 'connector_run_denied_or_expired' },
      { from: 'awaiting_qa', to: 'closed_auto', trigger: 'qa_approve_auto_close' },
      { from: 'awaiting_qa', to: 'retry_pending', trigger: 'qa_retry' },
      { from: 'awaiting_qa', to: 'human_review_required', trigger: 'qa_escalate' },
      { from: 'retry_pending', to: 'awaiting_qa', trigger: 'fallback_connector_run' },
      { from: 'human_review_required', to: 'closed_human', trigger: 'human_resolved' },
    ],
  },
};

// ─── Availability ─────────────────────────────────────────────────────────────

export function getPriorAuthConnectorAvailability(
  env: Env,
): PriorAuthConnectorAvailability[] {
  const x12Configured = Boolean(
    env.RCM_X12_CLAIM_STATUS_API_URL && env.RCM_X12_CLAIM_STATUS_API_KEY,
  );

  return [
    {
      key: 'x12_278',
      label: 'X12 278 Prior Auth Inquiry',
      status: x12Configured ? 'live' : 'simulation',
      mode: x12Configured ? 'remote' : 'simulation',
      configured: x12Configured,
      capabilities: [
        'prior_auth_status_inquiry',
        'auth_number_lookup',
        'approval_dates_check',
        'denial_reason_retrieval',
        'additional_info_detection',
      ],
      notes: x12Configured
        ? 'Live X12 278 prior auth inquiry via configured clearinghouse.'
        : 'Simulation mode — configure RCM_X12_CLAIM_STATUS_API_URL and RCM_X12_CLAIM_STATUS_API_KEY for live mode.',
    },
    {
      key: 'portal_submission',
      label: 'Payer Portal (Manual Submission)',
      status: 'manual_fallback',
      mode: 'manual',
      configured: false,
      capabilities: ['portal_prior_auth_submission'],
      notes: 'Portal submission stays human-led until credential vaulting is production-ready.',
    },
  ];
}

// ─── Main connector ───────────────────────────────────────────────────────────

export async function runPriorAuthConnector(
  env: Env,
  connectorKey: PriorAuthConnectorKey,
  input: PriorAuthConnectorExecutionInput,
): Promise<PriorAuthConnectorExecution> {
  if (connectorKey === 'portal_submission') {
    return portalSubmissionFallback(input);
  }

  const x12Url = env.RCM_X12_CLAIM_STATUS_API_URL;
  const x12Key = env.RCM_X12_CLAIM_STATUS_API_KEY;

  if (!x12Url || !x12Key) {
    return simulatePriorAuthExecution(input);
  }

  return runRemotePriorAuth(env, x12Url, x12Key, input);
}

// ─── Remote execution ─────────────────────────────────────────────────────────

async function runRemotePriorAuth(
  env: Env,
  baseUrl: string,
  apiKey: string,
  input: PriorAuthConnectorExecutionInput,
): Promise<PriorAuthConnectorExecution> {
  const timeoutMs = env.RCM_X12_CLAIM_STATUS_TIMEOUT_MS
    ? parseInt(env.RCM_X12_CLAIM_STATUS_TIMEOUT_MS, 10)
    : 20_000;
  const performedAt = new Date().toISOString();
  const traceId = crypto.randomUUID();

  try {
    const resp = await fetch(`${baseUrl}/prior-auth/inquiry`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'X-Trace-Id': traceId,
      },
      body: JSON.stringify({
        claimRef: input.claimRef,
        payerName: input.payerName,
        payerId: input.payerId,
        patientRef: input.patientRef,
        providerRef: input.providerRef,
        npi: input.npi,
        procedureCode: input.procedureCode,
        diagnosisCode: input.diagnosisCode,
        serviceStartDate: input.serviceStartDate,
        serviceEndDate: input.serviceEndDate,
        placeOfService: input.placeOfService,
        authRef: input.authRef,
        urgencyFlag: input.urgencyFlag,
        formType: input.formType,
        sourceSystem: input.sourceSystem,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`Remote prior auth connector returned ${resp.status}: ${text}`);
    }

    const raw = (await resp.json()) as Record<string, unknown>;
    return mapRemotePriorAuthResponse(raw, input, performedAt, traceId);
  } catch (err) {
    console.warn('[rcm-prior-auth] remote connector failed, using simulation:', err instanceof Error ? err.message : err);
    return simulatePriorAuthExecution(input);
  }
}

function mapRemotePriorAuthResponse(
  raw: Record<string, unknown>,
  input: PriorAuthConnectorExecutionInput,
  performedAt: string,
  traceId: string,
): PriorAuthConnectorExecution {
  const statusCode = (raw['statusCode'] as PriorAuthStatus | undefined) ?? 'pending_review';
  const confidencePct = typeof raw['confidencePct'] === 'number' ? raw['confidencePct'] : 65;
  const authDetails = buildAuthDetails(statusCode, traceId, input);

  return {
    connectorKey: 'x12_278',
    mode: 'remote',
    performedAt,
    strategy: 'x12_278',
    statusCode,
    statusLabel: statusCodeToLabel(statusCode),
    connectorTraceId: traceId,
    proposedResolution: raw['proposedResolution'] as string ?? defaultProposedResolution(statusCode),
    resolutionReasonCode: raw['resolutionReasonCode'] as string ?? statusCode,
    confidencePct,
    nextBestAction: raw['nextBestAction'] as string ?? defaultNextBestAction(statusCode),
    autoQaRecommendation: deriveAutoQaRecommendation(statusCode, confidencePct),
    authDetails,
    evidence: [
      { evidenceType: 'prior_auth_inquiry_submitted', payload: { claimRef: input.claimRef, payerName: input.payerName, procedureCode: input.procedureCode } },
      { evidenceType: 'prior_auth_inquiry_response', payload: { statusCode: raw['statusCode'], traceId } },
    ],
    summary: raw['summary'] as string ?? `Prior auth inquiry: ${statusCodeToLabel(statusCode)}`,
    rawResponse: raw,
  };
}

// ─── Simulation ───────────────────────────────────────────────────────────────

function simulatePriorAuthExecution(
  input: PriorAuthConnectorExecutionInput,
): PriorAuthConnectorExecution {
  const performedAt = new Date().toISOString();
  const traceId = `sim-pa-${Date.now()}`;

  const { statusCode, confidencePct } = simulatedOutcome(input.procedureCode, input.urgencyFlag);
  const authDetails = buildAuthDetails(statusCode, traceId, input);

  return {
    connectorKey: 'x12_278',
    mode: 'simulation',
    performedAt,
    strategy: 'x12_278',
    statusCode,
    statusLabel: statusCodeToLabel(statusCode),
    connectorTraceId: traceId,
    proposedResolution: defaultProposedResolution(statusCode),
    resolutionReasonCode: statusCode,
    confidencePct,
    nextBestAction: defaultNextBestAction(statusCode),
    autoQaRecommendation: deriveAutoQaRecommendation(statusCode, confidencePct),
    authDetails,
    evidence: [
      {
        evidenceType: 'prior_auth_inquiry_submitted',
        payload: { claimRef: input.claimRef, payerName: input.payerName, procedureCode: input.procedureCode, urgencyFlag: input.urgencyFlag, mode: 'simulation' },
      },
      {
        evidenceType: 'prior_auth_inquiry_response',
        payload: { statusCode, statusLabel: statusCodeToLabel(statusCode), traceId },
      },
    ],
    summary: `[SIM] Prior auth: ${statusCodeToLabel(statusCode)} for procedure ${input.procedureCode} (${input.payerName || 'unknown payer'})`,
    rawResponse: { simulatedAt: performedAt, procedureCode: input.procedureCode, urgencyFlag: input.urgencyFlag },
  };
}

function simulatedOutcome(procedureCode: string, urgencyFlag: boolean): { statusCode: PriorAuthStatus; confidencePct: number } {
  const code = procedureCode ?? '';
  if (code.startsWith('99')) return { statusCode: 'not_required', confidencePct: 90 };
  if (urgencyFlag) return { statusCode: 'approved', confidencePct: 85 };
  if (code.startsWith('7')) return { statusCode: 'additional_info_required', confidencePct: 70 };
  if (['0KD', '0FT', '0BT'].includes(code)) return { statusCode: 'pending_review', confidencePct: 65 };
  return { statusCode: 'pending_review', confidencePct: 72 };
}

function buildAuthDetails(
  statusCode: PriorAuthStatus,
  traceId: string,
  input: PriorAuthConnectorExecutionInput,
): PriorAuthConnectorExecution['authDetails'] {
  const traceShort = traceId.slice(-8);

  switch (statusCode) {
    case 'approved': {
      const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
      return {
        authorizationNumber: `AUTH-SIM-${traceShort}`,
        authorizationStatus: 'approved',
        approvedUnits: null,
        approvedFromDate: input.serviceStartDate,
        approvedToDate: input.serviceEndDate,
        expiresAt,
        additionalInfoRequired: [],
        denialReasonCode: null,
      };
    }
    case 'denied':
      return {
        authorizationNumber: null,
        authorizationStatus: 'denied',
        approvedUnits: null,
        approvedFromDate: null,
        approvedToDate: null,
        expiresAt: null,
        additionalInfoRequired: [],
        denialReasonCode: 'MEDICAL_NECESSITY',
      };
    case 'additional_info_required':
      return {
        authorizationNumber: null,
        authorizationStatus: 'additional_info_required',
        approvedUnits: null,
        approvedFromDate: null,
        approvedToDate: null,
        expiresAt: null,
        additionalInfoRequired: ['Clinical notes', 'Prior treatment history'],
        denialReasonCode: null,
      };
    case 'not_required':
      return {
        authorizationNumber: 'NOT_REQUIRED',
        authorizationStatus: 'not_required',
        approvedUnits: null,
        approvedFromDate: null,
        approvedToDate: null,
        expiresAt: null,
        additionalInfoRequired: [],
        denialReasonCode: null,
      };
    case 'expired': {
      const expiresAt = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
      return {
        authorizationNumber: null,
        authorizationStatus: 'expired',
        approvedUnits: null,
        approvedFromDate: null,
        approvedToDate: null,
        expiresAt,
        additionalInfoRequired: [],
        denialReasonCode: null,
      };
    }
    default:
      return {
        authorizationNumber: null,
        authorizationStatus: 'pending_review',
        approvedUnits: null,
        approvedFromDate: null,
        approvedToDate: null,
        expiresAt: null,
        additionalInfoRequired: [],
        denialReasonCode: null,
      };
  }
}

// ─── Portal submission fallback ───────────────────────────────────────────────

function portalSubmissionFallback(
  input: PriorAuthConnectorExecutionInput,
): PriorAuthConnectorExecution {
  return {
    connectorKey: 'portal_submission',
    mode: 'manual',
    performedAt: new Date().toISOString(),
    strategy: 'portal_submission',
    statusCode: 'pending_review',
    statusLabel: 'Manual portal submission required',
    connectorTraceId: null,
    proposedResolution: 'Operator must access the payer portal to submit prior authorization request.',
    resolutionReasonCode: 'manual_portal_submission_required',
    confidencePct: 0,
    nextBestAction: 'Operator: log into payer portal and submit prior auth request.',
    autoQaRecommendation: 'human_review_required',
    authDetails: {
      authorizationNumber: null,
      authorizationStatus: 'pending_review',
      approvedUnits: null,
      approvedFromDate: null,
      approvedToDate: null,
      expiresAt: null,
      additionalInfoRequired: [],
      denialReasonCode: null,
    },
    evidence: [
      {
        evidenceType: 'portal_submission_required',
        payload: { claimRef: input.claimRef, payerName: input.payerName, reason: 'credential_vault_not_configured' },
      },
    ],
    summary: 'Portal submission is manual-only until credential vaulting is production-ready.',
    rawResponse: { transport: 'manual', fallback: true },
  };
}

// ─── Pure derivation helpers ──────────────────────────────────────────────────

function statusCodeToLabel(code: PriorAuthStatus): string {
  const labels: Record<PriorAuthStatus, string> = {
    approved: 'Approved',
    denied: 'Denied',
    additional_info_required: 'Additional Information Required',
    pending_review: 'Pending Review',
    expired: 'Expired',
    not_required: 'Authorization Not Required',
  };
  return labels[code] ?? code;
}

function defaultProposedResolution(code: PriorAuthStatus): string {
  const resolutions: Record<PriorAuthStatus, string> = {
    approved: 'Prior authorization approved. Proceed with service.',
    denied: 'Prior authorization denied. Evaluate appeal or alternative path.',
    additional_info_required: 'Payer requires additional clinical documentation.',
    pending_review: 'Authorization is under payer review. Follow up in 3–5 business days.',
    expired: 'Authorization has expired. Resubmit prior auth request.',
    not_required: 'No prior authorization required for this procedure.',
  };
  return resolutions[code] ?? 'Review authorization status and take appropriate action.';
}

function defaultNextBestAction(code: PriorAuthStatus): string {
  const actions: Record<PriorAuthStatus, string> = {
    approved: 'Confirm authorization number and proceed with service scheduling',
    denied: 'Evaluate appeal eligibility and gather supporting documentation',
    additional_info_required: 'Collect and submit required clinical documentation',
    pending_review: 'Follow up with payer in 3–5 business days',
    expired: 'Submit new prior auth request',
    not_required: 'No action required — proceed with service',
  };
  return actions[code] ?? 'Review and take action';
}

function deriveAutoQaRecommendation(
  code: PriorAuthStatus,
  confidencePct: number,
): PriorAuthConnectorExecution['autoQaRecommendation'] {
  if (code === 'not_required') return 'close_auto';
  if (code === 'approved') return confidencePct >= 80 ? 'close_auto' : 'awaiting_qa';
  if (code === 'denied' || code === 'expired') return 'human_review_required';
  return 'awaiting_qa';
}
