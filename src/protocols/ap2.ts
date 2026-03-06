/**
 * AP2 (Agent Payment Protocol v2) — AgentPay Integration
 *
 * AP2 is a lightweight payment protocol for agent-to-agent micropayments.
 * It uses a simple request/receipt/confirm flow optimized for high-frequency
 * machine-speed transactions.
 *
 * Endpoints:
 *   POST /api/ap2/request  — Agent requests payment from another agent
 *   POST /api/ap2/receipt  — Issuer generates a signed payment receipt
 *   POST /api/ap2/confirm  — Payer confirms receipt and releases funds
 *   GET  /api/ap2/status/:id — Get transaction status
 *
 * @module protocols/ap2
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { logger } from '../logger.js';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';

const router = Router();

// AP2 schemas
const ap2RequestSchema = z.object({
  payerId: z.string().min(1),
  payeeId: z.string().min(1),
  amountUsdc: z.number().positive().max(100000),
  taskDescription: z.string().min(1).max(512),
  callbackUrl: z.string().url().optional(),
  ttlSeconds: z.number().int().positive().max(3600).default(300),
  metadata: z.record(z.string(), z.any()).optional(),
});

const ap2ReceiptSchema = z.object({
  requestId: z.string().uuid(),
  payeeSignature: z.string().min(1),
  completionProof: z.string().optional(),
});

const ap2ConfirmSchema = z.object({
  requestId: z.string().uuid(),
  receiptId: z.string().uuid(),
  payerConfirmation: z.string().min(1),
});

export type Ap2Request = z.infer<typeof ap2RequestSchema>;
export type Ap2Receipt = z.infer<typeof ap2ReceiptSchema>;
export type Ap2Confirm = z.infer<typeof ap2ConfirmSchema>;

// In-memory store for demo purposes. In production, use the DB.
const ap2Transactions = new Map<string, any>();

/**
 * POST /api/ap2/request
 * Initiate an AP2 payment request.
 */
router.post('/request', async (req: Request, res: Response) => {
  const parsed = ap2RequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Validation error',
      details: parsed.error.issues.map((e) => e.message),
      protocol: 'ap2',
    });
    return;
  }

  const { payerId, payeeId, amountUsdc, taskDescription, callbackUrl, ttlSeconds, metadata } =
    parsed.data;

  const requestId = uuidv4();
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();

  const transaction = {
    requestId,
    status: 'pending_receipt',
    payerId,
    payeeId,
    amountUsdc,
    taskDescription,
    callbackUrl,
    expiresAt,
    metadata,
    createdAt: new Date().toISOString(),
    protocol: 'ap2',
  };

  ap2Transactions.set(requestId, transaction);

  logger.info('[AP2] Payment request created', { requestId, payerId, payeeId, amountUsdc });

  res.status(201).json({
    success: true,
    requestId,
    transaction,
    nextStep: 'payee_issues_receipt',
    instructions: {
      payee: `Issue a receipt at POST /api/ap2/receipt with requestId: ${requestId}`,
      payer: `Confirm after receipt at POST /api/ap2/confirm`,
    },
    docs: 'https://docs.agentpay.gg/protocols/ap2',
  });
});

/**
 * POST /api/ap2/receipt
 * Payee issues a signed receipt after completing the task.
 */
