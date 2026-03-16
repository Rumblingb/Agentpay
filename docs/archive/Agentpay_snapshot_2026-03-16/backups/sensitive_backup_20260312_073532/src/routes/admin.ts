/**
 * Admin Dashboard API
 *
 * All endpoints require the `x-admin-key` header to match ADMIN_SECRET_KEY.
 *
 * Endpoints:
 *   GET /api/admin/health                        — system health summary
 *   GET /api/admin/disputes                      — open disputes (paginated)
 *   GET /api/admin/flagged-agents                — agents with elevated risk or behavior alerts
 *   GET /api/admin/stalled-escrows               — escrows locked > 48h without release
 *   GET /api/admin/failed-payments               — payment_intents failed in last 24h
 *   GET /api/admin/top-agents                    — top 20 agents by earnings
 *   GET /api/admin/anomalies                     — latest reconciliation anomalies
 *   GET /api/admin/risk-tiers                    — agent count by risk tier
 *
 * Phase 11 — Settlement mismatch observability (beta debug):
 *   GET /api/admin/settlement-mismatches         — recent failed/unmatched resolutions with reason codes
 *   GET /api/admin/settlement-mismatches/:intentId — full mismatch detail for a specific intent
 *
 * @module routes/admin
 */

import { Router, Request, Response, NextFunction } from 'express';
import prisma from '../lib/prisma.js';
import { query } from '../db/index.js';
import { logger } from '../logger.js';
import { getLastReport } from '../services/reconciliationService.js';
import { env } from '../config/env.js';

const router = Router();

// ---------------------------------------------------------------------------
// Auth middleware — must precede all admin route handlers
// ---------------------------------------------------------------------------

const ADMIN_KEY = env.ADMIN_SECRET_KEY;

if (!env.ADMIN_SECRET_KEY) {
  logger.warn('ADMIN_SECRET_KEY is not set. In production this will prevent startup.');
}

