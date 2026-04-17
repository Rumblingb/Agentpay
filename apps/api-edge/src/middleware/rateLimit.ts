/**
 * Edge rate limiter — Cloudflare Workers compatible.
 *
 * Uses an in-memory sliding window per (IP, route bucket).  Because Workers
 * isolates are ephemeral and may restart at any time, this is a best-effort
 * DoS deterrent rather than a hard cap.  For strict enforcement, configure
 * Cloudflare Rate Limiting rules at the zone level (Workers → Rate Limiting).
 *
 * Route buckets and limits:
 *   'register'          10 req / 60s  — merchant registration (costly DB write)
 *   'concierge_intent'  20 req / 60s  — voice concierge planning/execution
 *   'intent_create'     60 req / 60s  — agent intent creation per IP
 *   'intent_verify'     30 req / 60s  — txHash submission per IP
 *   'key_rotate'        5  req / 60s  — API key rotation
 *   'oauth_register'    10 req / 60s  — host connector client registration
 *   'oauth_authorize'   20 req / 60s  — hosted authorize form posts/views
 *   'oauth_email_link'  5  req / 60s  — email-link delivery / anti-spam
 *   'oauth_email_confirm' 20 req / 60s — signed email-link confirmation
 *   'oauth_token'       30 req / 60s  — auth-code token exchange
 *   'default'           120 req / 60s — everything else
 */

import type { MiddlewareHandler } from 'hono';
import type { Env, Variables } from '../types';

interface Window {
  count: number;
  resetAt: number;
}

// Global map — lives for the duration of the isolate (minutes to hours)
const windows = new Map<string, Window>();

/**
 * Rate limit tiers by API key prefix.
 * Enterprise keys (apk_ent_*) get 10× headroom.
 * Growth keys (apk_grow_*) get 3× headroom.
 * Starter / no key: base limits.
 *
 * Revenue implications:
 *   - Hitting limits nudges users toward paid enterprise tier.
 *   - Enterprise subscription: $500–$5,000/month (see docs/REVENUE.md).
 */
type Tier = 'enterprise' | 'growth' | 'starter';

function getApiTier(req: Request): Tier {
  const key = req.headers.get('X-Api-Key') ?? req.headers.get('Authorization') ?? '';
  if (key.startsWith('apk_ent_')) return 'enterprise';
  if (key.startsWith('apk_grow_')) return 'growth';
  return 'starter';
}

const TIER_MULTIPLIER: Record<Tier, number> = {
  enterprise: 10,
  growth:      3,
  starter:     1,
};

const BASE_LIMITS: Record<string, { max: number; windowMs: number }> = {
  register:       { max: 10,  windowMs: 60_000 },
  concierge_intent:{ max: 20, windowMs: 60_000 },
  intent_create:  { max: 60,  windowMs: 60_000 },
  intent_verify:  { max: 30,  windowMs: 60_000 },
  key_rotate:     { max: 5,   windowMs: 60_000 },
  agent_register: { max: 5,   windowMs: 60_000 },
  passport_read:  { max: 60,  windowMs: 60_000 }, // free for all tiers
  agentrank_read: { max: 30,  windowMs: 60_000 }, // premium: growth/enterprise get more
  oauth_register: { max: 10,  windowMs: 60_000 },
  oauth_authorize:{ max: 20,  windowMs: 60_000 },
  oauth_email_link:{ max: 5,  windowMs: 60_000 },
  oauth_email_confirm:{ max: 20, windowMs: 60_000 },
  oauth_token:    { max: 30,  windowMs: 60_000 },
  default:        { max: 120, windowMs: 60_000 },
};

function getBucket(path: string, method: string): string {
  if (method === 'POST' && path === '/register')                   return 'oauth_register';
  if (path === '/authorize' && (method === 'GET' || method === 'POST')) return 'oauth_authorize';
  if (method === 'POST' && path === '/authorize/email-link')       return 'oauth_email_link';
  if ((method === 'GET' || method === 'POST') && path === '/authorize/email-link/confirm') return 'oauth_email_confirm';
  if (method === 'GET' && path === '/authorize/email-link')        return 'oauth_email_confirm';
  if (method === 'POST' && path === '/token')                      return 'oauth_token';
  if (method === 'POST' && path.includes('/merchants/register'))   return 'register';
  if (method === 'POST' && path.includes('/merchants/rotate-key')) return 'key_rotate';
  if (method === 'POST' && path.includes('/api/concierge/intent')) return 'concierge_intent';
  if (method === 'POST' && /\/v1\/payment-intents$/.test(path))    return 'intent_create';
  if (method === 'POST' && path.includes('/verify'))               return 'intent_verify';
  if (method === 'POST' && path.includes('/v1/agents/register'))   return 'agent_register';
  if (method === 'GET'  && path.startsWith('/api/passport'))       return 'passport_read';
  if (method === 'GET'  && path.includes('/agentrank'))            return 'agentrank_read';
  return 'default';
}

function getClientIp(req: Request): string {
  return (
    req.headers.get('CF-Connecting-IP') ??
    req.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ??
    'unknown'
  );
}

export const rateLimitMiddleware: MiddlewareHandler<{ Bindings: Env; Variables: Variables }> = async (
  c,
  next,
) => {
  const ip     = getClientIp(c.req.raw);
  const tier   = getApiTier(c.req.raw);
  const bucket = getBucket(c.req.path, c.req.method);
  const base   = BASE_LIMITS[bucket];
  // passport_read stays the same across tiers (free product)
  const multiplier = bucket === 'passport_read' || bucket.startsWith('oauth_') ? 1 : TIER_MULTIPLIER[tier];
  const max        = base.max * multiplier;
  const { windowMs } = base;

  // Expose tier in response for developer visibility
  c.header('X-AgentPay-Tier', tier);

  const key = `${ip}:${bucket}`;
  const now = Date.now();

  let win = windows.get(key);
  if (!win || win.resetAt < now) {
    win = { count: 0, resetAt: now + windowMs };
    windows.set(key, win);
  }

  win.count++;

  if (win.count > max) {
    const retryAfterSec = Math.ceil((win.resetAt - now) / 1000);
    c.header('Retry-After', String(retryAfterSec));
    c.header('X-RateLimit-Limit', String(max));
    c.header('X-RateLimit-Remaining', '0');
    c.header('X-RateLimit-Reset', String(Math.ceil(win.resetAt / 1000)));
    return c.json(
      { error: 'RATE_LIMIT_EXCEEDED', message: `Too many requests. Retry after ${retryAfterSec}s.` },
      429,
    );
  }

  c.header('X-RateLimit-Limit', String(max));
  c.header('X-RateLimit-Remaining', String(Math.max(0, max - win.count)));
  c.header('X-RateLimit-Reset', String(Math.ceil(win.resetAt / 1000)));

  // Periodically prune stale entries to prevent memory leaks in long-lived isolates
  if (windows.size > 10_000) {
    for (const [k, w] of windows) {
      if (w.resetAt < now) windows.delete(k);
    }
  }

  return next();
};

export function clearRateLimitWindowsForTests(): void {
  windows.clear();
}
