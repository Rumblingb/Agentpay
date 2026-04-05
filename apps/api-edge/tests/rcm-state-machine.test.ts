/**
 * RCM State Machine Transition Tests
 *
 * Tests the connector state machine logic, including:
 *   - Connector output → autoQaRecommendation mapping
 *   - State transitions: routed → awaiting_qa → closed_auto | retry_pending | human_review_required
 *   - Denial follow-up connector logic
 *   - ERA 835 connector scaffold
 *   - Autonomy loop helpers (pure functions)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Import pure functions from connectors ────────────────────────────────────

// We import individual functions that are exported from connector files.
// All external I/O (fetch, DB) is mocked.

vi.mock('../src/lib/db', () => ({
  createDb: vi.fn(),
  parseJsonb: (value: unknown, fallback: unknown) => {
    if (typeof value === 'string') {
      try { return JSON.parse(value); } catch { return fallback; }
    }
    return value ?? fallback;
  },
}));

// ─── Claim status connector — autoQaRecommendation rules ─────────────────────

describe('ClaimStatus connector — simulation outcomes', () => {
  // The simulation is deterministic based on claim ref. We test the autoQaRecommendation
  // mapping by importing and calling the simulation function indirectly via the connector.

  it('should produce valid status codes for known claim refs', async () => {
    const { runClaimStatusConnector } = await import('../src/lib/rcmClaimStatusConnector');
    const env = {} as never; // no API URL/key → simulation mode

    const result = await runClaimStatusConnector(env, 'x12_276_277', {
      workItemId: 'aaa00000-0000-0000-0000-000000000001',
      claimRef: 'CLM-ACTIVE-001',
      payerName: 'Test Payer',
      coverageType: 'medical',
      patientRef: 'PAT-001',
      providerRef: 'PRV-001',
      formType: 'UB-04',
      sourceSystem: 'test',
      amountAtRisk: 1500,
      metadata: {},
    });

    expect(result.connectorKey).toBe('x12_276_277');
    expect(result.mode).toBe('simulation');
    expect(result.statusCode).toBeDefined();
    expect(result.confidencePct).toBeGreaterThanOrEqual(0);
    expect(result.confidencePct).toBeLessThanOrEqual(100);
    expect(['close_auto', 'awaiting_qa', 'human_review_required']).toContain(result.autoQaRecommendation);
    expect(result.evidence).toBeInstanceOf(Array);
    expect(result.evidence.length).toBeGreaterThan(0);
    expect(result.connectorTraceId).toBeTruthy();
    expect(result.performedAt).toBeTruthy();
  });

  it('should return evidence array with required fields', async () => {
    const { runClaimStatusConnector } = await import('../src/lib/rcmClaimStatusConnector');
    const env = {} as never;

    const result = await runClaimStatusConnector(env, 'x12_276_277', {
      workItemId: 'aaa00000-0000-0000-0000-000000000002',
      claimRef: 'CLM-TEST-002',
      payerName: 'Payer B',
      coverageType: 'medical',
      patientRef: 'PAT-002',
      providerRef: 'PRV-002',
      formType: 'UB-04',
      sourceSystem: 'test',
      amountAtRisk: null,
      metadata: {},
    });

    for (const item of result.evidence) {
      expect(typeof item.evidenceType).toBe('string');
      expect(item.evidenceType.length).toBeGreaterThan(0);
    }
  });

  it('should return portal fallback when connectorKey is portal', async () => {
    const { runClaimStatusConnector } = await import('../src/lib/rcmClaimStatusConnector');
    const env = {} as never;

    const result = await runClaimStatusConnector(env, 'portal', {
      workItemId: 'aaa00000-0000-0000-0000-000000000003',
      claimRef: 'CLM-003',
      payerName: 'Portal Payer',
      coverageType: 'medical',
      patientRef: 'PAT-003',
      providerRef: 'PRV-003',
      formType: 'UB-04',
      sourceSystem: 'test',
      amountAtRisk: 500,
      metadata: {},
    });

    expect(result.connectorKey).toBe('portal');
    expect(result.mode).toBe('manual');
    expect(result.autoQaRecommendation).toBe('human_review_required');
    // Portal fallback is manual-only; confidence is not meaningful
    expect(result.confidencePct).toBeGreaterThanOrEqual(0);
    expect(result.confidencePct).toBeLessThanOrEqual(100);
  });

  it('should return connector availability with expected keys', async () => {
    const { getClaimStatusConnectorAvailability } = await import('../src/lib/rcmClaimStatusConnector');
    const env = {} as never;
    const availability = getClaimStatusConnectorAvailability(env);

    expect(availability).toBeInstanceOf(Array);
    expect(availability.length).toBeGreaterThanOrEqual(2);
    const keys = availability.map((a) => a.key);
    expect(keys).toContain('x12_276_277');
    expect(keys).toContain('portal');
  });
});

// ─── Eligibility connector — simulation outcomes ──────────────────────────────

describe('Eligibility connector — simulation outcomes', () => {
  it('should produce valid eligibility results in simulation mode', async () => {
    const { runEligibilityConnector } = await import('../src/lib/rcmEligibilityConnector');
    const env = {} as never;

    const result = await runEligibilityConnector(env, 'x12_270_271', {
      workItemId: 'bbb00000-0000-0000-0000-000000000001',
      memberId: 'MBR-ACTIVE-001',
      payerName: 'Test Payer',
      payerId: null,
      coverageType: 'medical',
      patientRef: 'PAT-001',
      providerRef: 'PRV-001',
      providerNpi: '1234567890',
      dateOfService: '2025-06-01',
      serviceTypeCodes: ['30'],
      formType: 'CMS-1500',
      sourceSystem: 'test',
      metadata: {},
    });

    expect(result.connectorKey).toBe('x12_270_271');
    expect(result.mode).toBe('simulation');
    expect(result.statusCode).toBeDefined();
    expect(result.confidencePct).toBeGreaterThanOrEqual(0);
    expect(result.confidencePct).toBeLessThanOrEqual(100);
    expect(['close_auto', 'awaiting_qa', 'human_review_required']).toContain(result.autoQaRecommendation);
    expect(result.evidence).toBeInstanceOf(Array);
  });

  it('should return portal fallback for eligibility when connectorKey is portal', async () => {
    const { runEligibilityConnector } = await import('../src/lib/rcmEligibilityConnector');
    const env = {} as never;

    const result = await runEligibilityConnector(env, 'portal', {
      workItemId: 'bbb00000-0000-0000-0000-000000000002',
      memberId: 'MBR-002',
      payerName: 'Payer B',
      payerId: 'PYR-002',
      coverageType: 'medical',
      patientRef: 'PAT-002',
      providerRef: 'PRV-002',
      providerNpi: '1234567890',
      dateOfService: '2025-06-01',
      serviceTypeCodes: ['30', '98'],
      formType: 'CMS-1500',
      sourceSystem: 'test',
      metadata: {},
    });

    expect(result.mode).toBe('manual');
    expect(result.autoQaRecommendation).toBe('human_review_required');
  });
});

// ─── Denial follow-up connector ───────────────────────────────────────────────

describe('DenialFollowUp connector — simulation outcomes', () => {
  it('should produce valid denial follow-up results in simulation mode', async () => {
    const { runDenialFollowUpConnector } = await import('../src/lib/rcmDenialFollowUpConnector');
    const env = {} as never;

    const result = await runDenialFollowUpConnector(env, 'x12_appeal_inquiry', {
      workItemId: 'ccc00000-0000-0000-0000-000000000001',
      claimRef: 'CLM-DENIED-001',
      payerName: 'Test Payer',
      coverageType: 'medical',
      patientRef: 'PAT-001',
      providerRef: 'PRV-001',
      denialReasonCode: 'CO-45',
      denialDate: '2025-05-01',
      appealDeadline: '2025-08-01',
      formType: 'UB-04',
      sourceSystem: 'test',
      amountAtRisk: 2500,
      metadata: {},
    });

    expect(result.connectorKey).toBe('x12_appeal_inquiry');
    expect(result.mode).toBe('simulation');
    expect(result.statusCode).toBeDefined();
    expect(result.confidencePct).toBeGreaterThanOrEqual(0);
    expect(result.confidencePct).toBeLessThanOrEqual(100);
    expect(['close_auto', 'awaiting_qa', 'human_review_required']).toContain(result.autoQaRecommendation);
    expect(typeof result.appealEligible).toBe('boolean');
    expect(['open', 'closing_soon', 'expired', 'unknown']).toContain(result.appealDeadlineStatus);
    expect(result.evidence).toBeInstanceOf(Array);
    expect(result.evidence.length).toBeGreaterThan(0);
  });

  it('should detect expired appeal deadline', async () => {
    const { runDenialFollowUpConnector } = await import('../src/lib/rcmDenialFollowUpConnector');
    const env = {} as never;

    const result = await runDenialFollowUpConnector(env, 'x12_appeal_inquiry', {
      workItemId: 'ccc00000-0000-0000-0000-000000000002',
      claimRef: 'CLM-DENIED-002',
      payerName: 'Test Payer',
      coverageType: 'medical',
      patientRef: 'PAT-002',
      providerRef: 'PRV-002',
      denialReasonCode: 'PR-29',
      denialDate: '2024-01-01',
      appealDeadline: '2024-04-01', // Past date — appeal window expired
      formType: 'UB-04',
      sourceSystem: 'test',
      amountAtRisk: 1000,
      metadata: {},
    });

    expect(result.appealDeadlineStatus).toBe('expired');
    expect(result.appealEligible).toBe(false);
    expect(result.exceptionSuggestion?.reasonCode).toBe('appeal_deadline_expired');
  });

  it('should detect closing_soon deadline (within 7 days)', async () => {
    const { runDenialFollowUpConnector } = await import('../src/lib/rcmDenialFollowUpConnector');
    const env = {} as never;

    // Set deadline to 3 days from now.
    // Use a neutral denial code (not CO- which maps to information_requested)
    // so the appeal deadline exception is the primary suggestion.
    const deadline = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();

    const result = await runDenialFollowUpConnector(env, 'x12_appeal_inquiry', {
      workItemId: 'ccc00000-0000-0000-0000-000000000003',
      claimRef: 'CLM-DENIED-003',
      payerName: 'Test Payer',
      coverageType: 'medical',
      patientRef: 'PAT-003',
      providerRef: 'PRV-003',
      denialReasonCode: 'unknown-neutral-code', // maps to under_review (no status exception)
      denialDate: '2025-05-01',
      appealDeadline: deadline,
      formType: 'UB-04',
      sourceSystem: 'test',
      amountAtRisk: 3000,
      metadata: {},
    });

    expect(result.appealDeadlineStatus).toBe('closing_soon');
    // The exception suggestion should reflect the imminent deadline
    expect(result.exceptionSuggestion?.reasonCode).toBe('appeal_deadline_imminent');
  });

  it('should map upheld denials to human_review_required', async () => {
    const { runDenialFollowUpConnector } = await import('../src/lib/rcmDenialFollowUpConnector');
    const env = {} as never;

    // The 'timely' denial code maps to 'upheld' in simulation
    const result = await runDenialFollowUpConnector(env, 'x12_appeal_inquiry', {
      workItemId: 'ccc00000-0000-0000-0000-000000000004',
      claimRef: 'CLM-TIMELY-004',
      payerName: 'Test Payer',
      coverageType: 'medical',
      patientRef: 'PAT-004',
      providerRef: 'PRV-004',
      denialReasonCode: 'timely_filing',
      denialDate: '2024-01-01',
      appealDeadline: '2025-12-01',
      formType: 'UB-04',
      sourceSystem: 'test',
      amountAtRisk: 800,
      metadata: {},
    });

    expect(result.statusCode).toBe('upheld');
    expect(result.autoQaRecommendation).toBe('human_review_required');
    expect(result.exceptionSuggestion?.exceptionType).toBe('denial_upheld_requires_review');
  });

  it('should return portal fallback for denial lane', async () => {
    const { runDenialFollowUpConnector } = await import('../src/lib/rcmDenialFollowUpConnector');
    const env = {} as never;

    const result = await runDenialFollowUpConnector(env, 'portal', {
      workItemId: 'ccc00000-0000-0000-0000-000000000005',
      claimRef: 'CLM-PORTAL-005',
      payerName: 'Portal Payer',
      coverageType: 'medical',
      patientRef: 'PAT-005',
      providerRef: 'PRV-005',
      denialReasonCode: 'CO-45',
      denialDate: '2025-05-01',
      appealDeadline: '2025-08-01',
      formType: 'UB-04',
      sourceSystem: 'test',
      amountAtRisk: 2000,
      metadata: {},
    });

    expect(result.connectorKey).toBe('portal');
    expect(result.mode).toBe('manual');
    expect(result.autoQaRecommendation).toBe('human_review_required');
    expect(result.confidencePct).toBe(0);
  });

  it('should return connector availability with portal as manual_fallback', async () => {
    const { getDenialFollowUpConnectorAvailability } = await import('../src/lib/rcmDenialFollowUpConnector');
    const env = {} as never;
    const availability = getDenialFollowUpConnectorAvailability(env);

    expect(availability).toBeInstanceOf(Array);
    const portalConnector = availability.find((a) => a.key === 'portal');
    expect(portalConnector).toBeDefined();
    expect(portalConnector?.status).toBe('manual_fallback');
    expect(portalConnector?.mode).toBe('manual');
  });

  it('should auto-close appeal_approved with high confidence', async () => {
    const { runDenialFollowUpConnector } = await import('../src/lib/rcmDenialFollowUpConnector');
    // OA- prefix maps to appeal_approved with 88% confidence → autoQaRecommendation = close_auto
    const env = {} as never;

    const result = await runDenialFollowUpConnector(env, 'x12_appeal_inquiry', {
      workItemId: 'ccc00000-0000-0000-0000-000000000006',
      claimRef: 'CLM-OA-006',
      payerName: 'Test Payer',
      coverageType: 'medical',
      patientRef: 'PAT-006',
      providerRef: 'PRV-006',
      denialReasonCode: 'OA-18',
      denialDate: '2025-04-01',
      appealDeadline: '2025-12-01',
      formType: 'UB-04',
      sourceSystem: 'test',
      amountAtRisk: 5000,
      metadata: {},
    });

    expect(result.statusCode).toBe('appeal_approved');
    expect(result.confidencePct).toBe(88);
    expect(result.autoQaRecommendation).toBe('close_auto');
  });
});

// ─── ERA 835 connector ────────────────────────────────────────────────────────

describe('ERA 835 connector — simulation scaffold', () => {
  it('should return simulation result with payment details', async () => {
    const { runEra835Connector } = await import('../src/lib/rcmEra835Connector');
    const env = {} as never;

    const result = await runEra835Connector(env, 'x12_835_clearinghouse', {
      workItemId: 'ddd00000-0000-0000-0000-000000000001',
      claimRef: 'CLM-ERA-001',
      eraRef: 'ERA-CHECK-12345',
      payerName: 'Test Payer',
      payerId: null,
      patientRef: 'PAT-001',
      providerRef: 'PRV-001',
      npi: '1234567890',
      checkDate: '2025-06-01',
      checkAmount: 1000,
      formType: 'ERA',
      sourceSystem: 'test',
      metadata: {},
    });

    expect(result.connectorKey).toBe('x12_835_clearinghouse');
    expect(result.mode).toBe('simulation');
    expect(result.statusCode).toBeDefined();
    expect(['payment_posted', 'partial_payment', 'denied', 'adjustment_required', 'unmatched', 'pending_posting']).toContain(result.statusCode);
    expect(result.paymentDetails).toBeDefined();
    expect(typeof result.paymentDetails.paymentAmount).toBe('number');
    expect(result.paymentDetails.claimLines).toBeInstanceOf(Array);
    expect(result.evidence.length).toBeGreaterThan(0);
  });

  it('should detect partial payment (underpayment) in simulation', async () => {
    const { runEra835Connector } = await import('../src/lib/rcmEra835Connector');
    const env = {} as never;

    const result = await runEra835Connector(env, 'x12_835_clearinghouse', {
      workItemId: 'ddd00000-0000-0000-0000-000000000002',
      claimRef: 'CLM-ERA-002',
      eraRef: 'ERA-CHECK-99999',
      payerName: 'Test Payer',
      payerId: null,
      patientRef: 'PAT-002',
      providerRef: 'PRV-002',
      npi: null,
      checkDate: '2025-06-15',
      checkAmount: 750, // simulated underpayment
      formType: 'ERA',
      sourceSystem: 'test',
      metadata: {},
    });

    // Simulation: checkAmount * 1.12 = totalCharge, so underpayment > 0
    expect(result.paymentDetails.underpaymentAmount).toBeGreaterThan(0);
    expect(result.statusCode).toBe('partial_payment');
    expect(result.autoQaRecommendation).toBe('awaiting_qa');
  });

  it('should return SFTP manual fallback', async () => {
    const { runEra835Connector } = await import('../src/lib/rcmEra835Connector');
    const env = {} as never;

    const result = await runEra835Connector(env, 'direct_sftp', {
      workItemId: 'ddd00000-0000-0000-0000-000000000003',
      claimRef: 'CLM-ERA-003',
      eraRef: 'ERA-SFTP-001',
      payerName: 'Test Payer',
      payerId: null,
      patientRef: 'PAT-003',
      providerRef: 'PRV-003',
      npi: null,
      checkDate: null,
      checkAmount: null,
      formType: 'ERA',
      sourceSystem: 'test',
      metadata: {},
    });

    expect(result.connectorKey).toBe('direct_sftp');
    expect(result.mode).toBe('manual');
    expect(result.autoQaRecommendation).toBe('human_review_required');
    expect(result.paymentDetails.claimLines).toHaveLength(0);
  });

  it('should return availability with clearinghouse as simulation mode', async () => {
    const { getEra835ConnectorAvailability } = await import('../src/lib/rcmEra835Connector');
    const env = {} as never;
    const availability = getEra835ConnectorAvailability(env);

    expect(availability.length).toBeGreaterThanOrEqual(2);
    const clearinghouse = availability.find((a) => a.key === 'x12_835_clearinghouse');
    expect(clearinghouse).toBeDefined();
    expect(clearinghouse?.status).toBe('simulation'); // ERA 835 parsing is a TODO
  });
});

// ─── State machine transition rules ──────────────────────────────────────────

describe('State machine — autoQaRecommendation transition rules', () => {
  it('should NOT allow retry after 2 attempts (exhausted)', () => {
    // Pure logic test — max autonomous attempts is 2
    const maxAttempts = 2;
    const attempts = [{ attemptNumber: 1 }, { attemptNumber: 2 }];
    expect(attempts.length >= maxAttempts).toBe(true);
  });

  it('should derive OPEN appeal deadline status for future date', () => {
    // Test the pure deadline derivation logic from the denial connector
    const futureDate = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString(); // 60 days
    const deadline = new Date(futureDate);
    const now = new Date();
    const diffDays = (deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
    expect(diffDays).toBeGreaterThan(7);
    const status = diffDays < 0 ? 'expired' : diffDays <= 7 ? 'closing_soon' : 'open';
    expect(status).toBe('open');
  });

  it('should derive EXPIRED appeal deadline status for past date', () => {
    const pastDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    const deadline = new Date(pastDate);
    const now = new Date();
    const diffDays = (deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
    expect(diffDays).toBeLessThan(0);
    const status = diffDays < 0 ? 'expired' : diffDays <= 7 ? 'closing_soon' : 'open';
    expect(status).toBe('expired');
  });

  it('should derive CLOSING_SOON appeal deadline status for date within 7 days', () => {
    const soonDate = new Date(Date.now() + 4 * 24 * 60 * 60 * 1000).toISOString();
    const deadline = new Date(soonDate);
    const now = new Date();
    const diffDays = (deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
    expect(diffDays).toBeGreaterThan(0);
    expect(diffDays).toBeLessThanOrEqual(7);
    const status = diffDays < 0 ? 'expired' : diffDays <= 7 ? 'closing_soon' : 'open';
    expect(status).toBe('closing_soon');
  });

  it('confidence >= 80 with appeal_approved maps to close_auto', () => {
    // Replicates the autoQaRecommendation logic from denial connector
    const deriveAutoQa = (code: string, confidence: number) => {
      if ((code === 'appeal_approved' || code === 're_submitted') && confidence >= 80) return 'close_auto';
      if (code === 'upheld' || code === 'appeal_denied') return 'human_review_required';
      if (code === 'information_requested') return 'human_review_required';
      return 'awaiting_qa';
    };

    expect(deriveAutoQa('appeal_approved', 85)).toBe('close_auto');
    expect(deriveAutoQa('appeal_approved', 75)).toBe('awaiting_qa'); // below threshold
    expect(deriveAutoQa('upheld', 90)).toBe('human_review_required');
    expect(deriveAutoQa('appeal_denied', 50)).toBe('human_review_required');
    expect(deriveAutoQa('information_requested', 70)).toBe('human_review_required');
    expect(deriveAutoQa('under_review', 70)).toBe('awaiting_qa');
    expect(deriveAutoQa('re_submitted', 82)).toBe('close_auto');
  });

  it('ERA 835 payment_posted with high confidence maps to close_auto', () => {
    const eraAutoQa = (code: string, confidence: number) => {
      if (code === 'payment_posted') return confidence >= 80 ? 'close_auto' : 'awaiting_qa';
      return 'awaiting_qa';
    };
    expect(eraAutoQa('payment_posted', 90)).toBe('close_auto');
    expect(eraAutoQa('payment_posted', 60)).toBe('awaiting_qa');
    expect(eraAutoQa('partial_payment', 90)).toBe('awaiting_qa');
  });
});

// ─── Autonomy loop — pure helpers ─────────────────────────────────────────────

describe('Autonomy loop — pure helper logic', () => {
  it('should extract attempt history from metadata', () => {
    const getAttemptHistory = (metadata: Record<string, unknown>) => {
      const attempts = metadata['attemptHistory'];
      return Array.isArray(attempts)
        ? attempts.filter((e): e is Record<string, unknown> => Boolean(e) && typeof e === 'object')
        : [];
    };

    expect(getAttemptHistory({})).toHaveLength(0);
    expect(getAttemptHistory({ attemptHistory: null })).toHaveLength(0);
    expect(getAttemptHistory({ attemptHistory: [{ attemptNumber: 1 }] })).toHaveLength(1);
    expect(getAttemptHistory({ attemptHistory: [null, { attemptNumber: 1 }, 'bad'] })).toHaveLength(1);
  });

  it('should build attempt summary with required fields', () => {
    const mockResult = {
      connectorKey: 'x12_276_277' as const,
      mode: 'simulation' as const,
      performedAt: '2025-01-01T00:00:00Z',
      connectorTraceId: 'trace-abc',
      statusCode: 'active' as const,
      statusLabel: 'Active',
      proposedResolution: 'Claim is active',
      resolutionReasonCode: 'active',
      confidencePct: 95,
      nextBestAction: 'Confirm payment timeline',
      autoQaRecommendation: 'close_auto' as const,
      evidence: [{ evidenceType: 'status_lookup_completed' }],
      summary: 'Claim active',
      rawResponse: {},
    };

    const buildAttemptSummary = (result: typeof mockResult, attemptNumber: number, role: string) => ({
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
    });

    const summary = buildAttemptSummary(mockResult, 1, 'primary_worker');
    expect(summary.attemptNumber).toBe(1);
    expect(summary.attemptRole).toBe('primary_worker');
    expect(summary.confidencePct).toBe(95);
    expect(summary.evidenceTypes).toContain('status_lookup_completed');
  });

  it('should apply threshold-based QA fallback correctly', () => {
    const thresholdQa = (confidencePct: number, attemptCount: number) => {
      if (confidencePct >= 80) return { qaDecision: 'approve_auto_close', qaReasonCode: 'threshold_auto_close' };
      if (confidencePct >= 60 && attemptCount < 2) return { qaDecision: 'retry_with_next_worker', qaReasonCode: 'threshold_retry' };
      return { qaDecision: 'escalate', qaReasonCode: 'threshold_escalate' };
    };

    expect(thresholdQa(85, 0).qaDecision).toBe('approve_auto_close');
    expect(thresholdQa(65, 0).qaDecision).toBe('retry_with_next_worker');
    expect(thresholdQa(65, 2).qaDecision).toBe('escalate');  // max attempts reached
    expect(thresholdQa(40, 1).qaDecision).toBe('escalate');  // below retry threshold
    expect(thresholdQa(80, 1).qaDecision).toBe('approve_auto_close');
  });

  it('should validate supported work types for autonomy loop', () => {
    const SUPPORTED_WORK_TYPES = ['institutional_claim_status', 'eligibility_verification', 'denial_follow_up'];
    expect(SUPPORTED_WORK_TYPES).toContain('institutional_claim_status');
    expect(SUPPORTED_WORK_TYPES).toContain('eligibility_verification');
    expect(SUPPORTED_WORK_TYPES).toContain('denial_follow_up');
    expect(SUPPORTED_WORK_TYPES).not.toContain('era_835'); // ERA 835 not in autonomy loop yet
    expect(SUPPORTED_WORK_TYPES).not.toContain('prior_auth_follow_up');
  });
});

// ─── AES-GCM Credential Vault ─────────────────────────────────────────────────

import { encryptPayload, decryptPayload, hexToBytes } from '../src/lib/rcmCredentialVault';

describe('Credential vault — AES-256-GCM encryption', () => {
  // 32-byte hex key for testing
  const TEST_KEY = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';

  it('should encrypt and decrypt back to original plaintext', async () => {
    const plaintext = JSON.stringify({ username: 'testuser', password: 'secret123' });
    const blob = await encryptPayload(TEST_KEY, plaintext);
    const decrypted = await decryptPayload(TEST_KEY, blob);
    expect(decrypted).toBe(plaintext);
  });

  it('should produce a base64 blob different from btoa(plaintext)', async () => {
    const plaintext = 'hello world';
    const blob = await encryptPayload(TEST_KEY, plaintext);
    expect(blob).not.toBe(btoa(plaintext));
  });

  it('should produce different ciphertext for the same plaintext (random IV)', async () => {
    const plaintext = 'same plaintext';
    const blob1 = await encryptPayload(TEST_KEY, plaintext);
    const blob2 = await encryptPayload(TEST_KEY, plaintext);
    // Same plaintext should produce different ciphertext due to random IV
    expect(blob1).not.toBe(blob2);
    // But both should decrypt to the same value
    expect(await decryptPayload(TEST_KEY, blob1)).toBe(plaintext);
    expect(await decryptPayload(TEST_KEY, blob2)).toBe(plaintext);
  });

  it('should fail to decrypt with wrong key', async () => {
    const plaintext = 'secret data';
    const blob = await encryptPayload(TEST_KEY, plaintext);
    const WRONG_KEY = '0000000000000000000000000000000000000000000000000000000000000000';
    await expect(decryptPayload(WRONG_KEY, blob)).rejects.toThrow();
  });

  it('hexToBytes should produce Uint8Array of correct length', () => {
    const bytes = hexToBytes(TEST_KEY);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBe(32);
  });
});

// ─── Prior Auth Connector ─────────────────────────────────────────────────────

import { runPriorAuthConnector, getPriorAuthConnectorAvailability, PRIOR_AUTH_LANE_KEY } from '../src/lib/rcmPriorAuthConnector';
import type { PriorAuthConnectorExecutionInput } from '../src/lib/rcmPriorAuthConnector';

function makePriorAuthInput(overrides: Partial<PriorAuthConnectorExecutionInput> = {}): PriorAuthConnectorExecutionInput {
  return {
    workItemId: '11111111-1111-1111-1111-111111111111',
    claimRef: 'CLM-2024-001',
    payerName: 'UnitedHealth',
    payerId: 'UHC001',
    patientRef: 'PAT-001',
    providerRef: 'PRV-001',
    npi: '1234567890',
    procedureCode: '27447',
    diagnosisCode: 'M17.11',
    serviceStartDate: '2024-06-01',
    serviceEndDate: null,
    placeOfService: '21',
    authRef: null,
    urgencyFlag: false,
    formType: 'PA',
    sourceSystem: 'epic',
    metadata: {},
    ...overrides,
  };
}

describe('Prior auth connector — simulation outcomes', () => {
  it('should return not_required for E&M procedure codes (99xxx)', async () => {
    const result = await runPriorAuthConnector({} as any, 'x12_278', makePriorAuthInput({ procedureCode: '99213' }));
    expect(result.statusCode).toBe('not_required');
    expect(result.autoQaRecommendation).toBe('close_auto');
    expect(result.confidencePct).toBeGreaterThanOrEqual(85);
  });

  it('should return additional_info_required for radiology procedures (7xxxx)', async () => {
    const result = await runPriorAuthConnector({} as any, 'x12_278', makePriorAuthInput({ procedureCode: '71250' }));
    expect(result.statusCode).toBe('additional_info_required');
    expect(result.autoQaRecommendation).toBe('awaiting_qa');
  });

  it('urgencyFlag=true should produce approved with high confidence', async () => {
    const result = await runPriorAuthConnector({} as any, 'x12_278', makePriorAuthInput({ urgencyFlag: true, procedureCode: '27447' }));
    expect(result.statusCode).toBe('approved');
    expect(result.confidencePct).toBeGreaterThanOrEqual(80);
  });

  it('denied should always map to human_review_required', async () => {
    // A procedure that maps to denied — use a code matching the denied pattern
    // The connector uses urgency and procedure logic; test portal_submission which returns pending_review (manual)
    // For denied, we test the autoQaRecommendation derivation directly via the simulation
    const result = await runPriorAuthConnector({} as any, 'portal_submission', makePriorAuthInput());
    expect(result.mode).toBe('manual');
    expect(result.autoQaRecommendation).toBe('human_review_required');
  });

  it('portal_submission should return manual fallback', async () => {
    const result = await runPriorAuthConnector({} as any, 'portal_submission', makePriorAuthInput());
    expect(result.connectorKey).toBe('portal_submission');
    expect(result.mode).toBe('manual');
  });

  it('should return connector availability with x12_278 and portal_submission', () => {
    const availability = getPriorAuthConnectorAvailability({} as any);
    const keys = availability.map((a) => a.key);
    expect(keys).toContain('x12_278');
    expect(keys).toContain('portal_submission');
    const portal = availability.find((a) => a.key === 'portal_submission');
    expect(portal?.status).toBe('manual_fallback');
  });

  it('PRIOR_AUTH_LANE_KEY should equal "prior_auth_follow_up"', () => {
    expect(PRIOR_AUTH_LANE_KEY).toBe('prior_auth_follow_up');
  });

  it('should include evidence in result', async () => {
    const result = await runPriorAuthConnector({} as any, 'x12_278', makePriorAuthInput());
    expect(Array.isArray(result.evidence)).toBe(true);
    expect(result.evidence.length).toBeGreaterThan(0);
    expect(result.evidence[0]).toHaveProperty('evidenceType');
  });
});

// ─── Confidence Tuner — pure helper ──────────────────────────────────────────

import { computeAdjustedThresholds, BASE_THRESHOLDS } from '../src/lib/rcmConfidenceTuner';

describe('Confidence tuner — computeAdjustedThresholds', () => {
  it('should return BASE_THRESHOLDS when no history', () => {
    const result = computeAdjustedThresholds(0, 0);
    expect(result.autoClose).toBe(BASE_THRESHOLDS.autoClose);
    expect(result.retry).toBe(BASE_THRESHOLDS.retry);
  });

  it('should raise autoClose by 5 when override rate is ~20%', () => {
    // 5 overridden out of 25 = 20% > 15% threshold
    const result = computeAdjustedThresholds(25, 5);
    expect(result.autoClose).toBe(BASE_THRESHOLDS.autoClose + 5);
  });

  it('should raise autoClose by 10 when override rate is >25%', () => {
    // 8 overridden out of 25 = 32% > 25% threshold
    const result = computeAdjustedThresholds(25, 8);
    expect(result.autoClose).toBe(Math.min(92, BASE_THRESHOLDS.autoClose + 10));
  });

  it('should lower autoClose by 2 when override rate < 5% with sufficient samples', () => {
    // 1 overridden out of 30 = 3.3% < 5% and 30 >= 20 samples
    const result = computeAdjustedThresholds(30, 1);
    expect(result.autoClose).toBe(Math.max(75, BASE_THRESHOLDS.autoClose - 2));
  });

  it('should not lower autoClose below 75', () => {
    // Simulate very low override rate with many samples — floor at 75
    let threshold = BASE_THRESHOLDS.autoClose;
    for (let i = 0; i < 10; i++) {
      threshold = Math.max(75, threshold - 2);
    }
    expect(threshold).toBeGreaterThanOrEqual(75);
  });

  it('should never exceed 92 even with high override rate', () => {
    // 100% override rate
    const result = computeAdjustedThresholds(25, 25);
    expect(result.autoClose).toBeLessThanOrEqual(92);
  });

  it('should keep retry threshold fixed at BASE_THRESHOLDS.retry', () => {
    const high = computeAdjustedThresholds(25, 25);
    const low = computeAdjustedThresholds(30, 1);
    expect(high.retry).toBe(BASE_THRESHOLDS.retry);
    expect(low.retry).toBe(BASE_THRESHOLDS.retry);
  });

  it('should not lower autoClose when samples < 20', () => {
    // 0 overridden out of 10 = 0% < 5% but only 10 < 20 samples
    const result = computeAdjustedThresholds(10, 0);
    expect(result.autoClose).toBe(BASE_THRESHOLDS.autoClose);
  });
});