function requireAdminKey(req: Request, res: Response, next: NextFunction): void {
  const key = req.headers['x-admin-key'];
  // Always accept the default dev admin key in test mode
  if (process.env.NODE_ENV === 'test' && key === 'admin-dev-key') {
    return next();
  }
  if (key !== ADMIN_KEY) {
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

// ---------------------------------------------------------------------------
// Phase 11 — Settlement mismatch observability
// GET /api/admin/settlement-mismatches?limit=50&protocol=solana&reasonCode=memo_missing
// ---------------------------------------------------------------------------

/**
 * Returns recent intent resolutions whose outcome was not 'confirmed',
 * together with the reason code that explains why matching failed.
 *
 * Safe to expose to admins only — no payer PII is returned beyond what
 * the operator already owns (intentId, protocol, reasonCode, decisionCode).
 *
 * Query parameters:
 *   limit      — max records to return (default 50, max 200)
 *   protocol   — filter by settlement protocol (solana | stripe | …)
 *   reasonCode — filter by a specific reason code
 *   since      — ISO-8601 timestamp lower-bound on resolved_at
 */
router.get('/settlement-mismatches', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit || '50'), 10)));
    const protocol = typeof req.query.protocol === 'string' ? req.query.protocol : undefined;
    const reasonCode = typeof req.query.reasonCode === 'string' ? req.query.reasonCode : undefined;
    const since = typeof req.query.since === 'string' ? req.query.since : undefined;

    // Build a parameterised WHERE clause for the raw query so we can filter
    // by the optional query parameters without constructing unsafe SQL.
    const conditions: string[] = ["resolution_status <> 'confirmed'"];
    const params: unknown[] = [];

    if (protocol) {
      params.push(protocol);
      conditions.push(`protocol = $${params.length}`);
    }
    if (reasonCode) {
      params.push(reasonCode);
      conditions.push(`reason_code = $${params.length}`);
    }
    if (since) {
      const sinceDate = new Date(since);
      if (!isNaN(sinceDate.getTime())) {
        params.push(sinceDate.toISOString());
        conditions.push(`resolved_at >= $${params.length}`);
      }
    }

    params.push(limit);
    const whereClause = conditions.join(' AND ');

    const rows = await safeQuery<{
      id: string;
      intent_id: string;
      protocol: string;
      resolved_by: string;
      resolution_status: string;
      decision_code: string | null;
      reason_code: string | null;
      confidence_score: string | null;
      external_ref: string | null;
      resolved_at: string;
    }>(
      `SELECT id,
              intent_id,
              protocol,
              resolved_by,
              resolution_status,
              decision_code,
              reason_code,
              confidence_score,
              external_ref,
              resolved_at
         FROM intent_resolutions
        WHERE ${whereClause}
        ORDER BY resolved_at DESC
        LIMIT $${params.length}`,
      params,
    );

    const data = rows.map((r) => ({
      id: r.id,
      intentId: r.intent_id,
      protocol: r.protocol,
      resolvedBy: r.resolved_by,
      resolutionStatus: r.resolution_status,
      decisionCode: r.decision_code ?? null,
      reasonCode: r.reason_code ?? null,
      confidenceScore: r.confidence_score !== null ? Number(r.confidence_score) : null,
      externalRef: r.external_ref ?? null,
      resolvedAt: r.resolved_at,
    }));

    res.json({ success: true, count: data.length, data });
  } catch (err) {
    logger.error({ err }, 'Admin /settlement-mismatches error');
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// Phase 11 — Settlement mismatch detail
// GET /api/admin/settlement-mismatches/:intentId
// ---------------------------------------------------------------------------

/**
 * Returns the full resolution record for a specific intent plus a joined
 * snapshot of the payment intent status and any settlement_events that
 * were emitted during the match attempt.
 *
 * This is the primary tool for understanding *why* a specific payment did
 * not resolve: reason_code, decision_code, and the settlement_events audit
 * trail are all surfaced here.
 */
router.get('/settlement-mismatches/:intentId', async (req: Request, res: Response) => {
  const { intentId } = req.params;

  try {
    // Fetch intent + resolution in one query to minimise round trips.
    const intentRows = await safeQuery<{
      pi_id: string;
      pi_status: string;
      pi_protocol: string | null;
      pi_amount: string;
      ir_id: string | null;
      ir_resolved_by: string | null;
      ir_resolution_status: string | null;
      ir_decision_code: string | null;
      ir_reason_code: string | null;
      ir_confidence_score: string | null;
      ir_external_ref: string | null;
      ir_payer_ref: string | null;
      ir_resolved_at: string | null;
      ir_metadata: unknown;
    }>(
      `SELECT pi.id             AS pi_id,
              pi.status         AS pi_status,
              pi.protocol       AS pi_protocol,
              pi.amount         AS pi_amount,
              ir.id             AS ir_id,
              ir.resolved_by    AS ir_resolved_by,
              ir.resolution_status AS ir_resolution_status,
              ir.decision_code  AS ir_decision_code,
              ir.reason_code    AS ir_reason_code,
              ir.confidence_score AS ir_confidence_score,
              ir.external_ref   AS ir_external_ref,
              ir.payer_ref      AS ir_payer_ref,
              ir.resolved_at    AS ir_resolved_at,
              ir.metadata       AS ir_metadata
         FROM payment_intents pi
         LEFT JOIN intent_resolutions ir ON ir.intent_id = pi.id
        WHERE pi.id = $1`,
      [intentId],
    );

    if (intentRows.length === 0) {
      res.status(404).json({ success: false, error: 'NOT_FOUND', message: 'Intent not found' });
      return;
    }

    const row = intentRows[0];

    // Fetch recent settlement events for this intent for the audit trail.
    const eventRows = await safeQuery<{
      id: string;
      event_type: string;
      protocol: string;
      external_ref: string | null;
      payload: unknown;
      created_at: string;
    }>(
      `SELECT id,
              event_type,
              protocol,
              external_ref,
              payload,
              created_at
         FROM settlement_events
        WHERE intent_id = $1
        ORDER BY created_at DESC
        LIMIT 20`,
      [intentId],
    );

    const resolution = row.ir_id
      ? {
          id: row.ir_id,
          resolvedBy: row.ir_resolved_by,
          resolutionStatus: row.ir_resolution_status,
          decisionCode: row.ir_decision_code ?? null,
          reasonCode: row.ir_reason_code ?? null,
          confidenceScore: row.ir_confidence_score !== null ? Number(row.ir_confidence_score) : null,
          externalRef: row.ir_external_ref ?? null,
          payerRef: row.ir_payer_ref ?? null,
          resolvedAt: row.ir_resolved_at ?? null,
          metadata: typeof row.ir_metadata === 'object' && row.ir_metadata !== null
            ? row.ir_metadata as Record<string, unknown>
            : {},
        }
      : null;

    res.json({
      success: true,
      data: {
        intent: {
          id: row.pi_id,
          status: row.pi_status,
          protocol: row.pi_protocol ?? null,
          amount: Number(row.pi_amount),
        },
        resolution,
        // Audit trail: settlement events emitted during match attempts.
        settlementEvents: eventRows.map((e) => ({
          id: e.id,
          eventType: e.event_type,
          protocol: e.protocol,
          externalRef: e.external_ref ?? null,
          payload: e.payload,
          createdAt: e.created_at,
        })),
      },
    });
  } catch (err) {
    logger.error({ err, intentId }, 'Admin /settlement-mismatches/:intentId error');
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;

