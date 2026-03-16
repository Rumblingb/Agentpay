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

import { prisma } from '../db/client';
import crypto from 'crypto';

interface DisputeRequest {
  transactionId: string;
  filedBy: string; // agentId
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
      claimant: number; // +/- trust score change
      respondent: number;
    };
  };
  filedAt: Date;
  resolvedAt?: Date;
}

class DisputeResolverAgent {
  private agentId = 'dispute_resolver_001';
  
  // Pricing tiers based on transaction value
  private getFee(transactionAmount: number): number {
    if (transactionAmount < 100) return 50;
    if (transactionAmount < 1000) return 100;
    if (transactionAmount < 10000) return 250;
    return 500;
  }
  
  // Evidence collection period
  private EVIDENCE_PERIOD_HOURS = 48;

  /**
   * File a dispute
   */
  async fileDispute(request: DisputeRequest): Promise<DisputeCase> {
    // 1. Validate transaction exists
    const transaction = await prisma.transaction.findUnique({
      where: { id: request.transactionId }
    });

    if (!transaction) {
      throw new Error('Transaction not found');
    }

    // 2. Verify filer is party to transaction
    if (request.filedBy !== transaction.fromAgent && request.filedBy !== transaction.toAgent) {
      throw new Error('Only transaction parties can file disputes');
    }

    // 3. Check if dispute already exists
    const existing = await prisma.dispute.findFirst({
      where: { transactionId: request.transactionId }
    });

    if (existing) {
      throw new Error('Dispute already filed for this transaction');
    }

    // 4. Charge dispute filing fee
    const fee = this.getFee(transaction.amount);
    await this.chargeFee(request.filedBy, fee);

    // 5. Identify respondent
    const respondent = request.filedBy === transaction.fromAgent
      ? transaction.toAgent
      : transaction.fromAgent;

    // 6. Create dispute case
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

    // 7. Store in database
    await this.storeDispute(disputeCase);

    // 8. Notify respondent (48h to respond)
    await this.notifyRespondent(disputeCase);

    // 9. Update transaction status
    await prisma.transaction.update({
      where: { id: request.transactionId },
      data: { status: 'disputed' }
    });

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

    // Add evidence
    dispute.evidence.respondent = evidence;

    // Update status to under review
    dispute.status = 'under_review';

    await this.updateDispute(dispute);

    // Begin resolution process
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

    // Check if evidence period expired (auto-proceed)
    const evidencePeriodEnd = new Date(
      dispute.filedAt.getTime() + this.EVIDENCE_PERIOD_HOURS * 60 * 60 * 1000
    );

    if (new Date() < evidencePeriodEnd && dispute.evidence.respondent.length === 0) {
      throw new Error('Evidence period still active');
    }

    // Analyze evidence
    const analysis = await this.analyzeEvidence(dispute);

    // Make decision
    const resolution = this.makeDecision(dispute, analysis);

    // Update dispute
    dispute.resolution = resolution;
    dispute.status = 'resolved';
    dispute.resolvedAt = new Date();

    await this.updateDispute(dispute);

    // Update reputation scores
    await this.updateReputationScores(dispute);

    // Notify both parties
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
      d => d.resolution?.decision === 'claimant_favor'
    ).length;

    const wonAsRespondent = asRespondent.filter(
      d => d.resolution?.decision === 'respondent_favor'
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

    // Evidence quantity
    const claimantEvidence = dispute.evidence.claimant.length;
    const respondentEvidence = dispute.evidence.respondent.length;

    if (claimantEvidence > respondentEvidence) {
      claimantScore += 10;
      reasoning.push('Claimant provided more evidence');
    } else if (respondentEvidence > claimantEvidence) {
      respondentScore += 10;
      reasoning.push('Respondent provided more evidence');
    }

    // No response penalty
    if (respondentEvidence === 0) {
      claimantScore += 20;
      respondentScore -= 20;
      reasoning.push('Respondent did not respond to claim');
    }

    // Evidence type quality
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

    // Category-specific analysis
    if (dispute.category === 'non_delivery') {
      // Delivery disputes: burden of proof on seller to show delivery
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

    // Update claimant
    await prisma.agent.update({
      where: { id: claimant },
      data: {
        trustScore: {
          increment: reputationImpact.claimant
        }
      }
    });

    // Update respondent
    await prisma.agent.update({
      where: { id: respondent },
      data: {
        trustScore: {
          increment: reputationImpact.respondent
        }
      }
    });
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
    const dispute = await prisma.dispute.findUnique({
      where: { id: caseId }
    });

    if (!dispute) return null;

    return dispute as any;
  }

  private async chargeFee(agentId: string, fee: number): Promise<void> {
    await prisma.transaction.create({
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

  private async notifyRespondent(dispute: DisputeCase): Promise<void> {
    // Send notification to respondent
    // In production: email, webhook, or in-app notification
  }

  private async beginResolution(caseId: string): Promise<void> {
    // Start resolution process
    // In production: schedule resolution after review period
  }

  private async notifyResolution(dispute: DisputeCase): Promise<void> {
    // Notify both parties of resolution
  }

  private generateCaseId(): string {
    return `case_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
  }
}

export const disputeResolverAgent = new DisputeResolverAgent();
