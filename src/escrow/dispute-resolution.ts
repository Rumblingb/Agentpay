/**
 * Programmatic Dispute Resolution — Automated dispute resolution without
 * human arbiters for A2A escrow transactions.
 *
 * Resolution flow:
 *   1. Both parties submit evidence (what was paid for / what was delivered).
 *   2. Automated scoring evaluates delivery completeness (0–1).
 *   3. Optional: community peer review by 3 high-reputation agents.
 *   4. Auto-resolution rules:
 *        completionScore > 0.8  → release full amount to worker
 *        completionScore < 0.5  → refund full amount to hirer
 *        0.5 – 0.8             → proportional split
 *
 * @module dispute-resolution
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DisputeEvidence {
  /** What the hiring agent paid for (description / spec) */
  hiringAgentProof: string;
  /** What the working agent delivered (description / deliverable link) */
  workingAgentProof: string;
}

export interface PeerReview {
  reviewerAgentId: string;
  /** 0 = side with hirer, 1 = side with worker */
  vote: number;
  comment?: string;
}

export type ResolutionOutcome = 'release_to_worker' | 'refund_to_hirer' | 'proportional_split';

export interface DisputeCase {
  id: string;
  escrowId: string;
  hiringAgent: string;
  workingAgent: string;
  amountUsdc: number;
  evidence: DisputeEvidence;
  completionScore: number | null;
  peerReviews: PeerReview[];
  outcome: ResolutionOutcome | null;
  workerPayout: number;
  hirerRefund: number;
  resolved: boolean;
  resolvedAt: Date | null;
  createdAt: Date;
}

