// Thin OpenGPT-style wrapper for AgentPay tools.
// This module translates between a function-calling/tool schema surface and
// the underlying tool client (the PR10 tool-contract layer). It intentionally
// does not implement business logic — it simply routes requests.

export type ToolClient = {
  create_payment: (params: { merchantId: string; amountUsdc: number; recipientAddress: string; metadata?: any }) => Promise<any>;
  verify_payment: (params: { transactionId: string; transactionHash: string }) => Promise<any>;
  handle_webhook: (params: { payload: any; signature?: string }) => Promise<any>;
  get_passport?: (params: { agentId: string }) => Promise<any>;
};

export type OpenGptTool = {
  name: string;
  description: string;
  parameters?: Record<string, any>; // JSON Schema-ish
  run: (args: any) => Promise<any>;
};

export function getOpenGptTools(toolClient: ToolClient): OpenGptTool[] {
  return [
    {
      name: 'create_payment',
      description: 'Create a payment intent for a merchant (USDC).',
      parameters: {
        type: 'object',
        properties: {
          merchantId: { type: 'string' },
          amountUsdc: { type: 'number' },
          recipientAddress: { type: 'string' },
          metadata: { type: 'object' },
        },
        required: ['merchantId', 'amountUsdc', 'recipientAddress'],
      },
      run: async (args: any) => {
        return await toolClient.create_payment({
          merchantId: args.merchantId,
          amountUsdc: args.amountUsdc,
          recipientAddress: args.recipientAddress,
          metadata: args.metadata,
        });
      },
    },
    {
      name: 'verify_payment',
      description: 'Verify a payment by providing transaction id and hash.',
      parameters: {
        type: 'object',
        properties: {
          transactionId: { type: 'string' },
          transactionHash: { type: 'string' },
        },
        required: ['transactionId', 'transactionHash'],
      },
      run: async (args: any) => {
        return await toolClient.verify_payment({ transactionId: args.transactionId, transactionHash: args.transactionHash });
      },
    },
    {
      name: 'handle_webhook',
      description: 'Deliver a webhook payload to the AgentPay webhook handler (useful for async notifications).',
      parameters: {
        type: 'object',
        properties: { payload: { type: ['object', 'string'] }, signature: { type: 'string' } },
        required: ['payload'],
      },
      run: async (args: any) => {
        return await toolClient.handle_webhook({ payload: args.payload, signature: args.signature });
      },
    },
    {
      name: 'get_passport',
      description: 'Retrieve an AgentPassport for an agent (optional).',
      parameters: {
        type: 'object',
        properties: { agentId: { type: 'string' } },
        required: ['agentId'],
      },
      run: async (args: any) => {
        if (typeof toolClient.get_passport !== 'function') throw new Error('get_passport not implemented by provided tool client');
        return await toolClient.get_passport!({ agentId: args.agentId });
      },
    },
  ];
}

export default {
  getOpenGptTools,
};
