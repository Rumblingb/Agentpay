/**
 * Tests for the enforceSpendingPolicy Express middleware.
 *
 * Tests the middleware-level behaviour (global pause, test-mode bypass)
 * that cannot be exercised via the pure checkPolicy function alone.
 */

import { jest, describe, it, expect, afterEach } from '@jest/globals';
import request from 'supertest';
import express, { Request, Response } from 'express';

// Stub out the DB helpers used by the middleware so tests don't need Postgres
jest.mock('../../src/db/index', () => ({
  __esModule: true,
  query: jest.fn().mockResolvedValue({ rows: [] }),
  pool: { on: jest.fn() },
  closePool: jest.fn(),
}));

import { enforceSpendingPolicy } from '../../src/middleware/spendingPolicy';

/** Minimal Express app that applies the middleware then returns 200 if allowed. */
function buildApp() {
  const app = express();
  app.use(express.json());
  app.post('/pay', enforceSpendingPolicy, (_req: Request, res: Response) => {
    res.json({ ok: true });
  });
  return app;
}

afterEach(() => {
  // Restore env vars after each test
  delete process.env.AGENTPAY_GLOBAL_PAUSE;
  delete process.env.AGENTPAY_TEST_MODE;
});

describe('enforceSpendingPolicy middleware', () => {
  describe('emergency global pause (whitepaper §4.3)', () => {
    it('returns 503 SERVICE_PAUSED when AGENTPAY_GLOBAL_PAUSE=true', async () => {
      process.env.AGENTPAY_GLOBAL_PAUSE = 'true';
      const app = buildApp();

      const res = await request(app).post('/pay').send({ amount: 100 });

      expect(res.status).toBe(503);
      expect(res.body.error).toBe('SERVICE_PAUSED');
      expect(res.body.message).toMatch(/temporarily paused/i);
    });

    it('does NOT pause when AGENTPAY_GLOBAL_PAUSE is unset', async () => {
      // AGENTPAY_TEST_MODE=true so it passes straight through
      process.env.AGENTPAY_TEST_MODE = 'true';
      delete process.env.AGENTPAY_GLOBAL_PAUSE;
      const app = buildApp();

      const res = await request(app).post('/pay').send({ amount: 100 });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });

    it('does NOT pause when AGENTPAY_GLOBAL_PAUSE=false', async () => {
      process.env.AGENTPAY_GLOBAL_PAUSE = 'false';
      process.env.AGENTPAY_TEST_MODE = 'true';
      const app = buildApp();

      const res = await request(app).post('/pay').send({ amount: 100 });

      expect(res.status).toBe(200);
    });

    it('global pause takes priority over test mode', async () => {
      // Even in test mode, global pause should block
      process.env.AGENTPAY_GLOBAL_PAUSE = 'true';
      process.env.AGENTPAY_TEST_MODE = 'true';
      const app = buildApp();

      const res = await request(app).post('/pay').send({ amount: 100 });

      expect(res.status).toBe(503);
    });
  });

  describe('test-mode bypass', () => {
    it('passes through when AGENTPAY_TEST_MODE=true (no auth required)', async () => {
      process.env.AGENTPAY_TEST_MODE = 'true';
      const app = buildApp();

      const res = await request(app).post('/pay').send({ amount: 999999 });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });
  });

  describe('no-auth fallthrough', () => {
    it('passes through when no merchant is attached (auth not run)', async () => {
      // Neither global pause nor test mode set — middleware should fail-open
      // when no merchant context is present
      delete process.env.AGENTPAY_GLOBAL_PAUSE;
      delete process.env.AGENTPAY_TEST_MODE;
      const app = buildApp();

      const res = await request(app).post('/pay').send({ amount: 100 });

      // No merchant = skip policy check → handler returns 200
      expect(res.status).toBe(200);
    });
  });
});
