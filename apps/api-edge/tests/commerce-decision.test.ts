import { describe, expect, it } from 'vitest';

import {
  CommerceDecisionError,
  evaluateCommerceDecision,
  hashCommerceValue,
  signCommerceDecision,
  verifyCommerceDecisionSignature,
} from '../src/lib/commerceDecision';

const now = new Date('2026-07-18T12:00:00.000Z');
const evidence = (minutesOld = 5) => [{
  field: 'price_and_stock',
  value: 'In stock at stated price',
  source: 'https://merchant.example/products/item',
  observedAt: new Date(now.getTime() - minutesOld * 60_000).toISOString(),
}];

const candidate = (overrides: Record<string, unknown> = {}) => ({
  id: 'item_a',
  name: 'Everyday layer',
  merchantId: 'merchant_a',
  merchantName: 'Merchant A',
  category: 'clothing',
  priceMinor: 7_200,
  currency: 'GBP',
  refundable: true,
  returnWindowDays: 30,
  deliveryDays: 3,
  qualityScore: 88,
  sustainabilityScore: 70,
  evidence: evidence(),
  ...overrides,
});

const request = (candidates: unknown[]) => ({
  intent: 'Find a durable everyday layer with easy returns',
  constitution: {
    currency: 'GBP',
    maxTotalMinor: 9_000,
    allowedCategories: ['clothing'],
    blockedMerchants: ['merchant_blocked'],
    requiresRefundable: true,
    minimumReturnWindowDays: 30,
    maximumDeliveryDays: 7,
    maxEvidenceAgeMinutes: 60,
    requireHumanApproval: true,
    weights: { price: 25, quality: 45, delivery: 15, sustainability: 15 },
  },
  candidates,
});

describe('commerce choice receipts', () => {
  it('ranks only policy-eligible candidates and proposes an exact one-time mandate', async () => {
    const decision = await evaluateCommerceDecision(request([
      candidate(),
      candidate({ id: 'item_b', name: 'Cheaper layer', priceMinor: 5_900, qualityScore: 60 }),
      candidate({ id: 'item_c', merchantId: 'merchant_blocked', priceMinor: 4_000 }),
    ]), now);

    expect(decision.recommendation?.id).toBe('item_a');
    expect(decision.rejected[0].reasons.map((item) => item.code)).toContain('MERCHANT_BLOCKED');
    expect(decision.approval).toMatchObject({ required: true, mode: 'human' });
    expect(decision.proposedMandate).toMatchObject({
      decisionId: decision.decisionId,
      candidateId: 'item_a',
      amountMinor: 7_200,
      oneTime: true,
    });
    expect(decision.retention).toBe('not-stored');
  });

  it('fails closed on hard constraints and stale evidence', async () => {
    const decision = await evaluateCommerceDecision(request([
      candidate({ id: 'too_expensive', priceMinor: 10_000 }),
      candidate({ id: 'stale', evidence: evidence(120) }),
      candidate({ id: 'no_returns', refundable: false, returnWindowDays: 0 }),
    ]), now);

    expect(decision.recommendation).toBeNull();
    expect(decision.proposedMandate).toBeNull();
    expect(decision.rejected.map((item) => item.reasons[0].code)).toEqual([
      'OVER_BUDGET',
      'EVIDENCE_STALE',
      'NOT_REFUNDABLE',
    ]);
  });

  it('produces stable decisions and detects tampered signed receipts', async () => {
    const first = await evaluateCommerceDecision(request([candidate()]), now);
    const second = await evaluateCommerceDecision(request([candidate()]), now);
    expect(second.decisionId).toBe(first.decisionId);

    const secret = 'commerce-signing-secret-that-is-long-enough';
    const signature = await signCommerceDecision(first, secret);
    await expect(verifyCommerceDecisionSignature(first, signature, secret)).resolves.toBe(true);
    await expect(verifyCommerceDecisionSignature(
      { ...first, intent: 'tampered' },
      signature,
      secret,
    )).resolves.toBe(false);

    await expect(evaluateCommerceDecision(request([
      candidate({ evidence: [{ ...evidence()[0], source: 'http://merchant.example/item' }] }),
    ]), now)).rejects.toBeInstanceOf(CommerceDecisionError);
  });

  it('hashes policy snapshots canonically for durable approval binding', async () => {
    const first = await hashCommerceValue({
      currency: 'GBP',
      nested: { maximum: 9_000, approval: true },
    });
    const reordered = await hashCommerceValue({
      nested: { approval: true, maximum: 9_000 },
      currency: 'GBP',
    });
    const changed = await hashCommerceValue({
      nested: { approval: true, maximum: 9_001 },
      currency: 'GBP',
    });

    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(reordered).toBe(first);
    expect(changed).not.toBe(first);
  });
});
