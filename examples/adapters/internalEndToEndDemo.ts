/*
  internalEndToEndDemo.ts

  Lightweight internal example that wires the wrapper -> tool contract ->
  capability adapter -> payment creation -> policy evaluation -> verification
  path. This file is a non-runtime example only; it uses a mock AgentPayClient
  so it doesn't call any external services and doesn't change core runtime
  code.

  Location: examples/adapters/internalEndToEndDemo.ts
*/

import { executeAgentPayTool, registerAgentPayTools } from '../../packages/adapters/src/tools/index.js';
import { createAgentPayCapability } from '../../packages/adapters/src/agentPayCapabilityAdapter.js';
import evaluatePolicy from '../../src/policy/evaluatePolicy.js';
import type { PaymentCreateRequest, Payment, PaymentVerificationResult } from '../../packages/sdk/src/types.js';

// Mock AgentPayClient: implements the tiny subset used by the capability adapter.
class MockAgentPayClient {
  baseUrl = 'mock://local';
  apiKey = 'demo-key';

  async pay(req: PaymentCreateRequest): Promise<Payment> {
    const now = new Date().toISOString();
    const txId = `tx-${Math.floor(Math.random() * 1e9)}`;
    const paymentId = `pmt-${Math.floor(Math.random() * 1e9)}`;
    return {
      id: txId,
      paymentId,
      amountUsdc: req.amountUsdc,
      recipientAddress: req.recipientAddress,
      payerAddress: 'demo-payer-address',
      transactionHash: null,
      status: 'pending',
      createdAt: now,
      metadata: req.metadata ?? {},
    } as Payment;
  }

  async verifyPayment(id: string, txHash: string): Promise<PaymentVerificationResult> {
    // Minimal heuristic: if txHash starts with 'tx-' mark verified true.
    const verified = typeof txHash === 'string' && txHash.startsWith('tx-');
    return {
      id,
      txHash,
      verified,
      status: verified ? 'confirmed' : 'unmatched',
      verifiedAt: verified ? new Date().toISOString() : undefined,
      confirmationDepth: verified ? 6 : 0,
      requiredDepth: verified ? 6 : 6,
      proof: verified ? { type: 'mock-proof', payload: { tx: txHash } } : null,
      raw: { demo: true },
    };
  }
}

// Minimal SQL mock for policy evaluation: acts as a template tag function and
// returns empty results so the policy engine falls back to defaults.
const sqlMock = async (..._args: any[]): Promise<any[]> => {
  return [];
};

async function main() {
  // 1) Create capability adapter backed by the mock client (represents adapter layer)
  const mockClient = new MockAgentPayClient();
  const adapter = createAgentPayCapability({ client: mockClient as any });

  // 2) Register tools (tool-contract layer) and show available definitions
  const defs = registerAgentPayTools(adapter as any);
  console.log('Registered AgentPay tools:', defs.map((d) => d.name));

  // 3) Wrapper-like call: create_payment via executeAgentPayTool
  const intent: PaymentCreateRequest = {
    amountUsdc: 1500,
    recipientAddress: 'demo-recipient-wallet-1',
    metadata: { purpose: 'travel-booking-demo' },
    protocol: 'solana',
    agentId: 'agent-demo-1',
  };

  console.log('\n--- create_payment (wrapper -> tool contract -> capability adapter) ---');
  const createResult = await executeAgentPayTool('create_payment', { intent }, adapter as any);
  console.log('create_payment result:', createResult.payment);

  // 4) Policy evaluation (policy layer) — uses a lightweight sql mock and a demo merchant id
  console.log('\n--- policy evaluation ---');
  const policyRes = await evaluatePolicy(sqlMock, 'demo-merchant', {
    amount: intent.amountUsdc,
    recipientAddress: intent.recipientAddress,
    agentId: intent.agentId,
  } as any);
  console.log('policy result:', policyRes);

  // 5) Simulate a transaction hash and verify (verification path)
  console.log('\n--- verify_payment (wrapper -> tool contract -> capability adapter) ---');
  const txHash = `tx-${Math.floor(Math.random() * 1e9)}`; // mock on-chain tx
  const verifyResult = await executeAgentPayTool('verify_payment', { paymentId: createResult.payment.paymentId, txHash }, adapter as any);
  console.log('verify_payment result:', verifyResult.verification);

  // 6) Final normalized receipt / output
  console.log('\n--- final normalized output / receipt ---');
  const normalized = {
    payment: createResult.payment,
    policy: policyRes,
    verification: verifyResult.verification,
    receiptId: `receipt-${createResult.payment.paymentId}`,
    success: verifyResult.verification.verified === true,
  };
  console.log(JSON.stringify(normalized, null, 2));
}

// Run if executed directly
if (require.main === module) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('internalEndToEndDemo failed:', err);
    process.exitCode = 1;
  });
}

export default main;
