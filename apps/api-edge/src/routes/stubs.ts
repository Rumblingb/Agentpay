/**
 * Deferred routes — endpoints that are on the roadmap but not yet migrated
 * to the Workers runtime.
 *
 * Rules:
 *   - Returns 503 with a JSON body so callers get a clear, actionable message.
 *   - Never returns 200 with an error body (that pattern masks failures in SDKs).
 *   - Removed/deprecated routes return 410 Gone.
 *   - Each stub documents when it will be implemented.
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../types';

const router = new Hono<{ Bindings: Env; Variables: Variables }>();

const deferred = (feature: string, eta?: string) =>
  new Response(
    JSON.stringify({
      error: 'NOT_YET_AVAILABLE',
      feature,
      message: `${feature} is not yet available. ${eta ? `Expected: ${eta}.` : 'Check the changelog for updates.'}`,
      docs: 'https://github.com/Rumblingb/Agentpay/tree/main/docs',
    }),
    { status: 503, headers: { 'content-type': 'application/json' } },
  );

const removed = (reason: string) =>
  new Response(
    JSON.stringify({
      error: 'ENDPOINT_REMOVED',
      message: reason,
      docs: 'https://github.com/Rumblingb/Agentpay/tree/main/docs',
    }),
    { status: 410, headers: { 'content-type': 'application/json' } },
  );

// ── Foundation agents — constitutional layer (Phase 2 migration) ──────────────
//
// These agents exist in the Node.js backend but are not yet on the Workers
// runtime. GET manifest is served live; POST actions return 503 until migrated.
//
// Manifest: GET /api/foundation-agents
router.get('/api/foundation-agents', (c) =>
  c.json({
    foundationAgents: [
      {
        id: 'identity_verifier_001',
        name: 'IdentityVerifierAgent',
        layer: 'constitutional',
        description: 'Agent identity attestation and credential issuance',
        status: 'beta_pending',
        endpoint: '/api/foundation-agents/identity',
        actions: ['verify', 'link', 'verify_credential', 'get_identity'],
        pricing: { basic: '$10', advanced: '$50' },
        eta: 'Phase 2',
      },
      {
        id: 'reputation_oracle_001',
        name: 'ReputationOracleAgent',
        layer: 'constitutional',
        description: 'Trust score queries from the AgentRank graph',
        status: 'beta_pending',
        endpoint: '/api/foundation-agents/reputation',
        actions: ['get_reputation', 'compare', 'get_trust_score', 'batch_lookup'],
        note: 'Use GET /api/passport/:agentId for free trust lookups today.',
        pricing: { basic: '$1', standard: '$3', comprehensive: '$5' },
        eta: 'Phase 2',
      },
      {
        id: 'dispute_resolver_001',
        name: 'DisputeResolverAgent',
        layer: 'constitutional',
        description: 'Structured dispute resolution for A2A transactions',
        status: 'beta_pending',
        endpoint: '/api/foundation-agents/dispute',
        actions: ['file_dispute', 'submit_evidence', 'resolve_dispute', 'get_case', 'get_history'],
        pricing: { small: '$50', medium: '$100', large: '$250', enterprise: '$500' },
        eta: 'Phase 2',
      },
      {
        id: 'intent_coordinator_001',
        name: 'IntentCoordinatorAgent',
        layer: 'constitutional',
        description: 'Multi-protocol payment routing across Solana, Stripe, x402, AP2',
        status: 'beta_pending',
        endpoint: '/api/foundation-agents/intent',
        note: 'Use POST /api/v1/payment-intents for Solana USDC intents today.',
        actions: ['create_intent', 'get_status', 'recommend_route'],
        pricing: { instant: '$1.00', fast: '$0.50', standard: '$0.25' },
        eta: 'Phase 2',
      },
    ],
    _note: 'Foundation agents are in beta. Core payment and passport APIs are fully live.',
    _docs: 'https://app.agentpay.so/docs',
  }),
);

// Action endpoints return 503 until Workers migration is complete
router.post('/api/foundation-agents/:agent', () =>
  deferred('Foundation agent actions', 'Phase 2'),
);

// ── Deferred: escrow stats requires in-memory state not yet migrated ──────────
router.get('/api/escrow/stats', () =>
  deferred('A2A escrow statistics', 'Phase 2'),
);

// ── Removed: internal test endpoints not for public use ───────────────────────
router.post('/api/test-tip', () =>
  removed('This was an internal test endpoint and has been removed.'),
);

// ── Removed: Prometheus metrics not applicable in Cloudflare Workers ──────────
// Use Cloudflare Analytics in the dashboard instead.
router.get('/metrics', () =>
  removed('Prometheus metrics are not available in the Workers runtime. Use Cloudflare Analytics.'),
);

export { router as stubsRouter };
