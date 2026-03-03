/**
 * examples/solana-agent-kit/agentpay-action.ts
 *
 * Custom action for Solana Agent Kit / LangChain integration.
 * Enables AI agents to make HTTP 402 payments via AgentPay.
 *
 * Usage with Solana Agent Kit:
 *   import { agentPayAction } from './agentpay-action';
 *   agent.registerAction(agentPayAction);
 *
 * Usage with LangChain:
 *   import { AgentPayTool } from './agentpay-action';
 *   const tools = [new AgentPayTool({ apiKey: 'YOUR_KEY' })];
 *
 * Prerequisites:
 *   npm install axios @solana/web3.js
 */

import axios from 'axios';

interface AgentPayConfig {
  apiKey: string;
  baseUrl?: string;
}

interface PaymentRequest {
  amountUsdc: number;
  recipientAddress: string;
  metadata?: Record<string, any>;
  tokenMint?: string;
}

interface PaymentResult {
  success: boolean;
  transactionId: string;
  paymentId: string;
  amount: number;
  recipientAddress: string;
}

interface VerifyResult {
  success: boolean;
  verified: boolean;
  payer?: string;
  certificate?: string;
  message: string;
}

/**
 * AgentPay client for Solana Agent Kit / LangChain actions.
 */
export class AgentPayClient {
  private apiKey: string;
  private baseUrl: string;

  constructor(config: AgentPayConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || 'http://localhost:3001';
  }

  private get headers() {
    return {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    };
  }

  /**
   * Create a payment request (HTTP 402 flow).
   */
  async createPayment(request: PaymentRequest): Promise<PaymentResult> {
    const response = await axios.post(
      `${this.baseUrl}/api/merchants/payments`,
      request,
      { headers: this.headers }
    );
    return response.data;
  }

  /**
   * Verify a Solana transaction for a payment.
   */
  async verifyPayment(transactionId: string, txHash: string): Promise<VerifyResult> {
    const response = await axios.post(
      `${this.baseUrl}/api/merchants/payments/${transactionId}/verify`,
      { transactionHash: txHash },
      { headers: this.headers }
    );
    return response.data;
  }

  /**
   * Get merchant stats (transaction volume, counts).
   */
  async getStats(): Promise<any> {
    const response = await axios.get(
      `${this.baseUrl}/api/merchants/stats`,
      { headers: this.headers }
    );
    return response.data;
  }

  /**
   * Register a bot on Moltbook.
   */
  async registerBot(handle: string, options?: {
    display_name?: string;
    bio?: string;
    primary_function?: string;
  }): Promise<any> {
    const response = await axios.post(
      `${this.baseUrl}/api/moltbook/bots/register`,
      { handle, ...options },
      { headers: this.headers }
    );
    return response.data;
  }
}

/**
 * Solana Agent Kit action definition for AgentPay.
 *
 * Register with: agent.registerAction(agentPayAction);
 */
export const agentPayAction = {
  name: 'agentpay_payment',
  description: 'Make a USDC payment via AgentPay HTTP 402 protocol on Solana',
  parameters: {
    type: 'object',
    properties: {
      amountUsdc: { type: 'number', description: 'Amount in USDC' },
      recipientAddress: { type: 'string', description: 'Solana wallet address' },
      purpose: { type: 'string', description: 'Payment purpose/reason' },
    },
    required: ['amountUsdc', 'recipientAddress'],
  },
  execute: async (params: any, context: any) => {
    const client = new AgentPayClient({
      apiKey: context.env?.AGENTPAY_API_KEY || process.env.AGENTPAY_API_KEY || '',
      baseUrl: context.env?.AGENTPAY_URL || process.env.AGENTPAY_URL,
    });

    const payment = await client.createPayment({
      amountUsdc: params.amountUsdc,
      recipientAddress: params.recipientAddress,
      metadata: { purpose: params.purpose, agent: context.agentId },
    });

    return {
      status: 'payment_created',
      paymentId: payment.paymentId,
      transactionId: payment.transactionId,
      amount: payment.amount,
      instructions: 'Send USDC to the recipient address, then verify the transaction.',
    };
  },
};

/**
 * LangChain-compatible tool for AgentPay.
 *
 * Usage:
 *   const tool = new AgentPayTool({ apiKey: 'YOUR_KEY' });
 *   const result = await tool.call({ amountUsdc: 1, recipientAddress: '...' });
 */
export class AgentPayTool {
  name = 'agentpay';
  description = 'Make USDC payments on Solana via AgentPay HTTP 402 protocol';
  private client: AgentPayClient;

  constructor(config: AgentPayConfig) {
    this.client = new AgentPayClient(config);
  }

  async call(input: { amountUsdc: number; recipientAddress: string; purpose?: string }) {
    const result = await this.client.createPayment({
      amountUsdc: input.amountUsdc,
      recipientAddress: input.recipientAddress,
      metadata: input.purpose ? { purpose: input.purpose } : undefined,
    });
    return JSON.stringify(result);
  }
}
