import {
  createAgentPayCapability,
  executeAgentPayTool,
  registerAgentPayTools,
} from '../../packages/adapters/src/index.js';

async function main() {
  const adapter = createAgentPayCapability({
    auth: { apiKey: process.env.AGENTPAY_API_KEY ?? '' },
    baseUrl: process.env.AGENTPAY_BASE_URL,
  });

  const tools = registerAgentPayTools(adapter);
  console.log('registered tools:', tools.map((tool) => tool.name));

  const created = await executeAgentPayTool(
    'create_payment',
    {
      intent: {
        amountUsdc: 2.5,
        recipientAddress: '5J8j5U4Nf8b3mSY2QzQv1hAq2N8Q4xVg3fK1Y8x4U2nA',
        metadata: { runtime: 'generic-tool-calling-agent' },
      },
    },
    adapter,
  );

  console.log('create_payment result:', created);

  const verified = await executeAgentPayTool(
    'verify_payment',
    { paymentId: 'replace-with-payment-id', txHash: 'replace-with-tx-hash' },
    adapter,
  );

  console.log('verify_payment result:', verified);
}

main().catch((error) => {
  console.error('tool-calling adapter example failed:', error);
  process.exitCode = 1;
});
