export type PolicyConfig = {
  maxTransactionAmount?: number; // maximum single transaction amount (USDC)
  dailySpendLimit?: number; // merchant-level daily spend limit (USDC)
  approvalRequiredAbove?: number; // amounts above this require approval
  allowedRecipients?: string[]; // list of allowed recipient addresses
  paymentsEnabled?: boolean; // global toggle for payments
};

export type PolicyContext = {
  amount: number;
  recipientAddress?: string;
  agentId?: string;
  merchantId?: string;
};

export type PolicyDecision = 'ALLOW' | 'REJECT' | 'REQUIRES_APPROVAL';

export const POLICY_DECISIONS: Record<string, PolicyDecision> = {
  ALLOW: 'ALLOW',
  REJECT: 'REJECT',
  REQUIRES_APPROVAL: 'REQUIRES_APPROVAL',
};
