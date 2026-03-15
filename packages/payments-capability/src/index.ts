export { enablePayments } from './payments';
export type { PaymentsCapability } from './payments';

// Re-export SDK types as type-only aliases for consumer convenience
export type { PaymentCreateRequest, Payment, PaymentListResponse, PaymentVerificationResult, Stats } from '@agentpay/sdk';
