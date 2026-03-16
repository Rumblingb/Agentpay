import type { AgentPayCapability } from '../types.js';
import type {
  AgentPayToolInputByName,
  AgentPayToolName,
  AgentPayToolResult,
} from './contracts.js';

export async function executeAgentPayTool<TName extends AgentPayToolName>(
  name: TName,
  input: AgentPayToolInputByName[TName],
  adapter: AgentPayCapability,
): Promise<AgentPayToolResult<TName>> {
  switch (name) {
    case 'create_payment': {
      const typedInput = input as AgentPayToolInputByName['create_payment'];
      return { ok: true, payment: await adapter.createPayment(typedInput.intent) } as AgentPayToolResult<TName>;
    }
    case 'verify_payment': {
      const typedInput = input as AgentPayToolInputByName['verify_payment'];
      return {
        ok: true,
        verification: await adapter.verifyPayment(typedInput.paymentId, typedInput.txHash),
      } as AgentPayToolResult<TName>;
    }
    case 'handle_webhook': {
      const typedInput = input as AgentPayToolInputByName['handle_webhook'];
      return { ok: true, webhook: await adapter.handleWebhook(typedInput.event) } as AgentPayToolResult<TName>;
    }
    case 'get_passport': {
      const typedInput = input as AgentPayToolInputByName['get_passport'];
      return {
        ok: true,
        passport: adapter.getPassport ? await adapter.getPassport(typedInput.agentId) : null,
      } as AgentPayToolResult<TName>;
    }
    default:
      throw new Error(`Unsupported AgentPay tool: ${name}`);
  }
}
