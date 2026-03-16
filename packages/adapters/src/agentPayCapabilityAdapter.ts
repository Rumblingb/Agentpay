import { AgentPayClient } from '../../sdk/src/index.js';
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
    } else if (opts.auth?.apiKey) {
      this.client = new AgentPayClient({ auth: opts.auth, baseUrl: opts.baseUrl });
    } else {
      this.client = AgentPayClient.fromEnv();
    }
    this.webhookHandler = opts.webhookHandler;
    this.passportProvider = opts.passportProvider;
  }

  async createPayment(intent: AgentPayCapabilityIntent) {
    return this.client.pay(intent);
  }

  async verifyPayment(paymentId: string, txHash: string) {
    return this.client.verifyPayment(paymentId, txHash);
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
