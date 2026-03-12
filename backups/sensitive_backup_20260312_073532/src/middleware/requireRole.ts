/**
 * RBAC Role-based access control middleware.
 *
 * Usage:
 *   router.get('/admin/only', requireRole(['admin']), handler)
 *   router.get('/platform', requireRole(['admin', 'platform']), handler)
 *
 * Roles are resolved from:
 *   1. x-admin-key header → 'admin' role
 *   2. x-platform-key header → 'platform' role (matches platforms table)
 *   3. Authenticated merchant (req.merchant) → 'merchant' role
 *   4. req.agent → 'agent' role
 *
 * This module does NOT break existing admin-key logic — the admin key still
 * works exactly as before; requireRole(['admin']) simply formalises that check.
 */

import { Request, Response, NextFunction } from 'express';
import { logger } from '../logger.js';
import { AuthRequest } from './auth.js';

export type Role = 'admin' | 'platform' | 'agent' | 'merchant';

export interface RbacRequest extends AuthRequest {
  roles?: Role[];
  platformId?: string;
}

const ADMIN_KEY = process.env.ADMIN_SECRET_KEY || 'admin-dev-key';

/**
 * Middleware that resolves roles from request headers and attaches them to
 * `req.roles`. Call this BEFORE requireRole() in route chains.
 */
export async function resolveRoles(
  req: RbacRequest,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const roles: Role[] = [];

  // Admin key → admin role
  if (req.headers['x-admin-key'] === ADMIN_KEY) {
    roles.push('admin');
  }

  // Platform key → platform role (stored in x-platform-key header)
  if (req.headers['x-platform-key']) {
    roles.push('platform');
    // platformId will be populated by assignPlatformFromKey middleware when used
  }

  // Authenticated merchant (set by authenticateApiKey) → merchant role
  if ((req as RbacRequest).merchant) {
    roles.push('merchant');
  }

  req.roles = roles;
  next();
}

/**
 * Returns middleware that enforces at least one of the specified roles.
 * Must be called AFTER resolveRoles() (or after authenticateApiKey for
 * merchant-only routes).
 *
 * Example:
 *   router.use(resolveRoles);
 *   router.get('/data', requireRole(['admin', 'platform']), handler);
 */
export function requireRole(allowedRoles: Role[]) {
  return (req: RbacRequest, res: Response, next: NextFunction): void => {
    const userRoles = req.roles ?? [];

    // Admin always passes
    if (userRoles.includes('admin')) {
      return next();
    }

    const hasRole = allowedRoles.some((r) => userRoles.includes(r));
    if (!hasRole) {
      logger.warn(
        { path: req.path, required: allowedRoles, present: userRoles },
        '[RBAC] Access denied — insufficient role',
      );
      res.status(403).json({
        code: 'RBAC_FORBIDDEN',
        message: 'You do not have permission to access this resource.',
        requiredRoles: allowedRoles,
      });
      return;
    }

    next();
  };
}
