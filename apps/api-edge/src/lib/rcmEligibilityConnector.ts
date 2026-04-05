import type { Env } from '../types';

export type EligibilityConnectorKey = 'x12_270_271' | 'portal';
export type EligibilityConnectorMode = 'remote' | 'simulation' | 'manual';
export type EligibilityAutoQaRecommendation =
  | 'close_auto'
  | 'awaiting_qa'
  | 'human_review_required';

export interface EligibilityConnectorEvidence {
  actorType?: string;
  actorRef?: string;
  evidenceType: string;
  payload?: unknown;
}

export interface EligibilityExceptionSuggestion {
  exceptionType:
    | 'subscriber_not_found'
    | 'coverage_inactive'
    | 'prior_auth_required'
    | 'coordination_of_benefits_gap'
    | 'out_of_network_provider'
    | 'payer_system_unavailable';
  severity: 'low' | 'normal' | 'high' | 'critical';
  summary: string;
  recommendedHumanAction: string;
  requiredContextFields: string[];
  reasonCode: string;
}

export interface EligibilityConnectorExecutionInput {
  workItemId: string;
  /** Member / subscriber ID — stored in claim_ref column. */
  memberId: string;
  payerName: string;
  /** EDI payer ID for HETS routing, sourced from metadata. */
  payerId: string | null;
  coverageType: string;
  patientRef: string;
  providerRef: string;
  /** Billing provider NPI, sourced from metadata. */
  providerNpi: string;
  /** ISO date string for the planned date of service. */
  dateOfService: string;
  /** X12 service type codes, e.g. ['30', '98']. */
  serviceTypeCodes: string[];
  formType: string;
  sourceSystem: string;
  metadata: Record<string, unknown>;
}

export interface EligibilityConnectorExecution {
  connectorKey: EligibilityConnectorKey;
  mode: EligibilityConnectorMode;
  performedAt: string;
  strategy: string;
  /** Canonical eligibility status code. */
  statusCode: string;
  statusLabel: string;
  connectorTraceId: string | null;
  proposedResolution: string;
  resolutionReasonCode: string;
  confidencePct: number;
  nextBestAction: string;
  autoQaRecommendation: EligibilityAutoQaRecommendation;
  evidence: EligibilityConnectorEvidence[];
  exceptionSuggestion?: EligibilityExceptionSuggestion;
  summary: string;
  rawResponse: Record<string, unknown>;
}

export interface EligibilityConnectorAvailability {
  key: EligibilityConnectorKey;
  label: string;
  status: 'live' | 'simulation' | 'manual_fallback';
  mode: EligibilityConnectorMode;
  configured: boolean;
  capabilities: string[];
  notes: string;
}

// ─── Internal response from the HETS network ─────────────────────────────────

type NormalizedEligibilityStatus =
  | 'active'
  | 'active_with_limitations'
  | 'deductible_not_met'
  | 'inactive'
  | 'not_found'
  | 'prior_auth_required'
  | 'out_of_network'
  | 'coordination_required'
  | 'transport_failed';

