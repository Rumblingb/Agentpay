export type PolicyConfig = {
  maxAmountPerTransaction?: number; // maximum single transaction amount (USDC)
  maxDailySpend?: number; // merchant-level daily spend limit (USDC)
  approvalRequiredAbove?: number; // amounts above this require approval
  allowlistRecipients?: string[]; // allowed recipient addresses
  blocklistRecipients?: string[]; // blocked recipient addresses
  paymentsEnabled?: boolean; // global toggle for payments
  policyVersion?: string;
};

export type PolicyContext = {
  amount: number;
  recipientAddress?: string;
  agentId?: string;
  passportId?: string;
  trustScore?: number;
  dailySpendSoFar?: number;
  merchantId?: string;
};

export type PolicyDecision = 'ALLOW' | 'REJECT' | 'REQUIRES_APPROVAL';

export type PolicyEvaluationResult = {
  decision: PolicyDecision;
  reason:
    | 'payments_disabled'
    | 'amount_above_threshold'
    | 'daily_limit_exceeded'
    | 'recipient_not_allowed'
    | 'recipient_blocked'
    | 'allowed'
    | 'unknown_error';
  policyVersion: string;
  evaluatedAt: string; // ISO timestamp
};

export const POLICY_DECISIONS: Record<string, PolicyDecision> = {
  ALLOW: 'ALLOW',
  REJECT: 'REJECT',
  REQUIRES_APPROVAL: 'REQUIRES_APPROVAL',
};
