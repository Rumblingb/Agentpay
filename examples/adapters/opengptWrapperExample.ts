import opengpt from '../../packages/adapters/src/opengpt/opengptWrapper';

async function runExample() {
  // Mock tool client that delegates to the real PR10 contract layer in real
  // usage. Here we simulate simple responses for demonstration.
  const mockToolClient = {
    create_payment: async ({ merchantId, amountUsdc, recipientAddress, metadata }: any) => {
      return { success: true, intentId: `intent-${Date.now()}`, merchantId, amountUsdc, recipientAddress, metadata };
    },
    verify_payment: async ({ transactionId, transactionHash }: any) => {
      return { success: true, transactionId, transactionHash, verified: true };
    },
    handle_webhook: async ({ payload, signature }: any) => {
      return { handled: true, payload, signature };
    },
    get_passport: async ({ agentId }: any) => {
      return { agentId, passport: { id: `passport-${agentId}`, claims: {} } };
    },
  };

  const tools = opengpt.getOpenGptTools(mockToolClient as any);

  // Simulate registering tools in an OpenGPT-like runtime
  console.log('Registered tools:', tools.map((t) => t.name));

  // Simulate a create_payment function call from the model
  const createTool = tools.find((t) => t.name === 'create_payment')!;
  const createRes = await createTool.run({ merchantId: 'm-123', amountUsdc: 12.5, recipientAddress: 'RADDR123', metadata: { agentId: 'agent-a' } });
  console.log('create_payment ->', createRes);

  // Simulate a verify_payment function call
  const verifyTool = tools.find((t) => t.name === 'verify_payment')!;
  const verifyRes = await verifyTool.run({ transactionId: 'tx-1', transactionHash: '0xdeadbeef' });
  console.log('verify_payment ->', verifyRes);
}

if (require.main === module) {
  runExample().catch((err) => {
    console.error('Example failed:', err);
    process.exit(1);
  });
}
