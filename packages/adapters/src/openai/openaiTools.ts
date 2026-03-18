/**
 * OpenAI function-calling adapter for AgentPay
 *
 * Converts AgentPay tool definitions into the OpenAI ChatCompletionTool format
 * and provides a dispatcher to execute tool calls from OpenAI response chunks.
 *
 * Usage:
 *   import { toOpenAITools, dispatchOpenAIToolCall } from '@agentpayxyz/adapters/openai';
 *
 *   const tools = toOpenAITools(adapter);
 *   const response = await openai.chat.completions.create({ tools, messages, ... });
 *   const result = await dispatchOpenAIToolCall(response.choices[0].message.tool_calls[0], adapter);
 */

import type { AgentPayCapability } from '../types.js';
import { registerAgentPayTools } from '../tools/registry.js';
import { executeAgentPayTool } from '../tools/executor.js';
import type { AgentPayToolName, AgentPayToolInputByName } from '../tools/contracts.js';

/** OpenAI tool definition shape */
export type OpenAITool = {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

/** OpenAI tool_call shape (from response) */
export type OpenAIToolCall = {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
};

/**
 * Convert AgentPay tool definitions to OpenAI ChatCompletionTool format.
 */
export function toOpenAITools(adapter: AgentPayCapability): OpenAITool[] {
  return registerAgentPayTools(adapter).map((def) => ({
    type: 'function' as const,
    function: {
      name: def.name,
      description: def.description,
      parameters: def.inputSchema as Record<string, unknown>,
    },
  }));
}

/**
 * Execute an OpenAI tool_call using the AgentPay adapter.
 * Returns a JSON string suitable for the tool result message.
 */
export async function dispatchOpenAIToolCall(
  toolCall: OpenAIToolCall,
  adapter: AgentPayCapability,
): Promise<string> {
  const name = toolCall.function.name as AgentPayToolName;
  let args: unknown;
  try {
    args = JSON.parse(toolCall.function.arguments);
  } catch {
    return JSON.stringify({ error: 'Invalid tool arguments — not valid JSON' });
  }
  try {
    const result = await executeAgentPayTool(
      name,
      args as AgentPayToolInputByName[typeof name],
      adapter,
    );
    return JSON.stringify(result);
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
  }
}
