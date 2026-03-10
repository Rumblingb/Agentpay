/**
 * Multi-tenant platform isolation middleware.
 *
 * Platform API keys are sent via the `x-platform-key` header.  This middleware
 * looks up the key in the `platforms` table and attaches `req.platformId` so
 * that downstream route handlers can scope all queries to the correct tenant.
 *
 * If no platform key is provided the request is treated as belonging to the
 * "default" platform (backward compatible with existing single-tenant deployments).
 *
 * Usage:
 *   router.use(assignPlatformFromKey);
 *   // ... route handlers that use req.platformId
 */

import { Request, Response, NextFunction } from 'express';
import { query } from '../db/index.js';
import { logger } from '../logger.js';

export interface PlatformRequest extends Request {
  platformId?: string;
  platformName?: string;
}

const DEFAULT_PLATFORM_ID = process.env.DEFAULT_PLATFORM_ID ?? 'default';

export async function assignPlatformFromKey(
  req: PlatformRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const platformKey = req.headers['x-platform-key'] as string | undefined;

  if (!platformKey) {
    // No key — use default platform (backward-compatible)
    req.platformId = DEFAULT_PLATFORM_ID;
    return next();
  }

  try {
    const result = await query(
      `SELECT id, name, is_active FROM platforms WHERE api_key_hash = $1 AND is_active = TRUE LIMIT 1`,
      [platformKey], // In production, store a hash — for now accept the raw key
    );

    if (result.rows.length === 0) {
      res.status(401).json({
        code: 'PLATFORM_AUTH_INVALID',
        message: 'Invalid or inactive platform key',
      });
      return;
    }

    req.platformId = result.rows[0].id;
    req.platformName = result.rows[0].name;
    logger.debug({ platformId: req.platformId }, '[Platform] Key resolved');
  } catch (err: any) {
    // Non-fatal: fall back to default platform so existing flows are unaffected
    logger.warn({ err: err.message }, '[Platform] Key lookup failed — using default platform');
    req.platformId = DEFAULT_PLATFORM_ID;
  }

  next();
}
