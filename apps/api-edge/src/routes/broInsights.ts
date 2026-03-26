import { Hono } from 'hono';
import { createDb } from '../lib/db';
import type { Env, Variables } from '../types';

export const broInsightsRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

broInsightsRouter.get('/bro-insights', async (c) => {
  if (c.req.header('x-admin-key') !== c.env.ADMIN_SECRET_KEY) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

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
