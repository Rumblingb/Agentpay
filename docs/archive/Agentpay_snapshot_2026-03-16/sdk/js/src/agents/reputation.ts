import { HttpClient } from '../http.js';
import type { AgentPayConfig } from '../types.js';

export interface ReputationScore {
  agentId: string;
  score: number;
  totalTransactions: number;
  successRate: number;
}

/** Fetch reputation score for an agent. */
export async function getReputation(
  config: AgentPayConfig,
  agentId: string,
): Promise<ReputationScore> {
  const client = new HttpClient(config.baseUrl, config.apiKey, config.timeoutMs);
  return client.get<ReputationScore>(`/api/agents/${encodeURIComponent(agentId)}/reputation`);
}
