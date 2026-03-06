/**
 * Tests for the Protocol Abstraction Layer (PAL) endpoints:
 *   - POST /api/acp/pay
 *   - POST /api/acp/verify
 *   - GET  /api/acp/schema
 *   - POST /api/ap2/request
 *   - POST /api/ap2/receipt
 *   - POST /api/ap2/confirm
 *   - GET  /api/ap2/status/:id
 *   - GET  /api/ap2/schema
 *   - GET  /api/protocol
 *   - POST /api/protocol/detect
 */

import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import request from 'supertest';
import express from 'express';
import { acpRouter } from '../src/protocols/acp';
import { ap2Router } from '../src/protocols/ap2';
import { createPalRouter } from '../src/protocols/index';

// Set signing secret so AP2 receipt endpoint doesn't return 500
process.env.AGENTPAY_SIGNING_SECRET = 'test-signing-secret-32chars!!!!!';

const app = express();
app.use(express.json());
app.use('/api/acp', acpRouter);
app.use('/api/ap2', ap2Router);
app.use('/api/protocol', createPalRouter());

// ============================================================
// ACP tests
// ============================================================
describe('ACP Protocol', () => {
  describe('POST /api/acp/pay', () => {
    it('creates an ACP payment receipt for valid input', async () => {
      const res = await request(app).post('/api/acp/pay').send({
        senderId: 'agent-sender-001',
        recipientId: 'agent-receiver-001',
        amountUsd: 5.0,
        purpose: 'Weather API call fee',
        preferredMethod: 'agentpay',
      });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.receipt).toBeDefined();
      expect(res.body.receipt.protocol).toBe('acp');
      expect(res.body.receipt.status).toBe('pending');
      expect(typeof res.body.receipt.paymentToken).toBe('string');
      expect(res.body.receipt.paymentToken.length).toBeGreaterThan(10);
    });

    it('uses provided messageId when given', async () => {
      const res = await request(app).post('/api/acp/pay').send({
        messageId: 'msg-custom-123',
        senderId: 'agent-a',
        recipientId: 'agent-b',
        amountUsd: 1.0,
        purpose: 'Test',
      });
      expect(res.status).toBe(201);
      expect(res.body.receipt.messageId).toBe('msg-custom-123');
    });

    it('returns 400 when required fields are missing', async () => {
      const res = await request(app).post('/api/acp/pay').send({
        senderId: 'agent-a',
        // missing recipientId and amountUsd
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Validation error');
      expect(res.body.protocol).toBe('acp');
    });

    it('returns 400 when amountUsd is not positive', async () => {
      const res = await request(app).post('/api/acp/pay').send({
        senderId: 'agent-a',
        recipientId: 'agent-b',
        amountUsd: -5,
        purpose: 'Test',
      });
      expect(res.status).toBe(400);
    });

    it('includes _acpMessage in response with correct fields', async () => {
      const res = await request(app).post('/api/acp/pay').send({
        senderId: 'agent-sender',
        recipientId: 'agent-receiver',
        amountUsd: 10.0,
        purpose: 'Data access',
        metadata: { requestId: 'req-999' },
      });
      expect(res.status).toBe(201);
      expect(res.body._acpMessage.senderId).toBe('agent-sender');
      expect(res.body._acpMessage.amountUsd).toBe(10.0);
      expect(res.body._acpMessage.metadata).toEqual({ requestId: 'req-999' });
    });
  });

  describe('POST /api/acp/verify', () => {
    it('verifies a valid-format payment token', async () => {
      const res = await request(app).post('/api/acp/verify').send({
        paymentToken: 'tok_valid_token_12345',
        senderId: 'agent-a',
        expectedAmountUsd: 5.0,
      });
      expect(res.status).toBe(200);
      expect(res.body.verified).toBe(true);
      expect(res.body.protocol).toBe('acp');
    });

    it('returns 400 when token is too short', async () => {
      const res = await request(app).post('/api/acp/verify').send({
        paymentToken: 'short',
        senderId: 'agent-a',
      });
      expect(res.status).toBe(400);
      expect(res.body.verified).toBe(false);
    });

    it('returns 400 when required fields missing', async () => {
      const res = await request(app).post('/api/acp/verify').send({
        senderId: 'agent-a',
        // missing paymentToken
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Validation error');
    });
  });

  describe('GET /api/acp/schema', () => {
    it('returns the ACP schema document', async () => {
      const res = await request(app).get('/api/acp/schema');
      expect(res.status).toBe(200);
      expect(res.body.protocol).toBe('acp');
      expect(res.body.version).toBe('1.0');
      expect(res.body.endpoints).toBeDefined();
      expect(res.body.endpoints.pay).toBeDefined();
      expect(res.body.endpoints.verify).toBeDefined();
    });
  });
});

// ============================================================
// AP2 tests
// ============================================================
describe('AP2 Protocol', () => {
  let requestId: string;
  let receiptId: string;

  describe('POST /api/ap2/request', () => {
    it('creates an AP2 payment request', async () => {
      const res = await request(app).post('/api/ap2/request').send({
        payerId: 'payer-agent-001',
        payeeId: 'payee-agent-001',
        amountUsdc: 15.0,
        taskDescription: 'Build a REST API wrapper for weather data',
        ttlSeconds: 300,
      });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(typeof res.body.requestId).toBe('string');
      expect(res.body.transaction.status).toBe('pending_receipt');
      expect(res.body.transaction.payerId).toBe('payer-agent-001');
      expect(res.body.transaction.amountUsdc).toBe(15.0);

      requestId = res.body.requestId;
    });

    it('returns 400 when required fields are missing', async () => {
      const res = await request(app).post('/api/ap2/request').send({
        payerId: 'payer-001',
        // missing payeeId and amountUsdc
      });
      expect(res.status).toBe(400);
      expect(res.body.protocol).toBe('ap2');
    });

    it('rejects amountUsdc exceeding max (100000)', async () => {
      const res = await request(app).post('/api/ap2/request').send({
        payerId: 'p1',
        payeeId: 'p2',
        amountUsdc: 999999,
        taskDescription: 'Way too expensive',
      });
      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/ap2/receipt', () => {
    it('requires a valid requestId', async () => {
      const res = await request(app).post('/api/ap2/receipt').send({
        requestId: '00000000-0000-0000-0000-000000000000',
        payeeSignature: 'sig_payee_xyz',
      });
      expect(res.status).toBe(404);
      expect(res.body.error).toMatch(/not found/i);
    });

    it('issues a receipt for an existing request', async () => {
      // First create a request
      const reqRes = await request(app).post('/api/ap2/request').send({
        payerId: 'payer-002',
        payeeId: 'payee-002',
        amountUsdc: 5.0,
        taskDescription: 'Deliver a market report',
      });
      expect(reqRes.status).toBe(201);
      const id = reqRes.body.requestId;

      // Now issue a receipt
      const receiptRes = await request(app).post('/api/ap2/receipt').send({
        requestId: id,
        payeeSignature: 'sig_payee_marker',
        completionProof: 'proof_hash_abc123',
      });
      expect(receiptRes.status).toBe(201);
      expect(receiptRes.body.success).toBe(true);
      expect(receiptRes.body.receipt.requestId).toBe(id);
      expect(typeof receiptRes.body.receipt.receiptId).toBe('string');
      expect(typeof receiptRes.body.receipt.serverSignature).toBe('string');
      expect(receiptRes.body.receipt.serverSignature.length).toBeGreaterThan(10);

      receiptId = receiptRes.body.receipt.receiptId;
    });
  });

  describe('POST /api/ap2/confirm', () => {
    it('confirms payment with valid requestId and receiptId', async () => {
      // Create a fresh request + receipt
      const reqRes = await request(app).post('/api/ap2/request').send({
        payerId: 'payer-confirm',
        payeeId: 'payee-confirm',
        amountUsdc: 7.5,
        taskDescription: 'Confirm test',
      });
      const id = reqRes.body.requestId;

      const receiptRes = await request(app).post('/api/ap2/receipt').send({
        requestId: id,
        payeeSignature: 'sig_confirm_test',
      });
      const rid = receiptRes.body.receipt.receiptId;

      const confirmRes = await request(app).post('/api/ap2/confirm').send({
        requestId: id,
        receiptId: rid,
        payerConfirmation: 'payer_signed_confirmation',
      });
      expect(confirmRes.status).toBe(200);
      expect(confirmRes.body.success).toBe(true);
      expect(confirmRes.body.transaction.status).toBe('completed');
    });

    it('returns 409 when re-confirming a completed transaction', async () => {
      // Create request, issue receipt, confirm → then try to confirm again
      const reqRes = await request(app).post('/api/ap2/request').send({
        payerId: 'payer-reconfirm',
        payeeId: 'payee-reconfirm',
        amountUsdc: 2.0,
        taskDescription: 'Re-confirm test',
      });
      const id = reqRes.body.requestId;

      const receiptRes = await request(app).post('/api/ap2/receipt').send({
        requestId: id,
        payeeSignature: 'sig_reconfirm',
      });
      const rid = receiptRes.body.receipt.receiptId;

      // First confirm — should succeed
      await request(app).post('/api/ap2/confirm').send({
        requestId: id,
        receiptId: rid,
        payerConfirmation: 'payer_first_confirm',
      });

      // Second confirm — should return 409 (already completed)
      const confirmRes2 = await request(app).post('/api/ap2/confirm').send({
        requestId: id,
        receiptId: rid,
        payerConfirmation: 'payer_second_confirm',
      });
      expect(confirmRes2.status).toBe(409);
      expect(confirmRes2.body.error).toMatch(/completed/i);
    });
  });

  describe('GET /api/ap2/status/:id', () => {
    it('returns the transaction status', async () => {
      const reqRes = await request(app).post('/api/ap2/request').send({
        payerId: 'payer-status',
        payeeId: 'payee-status',
        amountUsdc: 3.0,
        taskDescription: 'Status check test',
      });
      const id = reqRes.body.requestId;

      const statusRes = await request(app).get(`/api/ap2/status/${id}`);
      expect(statusRes.status).toBe(200);
      expect(statusRes.body.success).toBe(true);
      expect(statusRes.body.transaction.status).toBe('pending_receipt');
    });

    it('returns 404 for unknown transaction', async () => {
      const res = await request(app).get('/api/ap2/status/unknown-id-999');
      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/ap2/schema', () => {
    it('returns the AP2 schema document', async () => {
      const res = await request(app).get('/api/ap2/schema');
      expect(res.status).toBe(200);
      expect(res.body.protocol).toBe('ap2');
      expect(res.body.version).toBe('2.0');
      expect(res.body.flow).toEqual(['request → receipt → confirm']);
    });
  });
});

// ============================================================
// Protocol Abstraction Layer (PAL) tests
// ============================================================
describe('Protocol Abstraction Layer', () => {
  describe('GET /api/protocol', () => {
    it('returns PAL info with supported protocols', async () => {
      const res = await request(app).get('/api/protocol');
      expect(res.status).toBe(200);
      expect(res.body.supportedProtocols).toContain('x402');
      expect(res.body.supportedProtocols).toContain('acp');
      expect(res.body.supportedProtocols).toContain('ap2');
      expect(res.body.supportedProtocols).toContain('solana');
      expect(res.body.supportedProtocols).toContain('stripe');
    });
  });

  describe('POST /api/protocol/detect', () => {
    it('detects ACP from body structure', async () => {
      const res = await request(app).post('/api/protocol/detect').send({
        senderId: 'agent-a',
        recipientId: 'agent-b',
        amountUsd: 5,
      });
      expect(res.status).toBe(200);
      expect(res.body.detectedProtocol).toBe('acp');
    });

    it('detects AP2 from body structure', async () => {
      const res = await request(app).post('/api/protocol/detect').send({
        payerId: 'p1',
        payeeId: 'p2',
        amountUsdc: 10,
      });
      expect(res.status).toBe(200);
      expect(res.body.detectedProtocol).toBe('ap2');
    });

    it('detects protocol from X-Protocol header', async () => {
      const res = await request(app)
        .post('/api/protocol/detect')
        .set('X-Protocol', 'stripe')
        .send({});
      expect(res.status).toBe(200);
      expect(res.body.detectedProtocol).toBe('stripe');
    });

    it('defaults to x402 for unrecognized body', async () => {
      const res = await request(app).post('/api/protocol/detect').send({
        someRandomField: 'value',
      });
      expect(res.status).toBe(200);
      expect(res.body.detectedProtocol).toBe('x402');
    });
  });
});
