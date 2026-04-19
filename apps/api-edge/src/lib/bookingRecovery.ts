import type { Env } from '../types';
import { createDb } from './db';
import { deriveBookingHealth } from './bookingHealth';
import { dispatchToOpenClaw } from './openclaw';
import { evaluateRecoveryPolicy } from './recoveryPolicy';
import { withBookingState } from './bookingState';

type RecoveryRow = {
  id: string;
  status: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
};

export type AutoRecoveryResult = {
  jobId: string;
  recoveryBucket: string;
  recommendedAction: string;
  ok: boolean;
  details?: Record<string, unknown>;
};

export async function runAutoRecoverySweep(
  env: Env,
  options?: { limit?: number },
): Promise<{
  scanned: number;
  candidates: number;
  acted: number;
  results: AutoRecoveryResult[];
}> {
  const sql = createDb(env);
  try {
    const rows = await sql<RecoveryRow[]>`
      SELECT
        id,
        status,
        metadata,
        created_at::text AS "createdAt",
        updated_at::text AS "updatedAt"
      FROM payment_intents
      WHERE created_at > NOW() - INTERVAL '7 days'
        AND metadata->>'protocol' = 'marketplace_hire'
      ORDER BY updated_at DESC
      LIMIT ${options?.limit ?? 100}
    `;

    const results: AutoRecoveryResult[] = [];
    let candidates = 0;

    for (const row of rows) {
      const metadata = row.metadata ?? {};
      const health = deriveBookingHealth(row.status, metadata);
      const policy = evaluateRecoveryPolicy(health.recoveryBucket, metadata);
      if (!policy.canAutoRun || policy.action === 'none') continue;
      candidates += 1;

      if (policy.action === 'retry_dispatch') {
        const recoveryAttemptedAt = new Date().toISOString();
        const recoveryResult = await dispatchToOpenClaw(env, row.id, metadata);
        const recoveryPatch = JSON.stringify({
          recoveryAttemptedAt,
          recoveryAttemptCount: Number((metadata.recoveryAttemptCount as number | string | undefined) ?? 0) + 1,
          recoveryLastPolicyAction: policy.action,
          recoveryLastPolicyReason: policy.reason,
          recoveryLastResult: recoveryResult.status,
          recoveryLastError: recoveryResult.error ?? null,
          openclawDispatched: recoveryResult.status === 'dispatched',
          openclawJobId: recoveryResult.openclawJobId ?? (metadata.openclawJobId as string | undefined) ?? null,
          openclawDispatchedAt: recoveryResult.dispatchedAt,
          openclawError: recoveryResult.error ?? null,
          ...withBookingState(recoveryResult.status === 'dispatched' ? 'securing' : 'payment_confirmed'),
        });
        await sql`
          UPDATE payment_intents
          SET metadata = metadata || ${recoveryPatch}::jsonb
          WHERE id = ${row.id}
        `;
        results.push({
          jobId: row.id,
          recoveryBucket: health.recoveryBucket,
          recommendedAction: policy.action,
          ok: recoveryResult.status === 'dispatched',
          details: {
            status: recoveryResult.status,
            error: recoveryResult.error ?? null,
            openclawJobId: recoveryResult.openclawJobId ?? null,
          },
        });
        continue;
      }

      if (policy.action === 'escalate_manual') {
        const patch = JSON.stringify({
          manualReviewRequired: true,
          manualReviewReason: policy.reason,
          manualReviewMarkedAt: new Date().toISOString(),
          recoveryLastPolicyAction: policy.action,
          recoveryLastPolicyReason: policy.reason,
        });
        await sql`
          UPDATE payment_intents
          SET metadata = metadata || ${patch}::jsonb
          WHERE id = ${row.id}
        `;
        results.push({
          jobId: row.id,
          recoveryBucket: health.recoveryBucket,
          recommendedAction: policy.action,
          ok: true,
        });
      }
    }

    return {
      scanned: rows.length,
      candidates,
      acted: results.length,
      results,
    };
  } finally {
    await sql.end().catch(() => {});
  }
}
