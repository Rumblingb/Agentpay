/**
 * PRODUCTION FIX — DEMO FLOW
 *
 * Tests for the TrustPaymentFlow conditional send logic based on AgentRank.
 *
 * 3 tests:
 *   1. High-score agent (850) should be eligible for escrow (proceed)
 *   2. Low-score agent (150) should be blocked by Behavioral Oracle
 *   3. Unknown wallet should default to mid-range score (500)
 */

import {
  lookupAgentScore,
  evaluateTrustDecision,
} from '../dashboard/lib/trust-logic';

describe('TrustPaymentFlow — Conditional Send Logic', () => {
  // PRODUCTION FIX — DEMO FLOW: Test 1 — High-score agent proceeds to escrow
  it('should allow escrow for a high-score agent (score >= 700)', () => {
    const result = lookupAgentScore('DemoAgentTrust850');
    expect(result).not.toBeNull();
    expect(result!.score).toBe(850);
    expect(result!.grade).toBe('AAA');

    const decision = evaluateTrustDecision(result!.score);
    expect(decision).toBe('proceed');
  });

  // PRODUCTION FIX — DEMO FLOW: Test 2 — Low-score agent is blocked
  it('should block transaction for a low-score agent (score < 400)', () => {
    const result = lookupAgentScore('DemoAgentSlash150');
    expect(result).not.toBeNull();
    expect(result!.score).toBe(150);
    expect(result!.grade).toBe('F');

    const decision = evaluateTrustDecision(result!.score);
    expect(decision).toBe('blocked');
  });

  // PRODUCTION FIX — DEMO FLOW: Test 3 — Unknown wallet returns null (component defaults to 500)
  it('should return null for an unknown wallet address', () => {
    const result = lookupAgentScore('UnknownWalletXYZ');
    expect(result).toBeNull();

    // Component defaults unknown wallets to score 500 — verify decision at that score
    const decision = evaluateTrustDecision(500);
    expect(decision).toBe('blocked');
  });
});
