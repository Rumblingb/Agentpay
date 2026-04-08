/**
 * Settlement rail router — resolves the correct payment rail for a given
 * currency and optional country code.
 *
 * The approval engine is currency-agnostic; this function is the single place
 * where "which processor handles this payment" is decided. Routes that
 * previously hard-coded Stripe vs Razorpay vs Airwallex should call this
 * instead of branching inline.
 *
 * Precedence:
 *   1. Currency — most currencies map uniquely to one rail.
 *   2. Country  — used as a tiebreaker (e.g. KES is M-Pesa, not Airwallex).
 *   3. Default  — Stripe for everything not explicitly mapped.
 *
 * Adding a new rail:
 *   1. Add the Rail literal to the type.
 *   2. Add currency / country mappings below.
 *   3. Update the Env bindings and wrangler secrets as needed.
 */

export type Rail = 'stripe' | 'razorpay' | 'airwallex' | 'mpesa';

export interface RailRoute {
  rail: Rail;
  /** Normalised ISO 4217 currency code to use with the chosen rail. */
  currency: string;
}

/** APAC currencies best served by Airwallex. */
const AIRWALLEX_CURRENCIES = new Set(['MYR', 'SGD', 'HKD', 'AUD', 'JPY', 'THB', 'PHP', 'IDR', 'VND']);

/** East Africa M-Pesa countries. */
const MPESA_COUNTRIES = new Set(['KE', 'TZ', 'UG', 'RW']);

/**
 * Returns the settlement rail and canonical currency for a given payment.
 *
 * @param currency  ISO 4217 code (e.g. 'GBP', 'INR', 'KES')
 * @param country   ISO 3166-1 alpha-2 code (optional tiebreaker, e.g. 'KE')
 */
export function resolveSettlementRail(currency: string, country?: string): RailRoute {
  const ccy = currency.toUpperCase().trim();
  const ctry = (country ?? '').toUpperCase().trim();

  // India — always Razorpay (UPI)
  if (ccy === 'INR') {
    return { rail: 'razorpay', currency: 'INR' };
  }

  // East Africa — M-Pesa
  if (ccy === 'KES' || MPESA_COUNTRIES.has(ctry)) {
    return { rail: 'mpesa', currency: ccy || 'KES' };
  }

  // APAC — Airwallex handles local wallet and card rails better than Stripe
  if (AIRWALLEX_CURRENCIES.has(ccy)) {
    return { rail: 'airwallex', currency: ccy };
  }

  // Default — Stripe for GBP, EUR, USD, CAD, CHF, SEK, NOK, DKK, PLN, CZK, ...
  return { rail: 'stripe', currency: ccy };
}
