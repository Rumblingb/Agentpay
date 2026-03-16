// MoltClaw/OpenClaw-style thin wrapper for AgentPay tool contract.
// This module exposes a registration helper and tool bundle that a MoltClaw
// runtime can register. It only translates calls to an injected `toolClient`.

export type ToolClient = {
  create_payment: (params: { merchantId: string; amountUsdc: number; recipientAddress: string; metadata?: any }) => Promise<any>;
  verify_payment: (params: { transactionId: string; transactionHash: string }) => Promise<any>;
  handle_webhook: (params: { payload: any; signature?: string }) => Promise<any>;
  get_passport?: (params: { agentId: string }) => Promise<any>;
};

export type MoltClawTool = {
  id: string; // framework identifier
  title: string;
  schema?: Record<string, any>;
  handler: (payload: any) => Promise<any>;
};

export function createMoltClawTools(toolClient: ToolClient): MoltClawTool[] {
  return [
    {
      id: 'create_payment',
      title: 'Create Payment Intent',
      schema: {
        type: 'object',
        properties: {
          merchantId: { type: 'string' },
          amountUsdc: { type: 'number' },
          recipientAddress: { type: 'string' },
          metadata: { type: 'object' },
        },
        required: ['merchantId', 'amountUsdc', 'recipientAddress'],
      },
      handler: async (payload: any) => {
        return await toolClient.create_payment({
          merchantId: payload.merchantId,
          amountUsdc: payload.amountUsdc,
          recipientAddress: payload.recipientAddress,
          metadata: payload.metadata,
        });
      },
    },
    {
      id: 'verify_payment',
      title: 'Verify Payment',
      schema: {
        type: 'object',
        properties: { transactionId: { type: 'string' }, transactionHash: { type: 'string' } },
        required: ['transactionId', 'transactionHash'],
      },
      handler: async (payload: any) => {
        return await toolClient.verify_payment({ transactionId: payload.transactionId, transactionHash: payload.transactionHash });
      },
    },
    {
      id: 'handle_webhook',
      title: 'Handle Webhook',
      schema: {
        type: 'object',
        properties: { payload: { type: ['object', 'string'] }, signature: { type: 'string' } },
        required: ['payload'],
      },
      handler: async (payload: any) => {
        return await toolClient.handle_webhook({ payload: payload.payload, signature: payload.signature });
      },
    },
    {
      id: 'get_passport',
      title: 'Get AgentPassport (optional)',
      schema: { type: 'object', properties: { agentId: { type: 'string' } }, required: ['agentId'] },
      handler: async (payload: any) => {
        if (typeof toolClient.get_passport !== 'function') throw new Error('get_passport not implemented');
        return await toolClient.get_passport!({ agentId: payload.agentId });
      },
    },
  ];
}

export default { createMoltClawTools };
