import { SimulatedSandboxClient } from "./demoClients/SimulatedSandboxClient";

type DemoRequest = {
  requesterAgent: string;
  providerAgent: string;
  taskDescription: string;
  amountUsd: number;
  currency: string;
  merchantId: string;
};

type PaymentResult = any;
type PolicyResult = { allow: boolean; reason: string; rule?: string };
type VerificationResult = any;

function evaluatePolicy(_sqlMock: any, merchantId: string, context: any): PolicyResult {
  // Very small, deterministic policy mock
  const maxPaymentUsd = 1000;
  const allow = Number(context.amount) <= maxPaymentUsd;
  return {
    allow,
    reason: allow ? "maxPayment not exceeded" : "exceeds maxPayment",
    rule: "maxPayment",
  };
}

async function executeAgentPayTool(client: SimulatedSandboxClient, toolName: string, params: any) {
  if (toolName === "create_payment") {
    return client.pay(params);
  }

  if (toolName === "verify_payment") {
    const { paymentId, txHash } = params;
    return client.verifyPayment(paymentId, txHash);
  }

  throw new Error(`unknown tool ${toolName}`);
}

async function runDemo() {
  const client = new SimulatedSandboxClient();

  const demoRequest: DemoRequest = {
    requesterAgent: "ResearchAgent",
    providerAgent: "ExecutionAgent",
    taskDescription: "Compile 5 flight options to Lisbon under budget",
    amountUsd: 12,
    currency: "USD",
    merchantId: "demo-merchant",
  };

  // Step 2 — create payment
  const paymentResult: PaymentResult = await executeAgentPayTool(client, "create_payment", demoRequest);

  // Step 3 — evaluate policy (sqlMock returns safe defaults)
  const sqlMock = { dailySpend: 0 };
  const policyResult = evaluatePolicy(sqlMock, demoRequest.merchantId, { amount: demoRequest.amountUsd });

  // Step 4 — verify payment if allowed
  let verificationResult: VerificationResult | null = null;
  const txHash = "sim_tx_001";
  if (policyResult.allow) {
    verificationResult = await executeAgentPayTool(client, "verify_payment", { paymentId: paymentResult.paymentId, txHash });
  }

  // Step 5 — generate receipt
  const receipt = {
    receiptId: "rcpt_ap_001",
    intentId: paymentResult.paymentId,
    requesterAgent: demoRequest.requesterAgent,
    providerAgent: demoRequest.providerAgent,
    taskDescription: demoRequest.taskDescription,
    amountUsd: demoRequest.amountUsd,
    currency: demoRequest.currency,
    status: verificationResult && verificationResult.verified ? "completed" : "created",
    resolution: {
      outcome: verificationResult && verificationResult.verified ? "fulfilled" : "pending",
      verified: !!(verificationResult && verificationResult.verified),
    },
    settlement: verificationResult
      ? {
          network: verificationResult.proof?.network ?? "simulated-sandbox",
          txHash: verificationResult.proof?.txHash ?? txHash,
          confirmationDepth: verificationResult.confirmationDepth ?? 0,
        }
      : null,
    issuedAt: new Date().toISOString(),
  };

  // Step 6 — emit feed / trust event
  const feedEvent = {
    eventId: "evt_ap_001",
    type: "payment.completed",
    requesterAgent: demoRequest.requesterAgent,
    providerAgent: demoRequest.providerAgent,
    amountUsd: demoRequest.amountUsd,
    receiptId: receipt.receiptId,
    verified: !!(verificationResult && verificationResult.verified),
    timestamp: new Date().toISOString(),
  };

  const trustUpdate = {
    subjectAgent: demoRequest.providerAgent,
    reason: "successful_verified_completion",
    delta: 3,
  };

  // Cinematic summary
  console.log("AgentPay Semi-Live Demo");
  console.log("──────────────────────\n");
  console.log(`requester        → ${demoRequest.requesterAgent}`);
  console.log(`provider         → ${demoRequest.providerAgent}`);
  console.log(`task             → ${demoRequest.taskDescription}`);
  console.log(`amount           → $${demoRequest.amountUsd.toFixed(2)} ${demoRequest.currency}\n`);

  console.log(`create_payment   → ${paymentResult.paymentId}`);
  console.log(`policy.evaluate  → ${policyResult.allow ? "ALLOW" : "DENY"}`);
  console.log(`verify_payment   → ${verificationResult && verificationResult.verified ? "SUCCESS" : "FAIL"}`);
  console.log(`receipt.generate → ${receipt.receiptId}`);
  console.log(`feed.publish     → ${feedEvent.eventId}`);
  console.log(`trust.update     → +${trustUpdate.delta} to ${trustUpdate.subjectAgent}\n`);

  console.log("result           → completed verified agent-to-agent payment\n");

  // Structured objects for developers
  const pretty = (label: string, obj: any) => {
    console.log(`${label}:\n${JSON.stringify(obj, null, 2)}\n`);
  };

  pretty("paymentResult", paymentResult);
  pretty("policyResult", policyResult);
  pretty("verificationResult", verificationResult);
  pretty("receipt", receipt);
  pretty("feedEvent", feedEvent);
  pretty("trustUpdate", trustUpdate);
}

(async () => {
  try {
    await runDemo();
  } catch (err) {
    console.error("Demo failed:", err);
    process.exitCode = 1;
  }
})();
