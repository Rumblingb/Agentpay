import { Hono } from 'hono';
import { beforeEach, describe, expect, it } from 'vitest';

import { clearRateLimitWindowsForTests, rateLimitMiddleware } from '../src/middleware/rateLimit';
import type { Env, Variables } from '../src/types';

describe('edge rate limiting', () => {
  beforeEach(() => clearRateLimitWindowsForTests());

  it('caps commerce compilation at six requests per minute for every API tier', async () => {
    const app = new Hono<{ Bindings: Env; Variables: Variables }>();
    app.use('*', rateLimitMiddleware);
    app.post('/api/commerce/compile', (c) => c.json({ ok: true }));

    for (let requestNumber = 1; requestNumber <= 6; requestNumber += 1) {
      const response = await app.request('/api/commerce/compile', {
        method: 'POST',
        headers: {
          Authorization: 'apk_ent_test-key',
          'CF-Connecting-IP': '203.0.113.42',
        },
      }, {} as Env);
      expect(response.status).toBe(200);
      expect(response.headers.get('X-RateLimit-Limit')).toBe('6');
      expect(response.headers.get('X-RateLimit-Remaining')).toBe(String(6 - requestNumber));
    }

    const blocked = await app.request('/api/commerce/compile', {
      method: 'POST',
      headers: {
        Authorization: 'apk_ent_test-key',
        'CF-Connecting-IP': '203.0.113.42',
      },
    }, {} as Env);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('Retry-After')).toBeTruthy();
    await expect(blocked.json()).resolves.toMatchObject({ error: 'RATE_LIMIT_EXCEEDED' });
  });

  it('keeps unrelated enterprise traffic on the existing tier multiplier', async () => {
    const app = new Hono<{ Bindings: Env; Variables: Variables }>();
    app.use('*', rateLimitMiddleware);
    app.get('/api/example', (c) => c.json({ ok: true }));

    const response = await app.request('/api/example', {
      headers: {
        Authorization: 'apk_ent_test-key',
        'CF-Connecting-IP': '203.0.113.43',
      },
    }, {} as Env);
    expect(response.status).toBe(200);
    expect(response.headers.get('X-RateLimit-Limit')).toBe('1200');
  });
});
