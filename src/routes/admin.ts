/**
 * Admin Dashboard API
 *
 * All endpoints require the `x-admin-key` header to match ADMIN_SECRET_KEY.
 *
 * Endpoints:
 *   GET /api/admin/health          — system health summary
 *   GET /api/admin/disputes        — open disputes (paginated)
 *   GET /api/admin/flagged-agents  — agents with elevated risk or behavior alerts
 *   GET /api/admin/stalled-escrows — escrows locked > 48h without release
 *   GET /api/admin/failed-payments — payment_intents failed in last 24h
 *   GET /api/admin/top-agents      — top 20 agents by earnings
 *   GET /api/admin/anomalies       — latest reconciliation anomalies
 *   GET /api/admin/risk-tiers      — agent count by risk tier
 *
 * @module routes/admin
 */

import { Router, Request, Response, NextFunction } from 'express';
import prisma from '../lib/prisma.js';
import { query } from '../db/index.js';
import { logger } from '../logger.js';
import { getLastReport } from '../services/reconciliationService.js';

const router = Router();

// ---------------------------------------------------------------------------
// Auth middleware — must precede all admin route handlers
// ---------------------------------------------------------------------------

const ADMIN_KEY = process.env.ADMIN_SECRET_KEY || 'admin-dev-key';

if (!process.env.ADMIN_SECRET_KEY) {
  logger.warn('ADMIN_SECRET_KEY is not set — using insecure default. Set this variable before deploying to production.');
}

function requireAdminKey(req: Request, res: Response, next: NextFunction): void {
  if (req.headers['x-admin-key'] !== ADMIN_KEY) {
    res.status(403).json({ success: false, error: 'Forbidden: invalid admin key' });
    return;
  }
  next();
}

router.use(requireAdminKey);

// ---------------------------------------------------------------------------
// Helper — execute a raw query and return rows, or [] on any error
// ---------------------------------------------------------------------------

async function safeQuery<T = Record<string, unknown>>(
  sql: string,
  params?: unknown[],
): Promise<T[]> {
  try {
    const result = await query(sql, params as any[]);
    return result.rows as T[];
  } catch (err: any) {
    // P2021 equivalent for pg: relation does not exist
    if (err?.message?.includes('does not exist')) {
      logger.warn({ sql: sql.slice(0, 80) }, 'Admin query: table missing — returning empty');
    } else {
      logger.error({ err }, 'Admin safeQuery error');
    }
    return [];
  }
}

// ---------------------------------------------------------------------------
// GET /api/admin/health
// ---------------------------------------------------------------------------

router.get('/health', async (_req: Request, res: Response) => {
  try {
    let dbStatus: 'operational' | 'degraded' = 'operational';
    try {
      await query('SELECT 1');
    } catch {
      dbStatus = 'degraded';
    }

    const report = getLastReport();

    res.json({
      success: true,
      data: {
        status: dbStatus === 'operational' ? 'healthy' : 'degraded',
        database: dbStatus,
        lastReconciliation: report
          ? {
              runId: report.runId,
              completedAt: report.completedAt,
              anomaliesFound: report.stats.anomaliesFound,
              criticalAnomalies: report.stats.criticalAnomalies,
            }
          : null,
        checkedAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    logger.error({ err }, 'Admin /health error');
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/admin/disputes?page=1&limit=20
// ---------------------------------------------------------------------------

router.get('/disputes', async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10));
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '20'), 10)));
    const offset = (page - 1) * limit;

    const rows = await safeQuery(
      `SELECT * FROM dispute_cases WHERE status = 'open' ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset],
    );

    const countRows = await safeQuery<{ total: string }>(
      `SELECT COUNT(*) AS total FROM dispute_cases WHERE status = 'open'`,
    );
    const total = parseInt(countRows[0]?.total ?? '0', 10);

    res.json({
      success: true,
      data: rows,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    logger.error({ err }, 'Admin /disputes error');
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/admin/flagged-agents
// ---------------------------------------------------------------------------

router.get('/flagged-agents', async (_req: Request, res: Response) => {
  try {
    const rows = await safeQuery(
      `SELECT agent_id, score, grade, updated_at
         FROM agentrank_scores
        WHERE score < 400
        ORDER BY score ASC
        LIMIT 50`,
    );

    res.json({ success: true, data: rows });
  } catch (err) {
    logger.error({ err }, 'Admin /flagged-agents error');
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/admin/stalled-escrows
// ---------------------------------------------------------------------------

router.get('/stalled-escrows', async (_req: Request, res: Response) => {
  try {
    const rows = await safeQuery(
      `SELECT * FROM agent_escrows
        WHERE status = 'locked'
          AND created_at < NOW() - INTERVAL '48 hours'
        ORDER BY created_at ASC
        LIMIT 50`,
    );

    res.json({ success: true, data: rows });
  } catch (err) {
    logger.error({ err }, 'Admin /stalled-escrows error');
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/admin/failed-payments
// ---------------------------------------------------------------------------

router.get('/failed-payments', async (_req: Request, res: Response) => {
  try {
    const rows = await safeQuery(
      `SELECT * FROM payment_intents
        WHERE status = 'failed'
          AND created_at >= NOW() - INTERVAL '24 hours'
        ORDER BY created_at DESC
        LIMIT 100`,
    );

    res.json({ success: true, data: rows });
  } catch (err) {
    logger.error({ err }, 'Admin /failed-payments error');
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/admin/top-agents
// ---------------------------------------------------------------------------

router.get('/top-agents', async (_req: Request, res: Response) => {
  try {
    let rows: Record<string, unknown>[] = [];

    try {
      rows = await prisma.$queryRaw<Record<string, unknown>[]>`
        SELECT agent_id, SUM(amount) AS total_earnings, COUNT(*) AS job_count
          FROM agent_transactions
         WHERE status = 'completed'
         GROUP BY agent_id
         ORDER BY total_earnings DESC
         LIMIT 20
      `;
    } catch (err: any) {
      if (err?.code === 'P2021' || err?.message?.includes('does not exist')) {
        logger.warn('Admin /top-agents: agent_transactions table missing');
      } else {
        throw err;
      }
    }

    res.json({ success: true, data: rows });
  } catch (err) {
    logger.error({ err }, 'Admin /top-agents error');
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/admin/anomalies
// ---------------------------------------------------------------------------

router.get('/anomalies', async (_req: Request, res: Response) => {
  try {
    const report = getLastReport();

    res.json({
      success: true,
      data: report
        ? {
            runId: report.runId,
            completedAt: report.completedAt,
            anomalies: report.anomalies,
            stats: report.stats,
          }
        : null,
    });
  } catch (err) {
    logger.error({ err }, 'Admin /anomalies error');
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/admin/risk-tiers
// ---------------------------------------------------------------------------

router.get('/risk-tiers', async (_req: Request, res: Response) => {
  try {
    const rows = await safeQuery<{ grade: string; count: string }>(
      `SELECT grade, COUNT(*) AS count
         FROM agentrank_scores
        GROUP BY grade
        ORDER BY grade`,
    );

    const tierMap: Record<string, number> = {};
    for (const row of rows) {
      tierMap[row.grade] = parseInt(row.count, 10);
    }

    res.json({ success: true, data: tierMap });
  } catch (err) {
    logger.error({ err }, 'Admin /risk-tiers error');
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
