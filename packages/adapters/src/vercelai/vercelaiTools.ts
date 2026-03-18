/**
 * Vercel AI SDK adapter for AgentPay
 *
 * Converts AgentPay capabilities into Vercel AI SDK tool format.
 * Compatible with `ai` package ≥3.0 (tool() / CoreTool shape).
 *
 * Usage:
 *   import { toVercelAITools } from '@agentpayxyz/adapters/vercelai';
 *   import { generateText } from 'ai';
 *
 *   const { text } = await generateText({
 *     model: openai('gpt-4o'),
 *     tools: toVercelAITools(adapter),
 *     prompt: 'Create a $5 payment for translation work',
 *   });
 */

import type { AgentPayCapability } from '../types.js';
import { registerAgentPayTools } from '../tools/registry.js';
import { executeAgentPayTool } from '../tools/executor.js';
import type { AgentPayToolName, AgentPayToolInputByName } from '../tools/contracts.js';

/** Vercel AI SDK CoreTool shape (without zod dependency) */
export type VercelAITool = {
  description: string;
  parameters: Record<string, unknown>;   // JSON Schema object — Vercel AI accepts plain JSON schema
  execute: (args: Record<string, unknown>) => Promise<unknown>;
};

/**
 * Returns a Record<toolName, VercelAITool> for direct use in Vercel AI SDK
 * `generateText`, `streamText`, etc.
 */
export function toVercelAITools(
  adapter: AgentPayCapability,
): Record<string, VercelAITool> {
  const tools: Record<string, VercelAITool> = {};

  for (const def of registerAgentPayTools(adapter)) {
    tools[def.name] = {
      description: def.description,
      parameters:  def.inputSchema as Record<string, unknown>,
      execute: async (args: Record<string, unknown>) => {
        try {
          return await executeAgentPayTool(
            def.name as AgentPayToolName,
            args as AgentPayToolInputByName[AgentPayToolName],
            adapter,
          );
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    };
  }

  return tools;
}
