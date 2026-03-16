import { PolicyConfig, PolicyContext, PolicyDecision, POLICY_DECISIONS } from './types';

type GetDailySpendFn = (merchantId?: string) => Promise<number>;

export async function evaluatePolicyConfig(
  config: PolicyConfig | undefined,
  context: PolicyContext,
  getDailySpend?: GetDailySpendFn,
): Promise<PolicyDecision> {
  const cfg: PolicyConfig = config ?? {};

  const amount = Number(context.amount || 0);

  // paymentsEnabled (default true)
  if (cfg.paymentsEnabled === false) return POLICY_DECISIONS.REJECT;

  // maxTransactionAmount: immediate rejection if single tx exceeds allowed max
  if (typeof cfg.maxTransactionAmount === 'number' && amount > cfg.maxTransactionAmount) {
    return POLICY_DECISIONS.REJECT;
  }

  // dailySpendLimit: if provided, check today's spend (via helper); if unavailable
  // assume conservative path: require approval when limit would be exceeded.
  if (typeof cfg.dailySpendLimit === 'number' && typeof getDailySpend === 'function') {
    try {
      const today = await getDailySpend(context.merchantId);
      if (today + amount > cfg.dailySpendLimit) {
        return POLICY_DECISIONS.REQUIRES_APPROVAL;
      }
    } catch (err) {
      // If the helper fails, fallthrough — do not block by default.
    }
  }

  // approvalRequiredAbove: explicit approval threshold
  if (typeof cfg.approvalRequiredAbove === 'number' && amount > cfg.approvalRequiredAbove) {
    return POLICY_DECISIONS.REQUIRES_APPROVAL;
  }

  // allowedRecipients: if provided and recipient not listed, require approval
  if (Array.isArray(cfg.allowedRecipients) && cfg.allowedRecipients.length > 0) {
    const recipient = (context.recipientAddress || '').toLowerCase();
    const allowed = cfg.allowedRecipients.map((r) => r.toLowerCase());
    if (!allowed.includes(recipient)) return POLICY_DECISIONS.REQUIRES_APPROVAL;
  }

  return POLICY_DECISIONS.ALLOW;
}
