import { Router, Response } from 'express';
import { authenticateApiKey, type AuthRequest } from '../middleware/auth.js';
import {
  handleIdentityVerification,
  handleReputationQuery,
  handleDisputeResolution,
  handleIntentCoordination,
} from '../agents/index.js';

const router = Router();

/**
 * GET /api/foundation-agents
 *
 * Public discovery manifest — lists all 4 constitutional agents with their
 * endpoints, actions, and pricing. No auth required (read-only).
 */
router.get('/', (_req: AuthRequest, res: Response) => {
  res.json({
    foundationAgents: [
      {
        id: 'identity_verifier_001',
        name: 'IdentityVerifierAgent',
        layer: 'constitutional',
        description: 'Agent identity attestation & verification',
        endpoint: '/api/foundation-agents/identity',
        actions: ['verify', 'link', 'verify_credential', 'get_identity'],
        pricing: { basic: '$10', advanced: '$50' },
      },
      {
        id: 'reputation_oracle_001',
        name: 'ReputationOracleAgent',
        layer: 'constitutional',
        description: 'Trust score queries from the reputation graph',
        endpoint: '/api/foundation-agents/reputation',
        actions: ['get_reputation', 'compare', 'get_trust_score', 'batch_lookup'],
        pricing: { basic: '$1', standard: '$3', comprehensive: '$5' },
      },
      {
        id: 'dispute_resolver_001',
        name: 'DisputeResolverAgent',
        layer: 'constitutional',
        description: 'Structured dispute resolution for agent transactions',
        endpoint: '/api/foundation-agents/dispute',
        actions: ['file_dispute', 'submit_evidence', 'resolve_dispute', 'get_case', 'get_history'],
        pricing: { small: '$50', medium: '$100', large: '$250', enterprise: '$500' },
      },
      {
        id: 'intent_coordinator_001',
        name: 'IntentCoordinatorAgent',
        layer: 'constitutional',
        description: 'Multi-protocol transaction routing & coordination',
        endpoint: '/api/foundation-agents/intent',
        actions: ['create_intent', 'get_status', 'recommend_route'],
        pricing: { instant: '$1.00', fast: '$0.50', standard: '$0.25' },
      },
    ],
  });
});

/**
 * POST /api/foundation-agents/identity
 *
 * Actions: verify | link | verify_credential | get_identity
 *
 * Requires merchant API key auth. Fee-bearing actions (verify, link) use the
 * authenticated merchant ID as the billing operator.
 */
router.post(
  '/identity',
  authenticateApiKey,
  (req: AuthRequest, res: Response) => handleIdentityVerification(req, res),
);

/**
 * POST /api/foundation-agents/reputation
 *
 * Actions: get_reputation | compare | get_trust_score | batch_lookup
 *
 * Requires merchant API key auth. All actions charge a query fee against the
 * authenticated merchant's account.
 */
router.post(
  '/reputation',
  authenticateApiKey,
  (req: AuthRequest, res: Response) => handleReputationQuery(req, res),
);

/**
 * POST /api/foundation-agents/dispute
 *
 * Actions: file_dispute | submit_evidence | resolve_dispute | get_case | get_history
 *
 * Requires merchant API key auth. Filing a dispute charges a fee and requires
 * the authenticated merchant to be a party to the referenced transaction.
 */
router.post(
  '/dispute',
  authenticateApiKey,
  (req: AuthRequest, res: Response) => handleDisputeResolution(req, res),
);

/**
 * POST /api/foundation-agents/intent
 *
 * Actions: create_intent | get_status | recommend_route
 *
 * Requires merchant API key auth. create_intent charges a coordination fee.
 */
router.post(
  '/intent',
  authenticateApiKey,
  (req: AuthRequest, res: Response) => handleIntentCoordination(req, res),
);

export default router;
