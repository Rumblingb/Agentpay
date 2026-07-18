import { describe, expect, it } from 'vitest';

import {
  discoverProducts,
  ProductDiscoveryError,
  signDiscoveryReport,
  verifyDiscoveryReport,
} from '../src/lib/productDiscovery';

const now = new Date('2026-07-18T12:00:00.000Z');

const product = (overrides: Record<string, unknown> = {}) => ({
  id: 'pack_a',
  merchantId: 'merchant_a',
  merchantName: 'Northline Goods',
  title: 'Tidepack Commuter',
  category: 'bags',
  priceMinor: 9_600,
  currency: 'GBP',
  availability: 'in_stock',
  checkoutUrl: 'https://merchant.example/checkout/pack-a',
  imageUrl: 'https://merchant.example/images/pack-a.png',
  deliveryDays: 2,
  returnWindowDays: 45,
  refundable: true,
  catalogUpdatedAt: new Date(now.getTime() - 10 * 60_000).toISOString(),
  truthScore: 98,
  qualityScore: 91,
  needSignals: [{ need: 'rain-ready-commute', score: 97 }],
  sponsored: false,
  ...overrides,
});

const request = (products: unknown[]) => ({
  need: 'Rain ready commute',
  constitution: {
    currency: 'GBP',
    maxTotalMinor: 15_000,
    allowedCategories: ['bags'],
    requiresRefundable: true,
    minimumReturnWindowDays: 30,
    maximumDeliveryDays: 3,
    maxEvidenceAgeMinutes: 60,
    requireHumanApproval: true,
  },
  products,
});

describe('need-led product discovery', () => {
  it('ranks by customer fit while disclosing sponsorship without boosting it', () => {
    const report = discoverProducts(request([
      product(),
      product({
        id: 'sponsored_b',
        sponsored: true,
        truthScore: 93,
        qualityScore: 82,
        needSignals: [{ need: 'rain-ready-commute', score: 75 }],
      }),
    ]), now);

    expect(report.matches.map((match) => match.product.id)).toEqual(['pack_a', 'sponsored_b']);
    expect(report.matches[1].disclosure).toBe('sponsored');
    expect(report.rankingPolicy.paidPlacementChangesOrganicRank).toBe(false);
    expect(report).toMatchObject({
      schema: 'agentpay.product-discovery/1.1',
      constitution: {
        currency: 'GBP',
        maxTotalMinor: 15_000,
        allowedCategories: ['bags'],
        requireHumanApproval: true,
      },
    });
    expect(report.matches[0].attributionDraft).toMatchObject({
      status: 'draft_only',
      successFeeBps: 800,
      settlement: 'after_return_window',
      requiresMerchantAgreement: true,
      requiresVerifiedConversionWebhook: true,
    });
    expect(report.catalogProvenance).toMatchObject({
      source: 'caller_supplied_candidates',
      merchantConnection: 'not_verified',
    });
  });

  it('enforces category, merchant, and refund rules before ranking', () => {
    const policyRequest = {
      ...request([
        product({ id: 'wrong_category', category: 'clothing' }),
        product({ id: 'wrong_merchant', merchantId: 'merchant_b' }),
        product({ id: 'blocked_merchant', merchantId: 'merchant_blocked' }),
        product({ id: 'not_refundable', refundable: false }),
      ]),
      constitution: {
        ...request([]).constitution,
        allowedMerchants: ['merchant_a', 'merchant_blocked'],
        blockedMerchants: ['merchant_blocked'],
      },
    };

    const report = discoverProducts(policyRequest, now);

    expect(report.matches).toHaveLength(0);
    expect(report.rejected).toEqual([
      { productId: 'wrong_category', reasonCodes: ['CATEGORY_NOT_ALLOWED'] },
      { productId: 'wrong_merchant', reasonCodes: ['MERCHANT_NOT_ALLOWED'] },
      { productId: 'blocked_merchant', reasonCodes: ['MERCHANT_BLOCKED'] },
      { productId: 'not_refundable', reasonCodes: ['NOT_REFUNDABLE'] },
    ]);
  });

  it('requires an explicit category scope', () => {
    const noCategories = request([product()]);
    noCategories.constitution.allowedCategories = [];
    expect(() => discoverProducts(noCategories, now)).toThrow('constitution.allowedCategories must contain at least one explicit category');

    const malformedCategory = request([product()]);
    malformedCategory.constitution.allowedCategories = ['bags & clothing'];
    expect(() => discoverProducts(malformedCategory, now)).toThrow('constitution.allowedCategories[0] must contain lowercase words');
  });

  it('fails closed on budget, delivery, returns, freshness, stock, and weak need fit', () => {
    const report = discoverProducts(request([
      product({ id: 'over_budget', priceMinor: 16_000 }),
      product({ id: 'too_slow', deliveryDays: 5 }),
      product({ id: 'short_returns', returnWindowDays: 14 }),
      product({ id: 'stale', catalogUpdatedAt: new Date(now.getTime() - 120 * 60_000).toISOString() }),
      product({ id: 'sold_out', availability: 'out_of_stock' }),
      product({ id: 'weak_fit', needSignals: [{ need: 'rain-ready-commute', score: 40 }] }),
    ]), now);

    expect(report.matches).toHaveLength(0);
    expect(report.rejected.map((item) => item.reasonCodes[0])).toEqual([
      'OVER_BUDGET',
      'DELIVERY_TOO_SLOW',
      'RETURN_WINDOW_TOO_SHORT',
      'CATALOG_STALE',
      'NOT_IN_STOCK',
      'NEED_FIT_TOO_LOW',
    ]);
  });

  it('signs stable reports and rejects unsafe product URLs', async () => {
    const report = discoverProducts(request([product()]), now);
    const secret = 'discovery-signing-secret-that-is-long-enough';
    const signature = await signDiscoveryReport(report, secret);

    await expect(verifyDiscoveryReport(report, signature, secret)).resolves.toBe(true);
    await expect(verifyDiscoveryReport(
      { ...report, need: 'tampered-need' },
      signature,
      secret,
    )).resolves.toBe(false);
    expect(() => discoverProducts(request([product({ checkoutUrl: 'http://merchant.example/checkout' })]), now))
      .toThrow(ProductDiscoveryError);
  });
});
