/**
 * RCM ERA 835 Connector — scaffold
 *
 * Processes ANSI X12 835 Electronic Remittance Advice (ERA) files to:
 *   1. Parse payment data from payer remittance
 *   2. Match payments to outstanding claims
 *   3. Post payments and adjustments
 *   4. Detect underpayments and generate denial follow-up work items
 *   5. Reconcile posted amounts with expected claim values
 *
 * Status: SCAFFOLD — full X12 835 parsing and payment posting are TODO.
 *
 * Connector keys:
 *   x12_835_clearinghouse  — Receive ERA via clearinghouse (primary)
 *   direct_sftp            — Direct SFTP pickup from payer (secondary)
 *
 * The intake route is live at POST /api/rcm/lanes/era-835/intake.
 * Full processing logic will be added in a subsequent phase.
 */

import type { Env } from '../types';

// ─── Types ────────────────────────────────────────────────────────────────────

export type Era835ConnectorKey = 'x12_835_clearinghouse' | 'direct_sftp';
export type Era835ConnectorMode = 'remote' | 'simulation' | 'manual';
export type Era835AutoQaRecommendation = 'close_auto' | 'awaiting_qa' | 'human_review_required';

export type Era835PaymentStatus =
  | 'payment_posted'       // Full payment matched and posted
  | 'partial_payment'      // Partial payment — underpayment detected
  | 'denied'               // Claim denied in ERA
  | 'adjustment_required'  // Contractual adjustment needed
  | 'unmatched'            // ERA received but claim not found in system
  | 'pending_posting';     // ERA received, awaiting posting

export interface Era835ClaimLine {
  serviceDate: string;
  procedureCode: string;
  chargeAmount: number;
  paymentAmount: number;
  adjustmentAmount: number;
  adjustmentReasonCode: string;
  remarkCodes: string[];
}

export interface Era835ConnectorExecutionInput {
  workItemId: string;
  claimRef: string;
  eraRef: string;         // ERA 835 reference / check number
  payerName: string;
  payerId: string | null;
  patientRef: string;
  providerRef: string;
  npi: string | null;
  checkDate: string | null;
  checkAmount: number | null;
  formType: string;
  sourceSystem: string;
  metadata: Record<string, unknown>;
}

export interface Era835ConnectorExecution {
  connectorKey: Era835ConnectorKey;
  mode: Era835ConnectorMode;
  performedAt: string;
  strategy: string;
  statusCode: Era835PaymentStatus;
  statusLabel: string;
  connectorTraceId: string | null;
  proposedResolution: string;
  resolutionReasonCode: string;
  confidencePct: number;
  nextBestAction: string;
  autoQaRecommendation: Era835AutoQaRecommendation;
  /** Payment details extracted from ERA */
  paymentDetails: {
    checkNumber: string | null;
    checkDate: string | null;
    paymentAmount: number;
    claimLines: Era835ClaimLine[];
    totalCharge: number;
    totalPayment: number;
    underpaymentAmount: number;
  };
  evidence: Array<{ evidenceType: string; payload?: unknown; actorType?: string; actorRef?: string }>;
  summary: string;
  rawResponse: Record<string, unknown>;
}

export interface Era835ConnectorAvailability {
  key: Era835ConnectorKey;
  label: string;
  status: 'live' | 'simulation' | 'manual_fallback';
  mode: Era835ConnectorMode;
  configured: boolean;
  capabilities: string[];
  notes: string;
}

// ─── Availability ─────────────────────────────────────────────────────────────

export function getEra835ConnectorAvailability(env: Env): Era835ConnectorAvailability[] {
  const clearinghouseConfigured = Boolean(
    env.RCM_X12_CLAIM_STATUS_API_URL && env.RCM_X12_CLAIM_STATUS_API_KEY,
  );

  return [
    {
      key: 'x12_835_clearinghouse',
      label: 'X12 ERA 835 via Clearinghouse',
      status: 'simulation', // TODO: promote to 'live' once X12 835 parsing is implemented
      mode: 'simulation',
      configured: clearinghouseConfigured,
      capabilities: [
        'era_835_parsing',     // TODO
        'payment_matching',    // TODO
        'payment_posting',     // TODO
        'underpayment_detection',
        'denial_follow_up_routing',
      ],
      notes:
        'ERA 835 parsing and payment posting are planned for Phase 2. Currently returns simulation data.',
    },
    {
      key: 'direct_sftp',
      label: 'Direct SFTP ERA Pickup',
      status: 'manual_fallback',
      mode: 'manual',
      configured: false,
      capabilities: ['era_file_pickup'],
      notes: 'SFTP ERA pickup requires server configuration. Contact support to enable.',
    },
  ];
}

// ─── Main connector ────────────────────────────────────────────────────────────

/**
 * Run the ERA 835 connector for a work item.
 *
 * TODO: Implement real X12 835 parsing in a follow-up phase.
 *       For now, returns simulation data to complete the state machine loop.
 */
export async function runEra835Connector(
  _env: Env,
  connectorKey: Era835ConnectorKey,
  input: Era835ConnectorExecutionInput,
): Promise<Era835ConnectorExecution> {
  if (connectorKey === 'direct_sftp') {
    return sftpManualFallback(input);
  }
  return simulateEra835Execution(input);
}

// ─── Simulation ───────────────────────────────────────────────────────────────

