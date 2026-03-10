/**
 * Foundation Agents — barrel export
 *
 * Re-exports all four constitutional layer agent handlers so the route file
 * (and any future SDK) can import from a single path.
 */

export {
  identityVerifierAgent,
  handleIdentityVerification,
} from './IdentityVerifierAgent.js';

export {
  reputationOracleAgent,
  handleReputationQuery,
} from './ReputationOracleAgent.js';

export {
  disputeResolverAgent,
  handleDisputeResolution,
} from './DisputeResolverAgent.js';

export {
  intentCoordinatorAgent,
  handleIntentCoordination,
} from './IntentCoordinatorAgent.js';
