import { Payment } from './types';

export function mapPaymentResponse(raw: any): Payment {
  if (!raw) {
    throw new Error('Invalid payment response');
  }

  const id = raw.transactionId ?? raw.id ?? raw.txId ?? null;
  const paymentId = raw.paymentId ?? raw.payment_id ?? null;
  const amountUsdc =
    raw.amount ?? raw.amountUsdc ?? raw.amount_usdc ?? 0;
  const recipientAddress = raw.recipientAddress ?? raw.recipient_address ?? null;
  const payerAddress = raw.payerAddress ?? raw.payer_address ?? null;
  const transactionHash = raw.transactionHash ?? raw.transaction_hash ?? null;
  const status = raw.status ?? 'pending';
  const createdAt = raw.createdAt ?? new Date().toISOString();

  return {
    id,
    paymentId,
    amountUsdc,
    recipientAddress,
    payerAddress,
    transactionHash,
    status,
    createdAt,
  } as Payment;
}
