import { describe, expect, it } from 'vitest';

import { buildCommerceCompilePayload } from '../../../dashboard/app/api/commerce/compile/payload';

describe('commerce compiler dashboard BFF payload', () => {
  it('sends a normalized buyer constitution instead of legacy scalar constraints', () => {
    const payload = buildCommerceCompilePayload({
      need: 'commute',
      scopeMode: 'wear',
      budgetMinor: 15_000,
      maxDeliveryDays: 3,
      easyReturns: true,
    }, '2026-07-18T12:00:00.000Z');

    expect(payload).toMatchObject({
      need: 'rain-ready-commute',
      constitution: {
        currency: 'GBP',
        maxTotalMinor: 15_000,
        allowedCategories: ['bags', 'clothing'],
        blockedMerchants: [],
        requiresRefundable: true,
        minimumReturnWindowDays: 30,
        maximumDeliveryDays: 3,
        maxEvidenceAgeMinutes: 60,
        requireHumanApproval: true,
      },
    });
    expect(payload).not.toHaveProperty('budgetMinor');
    expect(payload).not.toHaveProperty('currency');
    expect(payload).not.toHaveProperty('maxDeliveryDays');
    expect(payload.products.every((product) => product.category && typeof product.refundable === 'boolean')).toBe(true);
  });
});
