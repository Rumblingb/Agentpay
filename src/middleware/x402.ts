/**
 * x402 Payment Required Middleware
 *
 * Implements the x402 protocol standard for payment-required HTTP responses.
 * When any route returns a 402 status, this middleware ensures the response
 * includes standardized headers for Coinbase/Stripe interoperability.
 *
 * Headers added to 402 responses:
 *   X-Payment-Required: true
 *   X-Payment-Network: solana
 *   X-Payment-Token: USDC
 *   X-Payment-Address: <merchant wallet>
 *   X-Payment-Protocol: agentpay-x402/1.0
 *   X-Payment-Description: <human-readable reason>
 */

import { Request, Response, NextFunction } from 'express';
import { logger } from '../logger';

interface AuthRequest extends Request {
  merchant?: {
    id: string;
    walletAddress: string;
  };
}

/**
 * Adds x402 standard headers to any 402 Payment Required response.
 * Must be mounted before routes so it can intercept res.json/res.send.
 */
export function x402Headers(req: AuthRequest, res: Response, next: NextFunction): void {
  // Intercept the response to add x402 headers on 402 status
  const originalJson = res.json.bind(res);
  const originalSend = res.send.bind(res);

  res.json = function (body: any) {
    if (res.statusCode === 402) {
      addX402Headers(res, req, body);
    }
    return originalJson(body);
  };

  res.send = function (body: any) {
    if (res.statusCode === 402) {
      addX402Headers(res, req);
    }
    return originalSend(body);
  };

  next();
}

function addX402Headers(res: Response, req: AuthRequest, body?: any): void {
  const walletAddress = req.merchant?.walletAddress || process.env.PLATFORM_WALLET_ADDRESS || '';
  const description = body?.message || body?.error || 'Payment required to access this resource';
  const amount = body?.amount || body?.costUsd || '';

  res.setHeader('X-Payment-Required', 'true');
  res.setHeader('X-Payment-Network', 'solana');
  res.setHeader('X-Payment-Token', 'USDC');
  res.setHeader('X-Payment-Protocol', 'agentpay-x402/1.0');
  res.setHeader('X-Payment-Description', description);

  if (walletAddress) {
    res.setHeader('X-Payment-Address', walletAddress);
  }
  if (amount) {
    res.setHeader('X-Payment-Amount', String(amount));
  }

  // Include AgentPay-specific headers for SDK auto-resolution
  res.setHeader('X-AgentPay-Version', '1.0.0');
  res.setHeader('X-AgentPay-Docs', 'https://docs.agentpay.gg/x402');
}

/**
 * Utility to send a standardized 402 Payment Required response
 * with x402-compliant headers and body.
 */
export function sendPaymentRequired(
  res: Response,
  options: {
    message?: string;
    amount?: number;
    currency?: string;
    recipientAddress?: string;
    merchantId?: string;
    network?: string;
  } = {},
): void {
  const {
    message = 'Payment required to access this resource',
    amount,
    currency = 'USDC',
    recipientAddress,
    merchantId,
    network = 'solana',
  } = options;

  res.setHeader('X-Payment-Required', 'true');
  res.setHeader('X-Payment-Network', network);
  res.setHeader('X-Payment-Token', currency);
  res.setHeader('X-Payment-Protocol', 'agentpay-x402/1.0');
  res.setHeader('X-Payment-Description', message);
  res.setHeader('X-AgentPay-Version', '1.0.0');
  res.setHeader('X-AgentPay-Docs', 'https://docs.agentpay.gg/x402');

  if (recipientAddress) {
    res.setHeader('X-Payment-Address', recipientAddress);
  }
  if (amount !== undefined) {
    res.setHeader('X-Payment-Amount', String(amount));
  }

  res.status(402).json({
    error: 'PAYMENT_REQUIRED',
    message,
    payment: {
      network,
      token: currency,
      amount,
      recipientAddress,
      merchantId,
      protocol: 'agentpay-x402/1.0',
      docsUrl: 'https://docs.agentpay.gg/x402',
    },
  });
}

export default { x402Headers, sendPaymentRequired };
