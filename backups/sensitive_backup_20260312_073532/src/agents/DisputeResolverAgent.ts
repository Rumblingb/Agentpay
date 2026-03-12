/**
 * DisputeResolverAgent - Constitutional Layer Agent #3
 *
 * Structured dispute resolution for agent transactions.
 * Creates economic memory and makes trust consequential.
 *
 * Core Functions:
 * 1. Accept dispute filings with evidence
 * 2. Structured evidence collection
 * 3. Resolution decisions (not legal arbitration, delivery/completion checks)
 * 4. Update reputation based on outcomes
 *
 * Revenue: $50-500 per dispute (tiered by transaction value)
 * Moat: Dispute history creates reputation consequences
 */

/**
 * Copyright (c) AgentPay, Inc. All rights reserved.
 * Proprietary and confidential. Licensed under Business Source License 1.1; converts to AGPL-3.0 on 2029-01-01.
 */
import { prisma } from '../lib/prisma.js';
import crypto from 'crypto';
import { emitEvent } from '../services/events.js';
import { recordTrustEvent } from '../services/trustEventService.js';
import { logger } from '../logger.js';

interface DisputeRequest {
  transactionId: string;
  filedBy: string;
  claim: string;
  category: 'non_delivery' | 'quality' | 'payment' | 'terms' | 'other';
  evidence: Evidence[];
}

interface Evidence {
  type: 'log' | 'screenshot' | 'message' | 'code' | 'data';
  description: string;
  contentHash: string;
  timestamp: Date;
}

interface DisputeCase {
  caseId: string;
  transactionId: string;
  claimant: string;
  respondent: string;
  claim: string;
  category: string;
  evidence: {
    claimant: Evidence[];
    respondent: Evidence[];
  };
  status: 'filed' | 'evidence_collection' | 'under_review' | 'resolved';
  /**
   * notificationMode reflects whether parties were automatically notified
   * about this dispute event. "disabled" means no automatic notification
   * was sent — you must manually inform the respondent of this case.
   */
  notificationMode: 'disabled' | 'live';
  resolution?: {
    decision: 'claimant_favor' | 'respondent_favor' | 'split' | 'no_fault';
    reasoning: string;
    reputationImpact: {
      claimant: number;
      respondent: number;
    };
  };
  filedAt: Date;
  resolvedAt?: Date;
}

class DisputeResolverAgent {
  private agentId = 'dispute_resolver_001';

  /**
   * notificationMode: "disabled" means notifyRespondent and notifyResolution
   * are no-ops — parties are NOT automatically notified of dispute events.
   *
   * Operators must manually inform parties, or implement a webhook integration
   * before enabling "live" mode.
   *
   * This must remain "disabled" until a real email/webhook delivery mechanism
   * is wired into notifyRespondent() and notifyResolution().
   */
  readonly notificationMode: 'disabled' | 'live' = 'disabled';

  private getFee(transactionAmount: number): number {
    if (transactionAmount < 100) return 50;
    if (transactionAmount < 1000) return 100;
    if (transactionAmount < 10000) return 250;
    return 500;
  }

  private EVIDENCE_PERIOD_HOURS = 48;

  /**
   * File a dispute
   */
  async fileDispute(request: DisputeRequest): Promise<DisputeCase> {
    // Validate transaction exists (AgentTransaction is the hire/complete record)
    const transaction = await prisma.agentTransaction.findUnique({
      where: { id: request.transactionId }
    });

    if (!transaction) {
      throw new Error('Transaction not found');
    }

    // Verify filer is party to transaction
    if (
      request.filedBy !== transaction.buyerAgentId &&
      request.filedBy !== transaction.sellerAgentId
    ) {
      throw new Error('Only transaction parties can file disputes');
    }

    // Check if dispute already exists
    const existing = await prisma.dispute.findFirst({
      where: { transactionId: request.transactionId }
    });

    if (existing) {
      throw new Error('Dispute already filed for this transaction');
    }

    await this.chargeFee(request.filedBy, this.getFee(transaction.amount));

    const respondent =
      request.filedBy === transaction.buyerAgentId
        ? transaction.sellerAgentId
        : transaction.buyerAgentId;

    const caseId = this.generateCaseId();
    const disputeCase: DisputeCase = {
      caseId,
      transactionId: request.transactionId,
      claimant: request.filedBy,
      respondent,
      claim: request.claim,
      category: request.category,
      evidence: {
        claimant: request.evidence,
        respondent: []
      },
      status: 'evidence_collection',
      notificationMode: this.notificationMode,
      filedAt: new Date()
    };

    await this.storeDispute(disputeCase);

    // Mark the underlying transaction as disputed
    await prisma.agentTransaction.update({
      where: { id: request.transactionId },
      data: { status: 'disputed' }
    });

    await this.notifyRespondent(disputeCase);

    // Record trust event for the respondent (dispute opened against them)
    recordTrustEvent(
      respondent,
      'dispute_filed',
      `Dispute ${caseId} filed for transaction ${request.transactionId}`,
      request.filedBy,
      { caseId, transactionId: request.transactionId, category: request.category },
    ).catch((err: any) => logger.warn({ err: err?.message, caseId }, '[DisputeResolver] dispute_filed trust event failed'));

    // Webhook fan-out — fire-and-forget; never block the filing response
    emitEvent('dispute.filed', {
      caseId,
      transactionId: request.transactionId,
      claimant: request.filedBy,
      respondent,
      category: request.category,
    }).catch((err) => logger.warn({ err: (err as Error).message, caseId }, '[DisputeResolver] dispute.filed webhook delivery failed'));

    return disputeCase;
  }