export interface CreateDisputeCaseParams {
  escrowId: string;
  hiringAgent: string;
  workingAgent: string;
  amountUsdc: number;
  hiringAgentProof: string;
  workingAgentProof: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Score above which the worker gets the full payout */
const RELEASE_THRESHOLD = 0.8;

/** Score below which the hirer gets a full refund */
const REFUND_THRESHOLD = 0.5;

/** Number of peer reviewers required for community verdict */
const REQUIRED_PEER_REVIEWERS = 3;

/** Minimum AgentRank score to serve as a peer reviewer */
export const MIN_REVIEWER_SCORE = 700;

// ---------------------------------------------------------------------------
// In-memory store (replace with DB when table is migrated)
// ---------------------------------------------------------------------------

let disputeStore: DisputeCase[] = [];
let idCounter = 1;

function generateId(): string {
  return `dispute-${Date.now()}-${idCounter++}`;
}

/** Reset store — useful for tests */
export function _resetStore(): void {
  disputeStore = [];
  idCounter = 1;
}

// ---------------------------------------------------------------------------
// Scoring functions (pure — no DB dependency)
// ---------------------------------------------------------------------------

/**
 * Compute a completion score (0–1) from evidence.
 *
 * In production this would use an ML model or LLM evaluation.
 * For now we use a heuristic: longer working agent proof relative
 * to the hiring agent spec → higher score. This is a placeholder
 * for the real scoring pipeline.
 */
export function computeCompletionScore(evidence: DisputeEvidence): number {
  if (!evidence.workingAgentProof || evidence.workingAgentProof.trim().length === 0) {
    return 0;
  }
  if (!evidence.hiringAgentProof || evidence.hiringAgentProof.trim().length === 0) {
    return 1; // no spec means nothing to violate
  }

  // Heuristic: ratio of delivery detail to spec detail, capped at 1
  const specLength = evidence.hiringAgentProof.trim().length;
  const deliveryLength = evidence.workingAgentProof.trim().length;
  const ratio = deliveryLength / Math.max(specLength, 1);

  return Math.min(1, Math.max(0, ratio * 0.5 + 0.25));
}

/**
 * Determine the resolution outcome from a completion score.
 */
export function determineOutcome(completionScore: number): ResolutionOutcome {
  if (completionScore > RELEASE_THRESHOLD) return 'release_to_worker';
  if (completionScore < REFUND_THRESHOLD) return 'refund_to_hirer';
  return 'proportional_split';
}

/**
 * Calculate payout split for a proportional resolution.
 * Worker gets (completionScore × amount), hirer gets the remainder.
 */
export function calculateSplit(
  amountUsdc: number,
  completionScore: number,
): { workerPayout: number; hirerRefund: number } {
  const workerPayout = Math.round(amountUsdc * completionScore * 100) / 100;
  const hirerRefund = Math.round((amountUsdc - workerPayout) * 100) / 100;
  return { workerPayout, hirerRefund };
}

/**
 * Aggregate peer review votes into a final score adjustment.
 * Average vote (0-1) is blended with the automated score.
 */
export function aggregatePeerVotes(reviews: PeerReview[]): number | null {
  if (reviews.length < REQUIRED_PEER_REVIEWERS) return null;
  const total = reviews.reduce((sum, r) => sum + r.vote, 0);
  return total / reviews.length;
}

// ---------------------------------------------------------------------------
// Dispute case management
// ---------------------------------------------------------------------------

/**
 * Open a new dispute case.
 */
export function createDisputeCase(params: CreateDisputeCaseParams): DisputeCase {
  if (!params.escrowId) throw new Error('escrowId is required');
  if (!params.hiringAgent || !params.workingAgent) {
    throw new Error('Both hiringAgent and workingAgent are required');
  }
  if (params.amountUsdc <= 0) throw new Error('Amount must be greater than zero');

  const evidence: DisputeEvidence = {
    hiringAgentProof: params.hiringAgentProof || '',
    workingAgentProof: params.workingAgentProof || '',
  };

  const disputeCase: DisputeCase = {
    id: generateId(),
    escrowId: params.escrowId,
    hiringAgent: params.hiringAgent,
    workingAgent: params.workingAgent,
    amountUsdc: params.amountUsdc,
    evidence,
    completionScore: null,
    peerReviews: [],
    outcome: null,
    workerPayout: 0,
    hirerRefund: 0,
    resolved: false,
    resolvedAt: null,
    createdAt: new Date(),
  };

  disputeStore.push(disputeCase);
  return disputeCase;
}

/**
 * Submit a peer review for a dispute case.
 */
export function submitPeerReview(
  disputeId: string,
  review: PeerReview,
): DisputeCase {
  const dispute = disputeStore.find((d) => d.id === disputeId);
  if (!dispute) throw new Error('Dispute case not found');
  if (dispute.resolved) throw new Error('Dispute is already resolved');

  // Prevent duplicate reviews from the same reviewer
  if (dispute.peerReviews.some((r) => r.reviewerAgentId === review.reviewerAgentId)) {
    throw new Error('Reviewer has already submitted a review');
  }

  // Prevent parties from reviewing their own dispute
  if (review.reviewerAgentId === dispute.hiringAgent || review.reviewerAgentId === dispute.workingAgent) {
    throw new Error('Dispute participants cannot serve as peer reviewers');
  }

  if (review.vote < 0 || review.vote > 1) {
    throw new Error('Vote must be between 0 and 1');
  }

  dispute.peerReviews.push(review);
  return dispute;
}

/**
 * Resolve a dispute case using automated scoring + optional peer review.
 */
export function resolveDispute(disputeId: string): DisputeCase {
  const dispute = disputeStore.find((d) => d.id === disputeId);
  if (!dispute) throw new Error('Dispute case not found');
  if (dispute.resolved) throw new Error('Dispute is already resolved');

  // Step 1: Compute automated completion score
  const autoScore = computeCompletionScore(dispute.evidence);

  // Step 2: Blend with peer review if available
  const peerScore = aggregatePeerVotes(dispute.peerReviews);
  const finalScore = peerScore !== null
    ? (autoScore * 0.6 + peerScore * 0.4)  // 60% auto, 40% community
    : autoScore;

  dispute.completionScore = Math.round(finalScore * 1000) / 1000;

  // Step 3: Determine outcome
  dispute.outcome = determineOutcome(dispute.completionScore);

  // Step 4: Calculate payouts
  if (dispute.outcome === 'release_to_worker') {
    dispute.workerPayout = dispute.amountUsdc;
    dispute.hirerRefund = 0;
  } else if (dispute.outcome === 'refund_to_hirer') {
    dispute.workerPayout = 0;
    dispute.hirerRefund = dispute.amountUsdc;
  } else {
    const split = calculateSplit(dispute.amountUsdc, dispute.completionScore);
    dispute.workerPayout = split.workerPayout;
    dispute.hirerRefund = split.hirerRefund;
  }

  dispute.resolved = true;
  dispute.resolvedAt = new Date();

  return dispute;
}

/**
 * Retrieve a dispute case by ID.
 */
export function getDisputeCase(disputeId: string): DisputeCase | null {
  return disputeStore.find((d) => d.id === disputeId) ?? null;
}

/**
 * List all dispute cases for a given agent.
 */
export function listDisputesForAgent(agentId: string): DisputeCase[] {
  return disputeStore.filter(
    (d) => d.hiringAgent === agentId || d.workingAgent === agentId,
  );
}
