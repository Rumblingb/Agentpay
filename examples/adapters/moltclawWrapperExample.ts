import moltclaw from '../../packages/adapters/src/moltclaw/moltclawWrapper';

async function runExample() {
  const mockToolClient = {
    create_payment: async ({ merchantId, amountUsdc, recipientAddress, metadata }: any) => ({ success: true, intentId: `intent-${Date.now()}`, merchantId, amountUsdc, recipientAddress, metadata }),
    verify_payment: async ({ transactionId, transactionHash }: any) => ({ success: true, transactionId, transactionHash, verified: true }),
    handle_webhook: async ({ payload, signature }: any) => ({ handled: true, payload, signature }),
    get_passport: async ({ agentId }: any) => ({ agentId, passport: { id: `pp-${agentId}` } }),
  };

  const tools = moltclaw.createMoltClawTools(mockToolClient as any);
  console.log('MoltClaw tools:', tools.map((t) => ({ id: t.id, title: t.title })));

  // simulate create_payment
  const create = tools.find((t) => t.id === 'create_payment')!;
  const cRes = await create.handler({ merchantId: 'm-1', amountUsdc: 25, recipientAddress: 'R-1' });
  console.log('create_payment ->', cRes);

  // simulate verify_payment
  const verify = tools.find((t) => t.id === 'verify_payment')!;
  const vRes = await verify.handler({ transactionId: 'tx-1', transactionHash: '0xabcd' });
  console.log('verify_payment ->', vRes);
}

if (require.main === module) runExample().catch((e) => console.error(e));
