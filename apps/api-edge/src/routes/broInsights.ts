import { Hono } from 'hono';
import { createDb } from '../lib/db';
import type { Env, Variables } from '../types';
import { deriveBookingHealth } from '../lib/bookingHealth';
import { dispatchToOpenClaw } from '../lib/openclaw';
import { withBookingState } from '../lib/bookingState';
import { evaluateRecoveryPolicy } from '../lib/recoveryPolicy';
import { runAutoRecoverySweep } from '../lib/bookingRecovery';

export const broInsightsRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

type BookingHealthRow = {
  id: string;
  status: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
};

function opsPriorityForRecoveryBucket(bucket: string): 1 | 2 | 3 | 4 {
  if (bucket === 'fulfilment_failed' || bucket === 'failed') return 1;
  if (bucket === 'stuck_securing') return 2;
  if (bucket === 'ready_for_dispatch') return 3;
  return 4;
}

function mapBookingHealthRow(row: BookingHealthRow) {
  const metadata = row.metadata ?? {};
  const health = deriveBookingHealth(row.status, metadata);
  const policy = evaluateRecoveryPolicy(health.recoveryBucket, metadata);
  return {
    jobId: row.id,
    intentStatus: row.status,
    bookingState: health.bookingState,
    recoveryBucket: health.recoveryBucket,
    shouldEscalate: health.shouldEscalate,
    summary: health.summary,
    provider: (metadata.paymentProvider as string | undefined) ?? null,
    journeyId: (metadata.journeyId as string | undefined) ?? null,
    bookingRef: (metadata.ticketRef as string | undefined) ?? (metadata.pnr as string | undefined) ?? (metadata.broRef as string | undefined) ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    recommendedAction: policy.action,
    recommendationReason: policy.reason,
    canAutoRun: policy.canAutoRun,
    opsPriority: opsPriorityForRecoveryBucket(health.recoveryBucket),
    metadata,
  };
}

function requireAdmin(c: { req: { header: (name: string) => string | undefined }; env: Env; json: (data: unknown, status?: number) => Response }) {
  if (c.req.header('x-admin-key') !== c.env.ADMIN_SECRET_KEY) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  return null;
}

broInsightsRouter.get('/bro-insights', async (c) => {
  const unauthorized = requireAdmin(c);
  if (unauthorized) return unauthorized;

  const sql = createDb(c.env);
  try {
    const statusRows = await sql<Array<{ status: string; count: string | number }>>`
      SELECT status, COUNT(*) as count
      FROM payment_intents
      WHERE created_at > NOW() - INTERVAL '7 days'
      GROUP BY status
    `;
    const failedSkillRows = await sql<Array<{ skill: string | null; count: string | number }>>`
      SELECT metadata->>'skill' as skill, COUNT(*) as count
      FROM payment_intents
      WHERE status = 'failed'
        AND created_at > NOW() - INTERVAL '7 days'
      GROUP BY metadata->>'skill'
      ORDER BY count DESC
      LIMIT 10
    `;

    const byStatus = statusRows.reduce<Record<string, number>>((acc, row) => {
      acc[row.status] = Number(row.count);
      return acc;
    }, {});
    const totalIntents = Object.values(byStatus).reduce((sum, count) => sum + count, 0);
    const failureCount = byStatus.failed ?? 0;

    return c.json({
      window: '7d',
      totalIntents,
      failureRate: totalIntents > 0 ? Number((failureCount / totalIntents).toFixed(4)) : 0,
      byStatus,
      topFailedSkills: failedSkillRows
        .filter((row) => !!row.skill)
        .map((row) => ({ skill: row.skill as string, count: Number(row.count) })),
      corrections: 'manual review needed — check CF logs for bro_signal type=user_correction',
      generatedAt: new Date().toISOString(),
    });
  } finally {
    await sql.end().catch(() => {});
  }
});

broInsightsRouter.get('/booking-health', async (c) => {
  const unauthorized = requireAdmin(c);
  if (unauthorized) return unauthorized;

  const sql = createDb(c.env);
  try {
    const rows = await sql<BookingHealthRow[]>`
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
      LIMIT 100
    `;

    const jobs = rows.map(mapBookingHealthRow);

    const byRecoveryBucket = jobs.reduce<Record<string, number>>((acc, job) => {
      acc[job.recoveryBucket] = (acc[job.recoveryBucket] ?? 0) + 1;
      return acc;
    }, {});

    return c.json({
      window: '7d',
      totalJobs: jobs.length,
      escalations: jobs.filter((job) => job.shouldEscalate).length,
      byRecoveryBucket,
      jobs: jobs.map(({ metadata, ...job }) => job),
      generatedAt: new Date().toISOString(),
    });
  } finally {
    await sql.end().catch(() => {});
  }
});

