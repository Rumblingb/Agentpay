/**
 * Unit tests for feeService — pure fee calculation functions, no DB required.
 */

import {
  calculateFees,
  applyFees,
  formatFeeBreakdown,
} from '../../src/services/feeService';

describe('feeService', () => {
  describe('calculateFees', () => {
    it('returns correct breakdown for $100', () => {
      const result = calculateFees(100);
      expect(result.grossAmount).toBe(100);
      expect(result.platformFeeUsd).toBeCloseTo(1, 5);       // 1%
      expect(result.networkFeeUsd).toBeCloseTo(0.001, 5);    // fixed
      expect(result.disputeReserveUsd).toBeCloseTo(0.5, 5);  // 0.5%
      expect(result.netToSeller).toBeCloseTo(98.499, 3);
    });

    it('enforces minimum platform fee on tiny amounts', () => {
      const result = calculateFees(0.5);
      expect(result.platformFeeUsd).toBeGreaterThanOrEqual(0.01);
    });

    it('netToSeller is never negative', () => {
      const result = calculateFees(0.001);
      expect(result.netToSeller).toBeGreaterThanOrEqual(0);
    });

    it('respects custom fee config', () => {
      const result = calculateFees(100, { platformFeePct: 0.02 });
      expect(result.platformFeeUsd).toBeCloseTo(2, 5);
    });

    it('netToProtocol equals platformFee + networkFee', () => {
      const result = calculateFees(100);
      expect(result.netToProtocol).toBeCloseTo(
        result.platformFeeUsd + result.networkFeeUsd,
        8,
      );
    });
  });

  describe('applyFees', () => {
    it('returns netToSeller, totalFees, and breakdown', () => {
      const result = applyFees(100);
      expect(result.netToSeller).toBeCloseTo(98.499, 3);
      expect(result.totalFees).toBeCloseTo(1.501, 3); // 1 + 0.001 + 0.5
      expect(result.breakdown).toBeDefined();
      expect(result.breakdown.grossAmount).toBe(100);
    });

    it('is consistent with calculateFees', () => {
      const fees = calculateFees(50);
      const applied = applyFees(50);
      expect(applied.netToSeller).toBe(fees.netToSeller);
      expect(applied.breakdown.platformFeeUsd).toBe(fees.platformFeeUsd);
    });
  });

  describe('formatFeeBreakdown', () => {
    it('returns a non-empty string', () => {
      const breakdown = calculateFees(100);
      const text = formatFeeBreakdown(breakdown);
      expect(typeof text).toBe('string');
      expect(text.length).toBeGreaterThan(0);
    });

    it('contains gross amount and net to seller', () => {
      const breakdown = calculateFees(100);
      const text = formatFeeBreakdown(breakdown);
      expect(text).toContain('Gross Amount');
      expect(text).toContain('Net to Seller');
    });
  });
});
