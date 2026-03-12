/**
 * Fee Service — Centralised fee calculation for all AgentPay transactions.
 *
 * Default fee structure:
 *   - Platform fee:     1%   (min $0.01)
 *   - Network fee:      $0.001 fixed
 *   - Dispute reserve:  0.5% (returned on clean completion)
 *
 * @module services/feeService
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FeeBreakdown {
  grossAmount: number;
  platformFeePct: number;
  platformFeeUsd: number;
  networkFeeUsd: number;
  disputeReservePct: number;
  disputeReserveUsd: number;
  netToSeller: number;
  netToProtocol: number;
}

export interface FeeConfig {
  platformFeePct?: number;
  networkFeeUsd?: number;
  disputeReservePct?: number;
  minFeeUsd?: number;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_PLATFORM_FEE_PCT = 0.01;   // 1%
const DEFAULT_NETWORK_FEE_USD = 0.001;   // $0.001 fixed
const DEFAULT_DISPUTE_RESERVE_PCT = 0.005; // 0.5%
const DEFAULT_MIN_FEE_USD = 0.01;         // $0.01 minimum

// ---------------------------------------------------------------------------
// Core functions
// ---------------------------------------------------------------------------

/**
 * Calculate the full fee breakdown for a gross payment amount.
 */
export function calculateFees(grossAmount: number, config?: FeeConfig): FeeBreakdown {
  const platformFeePct = config?.platformFeePct ?? DEFAULT_PLATFORM_FEE_PCT;
  const networkFeeUsd = config?.networkFeeUsd ?? DEFAULT_NETWORK_FEE_USD;
  const disputeReservePct = config?.disputeReservePct ?? DEFAULT_DISPUTE_RESERVE_PCT;
  const minFeeUsd = config?.minFeeUsd ?? DEFAULT_MIN_FEE_USD;

  const rawPlatformFee = grossAmount * platformFeePct;
  const platformFeeUsd = Math.max(rawPlatformFee, minFeeUsd);
  const disputeReserveUsd = grossAmount * disputeReservePct;

  const netToSeller = grossAmount - platformFeeUsd - networkFeeUsd - disputeReserveUsd;
  const netToProtocol = platformFeeUsd + networkFeeUsd;

  return {
    grossAmount,
    platformFeePct,
    platformFeeUsd,
    networkFeeUsd,
    disputeReservePct,
    disputeReserveUsd,
    netToSeller: Math.max(0, netToSeller),
    netToProtocol,
  };
}

/**
 * Apply fees and return net amounts along with the full breakdown.
 */
export function applyFees(
  grossAmount: number,
  config?: FeeConfig,
): { netToSeller: number; totalFees: number; breakdown: FeeBreakdown } {
  const breakdown = calculateFees(grossAmount, config);
  const totalFees = breakdown.platformFeeUsd + breakdown.networkFeeUsd + breakdown.disputeReserveUsd;
  return {
    netToSeller: breakdown.netToSeller,
    totalFees,
    breakdown,
  };
}

/**
 * Return a human-readable summary of a fee breakdown.
 */
export function formatFeeBreakdown(breakdown: FeeBreakdown): string {
  const pct = (n: number) => `${(n * 100).toFixed(2)}%`;
  const usd = (n: number) => `$${n.toFixed(4)}`;

  return [
    `Gross Amount:      ${usd(breakdown.grossAmount)}`,
    `Platform Fee:      ${usd(breakdown.platformFeeUsd)} (${pct(breakdown.platformFeePct)})`,
    `Network Fee:       ${usd(breakdown.networkFeeUsd)} (fixed)`,
    `Dispute Reserve:   ${usd(breakdown.disputeReserveUsd)} (${pct(breakdown.disputeReservePct)})`,
    `Net to Seller:     ${usd(breakdown.netToSeller)}`,
    `Net to Protocol:   ${usd(breakdown.netToProtocol)}`,
  ].join('\n');
}