function simulateEra835Execution(input: Era835ConnectorExecutionInput): Era835ConnectorExecution {
  const performedAt = new Date().toISOString();
  const traceId = `sim-era835-${Date.now()}`;
  const paymentAmount = input.checkAmount ?? 0;
  const totalCharge = paymentAmount * 1.12; // simulate 88% payment rate
  const underpayment = totalCharge - paymentAmount;
  const statusCode: Era835PaymentStatus = underpayment > 0.01 ? 'partial_payment' : 'payment_posted';

  return {
    connectorKey: 'x12_835_clearinghouse',
    mode: 'simulation',
    performedAt,
    strategy: 'x12_835_clearinghouse',
    statusCode,
    statusLabel: era835StatusLabel(statusCode),
    connectorTraceId: traceId,
    proposedResolution: era835ProposedResolution(statusCode, underpayment),
    resolutionReasonCode: statusCode,
    confidencePct: statusCode === 'payment_posted' ? 90 : 70,
    nextBestAction: era835NextBestAction(statusCode, underpayment),
    autoQaRecommendation: statusCode === 'payment_posted' ? 'close_auto' : 'awaiting_qa',
    paymentDetails: {
      checkNumber: input.eraRef ?? null,
      checkDate: input.checkDate,
      paymentAmount,
      totalCharge,
      totalPayment: paymentAmount,
      underpaymentAmount: Math.max(0, underpayment),
      claimLines: [
        {
          serviceDate: new Date().toISOString().slice(0, 10),
          procedureCode: '99213',
          chargeAmount: totalCharge,
          paymentAmount,
          adjustmentAmount: underpayment,
          adjustmentReasonCode: 'CO-45',
          remarkCodes: ['N130'],
        },
      ],
    },
    evidence: [
      {
        evidenceType: 'era_835_received',
        payload: { eraRef: input.eraRef, payerName: input.payerName, checkDate: input.checkDate },
      },
      {
        evidenceType: 'payment_matching_attempted',
        payload: { claimRef: input.claimRef, paymentAmount, statusCode, mode: 'simulation' },
      },
    ],
    summary: `[SIM] ERA 835: ${era835StatusLabel(statusCode)} — $${paymentAmount.toFixed(2)} received${underpayment > 0.01 ? `, $${underpayment.toFixed(2)} underpayment` : ''}`,
    rawResponse: { simulatedAt: performedAt, eraRef: input.eraRef, paymentAmount },
  };
}

function sftpManualFallback(input: Era835ConnectorExecutionInput): Era835ConnectorExecution {
  return {
    connectorKey: 'direct_sftp',
    mode: 'manual',
    performedAt: new Date().toISOString(),
    strategy: 'direct_sftp',
    statusCode: 'pending_posting',
    statusLabel: 'Manual SFTP pickup required',
    connectorTraceId: null,
    proposedResolution: 'Operator must download the ERA file from the SFTP server and post payments manually.',
    resolutionReasonCode: 'manual_sftp_required',
    confidencePct: 0,
    nextBestAction: 'Configure SFTP credentials or use clearinghouse ERA delivery.',
    autoQaRecommendation: 'human_review_required',
    paymentDetails: {
      checkNumber: input.eraRef ?? null,
      checkDate: input.checkDate,
      paymentAmount: 0,
      totalCharge: 0,
      totalPayment: 0,
      underpaymentAmount: 0,
      claimLines: [],
    },
    evidence: [
      {
        evidenceType: 'sftp_pickup_required',
        payload: { claimRef: input.claimRef, eraRef: input.eraRef, reason: 'sftp_not_configured' },
      },
    ],
    summary: 'ERA 835 SFTP pickup is manual-only until SFTP server is configured.',
    rawResponse: { transport: 'manual', fallback: true },
  };
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

function era835StatusLabel(code: Era835PaymentStatus): string {
  const labels: Record<Era835PaymentStatus, string> = {
    payment_posted: 'Payment Posted',
    partial_payment: 'Partial Payment — Underpayment Detected',
    denied: 'Claim Denied in ERA',
    adjustment_required: 'Contractual Adjustment Required',
    unmatched: 'ERA Received — Claim Not Found',
    pending_posting: 'Pending Payment Posting',
  };
  return labels[code] ?? code;
}

function era835ProposedResolution(code: Era835PaymentStatus, underpayment: number): string {
  if (code === 'payment_posted') return 'Payment posted in full. No further action required.';
  if (code === 'partial_payment') return `Partial payment received. Underpayment of $${underpayment.toFixed(2)} detected — route to denial follow-up.`;
  if (code === 'denied') return 'Claim denied in ERA. Route to denial follow-up lane for appeal.';
  if (code === 'adjustment_required') return 'Contractual adjustment required. Post adjustment and reconcile.';
  if (code === 'unmatched') return 'ERA payment cannot be matched to a claim. Manual reconciliation required.';
  return 'Post payment and reconcile with billing system.';
}

function era835NextBestAction(code: Era835PaymentStatus, underpayment: number): string {
  if (code === 'payment_posted') return 'Confirm payment posting in billing system';
  if (code === 'partial_payment') return `Submit underpayment of $${underpayment.toFixed(2)} to denial follow-up`;
  if (code === 'denied') return 'Create denial follow-up work item';
  if (code === 'adjustment_required') return 'Post contractual adjustment';
  if (code === 'unmatched') return 'Manual reconciliation required';
  return 'Post payment and reconcile';
}