broInsightsRouter.get('/ops-queue', async (c) => {
  const unauthorized = requireAdmin(c);
  if (unauthorized) return unauthorized;

  const sql = createDb(c.env);
  try {
    const rows = await sql<BookingHealthRow[]>`
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
      LIMIT 100
    `;

    const actionable = rows
      .map(mapBookingHealthRow)
      .filter((job) => job.recommendedAction !== 'none' || job.shouldEscalate)
      .sort((a, b) => a.opsPriority - b.opsPriority || Date.parse(b.updatedAt) - Date.parse(a.updatedAt));

    return c.json({
      window: '7d',
      queueDepth: actionable.length,
      byPriority: actionable.reduce<Record<string, number>>((acc, job) => {
        const key = `p${job.opsPriority}`;
        acc[key] = (acc[key] ?? 0) + 1;
        return acc;
      }, {}),
      jobs: actionable.map(({ metadata, ...job }) => job),
      generatedAt: new Date().toISOString(),
    });
  } finally {
    await sql.end().catch(() => {});
  }
});

broInsightsRouter.post('/booking-health/:jobId/recover', async (c) => {
  const unauthorized = requireAdmin(c);
  if (unauthorized) return unauthorized;

  const jobId = c.req.param('jobId');
  const sql = createDb(c.env);
  try {
    const rows = await sql<BookingHealthRow[]>`
      SELECT
        id,
        status,
        metadata,
        created_at::text AS "createdAt",
        updated_at::text AS "updatedAt"
      FROM payment_intents
      WHERE id = ${jobId}
        AND metadata->>'protocol' = 'marketplace_hire'
      LIMIT 1
    `;
    if (!rows[0]) {
      return c.json({ error: 'Not found' }, 404);
    }

    const mapped = mapBookingHealthRow(rows[0]);
    if (!['ready_for_dispatch', 'stuck_securing'].includes(mapped.recoveryBucket)) {
      return c.json({
        error: 'NOT_RECOVERABLE',
        recoveryBucket: mapped.recoveryBucket,
        summary: mapped.summary,
      }, 409);
    }

    const recoveryAttemptedAt = new Date().toISOString();
    const recoveryResult = await dispatchToOpenClaw(c.env, jobId, mapped.metadata ?? {});
    const recoveryPatch = JSON.stringify({
      recoveryAttemptedAt,
      recoveryAttemptCount: Number((mapped.metadata?.recoveryAttemptCount as number | string | undefined) ?? 0) + 1,
      recoveryLastResult: recoveryResult.status,
      recoveryLastError: recoveryResult.error ?? null,
      openclawDispatched: recoveryResult.status === 'dispatched',
      openclawJobId: recoveryResult.openclawJobId ?? (mapped.metadata?.openclawJobId as string | undefined) ?? null,
      openclawDispatchedAt: recoveryResult.dispatchedAt,
      openclawError: recoveryResult.error ?? null,
      ...withBookingState(recoveryResult.status === 'dispatched' ? 'securing' : 'payment_confirmed'),
    });

    await sql`
      UPDATE payment_intents
      SET metadata = metadata || ${recoveryPatch}::jsonb
      WHERE id = ${jobId}
    `;

    return c.json({
      ok: true,
      jobId,
      attemptedAt: recoveryAttemptedAt,
      result: recoveryResult,
    });
  } finally {
    await sql.end().catch(() => {});
  }
});

broInsightsRouter.post('/booking-health/:jobId/escalate', async (c) => {
  const unauthorized = requireAdmin(c);
  if (unauthorized) return unauthorized;

  const jobId = c.req.param('jobId');
  let body: { reason?: string } = {};
  try {
    body = await c.req.json<{ reason?: string }>();
  } catch {
    body = {};
  }

  const sql = createDb(c.env);
  try {
    const rows = await sql<Array<{ id: string }>>`
      SELECT id
      FROM payment_intents
      WHERE id = ${jobId}
        AND metadata->>'protocol' = 'marketplace_hire'
      LIMIT 1
    `;
    if (!rows[0]) {
      return c.json({ error: 'Not found' }, 404);
    }

    const patch = JSON.stringify({
      manualReviewRequired: true,
      manualReviewReason: body.reason ?? 'Manual escalation requested from booking health console',
      manualReviewMarkedAt: new Date().toISOString(),
    });
    await sql`
      UPDATE payment_intents
      SET metadata = metadata || ${patch}::jsonb
      WHERE id = ${jobId}
    `;

    return c.json({
      ok: true,
      jobId,
      manualReviewRequired: true,
    });
  } finally {
    await sql.end().catch(() => {});
  }
});

