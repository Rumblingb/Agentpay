import type { AgentPayCapability } from '../types.js';
import type {
  AgentPayToolDefinition,
  AgentPayToolName,
  JsonSchema,
} from './contracts.js';

const createPaymentInputSchema: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    intent: {
      type: 'object',
      description: 'Payment intent payload accepted by createPayment(intent).',
    },
  },
  required: ['intent'],
};

const verifyPaymentInputSchema: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    paymentId: { type: 'string', description: 'AgentPay payment id.' },
    txHash: { type: 'string', description: 'On-chain transaction hash.' },
  },
  required: ['paymentId', 'txHash'],
};

const handleWebhookInputSchema: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    event: {
      type: 'object',
      description: 'Webhook envelope with type, payload, and optional signature.',
    },
  },
  required: ['event'],
};

const getPassportInputSchema: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    agentId: { type: 'string', description: 'Agent identifier.' },
  },
  required: ['agentId'],
};

export function registerAgentPayTools(
  adapter: AgentPayCapability,
): AgentPayToolDefinition<AgentPayToolName>[] {
  const definitions: AgentPayToolDefinition<AgentPayToolName>[] = [
    {
      name: 'create_payment',
      description: 'Create a payment intent with AgentPay.',
      inputSchema: createPaymentInputSchema,
    },
    {
      name: 'verify_payment',
      description: 'Verify a payment against transaction hash.',
      inputSchema: verifyPaymentInputSchema,
    },
    {
      name: 'handle_webhook',
      description: 'Handle a webhook event using adapter webhook handling.',
      inputSchema: handleWebhookInputSchema,
    },
  ];

  if (adapter.getPassport) {
    definitions.push({
      name: 'get_passport',
      description: 'Fetch AgentPassport metadata for an agent.',
      inputSchema: getPassportInputSchema,
    });
  }

  return definitions;
}
