/**
 * AgentPay E2E Protocol Integration Tests
 *
 * Exercises the full payment lifecycle using API calls only — no Solana RPC,
 * no Stripe, no external network calls.
 *
 * Prerequisites (set automatically via jest.setup.cjs + CI env):
 *   NODE_ENV   = 'test'          (Jest sets this)
 *   AGENTPAY_TEST_MODE = 'true'  (jest.setup.cjs sets this)
 *   DATABASE_URL pointing at a live Postgres instance
 *
 * Flow tested:
 *   1. Merchant registration
 *   2. Payment intent creation
 *   3. Test-mode force-verification (bypasses Solana RPC)
 *   4. Webhook delivery to a local mock HTTP receiver
 *   5. Delivery attempt recorded in webhook_events table
 */

import http from 'http';
import net from 'net';
import request from 'supertest';
import app from '../../src/server';
import { closePool, query } from '../../src/db/index';

// ── Local webhook receiver ────────────────────────────────────────────────────

let webhookServer: http.Server;
let webhookPort: number;
const receivedWebhooks: any[] = [];

function startWebhookReceiver(): Promise<void> {
  return new Promise((resolve) => {
    webhookServer = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
      req.on('end', () => {
        try { receivedWebhooks.push(JSON.parse(body)); } catch { /* non-JSON body — ignore */ }
        res.writeHead(200);
        res.end('OK');
      });
    });
    webhookServer.listen(0, () => {
      webhookPort = (webhookServer.address() as net.AddressInfo).port;
      resolve();
    });
  });
}

/** Poll until at least one webhook payload has arrived, or timeout. */
async function waitForWebhook(timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (receivedWebhooks.length === 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 50));
  }
}

// ── Shared state set across sequential test steps ────────────────────────────

let appServer: http.Server;
let merchantId: string;
let apiKey: string;
let transactionId: string;

// ── Lifecycle ─────────────────────────────────────────────────────────────────

beforeAll(async () => {
  await startWebhookReceiver();
  appServer = app.listen(0);
  // Clean slate for this test run.
  await query(
    `TRUNCATE merchants, transactions, api_logs, rate_limit_counters,
              payment_verifications, webhook_events, payment_audit_log
     RESTART IDENTITY CASCADE`
  );
}, 30_000);

afterAll(async () => {
  await new Promise<void>((resolve) => appServer.close(() => resolve()));
  await new Promise<void>((resolve) => webhookServer.close(() => resolve()));
  await closePool();
}, 30_000);

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AgentPay E2E Protocol', () => {
  // ── Step 1: Merchant registration ─────────────────────────────────────────
  describe('Step 1 – Merchant Registration', () => {
    it('registers a new merchant and returns credentials', async () => {
      const res = await request(app)
        .post('/api/merchants/register')
        .send({
          name: 'E2E Test Merchant',
          email: `e2e-${Date.now()}@example.com`,
          walletAddress: '5YNmS1R9n7VBjnMjhkKLhUXZhiANpvKaQYV8j8PqD',
          webhookUrl: `http://localhost:${webhookPort}/webhook`,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.merchantId).toBeDefined();
      expect(res.body.apiKey).toBeDefined();

      merchantId = res.body.merchantId;
      apiKey = res.body.apiKey;
    });
  });

  // ── Step 2: Payment intent ─────────────────────────────────────────────────
  describe('Step 2 – Payment Intent Creation', () => {
    it('creates a payment intent for the registered merchant', async () => {
      const res = await request(app)
        .post('/api/merchants/payments')
        .set('Authorization', `Bearer ${apiKey}`)
        .send({
          amountUsdc: 5.0,
          recipientAddress: '5YNmS1R9n7VBjnMjhkKLhUXZhiANpvKaQYV8j8PqD',
          expiryMinutes: 30,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.transactionId).toBeDefined();
      expect(res.body.paymentId).toBeDefined();

      transactionId = res.body.transactionId;
    });

    it('newly created intent is in pending status', async () => {
      const res = await request(app)
        .get(`/api/merchants/payments/${transactionId}`)
        .set('Authorization', `Bearer ${apiKey}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('pending');
    });
  });

  // ── Step 3: Test-mode force-verification ──────────────────────────────────
  describe('Step 3 – Test-Mode Force Verification (no Solana RPC)', () => {
    it('is gated behind AGENTPAY_TEST_MODE — route exists in test env', async () => {
      // Sanity check: the route must be reachable (not 404) in test mode.
      const res = await request(app)
        .post(`/api/test/force-verify/${transactionId}`)
        .set('Authorization', `Bearer ${apiKey}`);

      // A 404 here would mean the test routes were not registered.
      expect(res.status).not.toBe(404);
    });

    it('force-verifies the payment without calling Solana', async () => {
      const res = await request(app)
        .post(`/api/test/force-verify/${transactionId}`)
        .set('Authorization', `Bearer ${apiKey}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.status).toBe('confirmed');
    });

    it('transaction status is now confirmed', async () => {
      const res = await request(app)
        .get(`/api/merchants/payments/${transactionId}`)
        .set('Authorization', `Bearer ${apiKey}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('confirmed');
    });

    it('rejects force-verify for a transaction owned by another merchant', async () => {
      // Register a second merchant
      const reg = await request(app)
        .post('/api/merchants/register')
        .send({
          name: 'Other Merchant',
          email: `other-${Date.now()}@example.com`,
          walletAddress: `5YNmS1R9n7VBjnMjhkKLhUXZhiANpvN${Date.now()}`.substring(0, 44),
        });
      expect(reg.status).toBe(201);

      const res = await request(app)
        .post(`/api/test/force-verify/${transactionId}`)
        .set('Authorization', `Bearer ${reg.body.apiKey}`);

      expect(res.status).toBe(403);
    });
  });

  // ── Step 4: Webhook delivery ──────────────────────────────────────────────
  describe('Step 4 – Webhook Delivery', () => {
    it('records a webhook_events row in the database', async () => {
      const { rows } = await query(
        `SELECT * FROM webhook_events WHERE merchant_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [merchantId]
      );
      expect(rows.length).toBeGreaterThan(0);
      expect(rows[0].event_type).toBe('payment.verified');
    });

    it('delivers the webhook payload to the local mock receiver', async () => {
      await waitForWebhook();

      expect(receivedWebhooks.length).toBeGreaterThan(0);
      const payload = receivedWebhooks[0];
      expect(payload.event).toBe('payment.verified');
      expect(payload.merchantId).toBe(merchantId);
      expect(payload.verified).toBe(true);
    });

    it('marks the delivery attempt as sent in the database', async () => {
      // Allow brief time for the async webhook handler to write back to the DB.
      await new Promise((r) => setTimeout(r, 500));

      const { rows } = await query(
        `SELECT * FROM webhook_events
          WHERE merchant_id = $1 AND status = 'sent'
          LIMIT 1`,
        [merchantId]
      );
      expect(rows.length).toBeGreaterThan(0);
    });
  });
});
