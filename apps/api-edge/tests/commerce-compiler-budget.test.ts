import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import { commerceCompilerBudgetMiddleware } from '../src/middleware/commerceCompilerBudget';
import type { Env, RateLimitBinding, Variables } from '../src/types';

function buildApp() {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use('*', async (c, next) => {
    c.set('merchant', {
      id: 'merchant-private-id',
      name: 'Private Merchant',
      email: 'private@example.test',
      walletAddress: null,
      webhookUrl: null,
    });
    await next();
  });
  app.use('*', commerceCompilerBudgetMiddleware);
  app.post('/compile', (c) => c.json({ ok: true }));
  return app;
}

function limiter(success: boolean, seen: string[] = []): RateLimitBinding {
  return {
    limit: vi.fn(async ({ key }: { key: string }) => {
      seen.push(key);
      return { success };
    }),
  };
}

describe('commerce compiler cost controls', () => {
  it('fails closed whenever real model billing lacks Cloudflare quotas', async () => {
    const response = await buildApp().request('/compile', { method: 'POST' }, {
      OPENAI_API_KEY: 'server-funded-model-key',
    } as Env);

    expect(response.status).toBe(503);
    expect(response.headers.get('X-AgentPay-Rate-Control')).toBe('unavailable');
    await expect(response.json()).resolves.toMatchObject({ error: 'COMMERCE_RATE_CONTROL_UNAVAILABLE' });
  });

  it('retains the isolate backstop for local deterministic development', async () => {
    const response = await buildApp().request('/compile', { method: 'POST' }, {} as Env);

    expect(response.status).toBe(200);
    expect(response.headers.get('X-AgentPay-Rate-Control')).toBe('isolate');
  });

  it('uses opaque shopper and merchant keys for both Cloudflare quotas', async () => {
    const shopperKeys: string[] = [];
    const merchantKeys: string[] = [];
    const response = await buildApp().request('/compile', {
      method: 'POST',
      headers: {
        'CF-Connecting-IP': '203.0.113.42',
        'X-AgentPay-Consumer-Key': 'a'.repeat(64),
      },
    }, {
      OPENAI_API_KEY: 'server-funded-model-key',
      COMMERCE_COMPILER_SHOPPER_LIMITER: limiter(true, shopperKeys),
      COMMERCE_COMPILER_MERCHANT_LIMITER: limiter(true, merchantKeys),
    } as Env);

    expect(response.status).toBe(200);
    expect(response.headers.get('X-AgentPay-Rate-Control')).toBe('isolate+cloudflare');
    expect([...shopperKeys, ...merchantKeys]).toHaveLength(2);
    for (const key of [...shopperKeys, ...merchantKeys]) {
      expect(key).toMatch(/^[a-f0-9]{64}$/);
      expect(key).not.toContain('merchant-private-id');
      expect(key).not.toContain('203.0.113.42');
    }
    expect(shopperKeys[0]).not.toBe(merchantKeys[0]);
  });

  it('returns a scoped 429 before the model call when shopper capacity is spent', async () => {
    const response = await buildApp().request('/compile', { method: 'POST' }, {
      OPENAI_API_KEY: 'server-funded-model-key',
      COMMERCE_COMPILER_SHOPPER_LIMITER: limiter(false),
      COMMERCE_COMPILER_MERCHANT_LIMITER: limiter(true),
    } as Env);

    expect(response.status).toBe(429);
    expect(response.headers.get('X-AgentPay-Rate-Scope')).toBe('shopper');
    expect(response.headers.get('Retry-After')).toBe('60');
  });

  it('contains aggregate model spend with a separate merchant budget', async () => {
    const response = await buildApp().request('/compile', { method: 'POST' }, {
      OPENAI_API_KEY: 'server-funded-model-key',
      COMMERCE_COMPILER_SHOPPER_LIMITER: limiter(true),
      COMMERCE_COMPILER_MERCHANT_LIMITER: limiter(false),
    } as Env);

    expect(response.status).toBe(429);
    expect(response.headers.get('X-AgentPay-Rate-Scope')).toBe('merchant');
  });

  it('fails closed if a production quota binding errors', async () => {
    const failingLimiter: RateLimitBinding = {
      limit: vi.fn(async () => { throw new Error('binding unavailable'); }),
    };
    const response = await buildApp().request('/compile', { method: 'POST' }, {
      OPENAI_API_KEY: 'server-funded-model-key',
      COMMERCE_COMPILER_SHOPPER_LIMITER: failingLimiter,
      COMMERCE_COMPILER_MERCHANT_LIMITER: limiter(true),
    } as Env);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ error: 'COMMERCE_RATE_CONTROL_UNAVAILABLE' });
  });
});
