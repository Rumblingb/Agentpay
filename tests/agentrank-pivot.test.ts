/**
 * Tests for new AgentRank pivot modules:
 *   - AgentRank-Core (scoring engine + Sybil resistance)
 *   - Trust-Escrow-SDK (createEscrow, markComplete, approveWork, disputeWork)
 *   - KYA-Gateway (agent identity registration)
 *   - Behavioral Oracle (fraud detection)
 *   - Sybil Resistance Engine (dedicated Sybil defenses)
 *   - Programmatic Dispute Resolution (automated resolution)
 */

import {
  computeAgentRankScore,
  scoreToGrade,
  normaliseVolume,
  normaliseWalletAge,
  detectSybilFlags,
  applySybilPenalty,
  calculateAgentRank,
  type AgentRankFactors,
  type SybilSignals,
} from '../src/reputation/agentrank-core';

import {
  createEscrow,
  markComplete,
  approveWork,
  disputeWork,
  isAutoReleaseEligible,
  getEscrow,
  listEscrowsForAgent,
  _resetStore as resetEscrowStore,
} from '../src/escrow/trust-escrow';

import {
  registerKya,
  getKya,
  verifyKya,
  computeRiskScore,
  _resetStore as resetKyaStore,
} from '../src/identity/kya-gateway';

import {
  detectPredatoryDisputes,
  detectLoopingTransactions,
  detectWashTrading,
  detectRapidEscalation,
  getAlertsForAgent,
  getCriticalAlerts,
  _resetStore as resetOracleStore,
  type AgentBehaviorProfile,
} from '../src/monitoring/behavioral-oracle';

import {
  computeWalletAgeScore,
  meetsStakeRequirement,
  computeCounterpartyDiversityScore,
  detectCircularTrading,
  exceedsVelocityLimit,
  runSybilCheck,
  type WalletProfile,
} from '../src/reputation/sybil-resistance';

import {
  computeCompletionScore,
  determineOutcome,
  calculateSplit,
  aggregatePeerVotes,
  createDisputeCase,
  submitPeerReview,
  resolveDispute,
  getDisputeCase,
  _resetStore as resetDisputeStore,
} from '../src/escrow/dispute-resolution';

// ---------------------------------------------------------------------------
// Module 1: AgentRank-Core
// ---------------------------------------------------------------------------