broInsightsRouter.post('/booking-health/run-auto-recovery', async (c) => {
  const unauthorized = requireAdmin(c);
  if (unauthorized) return unauthorized;
  const result = await runAutoRecoverySweep(c.env, { limit: 100 });
  return c.json({
    ok: true,
    ...result,
    generatedAt: new Date().toISOString(),
  });
});

broInsightsRouter.get('/founder-metrics', async (c) => {
  const unauthorized = requireAdmin(c);
  if (unauthorized) return unauthorized;

  const sql = createDb(c.env);
  try {
    const [statusRows, bookingStateRows, providerRows, recoveryRows, issueRows, economicsRows] = await Promise.all([
      sql<Array<{ status: string; count: string | number }>>`
        SELECT status, COUNT(*) AS count
        FROM payment_intents
        WHERE created_at > NOW() - INTERVAL '30 days'
        GROUP BY status
      `,
      sql<Array<{ bookingState: string | null; count: string | number }>>`
        SELECT metadata->>'bookingState' AS "bookingState", COUNT(*) AS count
        FROM payment_intents
        WHERE created_at > NOW() - INTERVAL '30 days'
          AND metadata->>'protocol' = 'marketplace_hire'
        GROUP BY metadata->>'bookingState'
      `,
      sql<Array<{ provider: string | null; corridor: string | null; total: string | number; succeeded: string | number }>>`
        SELECT
          metadata->>'paymentProvider' AS provider,
          CONCAT_WS(
            ' -> ',
            COALESCE(metadata->'trainDetails'->>'origin', metadata->'flightDetails'->>'origin', metadata->'hotelDetails'->>'city'),
            COALESCE(metadata->'trainDetails'->>'destination', metadata->'flightDetails'->>'destination', metadata->'hotelDetails'->>'city')
          ) AS corridor,
          COUNT(*) AS total,
          COUNT(*) FILTER (
            WHERE status = 'completed'
               OR metadata->>'bookingState' = 'issued'
          ) AS succeeded
        FROM payment_intents
        WHERE created_at > NOW() - INTERVAL '30 days'
          AND metadata->>'protocol' = 'marketplace_hire'
          AND metadata->>'paymentProvider' IS NOT NULL
        GROUP BY metadata->>'paymentProvider', corridor
        ORDER BY total DESC, succeeded DESC
        LIMIT 20
      `,
      sql<Array<{ attempted: string | number; saved: string | number; escalated: string | number }>>`
        SELECT
          COUNT(*) FILTER (WHERE COALESCE((metadata->>'recoveryAttemptCount')::int, 0) > 0) AS attempted,
          COUNT(*) FILTER (
            WHERE COALESCE((metadata->>'recoveryAttemptCount')::int, 0) > 0
              AND metadata->>'bookingState' = 'issued'
          ) AS saved,
          COUNT(*) FILTER (WHERE metadata->>'manualReviewRequired' = 'true') AS escalated
        FROM payment_intents
        WHERE created_at > NOW() - INTERVAL '30 days'
          AND metadata->>'protocol' = 'marketplace_hire'
      `,
      sql<Array<{ avgMinutes: string | number | null; p95Minutes: string | number | null }>>`
        SELECT
          AVG(EXTRACT(EPOCH FROM (COALESCE((metadata->>'fulfilledAt')::timestamptz, (metadata->>'completedAt')::timestamptz) - (metadata->>'hiredAt')::timestamptz)) / 60.0) AS "avgMinutes",
          PERCENTILE_CONT(0.95) WITHIN GROUP (
            ORDER BY EXTRACT(EPOCH FROM (COALESCE((metadata->>'fulfilledAt')::timestamptz, (metadata->>'completedAt')::timestamptz) - (metadata->>'hiredAt')::timestamptz)) / 60.0
          ) AS "p95Minutes"
        FROM payment_intents
        WHERE created_at > NOW() - INTERVAL '30 days'
          AND metadata->>'protocol' = 'marketplace_hire'
          AND metadata->>'hiredAt' IS NOT NULL
          AND COALESCE(metadata->>'fulfilledAt', metadata->>'completedAt') IS NOT NULL
      `,
      sql<Array<{ protocol: string | null; intents: string | number; grossVolumeUsdc: string | number | null; platformRevenueUsdc: string | number | null }>>`
        SELECT
          protocol,
          SUM(intents) AS intents,
          SUM(gross_amount) AS "grossVolumeUsdc",
          SUM(platform_fee_amount) AS "platformRevenueUsdc"
        FROM (
          SELECT
            COALESCE(pi.metadata->>'protocol', 'direct') AS protocol,
            COUNT(*) AS intents,
            COALESCE(SUM(fle.gross_amount), 0) AS gross_amount,
            COALESCE(SUM(fle.platform_fee_amount), 0) AS platform_fee_amount
          FROM fee_ledger_entries fle
          JOIN payment_intents pi ON pi.id = fle.intent_id
          WHERE pi.created_at > NOW() - INTERVAL '30 days'
            AND COALESCE(pi.metadata->>'protocol', 'direct') <> 'marketplace_hire'
          GROUP BY COALESCE(pi.metadata->>'protocol', 'direct')

          UNION ALL

          SELECT
            'marketplace_hire' AS protocol,
            COUNT(*) AS intents,
            COALESCE(SUM(amount), 0) AS gross_amount,
            COALESCE(SUM((metadata->>'platformFee')::numeric), 0) AS platform_fee_amount
          FROM payment_intents
          WHERE created_at > NOW() - INTERVAL '30 days'
            AND metadata->>'protocol' = 'marketplace_hire'
        ) metrics
        GROUP BY protocol
        ORDER BY "grossVolumeUsdc" DESC
      `,
    ]);

    const byStatus = statusRows.reduce<Record<string, number>>((acc, row) => {
      acc[row.status] = Number(row.count);
      return acc;
    }, {});
    const totalIntents = Object.values(byStatus).reduce((sum, count) => sum + count, 0);

    const byBookingState = bookingStateRows.reduce<Record<string, number>>((acc, row) => {
      if (!row.bookingState) return acc;
      acc[row.bookingState] = Number(row.count);
      return acc;
    }, {});

    const recovery = recoveryRows[0] ?? { attempted: 0, saved: 0, escalated: 0 };
    const recoveryAttempted = Number(recovery.attempted);
    const recoverySaved = Number(recovery.saved);
    const issueTiming = issueRows[0] ?? { avgMinutes: null, p95Minutes: null };

    return c.json({
      window: '30d',
      generatedAt: new Date().toISOString(),
      funnel: {
        totalIntents,
        byStatus,
        byBookingState,
        paymentConfirmed: (byBookingState.payment_confirmed ?? 0) + (byBookingState.securing ?? 0) + (byBookingState.issued ?? 0),
        securing: byBookingState.securing ?? 0,
        issued: byBookingState.issued ?? 0,
        failed: (byStatus.failed ?? 0) + (byBookingState.failed ?? 0),
      },
      providerPerformance: providerRows.map((row) => {
        const total = Number(row.total);
        const succeeded = Number(row.succeeded);
        return {
          provider: row.provider ?? 'unknown',
          corridor: row.corridor || 'unknown',
          total,
          succeeded,
          successRate: total > 0 ? Number((succeeded / total).toFixed(4)) : 0,
        };
      }),
      recovery: {
        attempted: recoveryAttempted,
        saved: recoverySaved,
        escalated: Number(recovery.escalated),
        saveRate: recoveryAttempted > 0 ? Number((recoverySaved / recoveryAttempted).toFixed(4)) : 0,
      },
      timeToIssue: {
        avgMinutes: issueTiming.avgMinutes == null ? null : Number(Number(issueTiming.avgMinutes).toFixed(1)),
        p95Minutes: issueTiming.p95Minutes == null ? null : Number(Number(issueTiming.p95Minutes).toFixed(1)),
      },
      economics: {
        byProtocol: economicsRows.map((row) => ({
          protocol: row.protocol ?? 'direct',
          intents: Number(row.intents),
          grossVolumeUsdc: Number(row.grossVolumeUsdc ?? 0),
          platformRevenueUsdc: Number(row.platformRevenueUsdc ?? 0),
        })),
        totalGrossVolumeUsdc: Number(economicsRows.reduce((sum, row) => sum + Number(row.grossVolumeUsdc ?? 0), 0).toFixed(6)),
        totalPlatformRevenueUsdc: Number(economicsRows.reduce((sum, row) => sum + Number(row.platformRevenueUsdc ?? 0), 0).toFixed(6)),
      },
    });
  } finally {
    await sql.end().catch(() => {});
  }
});
