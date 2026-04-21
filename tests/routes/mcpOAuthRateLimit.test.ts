import apiEdge from '../../apps/api-edge/src/index';
import { clearRateLimitWindowsForTests } from '../../apps/api-edge/src/middleware/rateLimit';

function appEnv(extra: Record<string, unknown> = {}) {
  return {
    DATABASE_URL: 'postgres://agentpay:test@localhost:5432/agentpay',
    WEBHOOK_SECRET: 'w'.repeat(32),
    AGENTPAY_SIGNING_SECRET: 's'.repeat(32),
    VERIFICATION_SECRET: 'v'.repeat(32),
    ADMIN_SECRET_KEY: 'a'.repeat(32),
    CORS_ORIGIN: 'http://localhost:3000',
    API_BASE_URL: 'http://agentpay.test',
    FRONTEND_URL: 'http://agentpay.test',
    AGENTPAY_TEST_MODE: 'true',
    NODE_ENV: 'development',
    ...extra,
  } as never;
}

describe('MCP OAuth rate limiting', () => {
  beforeEach(() => {
    clearRateLimitWindowsForTests();
  });

  afterEach(() => {
    clearRateLimitWindowsForTests();
  });

  it('throttles repeated email-link requests before they can become spam', async () => {
    const requestFactory = () => new Request('http://agentpay.test/authorize/email-link', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'cf-connecting-ip': '203.0.113.42',
      },
      body: new URLSearchParams({
        client_id: '',
        redirect_uri: '',
      }).toString(),
    });

    for (let i = 0; i < 5; i += 1) {
      const res = await apiEdge.fetch(requestFactory(), appEnv(), {} as never);
      expect(res.status).toBe(400);
    }

    const limited = await apiEdge.fetch(requestFactory(), appEnv(), {} as never);
    expect(limited.status).toBe(429);
    await expect(limited.json()).resolves.toEqual(expect.objectContaining({
      error: 'RATE_LIMIT_EXCEEDED',
    }));
    expect(limited.headers.get('Retry-After')).toBeTruthy();
  });
});
