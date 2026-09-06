/**
 * x402 — HTTP 402 Payment Required protocol handler (Cloudflare Workers / Hono)
 *
 * Flow:
 *   1. Discovery returns a 402 challenge descriptor
 *   2. Agent/client creates an intent at POST /api/v1/payment-intents
 *   3. Agent retries the original request with X-AgentPay-Payment-Id header
 *   4. POST /api/x402/verify checks the payment against /api/verify/:id
 *
 * Endpoints:
 *   GET  /api/x402               — HTTP 402 challenge (canonical discovery)
 *   GET  /api/x402/challenge     — same challenge
 *   GET  /api/x402/pay           — same challenge
 *   GET  /api/x402/schema        — machine-readable protocol schema
 *   POST /api/x402/verify        — verify a payment token (internal + SDK use)
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { getInternalAppFetcher } from '../lib/internalAppFetch';
import { isSolanaAddress } from '../lib/cryptoRecipient';

const router = new Hono<{ Bindings: Env; Variables: Variables }>();

function publicApiBase(env: Env): string {
  return (env.API_BASE_URL || 'https://api.agentpay.so').replace(/\/$/, '');
}

export function build402Descriptor(opts: {
  resource: string;
  amountUsd: number;
  minAgentRank?: number;
  apiBase?: string;
  recipientAddress?: string | null;
}) {
  const base = opts.apiBase ?? 'https://api.agentpay.so';
  const recipient = isSolanaAddress(opts.recipientAddress) ? opts.recipientAddress.trim() : undefined;
  return {
    version: '1.0',
    scheme: 'x402',
    resource: opts.resource,
    amountUsd: opts.amountUsd,
    currency: 'USD',
    paymentEndpoints: {
      agentpay: `${base}/api/v1/payment-intents`,
      solana: `${base}/api/v1/payment-intents`,
    },
    acceptedNetworks: ['solana'],
    ...(recipient ? { recipientAddress: recipient } : {}),
    memo: `Payment required for ${opts.resource}`,
    verify: { method: 'POST', path: '/api/x402/verify' },
    settle: { method: 'POST', path: '/api/x402/verify' },
    schema: { method: 'GET', path: '/api/x402/schema' },
    ...(opts.minAgentRank
      ? {
          agentRankRequirement: {
            minimum: opts.minAgentRank,
            checkUrl: `${base}/api/passport/:agentId`,
          },
        }
      : {}),
  };
}

function challengeHeaders(): Record<string, string> {
  return {
    'X-AgentPay-Protocol': 'x402',
    'X-AgentPay-Amount-USD': '1',
    'X-AgentPay-Resource': 'x402-challenge',
  };
}

function challengeBody(env: Env) {
  return build402Descriptor({
    resource: 'x402-challenge',
    amountUsd: 0.01,
    apiBase: publicApiBase(env),
    recipientAddress: env.PLATFORM_TREASURY_WALLET,
  });
}

function respondWithChallenge(c: { json: (body: unknown, status: 402, headers?: Record<string, string>) => Response; env: Env }) {
  return c.json(challengeBody(c.env), 402, challengeHeaders());
}

async function readVerifyJson(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // fall through
  }
  throw new Error(`Verify backend returned non-JSON (${res.status})`);
}

async function lookupPayment(c: { env: Env; executionCtx: unknown }, paymentId: string): Promise<Record<string, unknown>> {
  const base = publicApiBase(c.env);
  const verifyUrl = `${base}/api/verify/${encodeURIComponent(paymentId)}`;
  const request = new Request(verifyUrl, {
    headers: { 'User-Agent': 'AgentPay-x402-verifier/1.0' },
  });

  const internal = getInternalAppFetcher();
  if (internal) {
    const res = await internal(request, c.env, c.executionCtx as never);
    return readVerifyJson(res);
  }

  try {
    const res = await fetch(verifyUrl, {
      headers: { 'User-Agent': 'AgentPay-x402-verifier/1.0' },
    });
    return readVerifyJson(res);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`Verification backend unavailable: ${reason}`);
  }
}

// ---------------------------------------------------------------------------
// GET /api/x402  — advertised challenge
// ---------------------------------------------------------------------------
router.get('/', (c) => respondWithChallenge(c));
router.get('/challenge', (c) => respondWithChallenge(c));
router.get('/pay', (c) => respondWithChallenge(c));

// ---------------------------------------------------------------------------
// GET /api/x402/schema  — discovery endpoint for agents
// ---------------------------------------------------------------------------
router.get('/schema', (c) => {
  const base = publicApiBase(c.env);
  return c.json({
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
      challenge: { method: 'GET', path: '/api/x402', status: 402 },
      schema: { method: 'GET', path: '/api/x402/schema' },
      verify: { method: 'POST', path: '/api/x402/verify' },
      createIntent: { method: 'POST', path: '/api/v1/payment-intents' },
      checkPayment: { method: 'GET', path: '/api/verify/:intentId' },
    },
    agentRank: {
      description: 'Resources can require a minimum AgentRank score',
      checkUrl: `${base}/api/passport/:agentId`,
    },
    docs: 'https://agentpay.so/docs#x402',
  });
});

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

  let data: Record<string, unknown>;
  try {
    data = await lookupPayment(c, paymentId);
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'Verification backend unavailable';
    return c.json({
      verified: false,
      error: 'verification_backend_unavailable',
      reason,
      protocol: 'x402',
    }, 503);
  }

  const status = typeof data.status === 'string' ? data.status : undefined;
  if (status !== 'verified' && status !== 'completed' && status !== 'confirmed' && data.verified !== true) {
    return c.json({
      verified: false,
      reason: `Payment status: ${status ?? 'unknown'}`,
      protocol: 'x402',
    }, 402);
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
    status: status ?? 'verified',
    amount: data.amount ?? null,
    protocol: 'x402',
    verifiedAt: new Date().toISOString(),
  });
});

export { router as x402Router };
