/**
 * x402 — HTTP 402 Payment Required protocol handler (Cloudflare Workers / Hono)
 *
 * Flow:
 *   1. Any route can respond with 402 + a payment descriptor
 *   2. Agent/client creates an intent at POST /api/v1/payment-intents
 *   3. Agent retries the original request with X-AgentPay-Payment-Id header
 *   4. This middleware verifies the payment and forwards to the resource
 *
 * Endpoints:
 *   GET  /api/x402/schema        — machine-readable protocol schema
 *   POST /api/x402/verify        — verify a payment token (internal + SDK use)
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../types';

const router = new Hono<{ Bindings: Env; Variables: Variables }>();

const BASE_URL = 'https://api.agentpay.so';

// ---------------------------------------------------------------------------
// GET /api/x402/schema  — discovery endpoint for agents
// ---------------------------------------------------------------------------
router.get('/schema', (c) =>
  c.json({
    protocol: 'x402',
    version: '1.0',
    description:
      'HTTP 402 Payment Required — agents present X-AgentPay-Payment-Id to access paid resources',
    flow: [
      'resource returns 402 + payment descriptor',
      'agent creates intent at POST /api/v1/payment-intents',
      'agent retries with X-AgentPay-Payment-Id: <intentId>',
      'resource verifies via POST /api/x402/verify or GET /api/verify/:id',
    ],
    headers: {
      request: 'X-AgentPay-Payment-Id: <intentId>',
      response402: [
        'X-AgentPay-Protocol: x402',
        'X-AgentPay-Amount-USD: <cents>',
        'X-AgentPay-Resource: <resource-name>',
      ],
    },
    endpoints: {
      schema: { method: 'GET', path: '/api/x402/schema' },
      verify: { method: 'POST', path: '/api/x402/verify' },
      createIntent: { method: 'POST', path: '/api/v1/payment-intents' },
      checkPayment: { method: 'GET', path: '/api/verify/:intentId' },
    },
    agentRank: {
      description: 'Resources can require a minimum AgentRank score',
      checkUrl: `${BASE_URL}/api/passport/:agentId`,
    },
    docs: 'https://agentpay.so/docs#x402',
  }),
);

// ---------------------------------------------------------------------------
// POST /api/x402/verify  — verify a payment proof
// ---------------------------------------------------------------------------
router.post('/verify', async (c) => {
  let body: { paymentId?: string; requiredAmountUsd?: number; agentId?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const { paymentId, requiredAmountUsd } = body;
  if (!paymentId) {
    return c.json({ error: 'paymentId is required' }, 400);
  }

  // Proxy to our own verify endpoint (single source of truth)
  const verifyUrl = `${BASE_URL}/api/verify/${encodeURIComponent(paymentId)}`;
  let data: any;
  try {
    const res = await fetch(verifyUrl, {
      headers: { 'User-Agent': 'AgentPay-x402-verifier/1.0' },
    });
    data = await res.json();
  } catch {
    return c.json({ verified: false, error: 'Verification service unreachable' }, 502);
  }

  if (data.status !== 'verified' && data.status !== 'completed') {
    return c.json({ verified: false, reason: `Payment status: ${data.status}`, protocol: 'x402' }, 402);
  }

  if (requiredAmountUsd !== undefined && Number(data.amount) < requiredAmountUsd) {
    return c.json({
      verified: false,
      reason: `Insufficient: paid ${data.amount}, required ${requiredAmountUsd}`,
      protocol: 'x402',
    }, 402);
  }

  return c.json({
    verified: true,
    paymentId,
    status: data.status,
    amount: data.amount,
    protocol: 'x402',
    verifiedAt: new Date().toISOString(),
  });
});

// ---------------------------------------------------------------------------
// Helper: build a 402 descriptor (used by other routes via import)
// ---------------------------------------------------------------------------
export function build402Descriptor(opts: {
  resource: string;
  amountUsd: number;
  minAgentRank?: number;
}) {
  return {
    version: '1.0',
    scheme: 'x402',
    resource: opts.resource,
    amountUsd: opts.amountUsd,
    currency: 'USD',
    paymentEndpoints: {
      agentpay: `${BASE_URL}/api/v1/payment-intents`,
      solana: `${BASE_URL}/api/v1/payment-intents`,
    },
    acceptedNetworks: ['solana', 'stripe'],
    memo: `Payment required for ${opts.resource}`,
    ...(opts.minAgentRank
      ? {
          agentRankRequirement: {
            minimum: opts.minAgentRank,
            checkUrl: `${BASE_URL}/api/passport/:agentId`,
          },
        }
      : {}),
  };
}

export { router as x402Router };
