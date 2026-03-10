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

import { prisma } from '../lib/prisma.js';
import crypto from 'crypto';

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
      filedAt: new Date()
    };

    await this.storeDispute(disputeCase);

    // Mark the underlying transaction as disputed
    await prisma.agentTransaction.update({
      where: { id: request.transactionId },
      data: { status: 'disputed' }
    });

    await this.notifyRespondent(disputeCase);

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

    const { claimant, respondent, reputationImpact } = {
      claimant: dispute.claimant,
      respondent: dispute.respondent,
      reputationImpact: dispute.resolution.reputationImpact
    };

    await Promise.all([
      prisma.agent.update({
        where: { id: claimant },
        data: { trustScore: { increment: reputationImpact.claimant } }
      }),
      prisma.agent.update({
        where: { id: respondent },
        data: { trustScore: { increment: reputationImpact.respondent } }
      })
    ]);
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

  private async notifyRespondent(_dispute: DisputeCase): Promise<void> {
    // Production: send email/webhook to respondent with 48h deadline
  }

  private async beginResolution(_caseId: string): Promise<void> {
    // Production: schedule auto-resolution job after review period
  }

  private async notifyResolution(_dispute: DisputeCase): Promise<void> {
    // Production: notify both parties of the outcome
  }

  private generateCaseId(): string {
    return `case_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
  }
}

export const disputeResolverAgent = new DisputeResolverAgent();

export async function handleDisputeResolution(req: any, res: any) {
  const { action, ...params } = req.body;

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
