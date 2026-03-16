/**
 * Legal API — returns the current policy version and content hash.
 *
 * GET /api/legal
 *
 * Response:
 * {
 *   "version": "1.0.0",
 *   "policies": {
 *     "terms-of-service": { "hash": "...", "url": "..." },
 *     "privacy-policy":   { "hash": "...", "url": "..." },
 *     ...
 *   }
 * }
 */

import { Router, Request, Response } from 'express';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const router = Router();

const _legalDir = (() => {
  // Works in both ESM (import.meta.url) and CJS/Jest (__dirname) environments
  try {
    const metaUrl = new Function('return import.meta.url')() as string;
    return join(dirname(fileURLToPath(metaUrl)), '../../legal');
  } catch {
    // Jest/CJS fallback
    return join(process.cwd(), 'legal');
  }
})();

const POLICY_VERSION = '1.0.0';

const POLICY_FILES: Record<string, string> = {
  'terms-of-service':       'terms-of-service.md',
  'privacy-policy':         'privacy-policy.md',
  'non-custodial-disclaimer': 'non-custodial-disclaimer.md',
  'security-policy':        'security-policy.md',
};

function hashFile(filename: string): string | null {
  try {
    const content = readFileSync(join(_legalDir, filename), 'utf-8');
    return createHash('sha256').update(content).digest('hex').slice(0, 16);
  } catch {
    return null;
  }
}

router.get('/', (_req: Request, res: Response): void => {
  const policies: Record<string, { hash: string | null; file: string }> = {};

  for (const [key, file] of Object.entries(POLICY_FILES)) {
    policies[key] = { hash: hashFile(file), file };
  }

  res.json({
    version: POLICY_VERSION,
    updatedAt: '2025-01-01',
    policies,
    contact: 'legal@agentpay.gg',
  });
});

export default router;
