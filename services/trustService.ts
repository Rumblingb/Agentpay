import { getTrustScore } from '../adapters/trust/trustAdapter';
import type { TrustScoreResponse } from '../interfaces/trust';

export async function lookupTrust(agentId: string): Promise<TrustScoreResponse | null> {
  return getTrustScore(agentId);
}
