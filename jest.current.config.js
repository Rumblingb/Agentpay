import baseConfig from './jest.config.js';

// Current supported Jest gate.
//
// The files below target the legacy root Express app in `src/` or are Vitest
// suites. They currently fail under the CommonJS Jest runtime with ESM parsing
// errors, while the canonical Workers/API Edge, MCP, docs, and demo surfaces
// are covered by the remaining Jest suites plus the dedicated Vitest config.
// Keep the full historical sweep available through `npm run test:all`.
const legacyOrWrongRunnerSuites = [
  '/apps/api-edge/tests/',
  '/tests/agent-network-routes.test.ts',
  '/tests/agentrank-route.test.ts',
  '/tests/api-status.test.ts',
  '/tests/e2e/payment-simulation.e2e.test.ts',
  '/tests/e2e/protocol.e2e.test.ts',
  '/tests/escrow-route.test.ts',
  '/tests/integration.test.ts',
  '/tests/leaderboard-marketplace.test.ts',
  '/tests/legal-metrics.test.ts',
  '/tests/marketplace-hire-feed.test.ts',
  '/tests/protocols.test.ts',
  '/tests/reputation.test.ts',
  '/tests/routes/admin.settlement-mismatches.test.ts',
  '/tests/routes/agentIdentity.test.ts',
  '/tests/routes/agentInteract.test.ts',
  '/tests/routes/certificates.test.ts',
  '/tests/routes/delegation.test.ts',
  '/tests/routes/fiat.test.ts',
  '/tests/routes/kya.test.ts',
  '/tests/routes/receipt.test.ts',
  '/tests/routes/stripeWebhooks.test.ts',
  '/tests/routes/verify.test.ts',
  '/tests/routes/wallets.test.ts',
  '/tests/security/authMiddleware.test.ts',
  '/tests/stripe.test.ts',
  '/tests/unit/intentResolutionEngine.test.ts',
  '/tests/unit/merchantPaymentUuid.test.ts',
  '/tests/unit/merchantStripeConnect.test.ts',
  '/tests/unit/new-features.test.ts',
  '/tests/unit/v1Intents.test.ts',
  '/tests/v1-trust-events.test.ts',
  '/tests/webhooks.api.test.ts',
];

export default {
  ...baseConfig,
  testPathIgnorePatterns: [
    ...(baseConfig.testPathIgnorePatterns ?? []),
    ...legacyOrWrongRunnerSuites,
  ],
};
