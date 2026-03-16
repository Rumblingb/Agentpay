import type {
  Payment,
  PaymentCreateRequest,
  PaymentVerificationResult,
} from '../../sdk/src/index.js';

export type AgentPayCapabilityIntent = PaymentCreateRequest;

export type AdapterWebhookEvent = {
  type: string;
  payload: unknown;
  signature?: string;
  receivedAt?: string;
};

export type AdapterWebhookResult = {
  accepted: boolean;
  handled: boolean;
  eventType: string;
  verification?: PaymentVerificationResult;
};

export type AgentPassport = {
  agentId: string;
  attachedAt: string;
  metadata?: Record<string, string>;
};

export type PassportProvider = {
  getPassport?: (agentId: string) => Promise<AgentPassport | null>;
  attachPassport?: (agentId: string) => Promise<AgentPassport>;
};

export type AdapterWebhookHandler = (
  event: AdapterWebhookEvent,
) => Promise<AdapterWebhookResult>;

export interface AgentPayCapability {
  createPayment(intent: AgentPayCapabilityIntent): Promise<Payment>;
  verifyPayment(
    paymentId: string,
    txHash: string,
  ): Promise<PaymentVerificationResult>;
  handleWebhook(event: AdapterWebhookEvent): Promise<AdapterWebhookResult>;
  getPassport?(agentId: string): Promise<AgentPassport | null>;
  attachPassport?(agentId: string): Promise<AgentPassport>;
}
