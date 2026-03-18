/**
 * ACP — Agent Communication Protocol (Cloudflare Workers / Hono)
 *
 * Provides payment request + verification endpoints for multi-agent systems
 * that use ACP-formatted payment messages.
 *
 * Endpoints:
 *   POST /api/acp/pay     — create ACP payment request
 *   POST /api/acp/verify  — verify an ACP payment token
 *   GET  /api/acp/schema  — machine-readable schema for agent discovery
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../types';

const router = new Hono<{ Bindings: Env; Variables: Variables }>();

const BASE_URL = 'https://api.agentpay.so';

// ---------------------------------------------------------------------------
// GET /api/acp/schema
// ---------------------------------------------------------------------------
router.get('/schema', (c) =>
  c.json({
    protocol: 'acp',
    version: '1.0',
    description: 'Agent Communication Protocol — structured A2A payment messages',
    endpoints: {
      pay:    { method: 'POST', path: '/api/acp/pay',    description: 'Create ACP payment request' },
      verify: { method: 'POST', path: '/api/acp/verify', description: 'Verify ACP payment token' },
      schema: { method: 'GET',  path: '/api/acp/schema', description: 'This schema' },
    },
    paySchema: {
      senderId:        'string (required) — sending agent DID or ID',
      recipientId:     'string (required) — receiving agent DID or ID',
      amountUsd:       'number (required) — USD cents, e.g. 100 = $1.00',
      purpose:         'string (required, max 255)',
      preferredMethod: 'solana | stripe | agentpay  (default: agentpay)',
      messageId:       'string (optional)',
      metadata:        'object (optional)',
    },
    docs: 'https://agentpay.so/docs#acp',
  }),
);

// ---------------------------------------------------------------------------
// POST /api/acp/pay
// ---------------------------------------------------------------------------
router.post('/pay', async (c) => {
  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }

  const { messageId, senderId, recipientId, amountUsd, purpose, preferredMethod = 'agentpay', metadata } = body;

  if (!senderId || !recipientId || !amountUsd || !purpose) {
    return c.json({ error: 'senderId, recipientId, amountUsd, purpose required' }, 400);
  }
  if (!['solana', 'stripe', 'agentpay'].includes(preferredMethod)) {
    return c.json({ error: 'preferredMethod must be solana | stripe | agentpay' }, 400);
  }

  const paymentToken = crypto.randomUUID();
  const resolvedMessageId = messageId || crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();

  const receipt = {
    messageId: resolvedMessageId,
    status: 'pending',
    paymentToken,
    paymentUrl: `${BASE_URL}/api/v1/payment-intents`,
    agentpayIntentId: paymentToken,
    expiresAt,
    protocol: 'acp',
  };

  return c.json({
    success: true,
    receipt,
    nextSteps: {
      description: 'Complete payment using the AgentPay SDK or REST API',
      solanaEndpoint:  preferredMethod === 'solana'  ? `${BASE_URL}/api/v1/payment-intents` : undefined,
      stripeEndpoint:  preferredMethod === 'stripe'  ? `${BASE_URL}/api/fiat/checkout`      : undefined,
      verifyEndpoint: `${BASE_URL}/api/acp/verify`,
      docs: 'https://agentpay.so/docs#acp',
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
  }, 201);
});

// ---------------------------------------------------------------------------
// POST /api/acp/verify
// ---------------------------------------------------------------------------
router.post('/verify', async (c) => {
  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }

  const { paymentToken, senderId, expectedAmountUsd } = body;
  if (!paymentToken || !senderId) {
    return c.json({ error: 'paymentToken and senderId required' }, 400);
  }

  // UUID v4 format check
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidPattern.test(paymentToken)) {
    return c.json({ verified: false, error: 'INVALID_TOKEN_FORMAT', protocol: 'acp' }, 400);
  }

  // Proxy to verify endpoint for ledger confirmation
  let ledgerStatus: any = null;
  try {
    const res = await fetch(`${BASE_URL}/api/verify/${encodeURIComponent(paymentToken)}`, {
      headers: { 'User-Agent': 'AgentPay-ACP-verifier/1.0' },
    });
    if (res.ok) ledgerStatus = await res.json();
  } catch { /* best-effort */ }

  const verified = ledgerStatus
    ? (ledgerStatus.status === 'verified' || ledgerStatus.status === 'completed')
    : false;

  return c.json({
    verified,
    paymentToken,
    senderId,
    expectedAmountUsd,
    ledgerStatus: ledgerStatus?.status ?? 'unknown',
    protocol: 'acp',
    verifiedAt: new Date().toISOString(),
    ...(verified ? {} : { _note: 'Token format valid; ledger confirmation pending. Use /api/verify/:id for real-time status.' }),
  });
});

export { router as acpRouter };
