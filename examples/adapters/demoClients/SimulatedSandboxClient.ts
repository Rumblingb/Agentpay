export type DemoPayment = {
  id: string;
  requesterAgent: string;
  providerAgent: string;
  taskDescription: string;
  amountUsd: number;
  currency: string;
  recipientAddress: string;
  status: "created" | "verified" | "completed";
  createdAt: string;
  txHash?: string;
};

export class SimulatedSandboxClient {
  private payments = new Map<string, DemoPayment>();
  private paymentCounter = 1;
  private receiptCounter = 1;

  async pay(input: any) {
    const id = `intent_ap_${String(this.paymentCounter++).padStart(3, "0")}`;

    const payment: DemoPayment = {
      id,
      requesterAgent: input.requesterAgent ?? "ResearchAgent",
      providerAgent: input.providerAgent ?? "ExecutionAgent",
      taskDescription: input.taskDescription ?? "",
      amountUsd: Number(input.amountUsd ?? 0),
      currency: input.currency ?? "USD",
      recipientAddress: input.recipientAddress ?? "sandbox_recipient_execution_agent",
      status: "created",
      createdAt: new Date().toISOString(),
    };

    this.payments.set(id, payment);

    return {
      paymentId: payment.id,
      status: payment.status,
      recipientAddress: payment.recipientAddress,
      amountUsd: payment.amountUsd,
      currency: payment.currency,
      raw: payment,
    };
  }

  async verifyPayment(paymentId: string, txHash: string) {
    const payment = this.payments.get(paymentId);
    const proof = { network: "simulated-sandbox", txHash };

    if (!payment) {
      return {
        verified: false,
        status: "not_found",
        confirmationDepth: 0,
        proof,
      };
    }

    payment.status = "completed";
    payment.txHash = txHash;
    this.payments.set(paymentId, payment);

    return {
      verified: true,
      status: "confirmed",
      confirmationDepth: 1,
      proof,
      payment,
    };
  }

  getPayment(paymentId: string) {
    return this.payments.get(paymentId);
  }
}