describe('AgentRank-Core', () => {
  describe('normaliseVolume', () => {
    it('returns 0 for zero transactions', () => {
      expect(normaliseVolume(0)).toBe(0);
    });

    it('returns a value between 0 and 1 for positive volumes', () => {
      const result = normaliseVolume(100);
      expect(result).toBeGreaterThan(0);
      expect(result).toBeLessThanOrEqual(1);
    });

    it('caps at 1 for very high volumes', () => {
      expect(normaliseVolume(10000)).toBe(1);
    });
  });

  describe('normaliseWalletAge', () => {
    it('returns 0 for zero days', () => {
      expect(normaliseWalletAge(0)).toBe(0);
    });

    it('returns 1 for 365+ days', () => {
      expect(normaliseWalletAge(365)).toBe(1);
      expect(normaliseWalletAge(1000)).toBe(1);
    });
  });

  describe('computeAgentRankScore', () => {
    it('returns 1000 for a perfect agent', () => {
      const factors: AgentRankFactors = {
        paymentReliability: 1,
        serviceDelivery: 1,
        transactionVolume: 1000,
        walletAgeDays: 365,
        disputeRate: 0,
      };
      expect(computeAgentRankScore(factors)).toBe(1000);
    });

    it('returns 0 for an agent with all zeros', () => {
      const factors: AgentRankFactors = {
        paymentReliability: 0,
        serviceDelivery: 0,
        transactionVolume: 0,
        walletAgeDays: 0,
        disputeRate: 1,
      };
      expect(computeAgentRankScore(factors)).toBe(0);
    });

    it('weights payment reliability most heavily', () => {
      const base: AgentRankFactors = {
        paymentReliability: 0,
        serviceDelivery: 0,
        transactionVolume: 0,
        walletAgeDays: 0,
        disputeRate: 0,
      };
      const withPayment = computeAgentRankScore({ ...base, paymentReliability: 1 });
      const withDelivery = computeAgentRankScore({ ...base, serviceDelivery: 1 });
      expect(withPayment).toBeGreaterThan(withDelivery);
    });
  });

  describe('scoreToGrade', () => {
    it('maps S grade for 950+', () => {
      expect(scoreToGrade(950)).toBe('S');
      expect(scoreToGrade(1000)).toBe('S');
    });

    it('maps correct grades', () => {
      expect(scoreToGrade(800)).toBe('A');
      expect(scoreToGrade(600)).toBe('B');
      expect(scoreToGrade(400)).toBe('C');
      expect(scoreToGrade(200)).toBe('D');
      expect(scoreToGrade(50)).toBe('F');
      expect(scoreToGrade(0)).toBe('U');
    });
  });

  describe('detectSybilFlags', () => {
    it('returns no flags for a clean profile', () => {
      const signals: SybilSignals = {
        walletAgeDays: 100,
        stakeUsdc: 50,
        uniqueCounterparties: 10,
        circularTradingDetected: false,
      };
      expect(detectSybilFlags(signals)).toEqual([]);
    });

    it('flags new wallets', () => {
      const signals: SybilSignals = {
        walletAgeDays: 3,
        stakeUsdc: 50,
        uniqueCounterparties: 10,
        circularTradingDetected: false,
      };
      expect(detectSybilFlags(signals)).toContain('WALLET_TOO_NEW');
    });

    it('flags circular trading', () => {
      const signals: SybilSignals = {
        walletAgeDays: 100,
        stakeUsdc: 50,
        uniqueCounterparties: 10,
        circularTradingDetected: true,
      };
      expect(detectSybilFlags(signals)).toContain('CIRCULAR_TRADING');
    });
  });

  describe('applySybilPenalty', () => {
    it('returns original score when no flags', () => {
      expect(applySybilPenalty(800, [])).toBe(800);
    });

    it('reduces score by 10% per flag', () => {
      expect(applySybilPenalty(1000, ['FLAG1'])).toBe(900);
      expect(applySybilPenalty(1000, ['FLAG1', 'FLAG2'])).toBe(800);
    });

    it('caps penalty at 50%', () => {
      const flags = ['F1', 'F2', 'F3', 'F4', 'F5', 'F6'];
      expect(applySybilPenalty(1000, flags)).toBe(500);
    });
  });

  describe('calculateAgentRank', () => {
    it('produces a full result with grade and flags', () => {
      const factors: AgentRankFactors = {
        paymentReliability: 0.9,
        serviceDelivery: 0.8,
        transactionVolume: 50,
        walletAgeDays: 30,
        disputeRate: 0.05,
      };
      const signals: SybilSignals = {
        walletAgeDays: 30,
        stakeUsdc: 20,
        uniqueCounterparties: 5,
        circularTradingDetected: false,
      };
      const result = calculateAgentRank('agent-1', factors, signals);
      expect(result.agentId).toBe('agent-1');
      expect(result.score).toBeGreaterThan(0);
      expect(result.score).toBeLessThanOrEqual(1000);
      expect(['S', 'A', 'B', 'C', 'D', 'F', 'U']).toContain(result.grade);
    });
  });
});

// ---------------------------------------------------------------------------
// Module 2: Trust-Escrow-SDK
// ---------------------------------------------------------------------------

