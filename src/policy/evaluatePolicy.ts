import { PolicyContext, PolicyConfig, PolicyEvaluationResult } from './types.js';
import { evaluatePolicyConfig } from './policyEngine.js';

// `sql` is the per-request Postgres.js tagged template function used in this
// codebase. We accept `any` here for portability in the demo environment.
export async function evaluatePolicy(sql: any, merchantId: string, context: PolicyContext): Promise<PolicyEvaluationResult> {
  let policyConfig: PolicyConfig | undefined = undefined;

  try {
    const rows = await sql`
      SELECT config
      FROM merchant_policies
      WHERE merchant_id = ${merchantId}
      LIMIT 1
    `;
    if (rows && rows.length) {
      policyConfig = rows[0].config ?? undefined;
    }
  } catch (err) {
    policyConfig = undefined;
  }

  const getDailySpend = async (mId?: string): Promise<number> => {
    try {
      const merchant = mId ?? merchantId;
      const res = await sql`
        SELECT COALESCE(SUM(amount), 0) AS total
        FROM payment_intents
        WHERE merchant_id = ${merchant}
          AND created_at >= date_trunc('day', now())
      `;
      if (!res || !res.length) return 0;
      return Number(res[0].total ?? 0);
    } catch (err) {
      throw err;
    }
  };

  try {
    const { decision, reason, policyVersion } = await evaluatePolicyConfig(policyConfig, { ...context, merchantId }, getDailySpend);
    return {
      decision,
      reason,
      policyVersion,
      evaluatedAt: new Date().toISOString(),
    };
  } catch (err) {
    return {
      decision: 'ALLOW',
      reason: 'unknown_error',
      policyVersion: policyConfig?.policyVersion ?? 'v1',
      evaluatedAt: new Date().toISOString(),
    };
  }
}
