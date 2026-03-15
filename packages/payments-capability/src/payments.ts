import type AgentPayClient from '@agentpay/sdk';
import type {
  PaymentCreateRequest,
  Payment,
  PaymentListResponse,
  PaymentVerificationResult,
  Stats,
} from '@agentpay/sdk';

export type PaymentsCapability = {
  pay(req: PaymentCreateRequest): Promise<Payment>;
  getPayment(transactionId: string): Promise<Payment>;
  listPayments(opts?: { limit?: number; offset?: number }): Promise<PaymentListResponse>;
  verifyPayment(transactionId: string, txHash: string): Promise<PaymentVerificationResult>;
  getStats(): Promise<Stats>;
};

export function enablePayments(client: AgentPayClient): PaymentsCapability {
  return {
    pay: (req: PaymentCreateRequest) => client.pay(req),
    getPayment: (transactionId: string) => client.getPayment(transactionId),
    listPayments: (opts?: { limit?: number; offset?: number }) => client.listPayments(opts),
    verifyPayment: (transactionId: string, txHash: string) => client.verifyPayment(transactionId, txHash),
    getStats: () => client.getStats(),
  };
}

export default enablePayments;
