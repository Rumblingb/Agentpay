/**
 * App-level constants.
 * Stripe publishable key is EXPO_PUBLIC_ so it's safe to bundle — it's not secret.
 * Set EXPO_PUBLIC_STRIPE_KEY in your EAS build environment.
 */
export const STRIPE_PUBLISHABLE_KEY =
  process.env.EXPO_PUBLIC_STRIPE_KEY ?? 'pk_test_placeholder';
