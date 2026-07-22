import { describe, expect, it } from 'vitest';
import { shouldDispatchPaidAction } from '../src/lib/paymentDispatchPolicy';

describe('paid action dispatch policy', () => {
  it('fails closed before required payment is confirmed', () => {
    expect(shouldDispatchPaidAction({ requiresPayment: true, paymentConfirmed: false })).toBe(false);
  });

  it('allows exact-action resume after payment confirmation', () => {
    expect(shouldDispatchPaidAction({ requiresPayment: true, paymentConfirmed: true })).toBe(true);
  });

  it('does not block genuinely free actions', () => {
    expect(shouldDispatchPaidAction({ requiresPayment: false, paymentConfirmed: false })).toBe(true);
  });
});
