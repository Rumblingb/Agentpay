import { createAgentPayCapability } from '../../packages/adapters/src/index.js';

type ToolName = 'createPayment' | 'verifyPayment';

type ToolCall = {
  tool: ToolName;
  args: Record<string, unknown>;
};

const capability = createAgentPayCapability({
  auth: {
    apiKey: process.env.AGENTPAY_API_KEY ?? '',
  },
  baseUrl: process.env.AGENTPAY_BASE_URL,
});

const tools: Record<ToolName, (args: Record<string, unknown>) => Promise<unknown>> = {
  createPayment: async (args) => {
    return capability.createPayment({
      amountUsdc: Number(args.amountUsdc),
      recipientAddress: String(args.recipientAddress),
      metadata: {
        runtime: 'generic-tool-calling-agent',
      },
    });
  },
  verifyPayment: async (args) => {
    return capability.verifyPayment(String(args.paymentId), String(args.txHash));
  },
};

async function runToolCall(call: ToolCall) {
  const handler = tools[call.tool];
  if (!handler) {
    throw new Error(`Unsupported tool: ${call.tool}`);
  }

  return handler(call.args);
}

async function main() {
  // Simulates a generic runtime choosing tools based on model output.
  const createResult = await runToolCall({
    tool: 'createPayment',
    args: {
      amountUsdc: 1.25,
      recipientAddress: '5J8j5U4Nf8b3mSY2QzQv1hAq2N8Q4xVg3fK1Y8x4U2nA',
    },
  });

  console.log('createPayment result:', createResult);

  const verifyResult = await runToolCall({
    tool: 'verifyPayment',
    args: {
      paymentId: 'replace-with-payment-id',
      txHash: 'replace-with-tx-hash',
    },
  });

  console.log('verifyPayment result:', verifyResult);
}

main().catch((error) => {
  console.error('generic adapter example failed:', error);
  process.exitCode = 1;
});