router.post('/receipt', async (req: Request, res: Response) => {
  const parsed = ap2ReceiptSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Validation error',
      details: parsed.error.issues.map((e) => e.message),
      protocol: 'ap2',
    });
    return;
  }

  const { requestId, payeeSignature, completionProof } = parsed.data;

  const tx = ap2Transactions.get(requestId);
  if (!tx) {
    res.status(404).json({ error: 'AP2 request not found', requestId, protocol: 'ap2' });
    return;
  }

  if (tx.status !== 'pending_receipt') {
    res.status(409).json({
      error: `Cannot issue receipt: transaction is in status '${tx.status}'`,
      protocol: 'ap2',
    });
    return;
  }

  const signingSecret = process.env.AGENTPAY_SIGNING_SECRET;
  if (!signingSecret) {
    res.status(500).json({
      error: 'Server configuration error: AGENTPAY_SIGNING_SECRET is not set',
      protocol: 'ap2',
    });
    return;
  }

  const receiptId = uuidv4();
  // Sign the receipt with HMAC using server secret
  const receiptData = `${requestId}:${receiptId}:${tx.amountUsdc}:${tx.payeeId}`;
  const serverSignature = crypto
    .createHmac('sha256', signingSecret)
    .update(receiptData)
    .digest('hex');

  const receipt = {
    receiptId,
    requestId,
    payeeSignature,
    completionProof,
    serverSignature,
    issuedAt: new Date().toISOString(),
  };

  tx.status = 'pending_confirmation';
  tx.receipt = receipt;
  ap2Transactions.set(requestId, tx);

  logger.info('[AP2] Receipt issued', { requestId, receiptId });

  res.status(201).json({
    success: true,
    receipt,
    nextStep: 'payer_confirms',
    instructions: {
      payer: `Confirm payment at POST /api/ap2/confirm with requestId and receiptId`,
    },
  });
});

/**
 * POST /api/ap2/confirm
 * Payer confirms the receipt and triggers fund release.
 */
router.post('/confirm', async (req: Request, res: Response) => {
  const parsed = ap2ConfirmSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Validation error',
      details: parsed.error.issues.map((e) => e.message),
      protocol: 'ap2',
    });
    return;
  }

  const { requestId, receiptId, payerConfirmation } = parsed.data;

  const tx = ap2Transactions.get(requestId);
  if (!tx) {
    res.status(404).json({ error: 'AP2 request not found', requestId, protocol: 'ap2' });
    return;
  }

  if (tx.status !== 'pending_confirmation') {
    res.status(409).json({
      error: `Cannot confirm: transaction is in status '${tx.status}'`,
      protocol: 'ap2',
    });
    return;
  }

  if (!tx.receipt || tx.receipt.receiptId !== receiptId) {
    res.status(400).json({ error: 'Receipt ID mismatch', protocol: 'ap2' });
    return;
  }

  tx.status = 'completed';
  tx.payerConfirmation = payerConfirmation;
  tx.completedAt = new Date().toISOString();
  ap2Transactions.set(requestId, tx);

  logger.info('[AP2] Payment confirmed', { requestId, receiptId });

  res.status(200).json({
    success: true,
    transaction: tx,
    message: 'AP2 payment confirmed. Funds released to payee.',
    protocol: 'ap2',
  });
});

/**
 * GET /api/ap2/status/:id
 * Get the current status of an AP2 transaction.
 */
router.get('/status/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const tx = ap2Transactions.get(id);

  if (!tx) {
    res.status(404).json({ error: 'AP2 transaction not found', id, protocol: 'ap2' });
    return;
  }

  res.status(200).json({ success: true, transaction: tx, protocol: 'ap2' });
});

/**
 * GET /api/ap2/schema
 * Returns the AP2 schema for agent discovery.
 */
router.get('/schema', (_req: Request, res: Response) => {
  res.status(200).json({
    protocol: 'ap2',
    version: '2.0',
    description: 'Agent Payment Protocol v2 — lightweight A2A micropayments',
    flow: ['request → receipt → confirm'],
    endpoints: {
      request: { method: 'POST', path: '/api/ap2/request', description: 'Initiate payment' },
      receipt: { method: 'POST', path: '/api/ap2/receipt', description: 'Payee issues receipt' },
      confirm: { method: 'POST', path: '/api/ap2/confirm', description: 'Payer confirms' },
      status: { method: 'GET', path: '/api/ap2/status/:id', description: 'Get transaction status' },
      schema: { method: 'GET', path: '/api/ap2/schema', description: 'This schema document' },
    },
    docs: 'https://docs.agentpay.gg/protocols/ap2',
  });
});

export { router as ap2Router };
