/**
 * Admin Dashboard API Routes
 *
 * Protected routes for the platform founder/admin to track:
 * - Total Protocol MRR
 * - Active agents count
 * - Merchant analytics
 * - Moltbook vs API revenue breakdown
 *
 * Protected by ADMIN_API_KEY environment variable.
 */

import { Router, Request, Response } from 'express';
import { query } from '../db/index';
import { logger } from '../logger';

const router = Router();

/**
 * Admin authentication middleware.
 * Checks for a valid ADMIN_API_KEY in the Authorization header.
 */
function authenticateAdmin(req: Request, res: Response, next: Function): void {
  const adminKey = process.env.ADMIN_API_KEY;
  if (!adminKey) {
    res.status(503).json({ error: 'Admin API not configured' });
    return;
  }

  const authHeader = req.headers.authorization;
  const providedKey = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7)
    : (req.headers['x-admin-key'] as string);

  if (!providedKey || providedKey !== adminKey) {
    res.status(403).json({ error: 'Forbidden — invalid admin credentials' });
    return;
  }

  next();
}

// Apply admin auth to all routes
router.use(authenticateAdmin);

/**
 * GET /admin/stats
 *
 * Returns high-level platform statistics for the founder dashboard.
 */
router.get('/stats', async (_req: Request, res: Response) => {
  try {
    // Total merchants
    const merchantsResult = await query(
      `SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE is_active = true) as active FROM merchants`,
    );

    // Total payment intents and volume
    const intentsResult = await query(
      `SELECT COUNT(*) as total,
              COUNT(*) FILTER (WHERE status = 'verified') as verified,
              COALESCE(SUM(amount) FILTER (WHERE status = 'verified'), 0) as total_volume
       FROM payment_intents`,
    );

    // Active agents (unique agent IDs in last 30 days)
    let activeAgents = 0;
    try {
      const agentsResult = await query(
        `SELECT COUNT(DISTINCT metadata->>'agentId') as active_agents
         FROM payment_intents
         WHERE created_at >= NOW() - INTERVAL '30 days'
           AND metadata->>'agentId' IS NOT NULL`,
      );
      activeAgents = parseInt(agentsResult.rows[0]?.active_agents || '0', 10);
    } catch {
      // metadata column may not support jsonb query
    }

    // Monthly recurring revenue (platform fees in last 30 days)
    let mrr = 0;
    try {
      const mrrResult = await query(
        `SELECT COALESCE(SUM(fee_amount), 0) as mrr
         FROM merchant_invoices
         WHERE created_at >= NOW() - INTERVAL '30 days'
           AND status != 'waived'`,
      );
      mrr = parseFloat(mrrResult.rows[0]?.mrr || '0');
    } catch {
      // merchant_invoices table may not exist
    }

    // Revenue by type (Moltbook vs API)
    let revenueByType: Record<string, number> = {};
    try {
      const typeResult = await query(
        `SELECT
           COALESCE(metadata->>'type', 'direct') as revenue_type,
           COALESCE(SUM(amount), 0) as total
         FROM payment_intents
         WHERE status = 'verified'
           AND created_at >= NOW() - INTERVAL '30 days'
         GROUP BY metadata->>'type'`,
      );
      for (const row of typeResult.rows) {
        revenueByType[row.revenue_type] = parseFloat(row.total);
      }
    } catch {
      // Skip if metadata queries fail
    }

    const merchants = merchantsResult.rows[0];
    const intents = intentsResult.rows[0];

    res.json({
      success: true,
      stats: {
        merchants: {
          total: parseInt(merchants.total, 10),
          active: parseInt(merchants.active, 10),
        },
        intents: {
          total: parseInt(intents.total, 10),
          verified: parseInt(intents.verified, 10),
          totalVolumeUsdc: parseFloat(intents.total_volume),
        },
        activeAgents,
        mrr,
        revenueByType,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    logger.error('Admin stats error', { err: err.message });
    res.status(500).json({ error: 'Failed to fetch platform stats' });
  }
});

export default router;
