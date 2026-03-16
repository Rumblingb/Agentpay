# Minimal Adapter Interface (spec)

This document defines a minimal adapter interface for integrating payment
rails and external providers into AgentPay. It is intentionally small and
designed to be implementable by third-party adapters.

Interface surface (TypeScript-like):

```ts
interface Adapter {
  init(config: Record<string, unknown>): Promise<void>;
  createPayment(params: { amountUsdc: number; recipient: string; metadata?: any }): Promise<{ txHash?: string; providerRef?: string }>;
  getPaymentStatus(txHashOrRef: string): Promise<{ status: 'pending'|'confirmed'|'failed'; details?: any }>;
  refund?(ref: string): Promise<boolean>;
}
```

Adapters should be thin and map provider-specific data to the canonical fields
used by AgentPay (txHash, amount, recipientAddress, etc.).
