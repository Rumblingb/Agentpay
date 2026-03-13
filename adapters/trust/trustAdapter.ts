import type { AgentPassport } from '../../interfaces/passport';
import type { TrustScoreResponse } from '../../interfaces/trust';

// Adapter facade for trust-related calls. Currently delegates to local
// implementation. After split, this module will call private services.

export async function getTrustScore(agentId: string): Promise<TrustScoreResponse | null> {
  try {
    // Prefer dashboard demo lookup when available
    const mod = await import('../../dashboard/lib/trust-logic');
    const res = mod.lookupAgentScore(agentId);
    if (!res) return null;
    return { agentId, trustScore: res.score } as TrustScoreResponse;
  } catch (err) {
    // Fallback: return null if underlying implementation is not accessible
    return null;
  }
}

export async function formatPassportForUI(p: AgentPassport) {
  // adapter may enrich or translate fields later
  return p;
}
