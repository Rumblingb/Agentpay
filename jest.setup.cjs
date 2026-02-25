require('dotenv').config();

// Enable test-mode features (force-verify endpoint, Solana bypass).
// Gated in src/server.ts by NODE_ENV==='test' && AGENTPAY_TEST_MODE==='true'.
process.env.AGENTPAY_TEST_MODE = 'true';

// Stripe requires a non-empty API key to instantiate even in test mode.
// Provide a dummy key so the module loads without throwing.
if (!process.env.STRIPE_SECRET_KEY) {
  process.env.STRIPE_SECRET_KEY = 'sk_test_placeholder_for_tests';
}