  /**
   * Submit evidence as respondent
   */
  async submitEvidence(
    caseId: string,
    submittedBy: string,
    evidence: Evidence[]
  ): Promise<void> {
    const dispute = await this.getDispute(caseId);

    if (!dispute) {
      throw new Error('Dispute not found');
    }

    if (dispute.status !== 'evidence_collection') {
      throw new Error('Evidence period has ended');
    }

    if (submittedBy !== dispute.respondent) {
      throw new Error('Only respondent can submit additional evidence');
    }

    dispute.evidence.respondent = evidence;
    dispute.status = 'under_review';

    await this.updateDispute(dispute);
    await this.beginResolution(caseId);
  }

  /**
   * Resolve dispute (automatic after evidence period)
   */
  async resolveDispute(caseId: string): Promise<DisputeCase> {
    const dispute = await this.getDispute(caseId);

    if (!dispute) {
      throw new Error('Dispute not found');
    }

    if (dispute.status === 'resolved') {
      return dispute;
    }

    const evidencePeriodEnd = new Date(
      dispute.filedAt.getTime() + this.EVIDENCE_PERIOD_HOURS * 60 * 60 * 1000
    );

    if (new Date() < evidencePeriodEnd && dispute.evidence.respondent.length === 0) {
      throw new Error('Evidence period still active');
    }

    const analysis = await this.analyzeEvidence(dispute);
    const resolution = this.makeDecision(dispute, analysis);

    dispute.resolution = resolution;
    dispute.status = 'resolved';
    dispute.resolvedAt = new Date();

    await this.updateDispute(dispute);
    await this.updateReputationScores(dispute);
    await this.notifyResolution(dispute);

    // Webhook fan-out — fire-and-forget; never block the resolution response
    const decision = dispute.resolution?.decision;
    const guiltyParty =
      decision === 'claimant_favor' ? dispute.respondent :
      decision === 'respondent_favor' ? dispute.claimant :
      null; // 'split' / 'no_fault' — no single guilty party
    emitEvent('dispute.resolved', {
      caseId: dispute.caseId,
      transactionId: dispute.transactionId,
      decision,
      ...(guiltyParty ? { guiltyParty } : {}),
    }).catch((err) => logger.warn({ err: (err as Error).message, caseId: dispute.caseId }, '[DisputeResolver] dispute.resolved webhook delivery failed'));

    return dispute;
  }

  /**
   * Get dispute case
   */
  async getDisputeCase(caseId: string): Promise<DisputeCase> {
    const dispute = await this.getDispute(caseId);

    if (!dispute) {
      throw new Error('Dispute not found');
    }

    return dispute;
  }

  /**
   * Get agent's dispute history
   */
  async getDisputeHistory(agentId: string): Promise<{
    totalDisputes: number;
    asClaimant: number;
    asRespondent: number;
    wonAsClaimant: number;
    wonAsRespondent: number;
    cases: DisputeCase[];
  }> {
    const disputes = await prisma.dispute.findMany({
      where: {
        OR: [
          { claimant: agentId },
          { respondent: agentId }
        ]
      },
      orderBy: { filedAt: 'desc' }
    });

    const asClaimant = disputes.filter(d => d.claimant === agentId);
    const asRespondent = disputes.filter(d => d.respondent === agentId);

    const wonAsClaimant = asClaimant.filter(
      d => (d.resolution as any)?.decision === 'claimant_favor'
    ).length;

    const wonAsRespondent = asRespondent.filter(
      d => (d.resolution as any)?.decision === 'respondent_favor'
    ).length;

    return {
      totalDisputes: disputes.length,
      asClaimant: asClaimant.length,
      asRespondent: asRespondent.length,
      wonAsClaimant,
      wonAsRespondent,
      cases: disputes as any
    };
  }

  // Private methods

