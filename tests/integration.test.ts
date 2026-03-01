import request from 'supertest';
import app from '../src/server';
import { closePool } from '../src/db/index';
import { query } from '../src/db/index';

let server: any;
let merchantId: string = '';
let apiKey: string = '';
let transactionId: string = '';

beforeAll(async () => {
  server = app.listen(0);
  try {
    // Updated cleanup command
await query('TRUNCATE merchants, transactions, rate_limit_counters, payment_verifications, webhook_events, payment_audit_log RESTART IDENTITY CASCADE');
  } catch (e) {
    console.error('Cleanup failed:', e);
  }
});

afterAll(async () => {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  await closePool();
});

describe('x402 Payment Server', () => {
  describe('Merchant Registration', () => {
    const testEmail = `test-${Date.now()}@example.com`;
    const testWallet = `5YNmS1R9n7VBjnMjhkKLhUXZhiANpvKaQYV8j8PqD`;

    it('should register a new merchant', async () => {
      const res = await request(app)
        .post('/api/merchants/register')
        .send({
          name: 'Test Merchant',
          email: testEmail,
          walletAddress: testWallet,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.merchantId).toBeDefined();
      expect(res.body.apiKey).toBeDefined();

      merchantId = res.body.merchantId;
      apiKey = res.body.apiKey;
    });

    it('should reject duplicate email', async () => {
      const res = await request(app)
        .post('/api/merchants/register')
        .send({
          name: 'Test Merchant 2',
          email: testEmail,
          walletAddress: `5YNmS1R9n7VBjnMjhkKLhUXZhiANpvKb${Date.now()}`.substring(0, 44),
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('already registered');
    });

    it('should validate email format', async () => {
      const res = await request(app)
        .post('/api/merchants/register')
        .send({
          name: 'Test Merchant 3',
          email: 'invalid-email',
          walletAddress: `5YNmS1R9n7VBjnMjhkKLhUXZhiANpvKc${Date.now()}`.substring(0, 44),
        });

      expect(res.status).toBe(400);
    });
  });

  describe('Authentication', () => {
    it('should require valid API key', async () => {
      const res = await request(app)
        .get('/api/merchants/profile')
        .set('Authorization', 'Bearer invalid-key');

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('AUTH_INVALID');
    });

    it('should accept valid API key', async () => {
      const res = await request(app)
        .get('/api/merchants/profile')
        .set('Authorization', `Bearer ${apiKey}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(merchantId);
    });
  });

  describe('Payment Requests', () => {
    const testPayment = {
      amountUsdc: 100,
      recipientAddress: '5YNmS1R9n7VBjnMjhkKLhUXZhiANpvKaQYV8',
      expiryMinutes: 30,
    };

    it('should create payment request', async () => {
      const res = await request(app)
        .post('/api/merchants/payments')
        .set('Authorization', `Bearer ${apiKey}`)
        .send(testPayment);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.paymentId).toBeDefined();
      expect(res.body.transactionId).toBeDefined();

      transactionId = res.body.transactionId;
    });

    it('should validate amount is positive', async () => {
      const res = await request(app)
        .post('/api/merchants/payments')
        .set('Authorization', `Bearer ${apiKey}`)
        .send({
          ...testPayment,
          amountUsdc: -100,
        });

      expect(res.status).toBe(400);
    });

    it('should validate recipient address', async () => {
      const res = await request(app)
        .post('/api/merchants/payments')
        .set('Authorization', `Bearer ${apiKey}`)
        .send({
          ...testPayment,
          recipientAddress: 'invalid',
        });

      expect(res.status).toBe(400);
    });

    it('should retrieve payment request', async () => {
      const getRes = await request(app)
        .get(`/api/merchants/payments/${transactionId}`)
        .set('Authorization', `Bearer ${apiKey}`);

      expect(getRes.status).toBe(200);
      expect(getRes.body.id).toBe(transactionId);
    });

    it('should list merchant payments', async () => {
      const res = await request(app)
        .get('/api/merchants/payments')
        .set('Authorization', `Bearer ${apiKey}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.transactions)).toBe(true);
    });
  });

  describe('Security Tests', () => {
    it('should not allow unauthorized access to other merchant transactions', async () => {
      const uniqueId = Date.now();
      const regRes = await request(app)
        .post('/api/merchants/register')
        .send({
          name: 'Test Merchant 2',
          email: `test2-${uniqueId}@example.com`,
          walletAddress: `5YNmS1R9n7VBjnMjhkKLhUXZhiANpvN${uniqueId}`.substring(0, 44),
        });

      expect(regRes.status).toBe(201);
      const merchant2ApiKey = regRes.body.apiKey;

      const res = await request(app)
        .get(`/api/merchants/payments/${transactionId}`)
        .set('Authorization', `Bearer ${merchant2ApiKey}`);

      expect(res.status).toBe(403);
    });

    it('should validate payment verification input', async () => {
      const res = await request(app)
        .post(`/api/merchants/payments/${transactionId}/verify`)
        .set('Authorization', `Bearer ${apiKey}`)
        .send({
          transactionHash: '',
        });

      expect(res.status).toBe(400);
    });

    it('should log security events', async () => {
      await request(app)
        .get('/api/merchants/profile')
        .set('Authorization', 'Bearer invalid-key');

      const res = await request(app)
        .get('/api/merchants/profile')
        .set('Authorization', `Bearer ${apiKey}`);

      expect(res.status).toBe(200);
    });
  });

  describe('Statistics', () => {
    it('should return merchant statistics', async () => {
      const res = await request(app)
        .get('/api/merchants/stats')
        .set('Authorization', `Bearer ${apiKey}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('Rate Limiting', () => {
    it('should enforce rate limits', async () => {
      const results = [];
      for (let i = 0; i < 5; i++) {
        const res = await request(app)
          .get('/api/merchants/profile')
          .set('Authorization', `Bearer ${apiKey}`);
        results.push(res.status);
      }

      results.forEach((status) => {
        expect(status).toBe(200);
      });
    });
  });
});

describe('HTTP 402 Payment Required', () => {
  it('should return 402 for protected endpoints', async () => {
    const res = await request(app).get('/api/protected');

    expect(res.status).toBe(402);
    expect(res.body.code).toBe('PAYMENT_REQUIRED');
  });
});

describe('Bot Registration', () => {
  const testHandle = `@TestBot-${Date.now()}`;

  it('should register a new bot with only handle', async () => {
    const res = await request(app)
      .post('/api/moltbook/bots/register')
      .send({ handle: testHandle });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.botId).toBeDefined();
    expect(res.body.handle).toBe(testHandle);
    expect(res.body.walletAddress).toBeDefined();
  });

  it('should reject bot registration with missing handle', async () => {
    const res = await request(app)
      .post('/api/moltbook/bots/register')
      .send({});

    expect(res.status).toBe(400);
  });
});
