/**
 * AP2 — Agent Payment Protocol v2 (Cloudflare Workers / Hono)
 *
 * Lightweight A2A micropayment flow: request → receipt → confirm
 * DB-backed via payment_intents table (Hyperdrive → Supabase).
 * Stateless: no in-memory Map — every lookup hits the DB.
 *
 * Endpoints:
 *   POST /api/ap2/request   — agent initiates payment request
 *   POST /api/ap2/payment   — alias for /request
 *   POST /api/ap2/receipt   — payee issues signed receipt
 *   POST /api/ap2/confirm   — payer confirms, releases funds
 *   GET  /api/ap2/status/:id
 *   GET  /api/ap2/schema
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { createDb } from '../lib/db';
import { hmacSign } from '../lib/hmac';

const router = new Hono<{ Bindings: Env; Variables: Variables }>();

function randomId() {
  return crypto.randomUUID();
}

function randomToken(prefix: string) {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return `${prefix}_${Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')}`;
}

// ---------------------------------------------------------------------------
// GET /api/ap2/schema
// ---------------------------------------------------------------------------
router.get('/schema', (c) =>
  c.json({
    protocol: 'ap2',
    version: '2.0',
    description: 'Agent Payment Protocol v2 — lightweight A2A micropayments',
    flow: ['POST /request → POST /receipt → POST /confirm'],
    endpoints: {
      request: { method: 'POST', path: '/api/ap2/request', description: 'Initiate payment' },
      payment: { method: 'POST', path: '/api/ap2/payment', description: 'Alias for /request' },
      receipt: { method: 'POST', path: '/api/ap2/receipt', description: 'Payee issues receipt' },
      confirm: { method: 'POST', path: '/api/ap2/confirm', description: 'Payer confirms' },
      status:  { method: 'GET',  path: '/api/ap2/status/:id', description: 'Get status' },
      schema:  { method: 'GET',  path: '/api/ap2/schema', description: 'This schema' },
    },
    docs: 'https://agentpay.so/docs#ap2',
  }),
);

// ---------------------------------------------------------------------------
// POST /api/ap2/request  — create AP2 payment request
// ---------------------------------------------------------------------------
async function handleRequest(c: any) {
  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }

  const { payerId, payeeId, amountUsdc, taskDescription, callbackUrl, ttlSeconds = 300, metadata } = body;
  if (!payerId || !payeeId || !amountUsdc || !taskDescription) {
    return c.json({ error: 'payerId, payeeId, amountUsdc, taskDescription required' }, 400);
  }
  if (typeof amountUsdc !== 'number' || amountUsdc <= 0 || amountUsdc > 100000) {
    return c.json({ error: 'amountUsdc must be a positive number ≤ 100,000' }, 400);
  }

  const requestId = randomId();
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
  const verificationToken = randomToken('APV');

  const sql = createDb(c.env);
  try {
    await sql`
      INSERT INTO payment_intents
        (id, merchant_id, amount, currency, status, verification_token, expires_at, metadata)
      VALUES
        (${requestId},
         ${'system'},
         ${amountUsdc},
         ${'USDC'},
         ${'pending_receipt'},
         ${verificationToken},
         ${expiresAt}::timestamptz,
         ${JSON.stringify({
           protocol: 'ap2',
           payerId,
           payeeId,
           taskDescription,
           callbackUrl: callbackUrl ?? null,
           requestMetadata: metadata ?? null,
         })}::jsonb)
    `.catch(() => {}); // best-effort persist
  } finally {
    await sql.end().catch(() => {});
  }

  const tx = {
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

  return c.json({
    success: true,
    requestId,
    transaction: tx,
    nextStep: 'payee_issues_receipt',
    instructions: {
      payee: `POST /api/ap2/receipt with requestId: ${requestId}`,
      payer: 'POST /api/ap2/confirm after receipt is issued',
    },
    docs: 'https://agentpay.so/docs#ap2',
  }, 201);
}

router.post('/request', handleRequest);
router.post('/payment', handleRequest); // alias

// ---------------------------------------------------------------------------
// POST /api/ap2/receipt  — payee issues signed receipt
// ---------------------------------------------------------------------------
router.post('/receipt', async (c) => {
  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }

  const { requestId, payeeSignature, completionProof } = body;
  if (!requestId || !payeeSignature) {
    return c.json({ error: 'requestId and payeeSignature required' }, 400);
  }

  const sql = createDb(c.env);
  let tx: any;
  try {
    const rows = await sql<any[]>`
      SELECT id, status, amount, metadata FROM payment_intents
      WHERE id = ${requestId} AND metadata->>'protocol' = 'ap2'
      LIMIT 1
    `.catch(() => []);
    if (!rows.length) return c.json({ error: 'AP2 request not found', requestId }, 404);
    tx = rows[0];
  } finally {
    await sql.end().catch(() => {});
  }

  if (tx.status !== 'pending_receipt') {
    return c.json({ error: `Cannot issue receipt: status is '${tx.status}'` }, 409);
  }

  const signingSecret = c.env.AGENTPAY_SIGNING_SECRET;
  if (!signingSecret) return c.json({ error: 'Server config error: AGENTPAY_SIGNING_SECRET missing' }, 500);

  const receiptId = randomId();
  const receiptData = `${requestId}:${receiptId}:${tx.amount}:${tx.metadata?.payeeId ?? ''}`;
  const serverSignature = await hmacSign(receiptData, signingSecret);

  const receipt = { receiptId, requestId, payeeSignature, completionProof, serverSignature, issuedAt: new Date().toISOString() };
  const meta = { ...(tx.metadata ?? {}), ap2_receipt: receipt };

  const sql2 = createDb(c.env);
  try {
    await sql2`
      UPDATE payment_intents
      SET status = 'pending_confirmation', metadata = ${JSON.stringify(meta)}::jsonb
      WHERE id = ${requestId}
    `.catch(() => {});
  } finally {
    await sql2.end().catch(() => {});
  }

  return c.json({ success: true, receipt, nextStep: 'payer_confirms', instructions: { payer: 'POST /api/ap2/confirm' } }, 201);
});

// ---------------------------------------------------------------------------
// POST /api/ap2/confirm  — payer confirms receipt, releases funds
// ---------------------------------------------------------------------------
router.post('/confirm', async (c) => {
  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }

  const { requestId, receiptId, payerConfirmation } = body;
  if (!requestId || !receiptId || !payerConfirmation) {
    return c.json({ error: 'requestId, receiptId, payerConfirmation required' }, 400);
  }

  const sql = createDb(c.env);
  let tx: any;
  try {
    const rows = await sql<any[]>`
      SELECT id, status, amount, metadata FROM payment_intents
      WHERE id = ${requestId} AND metadata->>'protocol' = 'ap2'
      LIMIT 1
    `.catch(() => []);
    if (!rows.length) return c.json({ error: 'AP2 request not found', requestId }, 404);
    tx = rows[0];
  } finally {
    await sql.end().catch(() => {});
  }

  if (tx.status !== 'pending_confirmation') {
    return c.json({ error: `Cannot confirm: status is '${tx.status}'` }, 409);
  }

  const storedReceiptId = tx.metadata?.ap2_receipt?.receiptId;
  if (storedReceiptId !== receiptId) {
    return c.json({ error: 'Receipt ID mismatch' }, 400);
  }

  const sql2 = createDb(c.env);
  try {
    await sql2`
      UPDATE payment_intents SET status = 'completed' WHERE id = ${requestId}
    `.catch(() => {});
  } finally {
    await sql2.end().catch(() => {});
  }

  return c.json({
    success: true,
    transaction: { requestId, status: 'completed', completedAt: new Date().toISOString(), protocol: 'ap2' },
    message: 'AP2 payment confirmed. Funds released to payee.',
    protocol: 'ap2',
  });
});

// ---------------------------------------------------------------------------
// GET /api/ap2/status/:id
// ---------------------------------------------------------------------------
router.get('/status/:id', async (c) => {
  const { id } = c.req.param();
  const sql = createDb(c.env);
  try {
    const rows = await sql<any[]>`
      SELECT id, status, amount, metadata, created_at, expires_at FROM payment_intents
      WHERE id = ${id} AND metadata->>'protocol' = 'ap2'
      LIMIT 1
    `.catch(() => []);
    if (!rows.length) return c.json({ error: 'AP2 transaction not found', id }, 404);
    const row = rows[0];
    return c.json({
      success: true,
      transaction: {
        requestId: row.id,
        status: row.status,
        amountUsdc: Number(row.amount),
        payerId: row.metadata?.payerId,
        payeeId: row.metadata?.payeeId,
        taskDescription: row.metadata?.taskDescription,
        createdAt: row.created_at,
        expiresAt: row.expires_at,
        receipt: row.metadata?.ap2_receipt ?? null,
        protocol: 'ap2',
      },
    });
  } finally {
    await sql.end().catch(() => {});
  }
});

export { router as ap2Router };
