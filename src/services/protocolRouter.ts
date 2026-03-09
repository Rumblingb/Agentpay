/**
 * Protocol Abstraction Router
 *
 * Single entry-point for dispatching payments across all supported protocols:
 *   - solana  : Solana Pay on-chain USDC transfer
 *   - x402    : HTTP 402 Payment Required
 *   - ap2     : Agent Payment Protocol v2
 *   - acp     : Agent Communication Protocol
 *
 * Usage:
 *   const result = await routeProtocolPayment('solana', { amount, recipient, ... });
 */

import { logger } from '../logger.js';

export type SupportedPaymentProtocol = 'solana' | 'x402' | 'ap2' | 'acp';

export interface ProtocolPayload {
  [key: string]: unknown;
}

export interface ProtocolResult {
  protocol: SupportedPaymentProtocol;
  status: 'initiated' | 'pending' | 'confirmed' | 'failed';
  transactionId?: string;
  txHash?: string;
  message?: string;
  data?: Record<string, unknown>;
}

async function routeSolana(payload: ProtocolPayload): Promise<ProtocolResult> {
  logger.info('[ProtocolRouter] Routing to Solana Pay', { payload });
  // Solana payments are handled by the intent + on-chain listener flow.
  // This entry-point captures the intent and returns the Solana Pay URI.
  const { createIntent } = await import('./intentService.js');
  const merchantId = payload['merchantId'] as string;
  const amount = payload['amount'] as number;
  const currency = (payload['currency'] as string) ?? 'USDC';
  const metadata = (payload['metadata'] as Record<string, unknown>) ?? {};

  const result = await createIntent({ merchantId, amount, currency, metadata });
  return {
    protocol: 'solana',
    status: 'initiated',
    transactionId: result.intentId,
    message: result.instructions?.solanaPayUri ?? undefined,
    data: { solanaPayUri: result.instructions?.solanaPayUri },
  };
}

async function routeX402(payload: ProtocolPayload): Promise<ProtocolResult> {
  logger.info('[ProtocolRouter] Routing x402 payment', { payload });
  // x402 is a paywall middleware flow — the caller configures it via x402Paywall().
  // Here we simply confirm receipt and signal the caller to apply the paywall.
  return {
    protocol: 'x402',
    status: 'pending',
    message: 'x402 paywall: apply x402Paywall() middleware to the target route',
    data: { payload },
  };
}

async function routeAp2(payload: ProtocolPayload): Promise<ProtocolResult> {
  logger.info('[ProtocolRouter] Routing AP2 payment', { payload });
  // ap2Router is registered in server.ts at /api/ap2; this function records
  // the routing intent and returns instructions for the caller.
  const { ap2Router } = await import('../protocols/ap2.js');
  void ap2Router;
  return {
    protocol: 'ap2',
    status: 'pending',
    message: 'AP2 payment routed — use POST /api/ap2/pay to execute',
    data: { payload },
  };
}

async function routeAcp(payload: ProtocolPayload): Promise<ProtocolResult> {
  logger.info('[ProtocolRouter] Routing ACP payment', { payload });
  // acpRouter is registered in server.ts at /api/acp; this function records
  // the routing intent and returns instructions for the caller.
  const { acpRouter } = await import('../protocols/acp.js');
  void acpRouter;
  return {
    protocol: 'acp',
    status: 'pending',
    message: 'ACP payment routed — use POST /api/acp/pay to execute',
    data: { payload },
  };
}

/**
 * Route a payment to the appropriate protocol handler.
 *
 * @param protocol - The payment protocol to use
 * @param payload  - Protocol-specific payload (amount, recipient, agentId, etc.)
 */
export async function routeProtocolPayment(
  protocol: SupportedPaymentProtocol,
  payload: ProtocolPayload,
): Promise<ProtocolResult> {
  logger.info('[ProtocolRouter] Dispatching payment', { protocol });

  switch (protocol) {
    case 'solana':
      return routeSolana(payload);
    case 'x402':
      return routeX402(payload);
    case 'ap2':
      return routeAp2(payload);
    case 'acp':
      return routeAcp(payload);
    default: {
      const _exhaustive: never = protocol;
      throw new Error(`[ProtocolRouter] Unsupported protocol: ${String(_exhaustive)}`);
    }
  }
}
