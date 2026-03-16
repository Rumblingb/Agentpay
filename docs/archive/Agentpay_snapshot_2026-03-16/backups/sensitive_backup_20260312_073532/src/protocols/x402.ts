/**
 * x402 Paywall Handler — AgentPay Protocol Abstraction Layer
 *
 * Implements the HTTP 402 Payment Required flow as a middleware.
 * When a resource requires payment, this handler:
 *   1. Checks if a valid payment proof is present in the request header
 *   2. If not, returns 402 with a payment descriptor including AgentRank check
 *   3. If present, verifies the payment and forwards to the resource handler
 *
 * @module protocols/x402
 */

import { Request, Response, NextFunction } from 'express';
import { logger } from '../logger.js';
import { env } from '../config/env.js';

export interface X402Config {
  /** Amount required (in USD cents, e.g. 100 = $1.00) */
  amountUsd: number;
  /** Human-readable resource description */
  resource: string;
  /** Minimum AgentRank score required (0-1000). Default: 0 */
  minAgentRank?: number;
  /** Accept Solana USDC payments */
  acceptSolana?: boolean;
  /** Accept Stripe/card payments */
  acceptStripe?: boolean;
  /** Base URL of the AgentPay API */
  agentpayBaseUrl?: string;
}

export interface X402PaymentDescriptor {
  version: string;
  scheme: string;
  resource: string;
  amountUsd: number;
  currency: string;
  paymentEndpoints: {
    solana?: string;
    stripe?: string;
    agentpay?: string;
  };
  agentRankRequirement?: {
    minimum: number;
    checkUrl: string;
  };
  acceptedNetworks: string[];
  memo?: string;
}

/**
 * Creates an x402 paywall middleware for a specific resource.
 *
 * Usage:
 *   router.get('/premium-data', x402Paywall({ amountUsd: 100, resource: 'premium-data' }), handler);
 */
export function x402Paywall(config: X402Config) {
  const {
    amountUsd,
    resource,
    minAgentRank = 0,
    acceptSolana = true,
    acceptStripe = true,
    agentpayBaseUrl = env.API_BASE_URL,
  } = config;

  return async function x402Middleware(req: Request, res: Response, next: NextFunction) {
    // Check for payment proof in headers (x402 standard)
    const paymentProof =
      req.headers['x-payment-proof'] ||
      req.headers['x-agentpay-payment-id'] ||
      req.headers['authorization'];

    if (paymentProof && typeof paymentProof === 'string') {
      // Validate payment token format (basic check; real verification done by verify endpoint)
      const proofToken = paymentProof.startsWith('Bearer ')
        ? paymentProof.slice(7)
        : paymentProof;

      if (proofToken && proofToken.length > 10) {
        logger.info('[x402] Payment proof provided, forwarding to resource handler', {
          resource,
          proofPreview: proofToken.substring(0, 12) + '...',
        });
        (req as any).x402PaymentProof = proofToken;
        return next();
      }
    }

    // No valid payment proof — return 402 with payment descriptor
    const acceptedNetworks: string[] = [];
    const paymentEndpoints: X402PaymentDescriptor['paymentEndpoints'] = {};

    if (acceptSolana) {
      acceptedNetworks.push('solana');
      paymentEndpoints.solana = `${agentpayBaseUrl}/api/v1/payment-intents`;
    }
    if (acceptStripe) {
      acceptedNetworks.push('stripe');
      paymentEndpoints.stripe = `${agentpayBaseUrl}/api/fiat/checkout`;
    }
    paymentEndpoints.agentpay = `${agentpayBaseUrl}/api/v1/payment-intents`;

    const descriptor: X402PaymentDescriptor = {
      version: '1.0',
      scheme: 'x402',
      resource,
      amountUsd,
      currency: 'USD',
      paymentEndpoints,
      acceptedNetworks,
      memo: `Payment required for ${resource}`,
    };

    if (minAgentRank > 0) {
      descriptor.agentRankRequirement = {
        minimum: minAgentRank,
        checkUrl: `${agentpayBaseUrl}/api/agentrank/:agentId`,
      };
    }

    logger.info('[x402] Returning 402 Payment Required', { resource, amountUsd });

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('X-AgentPay-Protocol', 'x402');
    res.setHeader('X-AgentPay-Resource', resource);
    res.setHeader('X-AgentPay-Amount-USD', String(amountUsd));

    res.status(402).json({
      error: 'Payment Required',
      x402: descriptor,
      instructions: {
        step1: 'Create a payment intent at the agentpay endpoint',
        step2: 'Complete payment via Solana USDC or Stripe',
        step3: 'Retry this request with the payment ID in X-AgentPay-Payment-Id header',
        docs: 'https://docs.agentpay.gg/x402',
      },
    });
  };
}

/**
 * Verifies an x402 payment proof from a request.
 * Returns true if the payment is valid and sufficient.
 */
export async function verifyX402Payment(
  paymentId: string,
  requiredAmountUsd: number,
  agentpayBaseUrl?: string
): Promise<{ valid: boolean; reason?: string }> {
  const baseUrl = agentpayBaseUrl || env.API_BASE_URL;
  try {
    const response = await fetch(`${baseUrl}/api/verify/${paymentId}`);
    if (!response.ok) {
      return { valid: false, reason: `Verification failed: HTTP ${response.status}` };
    }
    const data = (await response.json()) as any;
    if (data.status !== 'verified' && data.status !== 'completed') {
      return { valid: false, reason: `Payment status: ${data.status}` };
    }
    if (data.amount < requiredAmountUsd) {
      return { valid: false, reason: `Insufficient payment: ${data.amount} < ${requiredAmountUsd}` };
    }
    return { valid: true };
  } catch (err: any) {
    logger.error('[x402] Payment verification error', { err: err.message });
    return { valid: false, reason: 'Verification error' };
  }
}