describe('Trust-Escrow-SDK', () => {
  beforeEach(() => {
    resetEscrowStore();
  });

  describe('createEscrow', () => {
    it('creates a funded escrow', () => {
      const escrow = createEscrow({
        hiringAgent: 'agent-A',
        workingAgent: 'agent-B',
        amountUsdc: 100,
        workDescription: 'Build a dashboard',
      });
      expect(escrow.status).toBe('funded');
      expect(escrow.amountUsdc).toBe(100);
      expect(escrow.hiringAgent).toBe('agent-A');
      expect(escrow.workingAgent).toBe('agent-B');
    });

    it('rejects same agent as both hirer and worker', () => {
      expect(() =>
        createEscrow({ hiringAgent: 'agent-A', workingAgent: 'agent-A', amountUsdc: 50 }),
      ).toThrow('must be different');
    });

    it('rejects zero or negative amounts', () => {
      expect(() =>
        createEscrow({ hiringAgent: 'agent-A', workingAgent: 'agent-B', amountUsdc: 0 }),
      ).toThrow('greater than zero');
    });
  });

  describe('markComplete', () => {
    it('allows the working agent to mark complete', () => {
      const escrow = createEscrow({ hiringAgent: 'A', workingAgent: 'B', amountUsdc: 50 });
      const updated = markComplete(escrow.id, 'B');
      expect(updated.status).toBe('completed');
      expect(updated.completedAt).toBeInstanceOf(Date);
    });

    it('rejects if caller is not the working agent', () => {
      const escrow = createEscrow({ hiringAgent: 'A', workingAgent: 'B', amountUsdc: 50 });
      expect(() => markComplete(escrow.id, 'A')).toThrow('Only the working agent');
    });
  });

  describe('approveWork', () => {
    it('releases funds and applies +10 reputation delta', () => {
      const escrow = createEscrow({ hiringAgent: 'A', workingAgent: 'B', amountUsdc: 50 });
      markComplete(escrow.id, 'B');
      const released = approveWork(escrow.id, 'A');
      expect(released.status).toBe('released');
      expect(released.reputationDeltaHiring).toBe(10);
      expect(released.reputationDeltaWorking).toBe(10);
    });
  });

  describe('disputeWork', () => {
    it('applies -20 reputation penalty to guilty party', () => {
      const escrow = createEscrow({ hiringAgent: 'A', workingAgent: 'B', amountUsdc: 50 });
      const disputed = disputeWork(escrow.id, 'A', 'Work not delivered', 'B');
      expect(disputed.status).toBe('disputed');
      expect(disputed.reputationDeltaWorking).toBe(-20);
      expect(disputed.reputationDeltaHiring).toBe(0);
    });
  });

  describe('isAutoReleaseEligible', () => {
    it('returns false for non-completed escrows', () => {
      const escrow = createEscrow({ hiringAgent: 'A', workingAgent: 'B', amountUsdc: 50 });
      expect(isAutoReleaseEligible(escrow)).toBe(false);
    });

    it('returns false if less than 24h since completion', () => {
      const escrow = createEscrow({ hiringAgent: 'A', workingAgent: 'B', amountUsdc: 50 });
      markComplete(escrow.id, 'B');
      expect(isAutoReleaseEligible(getEscrow(escrow.id)!)).toBe(false);
    });
  });

  describe('listEscrowsForAgent', () => {
    it('returns escrows where agent is hiring or working', () => {
      createEscrow({ hiringAgent: 'A', workingAgent: 'B', amountUsdc: 50 });
      createEscrow({ hiringAgent: 'C', workingAgent: 'A', amountUsdc: 75 });
      createEscrow({ hiringAgent: 'D', workingAgent: 'E', amountUsdc: 25 });
      const result = listEscrowsForAgent('A');
      expect(result).toHaveLength(2);
    });
  });
});

// ---------------------------------------------------------------------------
// Module 3: KYA-Gateway
// ---------------------------------------------------------------------------

