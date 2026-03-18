import type {
  AdapterWebhookEvent,
  AdapterWebhookResult,
  AgentPassport,
  AgentPayCapabilityIntent,
} from '../types.js';
import type { Payment, PaymentVerificationResult } from '../types.js';

export type AgentPayToolName =
  | 'create_payment'
  | 'verify_payment'
  | 'handle_webhook'
  | 'get_passport';

export type JsonSchema = {
  type: 'object';
  additionalProperties?: boolean;
  properties: Record<string, { type: string; description?: string }>;
  required?: string[];
};

export type CreatePaymentToolInput = { intent: AgentPayCapabilityIntent };
export type VerifyPaymentToolInput = { paymentId: string; txHash: string };
export type HandleWebhookToolInput = { event: AdapterWebhookEvent };
export type GetPassportToolInput = { agentId: string };

export type AgentPayToolInputByName = {
  create_payment: CreatePaymentToolInput;
  verify_payment: VerifyPaymentToolInput;
  handle_webhook: HandleWebhookToolInput;
  get_passport: GetPassportToolInput;
};

export type AgentPayToolOutputByName = {
  create_payment: { ok: true; payment: Payment };
  verify_payment: { ok: true; verification: PaymentVerificationResult };
  handle_webhook: { ok: true; webhook: AdapterWebhookResult };
  get_passport: { ok: true; passport: AgentPassport | null };
};

export type AgentPayToolResult<TName extends AgentPayToolName> =
  AgentPayToolOutputByName[TName];

export type AgentPayToolDefinition<TName extends AgentPayToolName> = {
  name: TName;
  description: string;
  inputSchema: JsonSchema;
};
