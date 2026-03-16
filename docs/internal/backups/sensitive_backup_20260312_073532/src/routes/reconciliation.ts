/**
 * Reconciliation API Routes
 *
 * POST /api/reconciliation/run   — trigger a reconciliation pass (auth required)
 * GET  /api/reconciliation/last  — fetch the most recent report (auth required)
 *
 * @module routes/reconciliation
 */

import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { authenticateApiKey } from '../middleware/auth.js';
import { runReconciliation, getLastReport } from '../services/reconciliationService.js';
import { logger } from '../logger.js';

const router = Router();

// Strict rate limit — reconciliation is an expensive DB scan
const reconciliationLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many reconciliation requests. Wait 60 seconds.' },
});

/**
 * POST /api/reconciliation/run
 *
 * Triggers a full reconciliation pass. Returns the report when done.
 * Protected by API key auth so only merchants/operators can trigger it.
 */
router.post('/run', reconciliationLimiter, authenticateApiKey, async (_req: Request, res: Response) => {
  try {
    logger.info('[reconciliation route] Manual run triggered');
    const report = await runReconciliation();
    res.json({ success: true, report });
  } catch (err: any) {
    logger.error('[reconciliation route] Run failed', { err: err?.message });
    res.status(500).json({ error: 'Reconciliation run failed' });
  }
});

/**
 * GET /api/reconciliation/last
 *
 * Returns the most recent reconciliation report, or a 404 if no run
 * has completed yet.
 */
router.get('/last', authenticateApiKey, (_req: Request, res: Response) => {
  const report = getLastReport();
  if (!report) {
    res.status(404).json({ error: 'No reconciliation report available yet. POST /run to generate one.' });
    return;
  }
  res.json({ success: true, report });
});

export default router;
