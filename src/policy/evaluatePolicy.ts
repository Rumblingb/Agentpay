import { PolicyDecision, PolicyContext, PolicyConfig, POLICY_DECISIONS } from './types';
import { evaluatePolicyConfig } from './policyEngine';

// `sql` is the per-request Postgres.js tagged template function used in this
// codebase (apps/api-edge uses a similar `sql` instance). We type it as any
// to avoid adding a new dependency on postgres types in this patch.
export async function evaluatePolicy(sql: any, merchantId: string, context: PolicyContext): Promise<PolicyDecision> {
  // Default policy: allow everything unless a merchant-level policy exists.
  let policyConfig: PolicyConfig | undefined = undefined;

  try {
    const rows = await sql`
      SELECT config
      FROM merchant_policies
      WHERE merchant_id = ${merchantId}
      LIMIT 1
    `;
    if (rows && rows.length) {
      // Expect config stored as jsonb in `config` column.
      policyConfig = rows[0].config ?? undefined;
    }
  } catch (err) {
    // Table might not exist or query may fail in some environments. Fall back
    // to an open policy (do not block intent creation by default).
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
      const total = res[0].total ?? 0;
      return Number(total);
    } catch (err) {
      // If the DB query fails, bubble up to let engine decide fallback behavior.
      throw err;
    }
  };

  try {
    return await evaluatePolicyConfig(policyConfig, { ...context, merchantId }, getDailySpend);
  } catch (err) {
    // On unexpected errors, be permissive to avoid blocking flows.
    return POLICY_DECISIONS.ALLOW;
  }
}