describe('KYA-Gateway', () => {
  beforeEach(() => {
    resetKyaStore();
  });

  describe('registerKya', () => {
    it('registers a new agent identity', () => {
      const identity = registerKya({
        agentId: 'agent-1',
        ownerEmail: 'owner@example.com',
      });
      expect(identity.agentId).toBe('agent-1');
      expect(identity.kycStatus).toBe('pending');
      expect(identity.verified).toBe(false);
    });

    it('auto-verifies when Stripe + platform token are provided', () => {
      const identity = registerKya({
        agentId: 'agent-2',
        ownerEmail: 'owner@example.com',
        stripeAccount: 'acct_123',
        platformToken: 'tok_456',
      });
      expect(identity.verified).toBe(true);
      expect(identity.kycStatus).toBe('verified');
    });

    it('rejects invalid email format', () => {
      expect(() =>
        registerKya({ agentId: 'agent-3', ownerEmail: 'not-an-email' }),
      ).toThrow('Invalid email');
    });

    it('rejects duplicate registration', () => {
      registerKya({ agentId: 'agent-4', ownerEmail: 'a@b.com' });
      expect(() =>
        registerKya({ agentId: 'agent-4', ownerEmail: 'c@d.com' }),
      ).toThrow('already registered');
    });
  });

  describe('computeRiskScore', () => {
    it('returns 50 for an unverified agent', () => {
      expect(computeRiskScore({})).toBe(50);
    });

    it('reduces risk for verified + Stripe', () => {
      const score = computeRiskScore({ verified: true, stripeAccount: 'acct_123' });
      expect(score).toBe(15);
    });
  });

  describe('verifyKya', () => {
    it('marks an agent as verified', () => {
      registerKya({ agentId: 'agent-5', ownerEmail: 'x@y.com' });
      const verified = verifyKya('agent-5');
      expect(verified.verified).toBe(true);
      expect(verified.kycStatus).toBe('verified');
    });
  });
});

// ---------------------------------------------------------------------------
// Module 4: Behavioral Oracle
// ---------------------------------------------------------------------------

