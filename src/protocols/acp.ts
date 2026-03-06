/**
 * ACP (Agent Communication Protocol) — AgentPay Integration
 *
 * Provides handlers for the ACP payment standard used in multi-agent systems.
 * ACP agents communicate payment requirements and proofs as structured messages.
 *
 * Endpoints:
 *   POST /api/acp/pay    — Create an ACP-formatted payment request
 *   POST /api/acp/verify — Verify an ACP payment message
 *
 * @module protocols/acp
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { logger } from '../logger.js';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

// ACP Message schema
const acpPaySchema = z.object({
  /** Unique message ID from the ACP agent */
  messageId: z.string().optional(),
  /** Sending agent DID or ID */
  senderId: z.string().min(1),
  /** Receiving agent DID or ID */
  recipientId: z.string().min(1),
  /** Payment amount in USD cents */
  amountUsd: z.number().positive(),
  /** Purpose / memo for this payment */
  purpose: z.string().min(1).max(255),
  /** Preferred payment method: solana | stripe | agentpay */
  preferredMethod: z.enum(['solana', 'stripe', 'agentpay']).default('agentpay'),
  /** Optional metadata */
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const acpVerifySchema = z.object({
  /** The ACP payment token / reference to verify */
  paymentToken: z.string().min(1),
  /** Sender agent ID to cross-check */
  senderId: z.string().min(1),
  /** Expected amount in USD cents */
  expectedAmountUsd: z.number().positive().optional(),
});

export type AcpPayRequest = z.infer<typeof acpPaySchema>;
export type AcpVerifyRequest = z.infer<typeof acpVerifySchema>;

export interface AcpPaymentReceipt {
  messageId: string;
  status: 'pending' | 'completed' | 'failed';
  paymentToken: string;
  paymentUrl?: string;
  agentpayIntentId?: string;
  expiresAt: string;
  protocol: 'acp';
}

/**
 * POST /api/acp/pay
 * Create a payment request in ACP format.
 * Returns a payment token that the sending agent can use to complete payment.
 */
router.post('/pay', async (req: Request, res: Response) => {
  const parsed = acpPaySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Validation error',
      details: parsed.error.issues.map((e) => e.message),
      protocol: 'acp',
    });
    return;
  }

  const { messageId, senderId, recipientId, amountUsd, purpose, preferredMethod, metadata } =
    parsed.data;

  const agentpayBaseUrl = process.env.AGENTPAY_API_URL || 'https://api.agentpay.gg';
  const paymentToken = uuidv4();
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString(); // 30 min TTL

  const receipt: AcpPaymentReceipt = {
    messageId: messageId || uuidv4(),
    status: 'pending',
    paymentToken,
    paymentUrl: `${agentpayBaseUrl}/api/v1/payment-intents`,
    agentpayIntentId: paymentToken,
    expiresAt,
    protocol: 'acp',
  };

  logger.info('[ACP] Payment request created', {
    senderId,
    recipientId,
    amountUsd,
    purpose,
    preferredMethod,
    paymentToken,
  });

  res.status(201).json({
    success: true,
    receipt,
    nextSteps: {
      description: 'Complete payment using the agentpay SDK or REST API',
      solanaEndpoint:
        preferredMethod === 'solana' ? `${agentpayBaseUrl}/api/v1/payment-intents` : undefined,
      stripeEndpoint:
        preferredMethod === 'stripe' ? `${agentpayBaseUrl}/api/fiat/checkout` : undefined,
      verifyEndpoint: `${agentpayBaseUrl}/api/acp/verify`,
      docs: 'https://docs.agentpay.gg/protocols/acp',
    },
    _acpMessage: {
      type: 'payment_request',
      version: '1.0',
      senderId,
      recipientId,
      amountUsd,
      purpose,
      metadata,
      token: paymentToken,
      expiresAt,
    },
  });
});

/**
 * POST /api/acp/verify
 * Verify an ACP payment token.
 */
router.post('/verify', async (req: Request, res: Response) => {
  const parsed = acpVerifySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Validation error',
      details: parsed.error.issues.map((e) => e.message),
      protocol: 'acp',
    });
    return;
  }

  const { paymentToken, senderId, expectedAmountUsd } = parsed.data;

  logger.info('[ACP] Verifying payment token', { paymentToken, senderId });

  // In a production deployment, this would check the payment in the DB.
  // For now, we validate format and return a structured ACP verification response.
  const isValidFormat = paymentToken.length > 8;

  if (!isValidFormat) {
    res.status(400).json({
      verified: false,
      reason: 'Invalid payment token format',
      protocol: 'acp',
    });
    return;
  }

  res.status(200).json({
    verified: true,
    paymentToken,
    senderId,
    expectedAmountUsd,
    protocol: 'acp',
    verifiedAt: new Date().toISOString(),
    _note:
      'In production, this endpoint queries the AgentPay ledger. Connect your DB for full verification.',
  });
});

/**
 * GET /api/acp/schema
 * Returns the ACP message schema for agent discovery.
 */
router.get('/schema', (_req: Request, res: Response) => {
  res.status(200).json({
    protocol: 'acp',
    version: '1.0',
    endpoints: {
      pay: { method: 'POST', path: '/api/acp/pay', description: 'Create ACP payment request' },
      verify: { method: 'POST', path: '/api/acp/verify', description: 'Verify ACP payment token' },
      schema: { method: 'GET', path: '/api/acp/schema', description: 'This schema document' },
    },
    paySchema: acpPaySchema.shape,
    verifySchema: acpVerifySchema.shape,
    docs: 'https://docs.agentpay.gg/protocols/acp',
  });
});

export { router as acpRouter };