  private async analyzeEvidence(dispute: DisputeCase): Promise<{
    claimantScore: number;
    respondentScore: number;
    reasoning: string[];
  }> {
    const reasoning: string[] = [];
    let claimantScore = 50;
    let respondentScore = 50;

    const claimantEvidence = dispute.evidence.claimant.length;
    const respondentEvidence = dispute.evidence.respondent.length;

    if (claimantEvidence > respondentEvidence) {
      claimantScore += 10;
      reasoning.push('Claimant provided more evidence');
    } else if (respondentEvidence > claimantEvidence) {
      respondentScore += 10;
      reasoning.push('Respondent provided more evidence');
    }

    if (respondentEvidence === 0) {
      claimantScore += 20;
      respondentScore -= 20;
      reasoning.push('Respondent did not respond to claim');
    }

    const claimantHasCode = dispute.evidence.claimant.some(e => e.type === 'code');
    const claimantHasLogs = dispute.evidence.claimant.some(e => e.type === 'log');

    if (claimantHasCode || claimantHasLogs) {
      claimantScore += 10;
      reasoning.push('Claimant provided technical evidence');
    }

    const respondentHasCode = dispute.evidence.respondent.some(e => e.type === 'code');
    const respondentHasLogs = dispute.evidence.respondent.some(e => e.type === 'log');

    if (respondentHasCode || respondentHasLogs) {
      respondentScore += 10;
      reasoning.push('Respondent provided technical evidence');
    }

    if (dispute.category === 'non_delivery') {
      respondentScore -= 10;
      reasoning.push('Non-delivery claim: seller must prove delivery');
    }

    return { claimantScore, respondentScore, reasoning };
  }

  private makeDecision(dispute: DisputeCase, analysis: any): {
    decision: 'claimant_favor' | 'respondent_favor' | 'split' | 'no_fault';
    reasoning: string;
    reputationImpact: { claimant: number; respondent: number };
  } {
    const scoreDiff = analysis.claimantScore - analysis.respondentScore;

    let decision: 'claimant_favor' | 'respondent_favor' | 'split' | 'no_fault';
    let reputationImpact = { claimant: 0, respondent: 0 };

    if (scoreDiff >= 20) {
      decision = 'claimant_favor';
      reputationImpact = { claimant: +5, respondent: -10 };
    } else if (scoreDiff <= -20) {
      decision = 'respondent_favor';
      reputationImpact = { claimant: -5, respondent: +5 };
    } else if (Math.abs(scoreDiff) < 10) {
      decision = 'no_fault';
      reputationImpact = { claimant: 0, respondent: 0 };
    } else {
      decision = 'split';
      reputationImpact = { claimant: -2, respondent: -2 };
    }

    const reasoning = [
      `Evidence analysis: ${analysis.reasoning.join('; ')}`,
      `Decision: ${decision}`,
      `Score differential: ${scoreDiff}`
    ].join('. ');

    return { decision, reasoning, reputationImpact };
  }

  private async updateReputationScores(dispute: DisputeCase): Promise<void> {
    if (!dispute.resolution) return;

    const { decision } = dispute.resolution;
    const { claimant, respondent } = dispute;

    // Route each party through the canonical trust event pipeline so every
    // score change is persisted in trust_events and propagated via webhooks.
    // "claimant_favor" → respondent is guilty; "respondent_favor" → claimant is guilty.
    const trustUpdates: Array<{ agentId: string; category: 'dispute_resolved_guilty' | 'dispute_resolved_innocent'; counterparty: string }> = [];

    if (decision === 'claimant_favor') {
      trustUpdates.push({ agentId: respondent, category: 'dispute_resolved_guilty', counterparty: claimant });
      trustUpdates.push({ agentId: claimant, category: 'dispute_resolved_innocent', counterparty: respondent });
    } else if (decision === 'respondent_favor') {
      trustUpdates.push({ agentId: claimant, category: 'dispute_resolved_guilty', counterparty: respondent });
      trustUpdates.push({ agentId: respondent, category: 'dispute_resolved_innocent', counterparty: claimant });
    }
    // 'split' and 'no_fault' — no further score changes beyond what was recorded on filing

    await Promise.all(
      trustUpdates.map(({ agentId, category, counterparty }) =>
        recordTrustEvent(
          agentId,
          category,
          `Dispute ${dispute.caseId} resolved: ${decision}`,
          counterparty,
          { caseId: dispute.caseId, transactionId: dispute.transactionId, decision },
        ).catch((err: any) =>
          logger.warn({ err: err?.message, caseId: dispute.caseId, agentId }, '[DisputeResolver] resolution trust event failed'),
        ),
      ),
    );
  }