describe('Behavioral Oracle', () => {
  beforeEach(() => {
    resetOracleStore();
  });

  describe('detectPredatoryDisputes', () => {
    it('returns null when dispute rate is low', () => {
      const profile: AgentBehaviorProfile = {
        agentId: 'agent-1',
        disputeCount: 1,
        totalEscrows: 10,
        recentTransactions: [],
      };
      expect(detectPredatoryDisputes(profile)).toBeNull();
    });

    it('flags critical when dispute rate exceeds 80%', () => {
      const profile: AgentBehaviorProfile = {
        agentId: 'agent-2',
        disputeCount: 9,
        totalEscrows: 10,
        recentTransactions: [],
      };
      const alert = detectPredatoryDisputes(profile);
      expect(alert).not.toBeNull();
      expect(alert!.severity).toBe('critical');
      expect(alert!.autoPaused).toBe(true);
    });
  });

  describe('detectLoopingTransactions', () => {
    it('detects round-trip patterns', () => {
      const profile: AgentBehaviorProfile = {
        agentId: 'agent-1',
        disputeCount: 0,
        totalEscrows: 0,
        recentTransactions: [
          { from: 'A', to: 'B', amount: 10, timestamp: new Date() },
          { from: 'B', to: 'A', amount: 10, timestamp: new Date() },
          { from: 'A', to: 'B', amount: 10, timestamp: new Date() },
          { from: 'B', to: 'A', amount: 10, timestamp: new Date() },
        ],
      };
      const alert = detectLoopingTransactions(profile);
      expect(alert).not.toBeNull();
      expect(alert!.alertType).toBe('LOOPING_TX');
    });
  });

  describe('detectRapidEscalation', () => {
    it('returns null when fewer than 3 disputes', () => {
      const result = detectRapidEscalation('agent-1', [new Date()]);
      expect(result).toBeNull();
    });

    it('flags critical when 3+ disputes in 24h', () => {
      const now = new Date();
      const disputes = [
        now,
        new Date(now.getTime() - 1000),
        new Date(now.getTime() - 2000),
      ];
      const alert = detectRapidEscalation('agent-1', disputes);
      expect(alert).not.toBeNull();
      expect(alert!.severity).toBe('critical');
      expect(alert!.autoPaused).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// Module 5: Sybil Resistance Engine
// ---------------------------------------------------------------------------

describe('Sybil Resistance Engine', () => {
  describe('computeWalletAgeScore', () => {
    it('returns 0 for a brand-new wallet', () => {
      expect(computeWalletAgeScore(new Date())).toBe(0);
    });

    it('returns 1 for a wallet 90+ days old', () => {
      const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
      expect(computeWalletAgeScore(ninetyDaysAgo)).toBe(1);
    });

    it('returns a partial score for intermediate age', () => {
      const fortyFiveDaysAgo = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000);
      const score = computeWalletAgeScore(fortyFiveDaysAgo);
      expect(score).toBeGreaterThan(0.4);
      expect(score).toBeLessThan(0.6);
    });
  });

  describe('meetsStakeRequirement', () => {
    it('returns false for insufficient stake', () => {
      expect(meetsStakeRequirement(50)).toBe(false);
    });

    it('returns true for $100+ USDC', () => {
      expect(meetsStakeRequirement(100)).toBe(true);
      expect(meetsStakeRequirement(500)).toBe(true);
    });
  });

  describe('detectCircularTrading', () => {
    it('returns false with no transactions', () => {
      expect(detectCircularTrading('A', [])).toBe(false);
    });

    it('returns true for A→B→A round-trips', () => {
      const history = [
        { from: 'A', to: 'B', amount: 10, timestamp: new Date() },
        { from: 'B', to: 'A', amount: 10, timestamp: new Date() },
        { from: 'A', to: 'B', amount: 10, timestamp: new Date() },
        { from: 'B', to: 'A', amount: 10, timestamp: new Date() },
      ];
      expect(detectCircularTrading('A', history)).toBe(true);
    });
  });

  describe('exceedsVelocityLimit', () => {
    it('returns false within daily limit', () => {
      expect(exceedsVelocityLimit(30)).toBe(false);
    });

    it('returns true above daily limit', () => {
      expect(exceedsVelocityLimit(51)).toBe(true);
    });
  });

  describe('runSybilCheck', () => {
    it('passes for a clean profile', () => {
      const profile: WalletProfile = {
        walletAddress: 'wallet-1',
        createdAt: new Date(Date.now() - 100 * 24 * 60 * 60 * 1000),
        stakedUsdc: 200,
        counterparties: ['a', 'b', 'c', 'd'],
        transactionsToday: 5,
        transactionHistory: [],
      };
      const result = runSybilCheck(profile);
      expect(result.passed).toBe(true);
      expect(result.flags).toEqual([]);
      expect(result.riskLevel).toBe('low');
    });

    it('fails with multiple flags for a suspicious profile', () => {
      const profile: WalletProfile = {
        walletAddress: 'wallet-2',
        createdAt: new Date(), // brand new
        stakedUsdc: 10,       // below $100
        counterparties: ['a'], // only 1 counterparty
        transactionsToday: 60, // above daily limit
        transactionHistory: [],
      };
      const result = runSybilCheck(profile);
      expect(result.passed).toBe(false);
      expect(result.flags.length).toBeGreaterThanOrEqual(3);
      expect(result.riskLevel).toBe('critical');
    });
  });
});

// ---------------------------------------------------------------------------
// Module 6: Programmatic Dispute Resolution
// ---------------------------------------------------------------------------

describe('Programmatic Dispute Resolution', () => {
  beforeEach(() => {
    resetDisputeStore();
  });

  describe('computeCompletionScore', () => {
    it('returns 0 when no delivery proof', () => {
      expect(computeCompletionScore({ hiringAgentProof: 'Build a bot', workingAgentProof: '' })).toBe(0);
    });

    it('returns 1 when no spec was provided', () => {
      expect(computeCompletionScore({ hiringAgentProof: '', workingAgentProof: 'Delivered' })).toBe(1);
    });

    it('returns a value between 0 and 1 for normal cases', () => {
      const score = computeCompletionScore({
        hiringAgentProof: 'Build a REST API with 5 endpoints',
        workingAgentProof: 'Built a REST API with all 5 endpoints, tests, and docs',
      });
      expect(score).toBeGreaterThan(0);
      expect(score).toBeLessThanOrEqual(1);
    });
  });

  describe('determineOutcome', () => {
    it('releases to worker for high scores', () => {
      expect(determineOutcome(0.9)).toBe('release_to_worker');
    });

    it('refunds to hirer for low scores', () => {
      expect(determineOutcome(0.3)).toBe('refund_to_hirer');
    });

    it('splits proportionally for medium scores', () => {
      expect(determineOutcome(0.65)).toBe('proportional_split');
    });
  });

  describe('calculateSplit', () => {
    it('splits amount proportionally', () => {
      const split = calculateSplit(100, 0.7);
      expect(split.workerPayout).toBe(70);
      expect(split.hirerRefund).toBe(30);
    });

    it('gives all to worker at score 1', () => {
      const split = calculateSplit(100, 1);
      expect(split.workerPayout).toBe(100);
      expect(split.hirerRefund).toBe(0);
    });
  });

  describe('aggregatePeerVotes', () => {
    it('returns null with fewer than 3 reviewers', () => {
      expect(aggregatePeerVotes([
        { reviewerAgentId: 'r1', vote: 0.8 },
      ])).toBeNull();
    });

    it('averages votes with 3+ reviewers', () => {
      const result = aggregatePeerVotes([
        { reviewerAgentId: 'r1', vote: 0.8 },
        { reviewerAgentId: 'r2', vote: 0.6 },
        { reviewerAgentId: 'r3', vote: 1.0 },
      ]);
      expect(result).toBeCloseTo(0.8, 2);
    });
  });

  describe('createDisputeCase', () => {
    it('creates a new dispute case', () => {
      const dispute = createDisputeCase({
        escrowId: 'escrow-1',
        hiringAgent: 'A',
        workingAgent: 'B',
        amountUsdc: 100,
        hiringAgentProof: 'Spec document',
        workingAgentProof: 'Delivered code',
      });
      expect(dispute.resolved).toBe(false);
      expect(dispute.outcome).toBeNull();
    });
  });

  describe('submitPeerReview', () => {
    it('adds a peer review', () => {
      const dispute = createDisputeCase({
        escrowId: 'escrow-1',
        hiringAgent: 'A',
        workingAgent: 'B',
        amountUsdc: 100,
        hiringAgentProof: 'Spec',
        workingAgentProof: 'Delivery',
      });
      const updated = submitPeerReview(dispute.id, {
        reviewerAgentId: 'reviewer-1',
        vote: 0.7,
        comment: 'Looks good',
      });
      expect(updated.peerReviews).toHaveLength(1);
    });

    it('rejects participants as reviewers', () => {
      const dispute = createDisputeCase({
        escrowId: 'escrow-1',
        hiringAgent: 'A',
        workingAgent: 'B',
        amountUsdc: 100,
        hiringAgentProof: 'Spec',
        workingAgentProof: 'Delivery',
      });
      expect(() =>
        submitPeerReview(dispute.id, { reviewerAgentId: 'A', vote: 0.5 }),
      ).toThrow('cannot serve as peer reviewers');
    });
  });

  describe('resolveDispute', () => {
    it('resolves with automated scoring when no peer reviews', () => {
      const dispute = createDisputeCase({
        escrowId: 'escrow-1',
        hiringAgent: 'A',
        workingAgent: 'B',
        amountUsdc: 100,
        hiringAgentProof: 'Build a short API',
        workingAgentProof: 'Built the API with all endpoints, tests, documentation, and deployment scripts',
      });
      const resolved = resolveDispute(dispute.id);
      expect(resolved.resolved).toBe(true);
      expect(resolved.completionScore).not.toBeNull();
      expect(resolved.outcome).not.toBeNull();
      expect(resolved.workerPayout + resolved.hirerRefund).toBeCloseTo(100, 1);
    });

    it('rejects resolving an already-resolved dispute', () => {
      const dispute = createDisputeCase({
        escrowId: 'escrow-2',
        hiringAgent: 'A',
        workingAgent: 'B',
        amountUsdc: 50,
        hiringAgentProof: 'Spec',
        workingAgentProof: 'Delivery',
      });
      resolveDispute(dispute.id);
      expect(() => resolveDispute(dispute.id)).toThrow('already resolved');
    });
  });
});
