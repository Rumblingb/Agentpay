import { AgentPay as AgentPayClient } from '@agentpayxyz/sdk';
import type {
  AdapterWebhookEvent,
  AdapterWebhookHandler,
  AdapterWebhookResult,
  AgentPassport,
  AgentPayCapability,
  AgentPayCapabilityIntent,
  PassportProvider,
} from './types.js';

export type AgentPayCapabilityAdapterOptions = {
  client?: AgentPayClient;
  auth?: { apiKey: string };
  baseUrl?: string;
  webhookHandler?: AdapterWebhookHandler;
  passportProvider?: PassportProvider;
};

export class AgentPayCapabilityAdapter implements AgentPayCapability {
  private readonly client: AgentPayClient;
  private readonly webhookHandler?: AdapterWebhookHandler;
  private readonly passportProvider?: PassportProvider;

  constructor(opts: AgentPayCapabilityAdapterOptions) {
    if (opts.client) {
      this.client = opts.client;
    } else {
      const baseUrl = opts.baseUrl ?? (typeof process !== 'undefined' ? process.env.AGENTPAY_BASE_URL ?? 'https://api.agentpay.so' : 'https://api.agentpay.so');
      const apiKey = opts.auth?.apiKey ?? (typeof process !== 'undefined' ? process.env.AGENTPAY_API_KEY ?? '' : '');
      this.client = new AgentPayClient({ baseUrl, apiKey });
    }
    this.webhookHandler = opts.webhookHandler;
    this.passportProvider = opts.passportProvider;
  }

  async createPayment(intent: AgentPayCapabilityIntent) {
    return this.client.pay(intent);
  }

  async verifyPayment(intentId: string, _txHash: string) {
    return this.client.verify(intentId);
  }

  async handleWebhook(event: AdapterWebhookEvent): Promise<AdapterWebhookResult> {
    if (this.webhookHandler) {
      return this.webhookHandler(event);
    }

    return {
      accepted: true,
      handled: false,
      eventType: event.type,
    };
  }

  async getPassport(agentId: string): Promise<AgentPassport | null> {
    if (!this.passportProvider?.getPassport) {
      return null;
    }

    return this.passportProvider.getPassport(agentId);
  }

  async attachPassport(agentId: string): Promise<AgentPassport> {
    if (!this.passportProvider?.attachPassport) {
      return {
        agentId,
        attachedAt: new Date().toISOString(),
      };
    }

    return this.passportProvider.attachPassport(agentId);
  }
}

export function createAgentPayCapability(
  opts: AgentPayCapabilityAdapterOptions,
): AgentPayCapability {
  return new AgentPayCapabilityAdapter(opts);
}