  private async storeDispute(dispute: DisputeCase): Promise<void> {
    await prisma.dispute.create({
      data: {
        id: dispute.caseId,
        transactionId: dispute.transactionId,
        claimant: dispute.claimant,
        respondent: dispute.respondent,
        claim: dispute.claim,
        category: dispute.category,
        evidence: dispute.evidence as any,
        status: dispute.status,
        filedAt: dispute.filedAt
      }
    });
  }

  private async updateDispute(dispute: DisputeCase): Promise<void> {
    await prisma.dispute.update({
      where: { id: dispute.caseId },
      data: {
        evidence: dispute.evidence as any,
        status: dispute.status,
        resolution: dispute.resolution as any,
        resolvedAt: dispute.resolvedAt
      }
    });
  }

  private async getDispute(caseId: string): Promise<DisputeCase | null> {
    const record = await prisma.dispute.findUnique({
      where: { id: caseId }
    });

    if (!record) return null;

    return {
      caseId: record.id,
      transactionId: record.transactionId,
      claimant: record.claimant,
      respondent: record.respondent,
      claim: record.claim,
      category: record.category,
      evidence: record.evidence as any,
      status: record.status as any,
      // Stored records may have been created before notificationMode was added.
      // Conservatively reflect the current mode (not historical).
      notificationMode: this.notificationMode,
      resolution: record.resolution as any,
      filedAt: record.filedAt,
      resolvedAt: record.resolvedAt ?? undefined
    };
  }

  private async chargeFee(agentId: string, fee: number): Promise<void> {
    await prisma.agentFeeTransaction.create({
      data: {
        fromAgent: agentId,
        toAgent: this.agentId,
        amount: fee,
        status: 'completed',
        description: 'Dispute filing fee',
        metadata: { service: 'DisputeResolver' }
      }
    });
  }

  /**
   * BETA STUB — parties are NOT automatically notified.
   *
   * Production: send email or webhook to the respondent containing the
   * case ID, claim summary, evidence deadline, and API endpoint for
   * submitting their response.
   */
  private async notifyRespondent(_dispute: DisputeCase): Promise<void> {
    console.warn(
      `[DisputeResolverAgent] BETA: notifyRespondent is disabled — ` +
      `respondent "${_dispute.respondent}" was NOT notified of case "${_dispute.caseId}". ` +
      `Manual notification is required.`
    );
  }

  /**
   * BETA STUB — resolution scheduling is not implemented.
   *
   * Production: enqueue a background job that will call resolveDispute()
   * after the EVIDENCE_PERIOD_HOURS window expires. Without this, disputes
   * remain in "under_review" indefinitely until resolve_dispute is called manually.
   */
  private async beginResolution(_caseId: string): Promise<void> {
    console.warn(
      `[DisputeResolverAgent] BETA: beginResolution is disabled — ` +
      `case "${_caseId}" will NOT auto-resolve after the evidence period. ` +
      `Call resolve_dispute manually.`
    );
  }

  /**
   * BETA STUB — parties are NOT automatically notified of resolution.
   *
   * Production: send email or webhook to both claimant and respondent with
   * the decision, reasoning, and reputation impact.
   */
  private async notifyResolution(_dispute: DisputeCase): Promise<void> {
    console.warn(
      `[DisputeResolverAgent] BETA: notifyResolution is disabled — ` +
      `neither party was notified of resolution for case "${_dispute.caseId}". ` +
      `Manual notification is required.`
    );
  }

  private generateCaseId(): string {
    return `case_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
  }
}

export const disputeResolverAgent = new DisputeResolverAgent();

export async function handleDisputeResolution(req: any, res: any) {
  const { action, ...params } = req.body;

  // The authenticated merchant ID is available as req.merchant.id.
  // It is not used for billing here (dispute fees are charged to the filing agent),
  // but it is threaded through so future authorization checks can verify the
  // merchant owns the filedBy agent.
  const _merchantId: string = req.merchant?.id;

  try {
    switch (action) {
      case 'file_dispute': {
        const disputeCase = await disputeResolverAgent.fileDispute(params);
        return res.json({ success: true, disputeCase });
      }
      case 'submit_evidence': {
        await disputeResolverAgent.submitEvidence(
          params.caseId,
          params.submittedBy,
          params.evidence
        );
        return res.json({ success: true });
      }
      case 'resolve_dispute': {
        const resolved = await disputeResolverAgent.resolveDispute(params.caseId);
        return res.json(resolved);
      }
      case 'get_case': {
        const disputeCase = await disputeResolverAgent.getDisputeCase(params.caseId);
        return res.json(disputeCase);
      }
      case 'get_history': {
        const history = await disputeResolverAgent.getDisputeHistory(params.agentId);
        return res.json(history);
      }
      default:
        return res.status(400).json({ error: 'Invalid action' });
    }
  } catch (error: any) {
    console.error('Dispute resolver error:', error);
    return res.status(500).json({ error: error.message });
  }
}
