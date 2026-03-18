/**
 * LangChain adapter for AgentPay
 *
 * Converts AgentPay capabilities into LangChain-compatible tool objects
 * (the StructuredTool / DynamicStructuredTool interface shape).
 *
 * Works without importing LangChain — returns plain objects matching
 * the DynamicStructuredTool constructor signature so callers can pass
 * them directly:
 *
 *   import { DynamicStructuredTool } from '@langchain/core/tools';
 *   import { toLangChainToolConfigs } from '@agentpayxyz/adapters/langchain';
 *
 *   const tools = toLangChainToolConfigs(adapter).map(
 *     (cfg) => new DynamicStructuredTool(cfg),
 *   );
 */

import type { AgentPayCapability } from '../types.js';
import { registerAgentPayTools } from '../tools/registry.js';
import { executeAgentPayTool } from '../tools/executor.js';
import type { AgentPayToolName, AgentPayToolInputByName } from '../tools/contracts.js';

/** Config shape matching LangChain DynamicStructuredTool constructor */
export type LangChainToolConfig = {
  name: string;
  description: string;
  schema: Record<string, unknown>;
  func: (input: Record<string, unknown>) => Promise<string>;
};

/**
 * Returns tool config objects for use with LangChain DynamicStructuredTool.
 * Does not import LangChain — caller wraps with their own DynamicStructuredTool.
 */
export function toLangChainToolConfigs(adapter: AgentPayCapability): LangChainToolConfig[] {
  return registerAgentPayTools(adapter).map((def) => ({
    name: def.name,
    description: def.description,
    schema: def.inputSchema as Record<string, unknown>,
    func: async (input: Record<string, unknown>): Promise<string> => {
      try {
        const result = await executeAgentPayTool(
          def.name as AgentPayToolName,
          input as AgentPayToolInputByName[AgentPayToolName],
          adapter,
        );
        return JSON.stringify(result);
      } catch (err) {
        return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  }));
}
