/**
 * JSON request/response logging middleware.
 *
 * Produces structured pino logs for every HTTP request:
 *   - method, path, status, durationMs
 *   - request ID (x-request-id or auto-generated)
 *   - Render-compatible JSON format in production
 *
 * Also increments Prometheus-compatible metrics counters.
 *
 * Usage: app.use(httpLogger) before route mounts.
 */

import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import { logger } from '../logger.js';
import { metrics } from '../services/metrics.js';

export function httpLogger(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const start = Date.now();

  // Attach / forward request ID for distributed tracing
  const requestId =
    (req.headers['x-request-id'] as string | undefined) ?? randomUUID();
  req.headers['x-request-id'] = requestId;
  res.setHeader('x-request-id', requestId);

  res.on('finish', () => {
    const durationMs = Date.now() - start;
    const level =
      res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';

    logger[level]({
      type: 'http',
      requestId,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      durationMs,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });

    // Prometheus metrics
    metrics.increment('http_requests_total', {
      method: req.method,
      route: req.path.replace(/\/[0-9a-f-]{36}/gi, '/:id'), // normalise UUIDs
      status: String(res.statusCode),
    });
    metrics.observe('http_request_duration_ms', durationMs);
  });

  next();
}
