/**
 * Certificate routes — POST /api/certificates/validate
 *
 * Ports src/routes/certificates.ts to Hono/Workers.
 *
 * Changes from Express:
 *   - validateCertificate() is now async (uses SubtleCrypto)
 *   - VERIFICATION_SECRET read from c.env (Workers binding) not process.env
 *
 * Preserved:
 *   - Route path: POST /api/certificates/validate
 *   - Request shape: { encoded: string }
 *   - Response shape: { valid: true, payload } | { valid: false }
 *   - Returns 200 for both valid and invalid (not 400 for invalid certificates)
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { validateCertificate } from '../lib/certificate';

const router = new Hono<{ Bindings: Env; Variables: Variables }>();

router.post('/validate', async (c) => {
  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const { encoded } = body;

  if (!encoded || typeof encoded !== 'string') {
    return c.json({ error: 'Missing or invalid "encoded" field' }, 400);
  }

  try {
    const payload = await validateCertificate(encoded, c.env.VERIFICATION_SECRET);
    if (payload) {
      return c.json({ valid: true, payload });
    }
    return c.json({ valid: false });
  } catch (err: unknown) {
    console.error('[certificates] validation error:', err instanceof Error ? err.message : err);
    return c.json({ error: 'Certificate validation failed' }, 500);
  }
});

export { router as certificatesRouter };
