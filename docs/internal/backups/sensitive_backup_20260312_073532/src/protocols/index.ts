/**
 * Protocol Abstraction Layer (PAL) — AgentPay
 *
 * Auto-detects the incoming payment protocol from request headers or body,
 * and routes to the appropriate protocol handler.
 *
 * Supported protocols:
 *   - x402    : HTTP 402 Payment Required (header: X-Protocol: x402)
 *   - acp     : Agent Communication Protocol (header: X-Protocol: acp)
 *   - ap2     : Agent Payment Protocol v2   (header: X-Protocol: ap2)
 *   - solana  : Solana Pay native flow       (header: X-Protocol: solana)
 *   - stripe  : Stripe/fiat flow             (header: X-Protocol: stripe)
 *
 * Usage in one line:
 *   import { pal } from './protocols/index.js';
 *   router.use('/pay', pal('x402')); // Force x402
 *   router.use('/pay', pal());       // Auto-detect
 *
 * @module protocols/index
 */

import { Router, Request, Response, NextFunction } from 'express';
import { acpRouter } from './acp.js';
import { ap2Router } from './ap2.js';
import { x402Paywall, type X402Config } from './x402.js';
import { logger } from '../logger.js';

export { x402Paywall, acpRouter, ap2Router };
export type { X402Config };

export type SupportedProtocol = 'x402' | 'acp' | 'ap2' | 'solana' | 'stripe' | 'auto';

/**
 * Detect the payment protocol from a request.
 */
export function detectProtocol(req: Request): SupportedProtocol {
  // 1. Explicit header takes priority
  const headerProtocol = (req.headers['x-protocol'] || req.headers['x-agentpay-protocol']) as
    | string
    | undefined;
  if (headerProtocol) {
    const proto = headerProtocol.toLowerCase() as SupportedProtocol;
    if (['x402', 'acp', 'ap2', 'solana', 'stripe'].includes(proto)) {
      return proto;
    }
  }

  // 2. Body field detection
  const body = req.body || {};
  if (body.protocol) {
    const proto = String(body.protocol).toLowerCase() as SupportedProtocol;
    if (['x402', 'acp', 'ap2', 'solana', 'stripe'].includes(proto)) {
      return proto;
    }
  }

  // 3. ACP signature — has messageId + senderId + recipientId
  if (body.senderId && body.recipientId && body.amountUsd !== undefined) {
    return 'acp';
  }

  // 4. AP2 signature — has payerId + payeeId + amountUsdc
  if (body.payerId && body.payeeId && body.amountUsdc !== undefined) {
    return 'ap2';
  }

  // 5. Solana Pay — has `reference` (base58 pubkey)
  if (body.reference && body.splToken) {
    return 'solana';
  }

  // 6. Stripe — has `payment_method_types` or `customerId`
  if (body.payment_method_types || body.customerId) {
    return 'stripe';
  }

  // Default to x402 (most common for HTTP APIs)
  return 'x402';
}

/**
 * PAL middleware factory.
 * Returns an Express middleware that routes to the correct protocol handler.
 *
 * @param protocol - Specific protocol to force, or 'auto' to detect from request
 * @param x402Config - Required when protocol is 'x402'
 */
export function pal(protocol: SupportedProtocol = 'auto', x402Config?: X402Config) {
  return function palMiddleware(req: Request, res: Response, next: NextFunction) {
    const detectedProtocol = protocol === 'auto' ? detectProtocol(req) : protocol;

    logger.info('[PAL] Routing payment request', {
      detectedProtocol,
      forced: protocol !== 'auto',
      path: req.path,
    });

    res.setHeader('X-AgentPay-Protocol', detectedProtocol);

    switch (detectedProtocol) {
      case 'x402': {
        if (x402Config) {
          return x402Paywall(x402Config)(req, res, next);
        }
        // If no x402 config, just tag the request and pass through
        return next();
      }
      case 'acp':
      case 'ap2':
      case 'solana':
      case 'stripe':
        // These are handled by their dedicated routers.
        // PAL tags the request and lets the dedicated router handle it.
        (req as any).detectedProtocol = detectedProtocol;
        return next();
      default:
        return next();
    }
  };
}

/**
 * Creates a PAL router that mounts all protocol handlers.
 * Mount at /api/protocol or similar.
 */
export function createPalRouter(): Router {
  const router = Router();

  // Protocol info endpoint
  router.get('/', (_req: Request, res: Response) => {
    res.status(200).json({
      name: 'AgentPay Protocol Abstraction Layer (PAL)',
      version: '1.0',
      supportedProtocols: ['x402', 'acp', 'ap2', 'solana', 'stripe'],
      autoDetection: true,
      docs: 'https://docs.agentpay.gg/protocols',
      endpoints: {
        acp: '/api/acp',
        ap2: '/api/ap2',
        x402: 'middleware (import { x402Paywall } from protocols/x402)',
        solana: '/api/v1/payment-intents (set preferredMethod: solana)',
        stripe: '/api/fiat/checkout',
      },
    });
  });

  // Detection endpoint
  router.post('/detect', (req: Request, res: Response) => {
    const detected = detectProtocol(req);
    res.status(200).json({
      detectedProtocol: detected,
      confidence: 'high',
      headers: {
        'x-protocol': req.headers['x-protocol'] || null,
        'x-agentpay-protocol': req.headers['x-agentpay-protocol'] || null,
      },
      bodySignals: {
        hasSenderId: !!(req.body?.senderId),
        hasPayerId: !!(req.body?.payerId),
        hasReference: !!(req.body?.reference),
        hasCustomerId: !!(req.body?.customerId),
      },
    });
  });

  // Mount ACP and AP2 sub-routers
  router.use('/acp', acpRouter);
  router.use('/ap2', ap2Router);

  return router;
}
