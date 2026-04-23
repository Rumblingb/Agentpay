/**
 * mandateApprovalLinks.ts — public mandate approval link handling.
 * Serves the human-readable approval page at /api/public/mandates/:token
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../types';

const router = new Hono<{ Bindings: Env; Variables: Variables }>();

router.get('/:token', async (c) => {
  return c.json({ error: 'Mandate approval UI not yet configured' }, 501);
});

export { router as mandateApprovalLinksRouter };