interface RemoteHetsResponse {
  eligibilityStatus?: string;
  statusLabel?: string;
  summary?: string;
  reasonCode?: string;
  traceId?: string;
  planName?: string;
  groupNumber?: string;
  coverageBeginDate?: string | null;
  coverageEndDate?: string | null;
  deductibleAmount?: number | null;
  deductibleMet?: number | null;
  copayAmount?: number | null;
  coinsurancePct?: number | null;
  priorAuthRequired?: boolean;
  outOfNetwork?: boolean;
  requiresCoordination?: boolean;
  limitations?: string[];
  requiredContextFields?: string[];
  recommendedHumanAction?: string;
  payerMessage?: string;
  rawResponse?: Record<string, unknown>;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 30_000;

function pickString(...values: unknown[]): string | undefined {
  for (const v of values) {
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return undefined;
}

function pickNumber(...values: unknown[]): number | null {
  for (const v of values) {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string') {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

function pickBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  return null;
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

// ─── Status normalisation ────────────────────────────────────────────────────

function normalizeEligibilityStatus(raw: string | null): {
  normalized: NormalizedEligibilityStatus;
  statusCode: string;
  statusLabel: string;
} {
  if (!raw) {
    return { normalized: 'transport_failed', statusCode: 'transport_failed', statusLabel: 'No Status Returned' };
  }
  const lower = raw.toLowerCase().trim();

  // Active / covered
  if (['1', 'active', 'active_coverage', 'covered', 'eligible'].includes(lower)) {
    return { normalized: 'active', statusCode: 'active', statusLabel: 'Active Coverage' };
  }
  // Active with limitations
  if (['active_with_limitations', 'active_limited', 'limited', 'restricted'].includes(lower)) {
    return { normalized: 'active_with_limitations', statusCode: 'active_with_limitations', statusLabel: 'Active — With Limitations' };
  }
  // Deductible not met
  if (['deductible_not_met', 'deductible', 'ded_not_met', 'deductible_outstanding'].includes(lower)) {
    return { normalized: 'deductible_not_met', statusCode: 'deductible_not_met', statusLabel: 'Active — Deductible Not Met' };
  }
  // Inactive / terminated
  if (['6', 'inactive', 'terminated', 'term', 'ineligible', 'not_covered', 'non_covered', 'lapsed'].includes(lower)) {
    return { normalized: 'inactive', statusCode: 'inactive', statusLabel: 'Inactive / Not Covered' };
  }
  // Not found
  if (['r', 'not_found', 'subscriber_not_found', 'unknown', 'no_record', 'not_on_file'].includes(lower)) {
    return { normalized: 'not_found', statusCode: 'not_found', statusLabel: 'Subscriber Not Found' };
  }
  // Prior auth required
  if (['prior_auth_required', 'prior_auth', 'auth_required', 'pa_required', 'preauth_required'].includes(lower)) {
    return { normalized: 'prior_auth_required', statusCode: 'prior_auth_required', statusLabel: 'Prior Auth Required' };
  }
  // Out of network
  if (['out_of_network', 'oon', 'out_of_plan', 'non_participating', 'non_par'].includes(lower)) {
    return { normalized: 'out_of_network', statusCode: 'out_of_network', statusLabel: 'Out of Network' };
  }
  // Coordination required
  if (['coordination_required', 'cob', 'coordination_of_benefits', 'other_insurance', 'other_coverage'].includes(lower)) {
    return { normalized: 'coordination_required', statusCode: 'coordination_required', statusLabel: 'Coordination of Benefits Required' };
  }
  // Transport failure
  if (['transport_failed', 'error', 'timeout', 'failed', 'connection_error'].includes(lower)) {
    return { normalized: 'transport_failed', statusCode: 'transport_failed', statusLabel: 'Connector Error' };
  }
  // Unmapped — treat as transport failure so the exception inbox picks it up
  return { normalized: 'transport_failed', statusCode: raw, statusLabel: raw };
}

// ─── Deterministic simulation ─────────────────────────────────────────────────

function deterministicSimulation(
  input: EligibilityConnectorExecutionInput,
): RemoteHetsResponse {
  const memberId = input.memberId.toUpperCase();

  // Pattern detection for predictable test scenarios
  if (memberId.includes('INACT') || memberId.includes('TERM')) {
    return {
      eligibilityStatus: 'inactive',
      summary: 'HETS 270/271 indicates subscriber coverage is no longer active.',
      reasonCode: 'coverage_terminated',
      recommendedHumanAction: 'Verify coverage termination date and check for secondary payer or re-enrollment.',
    };
  }
  if (memberId.includes('NOTF') || memberId.includes('NOR')) {
    return {
      eligibilityStatus: 'not_found',
      summary: 'HETS 270/271 could not locate this subscriber in the payer system.',
      reasonCode: 'subscriber_id_not_found',
      requiredContextFields: ['correct_member_id', 'subscriber_demographics'],
      recommendedHumanAction: 'Verify the member ID and subscriber demographics, then retry.',
    };
  }
  if (memberId.includes('AUTH') || memberId.includes('PA')) {
    return {
      eligibilityStatus: 'prior_auth_required',
      summary: 'HETS 270/271 indicates this service type requires prior authorization.',
      reasonCode: 'prior_authorization_required',
      priorAuthRequired: true,
      requiredContextFields: ['prior_auth_reference', 'clinical_documentation'],
      recommendedHumanAction: 'Obtain prior authorization from the payer before proceeding.',
    };
  }
  if (memberId.includes('OON') || memberId.includes('NP')) {
    return {
      eligibilityStatus: 'out_of_network',
      summary: 'HETS 270/271 indicates the provider is not participating in the patient\'s plan.',
      reasonCode: 'out_of_network_provider',
      outOfNetwork: true,
      requiredContextFields: ['network_participation_confirmation', 'patient_consent'],
      recommendedHumanAction: 'Confirm out-of-network billing path or identify a participating provider.',
    };
  }
  if (memberId.includes('COB') || memberId.includes('COORD')) {
    return {
      eligibilityStatus: 'coordination_required',
      summary: 'HETS 270/271 indicates coordination of benefits is required; this payer may be secondary.',
      reasonCode: 'coordination_of_benefits_required',
      requiresCoordination: true,
      requiredContextFields: ['primary_payer_eob', 'cob_order_confirmation'],
      recommendedHumanAction: 'Determine COB order and obtain primary payer explanation of benefits.',
    };
  }
  if (memberId.includes('LIM')) {
    return {
      eligibilityStatus: 'active_with_limitations',
      summary: 'HETS 270/271 confirms active coverage with service or benefit limitations.',
      reasonCode: 'coverage_active_with_limitations',
      planName: 'Simulated Health Plan',
      coverageBeginDate: '2024-01-01',
      limitations: ['mental_health_visit_limit', 'durable_medical_equipment_restriction'],
      recommendedHumanAction: 'Document limitations and confirm service type is covered.',
    };
  }
  if (memberId.includes('DED')) {
    return {
      eligibilityStatus: 'deductible_not_met',
      summary: 'HETS 270/271 confirms active coverage. Patient deductible has not been met.',
      reasonCode: 'coverage_active_deductible_outstanding',
      planName: 'Simulated Health Plan',
      deductibleAmount: 2000,
      deductibleMet: 450,
      coverageBeginDate: '2024-01-01',
    };
  }

  // Hash-based deterministic fallback for any other member ID
  const hash = Array.from(memberId).reduce((acc, char) => acc + char.charCodeAt(0), 0) % 4;
  if (hash === 0) {
    return {
      eligibilityStatus: 'active',
      summary: 'HETS 270/271 confirms active coverage for this subscriber.',
      reasonCode: 'coverage_active_confirmed',
      planName: 'Simulated Health Plan',
      coverageBeginDate: '2024-01-01',
      copayAmount: 30,
      coinsurancePct: 20,
    };
  }
  if (hash === 1) {
    return {
      eligibilityStatus: 'active_with_limitations',
      summary: 'HETS 270/271 confirms active coverage with plan-level limitations.',
      reasonCode: 'coverage_active_with_limitations',
      planName: 'Simulated Health Plan',
      coverageBeginDate: '2024-01-01',
      limitations: ['annual_visit_limit'],
    };
  }
  if (hash === 2) {
    return {
      eligibilityStatus: 'deductible_not_met',
      summary: 'HETS 270/271 confirms active coverage. Individual deductible has not been fully met.',
      reasonCode: 'coverage_active_deductible_outstanding',
      planName: 'Simulated Health Plan',
      deductibleAmount: 1500,
      deductibleMet: 200,
      coverageBeginDate: '2024-01-01',
    };
  }
  return {
    eligibilityStatus: 'active',
    summary: 'HETS 270/271 confirms active coverage for this subscriber.',
    reasonCode: 'coverage_active_confirmed',
    planName: 'Simulated Health Plan',
    coverageBeginDate: '2024-01-01',
    copayAmount: 20,
    coinsurancePct: 10,
  };
}

// ─── Remote HETS call ─────────────────────────────────────────────────────────

async function runRemoteHetsEligibility(
  env: Env,
  input: EligibilityConnectorExecutionInput,
): Promise<RemoteHetsResponse> {
  const apiUrl = env.RCM_HETS_API_URL;
  const apiKey = env.RCM_HETS_API_KEY;

  if (!apiUrl || !apiKey) {
    return deterministicSimulation(input);
  }

  const timeoutMsRaw = env.RCM_HETS_TIMEOUT_MS;
  const timeoutMs =
    typeof timeoutMsRaw === 'string' && Number.isFinite(Number(timeoutMsRaw))
      ? Number(timeoutMsRaw)
      : DEFAULT_TIMEOUT_MS;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const metadata = input.metadata;
    const body = {
      memberId: input.memberId,
      payerName: input.payerName,
      payerId: input.payerId,
      coverageType: input.coverageType,
      patientRef: input.patientRef,
      providerRef: input.providerRef,
      providerNpi: input.providerNpi,
      dateOfService: input.dateOfService,
      serviceTypeCodes: input.serviceTypeCodes,
      formType: input.formType,
      sourceSystem: input.sourceSystem,
      groupNumber: pickString(metadata['groupNumber']),
      providerTaxonomyCode: pickString(metadata['providerTaxonomyCode']),
      metadata,
    };

    const response = await fetch(
      `${apiUrl.replace(/\/$/, '')}/eligibility/270-271`,
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
        eligibilityStatus: 'transport_failed',
        summary: `HETS connector returned ${response.status}.`,
        reasonCode: 'connector_transport_failed',
        recommendedHumanAction:
          'Check the HETS connector configuration and route to exception handling if the issue persists.',
        rawResponse: json,
      };
    }

    return {
      eligibilityStatus: pickString(json['eligibilityStatus'], json['status'], json['memberStatus']) ?? 'transport_failed',
      statusLabel: pickString(json['statusLabel']) ?? undefined,
      summary: pickString(json['summary']) ?? undefined,
      reasonCode: pickString(json['reasonCode']) ?? undefined,
      traceId: pickString(json['traceId'], json['payerTraceId'], json['requestId']) ?? undefined,
      planName: pickString(json['planName'], json['planDescription']) ?? undefined,
      groupNumber: pickString(json['groupNumber']) ?? undefined,
      coverageBeginDate: pickString(json['coverageBeginDate'], json['eligibilityBeginDate']) ?? null,
      coverageEndDate: pickString(json['coverageEndDate'], json['eligibilityEndDate']) ?? null,
      deductibleAmount: pickNumber(json['deductibleAmount'], json['individualDeductible']),
      deductibleMet: pickNumber(json['deductibleMet'], json['deductiblePaid']),
      copayAmount: pickNumber(json['copayAmount'], json['copay']),
      coinsurancePct: pickNumber(json['coinsurancePct'], json['coinsurance']),
      priorAuthRequired: pickBoolean(json['priorAuthRequired']) ?? undefined,
      outOfNetwork: pickBoolean(json['outOfNetwork']) ?? undefined,
      requiresCoordination: pickBoolean(json['requiresCoordination'] ?? json['cobRequired']) ?? undefined,
      limitations: Array.isArray(json['limitations'])
        ? json['limitations'].filter((v): v is string => typeof v === 'string')
        : undefined,
      requiredContextFields: Array.isArray(json['requiredContextFields'])
        ? json['requiredContextFields'].filter((v): v is string => typeof v === 'string')
        : undefined,
      recommendedHumanAction: pickString(json['recommendedHumanAction']) ?? undefined,
      payerMessage: pickString(json['payerMessage'], json['message']) ?? undefined,
      rawResponse: json,
    };
  } catch (err: unknown) {
    return {
      eligibilityStatus: 'transport_failed',
      summary: err instanceof Error ? err.message : 'HETS connector request failed.',
      reasonCode: 'connector_transport_failed',
      recommendedHumanAction:
        'Check HETS connector availability and route to exception handling if needed.',
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

// ─── Build execution object from normalized response ──────────────────────────

function buildExecutionFromEligibility(
  connectorKey: EligibilityConnectorKey,
  mode: EligibilityConnectorMode,
  raw: RemoteHetsResponse,
): EligibilityConnectorExecution {
  const performedAt = new Date().toISOString();
  const normalized = normalizeEligibilityStatus(raw.eligibilityStatus ?? null);
  const traceId = raw.traceId ?? `rcm-${connectorKey}-${crypto.randomUUID().slice(0, 8)}`;

  let proposedResolution = '';
  let resolutionReasonCode = raw.reasonCode ?? normalized.statusCode;
  let confidencePct = 70;
  let nextBestAction = 'qa_verify';
  let autoQaRecommendation: EligibilityAutoQaRecommendation = 'awaiting_qa';
  let exceptionSuggestion: EligibilityExceptionSuggestion | undefined;

  switch (normalized.normalized) {
    case 'active': {
      proposedResolution =
        'HETS 270/271 confirms active coverage for this subscriber. Eligibility is established and the work item can close automatically.';
      resolutionReasonCode = raw.reasonCode ?? 'coverage_active_confirmed';
      confidencePct = 95;
      nextBestAction = 'approve_auto_close';
      autoQaRecommendation = 'close_auto';
      break;
    }
    case 'active_with_limitations': {
      proposedResolution =
        'HETS 270/271 confirms active coverage with plan-level limitations. Coverage status is established and documented; the item can close automatically.';
      resolutionReasonCode = raw.reasonCode ?? 'coverage_active_with_limitations';
      confidencePct = 88;
      nextBestAction = 'approve_auto_close';
      autoQaRecommendation = 'close_auto';
      break;
    }
    case 'deductible_not_met': {
      proposedResolution =
        'HETS 270/271 confirms active coverage. Patient deductible information is now documented. Coverage status is established; the item can close automatically.';
      resolutionReasonCode = raw.reasonCode ?? 'coverage_active_deductible_outstanding';
      confidencePct = 90;
      nextBestAction = 'approve_auto_close';
      autoQaRecommendation = 'close_auto';
      break;
    }
    case 'inactive': {
      proposedResolution =
        'HETS 270/271 indicates subscriber coverage is not active. The case must move to human review for coverage gap resolution or re-enrollment options.';
      resolutionReasonCode = raw.reasonCode ?? 'coverage_inactive';
      confidencePct = 85;
      nextBestAction = 'route_to_exception_inbox';
      autoQaRecommendation = 'human_review_required';
      exceptionSuggestion = {
        exceptionType: 'coverage_inactive',
        severity: 'high',
        summary: raw.summary ?? 'Subscriber coverage is not currently active according to the payer.',
        recommendedHumanAction:
          raw.recommendedHumanAction ??
          'Verify coverage termination date with the payer and determine whether re-enrollment or secondary billing is appropriate.',
        requiredContextFields: raw.requiredContextFields ?? ['coverage_termination_date', 'secondary_payer_check'],
        reasonCode: resolutionReasonCode,
      };
      break;
    }
    case 'not_found': {
      proposedResolution =
        'HETS 270/271 could not locate this subscriber. The case requires human review to verify the member ID and subscriber demographics.';
      resolutionReasonCode = raw.reasonCode ?? 'subscriber_id_not_found';
      confidencePct = 78;
      nextBestAction = 'route_to_exception_inbox';
      autoQaRecommendation = 'human_review_required';
      exceptionSuggestion = {
        exceptionType: 'subscriber_not_found',
        severity: 'high',
        summary: raw.summary ?? 'Subscriber not found in payer system — member ID or demographics may be incorrect.',
        recommendedHumanAction:
          raw.recommendedHumanAction ??
          'Verify the member ID against the patient\'s insurance card, correct demographics if needed, and retry.',
        requiredContextFields: raw.requiredContextFields ?? ['correct_member_id', 'subscriber_demographics'],
        reasonCode: resolutionReasonCode,
      };
      break;
    }
    case 'prior_auth_required': {
      proposedResolution =
        'HETS 270/271 indicates prior authorization is required for this service type. The case requires human follow-up to initiate the PA process.';
      resolutionReasonCode = raw.reasonCode ?? 'prior_authorization_required';
      confidencePct = 82;
      nextBestAction = 'route_to_exception_inbox';
      autoQaRecommendation = 'human_review_required';
      exceptionSuggestion = {
        exceptionType: 'prior_auth_required',
        severity: 'high',
        summary: raw.summary ?? 'Prior authorization is required before this service can proceed.',
        recommendedHumanAction:
          raw.recommendedHumanAction ??
          'Submit a prior authorization request to the payer with clinical documentation before scheduling or billing.',
        requiredContextFields: raw.requiredContextFields ?? ['prior_auth_reference', 'clinical_documentation'],
        reasonCode: resolutionReasonCode,
      };
      break;
    }
    case 'out_of_network': {
      proposedResolution =
        'HETS 270/271 indicates the provider is not participating in this patient\'s network. The case requires human review for out-of-network billing or provider alternatives.';
      resolutionReasonCode = raw.reasonCode ?? 'out_of_network_provider';
      confidencePct = 80;
      nextBestAction = 'route_to_exception_inbox';
      autoQaRecommendation = 'human_review_required';
      exceptionSuggestion = {
        exceptionType: 'out_of_network_provider',
        severity: 'high',
        summary: raw.summary ?? 'Provider is not participating in the patient\'s health plan network.',
        recommendedHumanAction:
          raw.recommendedHumanAction ??
          'Confirm out-of-network benefits and patient financial liability, or identify a participating provider.',
        requiredContextFields: raw.requiredContextFields ?? ['network_participation_confirmation', 'patient_consent'],
        reasonCode: resolutionReasonCode,
      };
      break;
    }
    case 'coordination_required': {
      proposedResolution =
        'HETS 270/271 indicates coordination of benefits applies. The case is routed to QA to determine COB order and whether a primary payer response is already on file.';
      resolutionReasonCode = raw.reasonCode ?? 'coordination_of_benefits_required';
      confidencePct = 72;
      nextBestAction = 'qa_verify';
      autoQaRecommendation = 'awaiting_qa';
      break;
    }
    default: {
      // transport_failed or unmapped
      proposedResolution =
        'The HETS connector did not return a stable eligibility status. The case must move to human review for manual verification.';
      resolutionReasonCode = raw.reasonCode ?? 'connector_transport_failed';
      confidencePct = 40;
      nextBestAction = 'route_to_exception_inbox';
      autoQaRecommendation = 'human_review_required';
      exceptionSuggestion = {
        exceptionType: 'payer_system_unavailable',
        severity: 'high',
        summary:
          raw.summary ?? 'HETS connector could not return a reliable eligibility status for this subscriber.',
        recommendedHumanAction:
          raw.recommendedHumanAction ??
          'Check HETS connector availability and verify eligibility manually via the payer portal.',
        requiredContextFields: raw.requiredContextFields ?? ['connector_access_context', 'manual_verification_path'],
        reasonCode: resolutionReasonCode,
      };
      break;
    }
  }

  const evidence: EligibilityConnectorEvidence[] = [
    {
      evidenceType: 'eligibility_inquiry_requested',
      payload: { connectorKey, mode, traceId, performedAt, serviceTypeCodes: [] },
    },
    {
      evidenceType: 'edi_270_submitted',
      payload: { connectorKey, mode, traceId },
    },
    {
      evidenceType: 'edi_271_received',
      payload: {
        connectorKey,
        mode,
        traceId,
        eligibilityStatus: normalized.statusCode,
        statusLabel: normalized.statusLabel,
        planName: raw.planName ?? null,
        groupNumber: raw.groupNumber ?? null,
        coverageBeginDate: raw.coverageBeginDate ?? null,
        coverageEndDate: raw.coverageEndDate ?? null,
      },
    },
  ];

  if (normalized.normalized === 'active' || normalized.normalized === 'active_with_limitations' || normalized.normalized === 'deductible_not_met') {
    evidence.push({
      evidenceType: 'eligibility_verified',
      payload: {
        connectorKey,
        mode,
        traceId,
        eligibilityStatus: normalized.statusCode,
        planName: raw.planName ?? null,
        deductibleAmount: raw.deductibleAmount ?? null,
        deductibleMet: raw.deductibleMet ?? null,
        copayAmount: raw.copayAmount ?? null,
        coinsurancePct: raw.coinsurancePct ?? null,
        limitations: raw.limitations ?? null,
        payerMessage: raw.payerMessage ?? null,
      },
    });
  }

  if (normalized.normalized === 'inactive' || normalized.normalized === 'not_found') {
    evidence.push({
      evidenceType: 'coverage_gap_detected',
      payload: {
        eligibilityStatus: normalized.statusCode,
        reasonCode: resolutionReasonCode,
        recommendedHumanAction: exceptionSuggestion?.recommendedHumanAction ?? null,
      },
    });
  }

  if (raw.priorAuthRequired === true || normalized.normalized === 'prior_auth_required') {
    evidence.push({
      evidenceType: 'prior_auth_flag_detected',
      payload: {
        priorAuthRequired: true,
        requiredContextFields: exceptionSuggestion?.requiredContextFields ?? [],
      },
    });
  }

  if (
    normalized.normalized === 'transport_failed' ||
    normalized.normalized === 'out_of_network' ||
    normalized.normalized === 'coordination_required'
  ) {
    evidence.push({
      evidenceType: 'payer_response_ambiguous',
      payload: {
        eligibilityStatus: normalized.statusCode,
        statusLabel: normalized.statusLabel,
        recommendedHumanAction: exceptionSuggestion?.recommendedHumanAction ?? null,
      },
    });
  }

  if (raw.deductibleAmount !== null && raw.deductibleAmount !== undefined) {
    evidence.push({
      evidenceType: 'benefit_detail_captured',
      payload: {
        deductibleAmount: raw.deductibleAmount,
        deductibleMet: raw.deductibleMet ?? null,
        copayAmount: raw.copayAmount ?? null,
        coinsurancePct: raw.coinsurancePct ?? null,
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
      planName: raw.planName ?? null,
      groupNumber: raw.groupNumber ?? null,
      coverageBeginDate: raw.coverageBeginDate ?? null,
      coverageEndDate: raw.coverageEndDate ?? null,
      deductibleAmount: raw.deductibleAmount ?? null,
      deductibleMet: raw.deductibleMet ?? null,
      copayAmount: raw.copayAmount ?? null,
      coinsurancePct: raw.coinsurancePct ?? null,
      priorAuthRequired: raw.priorAuthRequired ?? null,
      outOfNetwork: raw.outOfNetwork ?? null,
      requiresCoordination: raw.requiresCoordination ?? null,
      limitations: raw.limitations ?? null,
      payerMessage: raw.payerMessage ?? null,
    },
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function getEligibilityConnectorAvailability(env: Env): EligibilityConnectorAvailability[] {
  const hetsConfigured = Boolean(env.RCM_HETS_API_URL && env.RCM_HETS_API_KEY);

  return [
    {
      key: 'x12_270_271',
      label: 'X12 270/271 (HETS)',
      status: hetsConfigured ? 'live' : 'simulation',
      mode: hetsConfigured ? 'remote' : 'simulation',
      configured: hetsConfigured,
      capabilities: [
        'eligibility_verification',
        'benefit_detail_capture',
        'prior_auth_flag_detection',
        'deductible_status',
        'network_status',
        'auto_close_candidates',
      ],
      notes: hetsConfigured
        ? 'Remote HETS connector configured and ready to run X12 270/271 eligibility inquiries.'
        : 'No remote HETS credentials detected. Deterministic simulation mode is active so the lane can run end to end.',
    },
    {
      key: 'portal',
      label: 'Payer portal fallback',
      status: 'manual_fallback',
      mode: 'manual',
      configured: false,
      capabilities: ['operator_verification', 'manual_capture'],
      notes:
        'Portal fallback stays human-led until credential vaulting and operator controls are production-ready.',
    },
  ];
}

export async function runEligibilityConnector(
  env: Env,
  connectorKey: EligibilityConnectorKey,
  input: EligibilityConnectorExecutionInput,
): Promise<EligibilityConnectorExecution> {
  if (connectorKey !== 'x12_270_271') {
    return buildExecutionFromEligibility(connectorKey, 'manual', {
      eligibilityStatus: 'transport_failed',
      summary: `${connectorKey} is a manual fallback path and is not an autonomous live connector.`,
      reasonCode: 'manual_fallback_only',
      recommendedHumanAction:
        'Route this case to a human operator for payer portal verification.',
      requiredContextFields: ['operator_takeover_context'],
    });
  }

  const hetsConfigured = Boolean(env.RCM_HETS_API_URL && env.RCM_HETS_API_KEY);
  const raw = await runRemoteHetsEligibility(env, input);
  return buildExecutionFromEligibility(
    connectorKey,
    hetsConfigured ? 'remote' : 'simulation',
    raw,
  );
}
