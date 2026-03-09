import rateLimit from 'express-rate-limit';

/**
 * Rate limiter for the public receipt endpoint.
 * Allows up to 20 requests per 15-second window per IP.
 */
export const receiptLimiter = rateLimit({
  windowMs: 15_000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again shortly.' },
});

/**
 * Rate limiter for stats / analytics endpoints.
 * Allows up to 30 requests per 30-second window per IP.
 */
export const statsLimiter = rateLimit({
  windowMs: 30_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again shortly.' },
});
