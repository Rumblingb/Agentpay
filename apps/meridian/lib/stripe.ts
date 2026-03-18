/**
 * Stripe PaymentSheet wrapper for the Bro app.
 *
 * Requires EAS dev build or production build — not compatible with standard Expo Go
 * because @stripe/stripe-react-native uses native modules.
 *
 * Usage:
 *   const { clientSecret } = await createStripeSession({ amountUsdc: 2.50 });
 *   await showPaymentSheet(clientSecret);  // throws if user cancels or payment fails
 */

import { initPaymentSheet, presentPaymentSheet } from '@stripe/stripe-react-native';

/**
 * Initialise and present the Stripe PaymentSheet.
 * Resolves on success, throws on cancel or failure.
 */
export async function showPaymentSheet(clientSecret: string): Promise<void> {
  const { error: initError } = await initPaymentSheet({
    paymentIntentClientSecret: clientSecret,
    merchantDisplayName: 'AgentPay · Bro',
    style: 'alwaysDark',
    appearance: {
      colors: {
        primary:          '#4ade80',
        background:       '#0d0d0d',
        componentBackground: '#1a1a1a',
        componentBorder:  '#374151',
        componentDivider: '#1f2937',
        primaryText:      '#f9fafb',
        secondaryText:    '#6b7280',
        componentText:    '#f9fafb',
        placeholderText:  '#4b5563',
        icon:             '#6b7280',
        error:            '#f87171',
      },
      shapes: {
        borderRadius:     14,
        borderWidth:      1,
      },
    },
  });

  if (initError) throw new Error(initError.message);

  const { error: presentError } = await presentPaymentSheet();
  if (presentError) {
    if (presentError.code === 'Canceled') throw new Error('Payment cancelled');
    throw new Error(presentError.message);
  }
}
