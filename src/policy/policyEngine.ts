import {
  PolicyConfig,
  PolicyContext,
  PolicyDecision,
  POLICY_DECISIONS,
  PolicyEvaluationResult,
} from './types';

type GetDailySpendFn = (merchantId?: string) => Promise<number>;

function nowIso(): string {
  return new Date().toISOString();
}

export async function evaluatePolicyConfig(
  config: PolicyConfig | undefined,
  context: PolicyContext,
  getDailySpend?: GetDailySpendFn,
): Promise<{ decision: PolicyDecision; reason: PolicyEvaluationResult['reason']; policyVersion: string }> {
  const cfg: PolicyConfig = config ?? {};
  const amount = Number(context.amount || 0);

  const policyVersion = cfg.policyVersion ?? 'v1';

  // paymentsEnabled (default true)
  if (cfg.paymentsEnabled === false) {
    return { decision: 'REJECT', reason: 'payments_disabled', policyVersion };
  }

  // blocklistRecipients: immediate reject
  if (Array.isArray(cfg.blocklistRecipients) && cfg.blocklistRecipients.length > 0 && context.recipientAddress) {
    const recipient = context.recipientAddress.toLowerCase();
    if (cfg.blocklistRecipients.map((r) => r.toLowerCase()).includes(recipient)) {
      return { decision: 'REJECT', reason: 'recipient_blocked', policyVersion };
    }
  }

  // maxAmountPerTransaction: immediate rejection if single tx exceeds allowed max
  if (typeof cfg.maxAmountPerTransaction === 'number' && amount > cfg.maxAmountPerTransaction) {
    return { decision: 'REJECT', reason: 'amount_above_threshold', policyVersion };
  }

  // maxDailySpend: if provided, check today's spend via helper; require approval if would exceed
  if (typeof cfg.maxDailySpend === 'number' && typeof getDailySpend === 'function') {
    try {
      const today = await getDailySpend(context.merchantId);
      if (today + amount > cfg.maxDailySpend) {
        return { decision: 'REQUIRES_APPROVAL', reason: 'daily_limit_exceeded', policyVersion };
      }
    } catch (err) {
      // If helper fails, fall through permissively
    }
  }

  // approvalRequiredAbove: explicit approval threshold
  if (typeof cfg.approvalRequiredAbove === 'number' && amount > cfg.approvalRequiredAbove) {
    return { decision: 'REQUIRES_APPROVAL', reason: 'amount_above_threshold', policyVersion };
  }

  // allowlistRecipients: require approval if recipient not listed
  if (Array.isArray(cfg.allowlistRecipients) && cfg.allowlistRecipients.length > 0 && context.recipientAddress) {
    const recipient = context.recipientAddress.toLowerCase();
    if (!cfg.allowlistRecipients.map((r) => r.toLowerCase()).includes(recipient)) {
      return { decision: 'REQUIRES_APPROVAL', reason: 'recipient_not_allowed', policyVersion };
    }
  }

  return { decision: 'ALLOW', reason: 'allowed', policyVersion };
}

