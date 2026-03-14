import { HttpClient } from './http.js';
import type { AgentPayConfig } from './types.js';

/**
 * Minimal Agent helper for demo flows.
 * - Agent.spawn(config, body) → creates agent + demo transaction
 * - instance.hire(...) → hires another agent via marketplace
 * - instance.settle(intentId) → fetches receipt (settlement proof)
 */
export class Agent {
  private readonly client: HttpClient;
  public agentId?: string;

  constructor(config: AgentPayConfig, agentId?: string) {
    this.client = new HttpClient(config.baseUrl, config.apiKey, config.timeoutMs);
    this.agentId = agentId;
  }

  static async spawn(config: AgentPayConfig, body: { displayName?: string; service?: string } = {}) {
    const client = new HttpClient(config.baseUrl, config.apiKey, config.timeoutMs);
    return client.post<any>('/api/demo/spawn-agent', body);
  }

  async hire(agentId: string, amount: number, taskDescription: string, timeoutHours = 72) {
    return this.client.post<any>('/api/marketplace/hire', {
      agentIdToHire: agentId,
      amountUsd: amount,
      taskDescription,
      timeoutHours,
    });
  }

  async settle(intentId: string) {
    return this.client.get<any>(`/api/receipt/${encodeURIComponent(intentId)}`);
  }
}
