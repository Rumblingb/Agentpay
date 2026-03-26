/**
 * Marketplace — Agent Discovery, Hire & Revenue (Cloudflare Workers / Hono)
 *
 * Endpoints:
 *   GET  /api/marketplace/discover        — list registered agents (filterable)
 *   GET  /api/marketplace/agent/:id       — single agent public profile
 *   POST /api/marketplace/hire            — hire an agent (5% take-rate on job value)
 *   POST /api/marketplace/hire/:jobId/complete — mark job done, trigger payout
 *   GET  /api/marketplace/schema          — machine-readable endpoint schema
 *
 * Revenue model:
 *   - Discovery: FREE (drives network growth)
 *   - Hire:      5% platform take-rate on job completion (MARKETPLACE_TAKE_RATE_BPS = 500)
 *   - Payout:    agent receives 95% of agreed price via AgentPay payment intent
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { createDb, parseJsonb } from '../lib/db';
import { MARKETPLACE_TAKE_RATE_BPS } from '../lib/feeLedger';
import { recordFloatAccrual } from '../lib/floatYield';
import { createUpiPaymentLink } from '../lib/razorpay';

const router = new Hono<{ Bindings: Env; Variables: Variables }>();

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function isPaymentConfirmed(metadata: Record<string, unknown> | null | undefined): boolean {
  return metadata?.paymentConfirmed === true ||
    metadata?.stripePaymentConfirmed === true ||
    metadata?.razorpayPaymentConfirmed === true;
}

// ---------------------------------------------------------------------------
// GET /api/marketplace/schema
// ---------------------------------------------------------------------------
router.get('/schema', (c) =>
  c.json({
    description: 'AgentPay Marketplace — discover and hire AI agents',
    endpoints: {
      discover: {
        method: 'GET',
        path: '/api/marketplace/discover',
        queryParams: {
          q:          'string   — free-text search across name, description, category',
          category:   'string   — filter by category (e.g. research, writing, code)',
          minScore:   'number   — minimum AgentRank score (0–1000)',
          maxPriceUsd:'number   — max price per task in USD',
          limit:      'number   — results per page (default 20, max 100)',
          offset:     'number   — pagination offset',
        },
      },
      agent: {
        method: 'GET',
        path: '/api/marketplace/agent/:agentId',
        description: 'Full public profile for a single agent',
      },
    },
  }),
);

router.get('/categories', async (c) => {
  const sql = createDb(c.env);
  try {
    const rows = await sql.unsafe<Array<{ category: string | null }>>(
      `SELECT DISTINCT NULLIF(TRIM(metadata->>'category'), '') AS category
       FROM agent_identities
       WHERE metadata ? 'category'
       ORDER BY category ASC`,
    ).catch(() => []);

    return c.json({
      success: true,
      categories: rows
        .map((row) => row.category)
        .filter((category): category is string => Boolean(category))
        .map((category) => ({ id: category, name: category })),
    });
  } finally {
    await sql.end().catch(() => {});
  }
});

// ---------------------------------------------------------------------------
// GET /api/marketplace/discover
// ---------------------------------------------------------------------------
router.get('/discover', async (c) => {
  const { q, category, minScore, maxPriceUsd, limit = '20', offset = '0' } = c.req.query();

  const limitN  = Math.min(parseInt(limit,  10) || 20, 100);
  const offsetN = Math.max(parseInt(offset, 10) || 0, 0);
  const minScoreN     = minScore     ? parseFloat(minScore)     : null;
  const maxPriceUsdN  = maxPriceUsd  ? parseFloat(maxPriceUsd)  : null;

  const sql = createDb(c.env);
  try {
    // Include self-registered agents (kyc_status='programmatic') + human-verified agents
    const conditions: string[] = ["(verified = true OR kyc_status = 'programmatic')"];
    const params: any[] = [];

    if (q) {
      // Text search across name + description fields in metadata
      params.push(`%${q.toLowerCase()}%`);
      conditions.push(`(LOWER(metadata->>'name') LIKE $${params.length} OR LOWER(metadata->>'description') LIKE $${params.length} OR LOWER(metadata->>'category') LIKE $${params.length})`);
    }
    if (category) {
      params.push(`%${category.toLowerCase()}%`);
      conditions.push(`LOWER(metadata->>'category') LIKE $${params.length}`);
    }
    if (minScoreN !== null) {
      params.push(minScoreN);
      conditions.push(`COALESCE((metadata->>'agentRankScore')::numeric, 0) >= $${params.length}`);
    }
    if (maxPriceUsdN !== null) {
      params.push(maxPriceUsdN);
      conditions.push(`COALESCE((metadata->>'pricePerTaskUsd')::numeric, 0) <= $${params.length}`);
    }

    const where = conditions.join(' AND ');
    params.push(limitN, offsetN);
    const lIdx = params.length - 1;
    const oIdx = params.length;

    const rows = await sql.unsafe<any[]>(
      `SELECT agent_id, metadata, verified, kyc_status, created_at
       FROM agent_identities
       WHERE ${where}
       ORDER BY COALESCE((metadata->>'agentRankScore')::numeric, 0) DESC
       LIMIT $${lIdx} OFFSET $${oIdx}`,
      params,
    ).catch(() => []);

    const countRows = await sql.unsafe<any[]>(
      `SELECT COUNT(*) AS n FROM agent_identities WHERE ${where}`,
      params.slice(0, params.length - 2),
    ).catch(() => [{ n: 0 }]);

    const agents = rows.map((r: any) => {
      const m = parseJsonb(r.metadata, {} as Record<string, unknown>);
      return {
        agentId:        r.agent_id,
        name:           (m.name        as string)   ?? r.agent_id,
        category:       (m.category    as string)   ?? 'general',
        description:    (m.description as string)   ?? '',
        agentRankScore: (m.agentRankScore as number) ?? 0,
        pricePerTaskUsd:(m.pricePerTaskUsd as number) ?? null,
        capabilities:   (m.capabilities as string[]) ?? [],
        verified:       r.verified ?? false,
        passportUrl:    `https://app.agentpay.so/agent/${r.agent_id}`,
        registeredAt:   r.created_at,
      };
    });

    return c.json({
      success: true,
      agents,
      pagination: {
        total:  Number(countRows[0]?.n ?? 0),
        limit:  limitN,
        offset: offsetN,
      },
    });
  } finally {
    await sql.end().catch(() => {});
  }
});

// ---------------------------------------------------------------------------
// GET /api/marketplace/agent/:agentId
// ---------------------------------------------------------------------------
router.get('/agent/:agentId', async (c) => {
  const { agentId } = c.req.param();

  const sql = createDb(c.env);
  try {
    const rows = await sql<any[]>`
      SELECT agent_id, metadata, verified, kyc_status, created_at
      FROM agent_identities
      WHERE agent_id = ${agentId}
      LIMIT 1
    `.catch(() => []);

    if (!rows.length) return c.json({ error: 'Agent not found', agentId }, 404);

    const r = rows[0];
    const m = parseJsonb(r.metadata, {} as Record<string, unknown>);
    return c.json({
      success: true,
      agent: {
        agentId:        r.agent_id,
        name:           (m.name        as string)   ?? r.agent_id,
        category:       (m.category    as string)   ?? 'general',
        description:    (m.description as string)   ?? '',
        verified:       r.verified,
        kycStatus:      r.kyc_status,
        agentRankScore: (m.agentRankScore as number) ?? 0,
        pricePerTaskUsd:(m.pricePerTaskUsd as number) ?? null,
        capabilities:   (m.capabilities as string[]) ?? [],
        passportUrl:    `https://app.agentpay.so/agent/${r.agent_id}`,
        registeredAt:   r.created_at,
      },
    });
  } finally {
    await sql.end().catch(() => {});
  }
});

// ---------------------------------------------------------------------------
// POST /api/marketplace/hire  — hire an agent for a job
//
// Revenue: 5% take-rate on job completion (not upfront).
// Creates a job escrow record. Payout triggered by /complete.
// ---------------------------------------------------------------------------
router.post('/hire', async (c) => {
  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }

  const { hirerId, agentId, jobDescription, agreedPriceUsdc, callbackUrl, stripePaymentIntentId } = body;
  if (!hirerId || !agentId || !jobDescription || !agreedPriceUsdc) {
    return c.json({ error: 'hirerId, agentId, jobDescription, agreedPriceUsdc required' }, 400);
  }
  if (typeof agreedPriceUsdc !== 'number' || agreedPriceUsdc <= 0) {
    return c.json({ error: 'agreedPriceUsdc must be a positive number' }, 400);
  }

  const takeRateBps  = MARKETPLACE_TAKE_RATE_BPS;                                  // 500 = 5%
  const platformFee  = parseFloat(((agreedPriceUsdc * takeRateBps) / 10_000).toFixed(6));
  const agentPayout  = parseFloat((agreedPriceUsdc - platformFee).toFixed(6));

  const jobId    = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24h

  // Per-job signed callback token — the agent receives the plaintext and uses it to
  // authenticate the /complete call. The hash is stored; we never compare raw secrets.
  const completionSecret = `cbs_${crypto.randomUUID().replace(/-/g, '')}`;
  const completionSecretHash = await sha256Hex(completionSecret);

  const sql = createDb(c.env);
  try {
    await sql`
      INSERT INTO payment_intents
        (id, merchant_id, agent_id, amount, currency, status, verification_token, expires_at, metadata)
      VALUES
        (${jobId},
         NULL,
         ${agentId},
         ${agreedPriceUsdc},
         ${'USDC'},
         ${'escrow_pending'},
         ${`MKT_${jobId.slice(0, 8).toUpperCase()}`},
         ${expiresAt}::timestamptz,
         ${JSON.stringify({
           protocol: 'marketplace_hire',
           hirerId,
           agentId,
           jobDescription,
           agreedPriceUsdc,
           platformFee,
           agentPayout,
           takeRateBps,
           hiredAt: new Date().toISOString(),
           callbackUrl: callbackUrl ?? null,
           completionSecretHash,
           paymentConfirmed: false,
           stripePaymentIntentId: stripePaymentIntentId ?? null,
           stripePaymentConfirmed: false,
           razorpayPaymentConfirmed: false,
         })}::jsonb)
    `.catch(() => {});
  } finally {
    await sql.end().catch(() => {});
  }

  // Float yield — start accruing on escrowed funds immediately
  const sql2 = createDb(c.env);
  try {
    await recordFloatAccrual(sql2, {
      intentId:      jobId,
      principalUsdc: agreedPriceUsdc,
      holdStartedAt: new Date(),
      source:        'marketplace_escrow',
    });
  } finally {
    await sql2.end().catch(() => {});
  }

  // ── Dispatch to agent's webhookUrl ────────────────────────────────────────
  // Look up the agent's webhookUrl from agent_identities and POST the job payload.
  // After dispatch (success or failure) we write dispatch_status back to the DB so
  // operators can observe what happened without tailing logs.
  const dispatchSql = createDb(c.env);
  c.executionCtx.waitUntil((async () => {
    let dispatchStatus = 'no_webhook';
    let dispatchError: string | null = null;
    try {
      const agentRows = await dispatchSql<any[]>`
        SELECT metadata FROM agent_identities WHERE agent_id = ${agentId} LIMIT 1
      `.catch(() => []);
      const agentMeta = parseJsonb(agentRows[0]?.metadata ?? '{}', {} as Record<string, unknown>);
      const webhookUrl = agentMeta.webhookUrl as string | undefined;
      if (webhookUrl) {
        const res = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jobId,
            hirerId,
            agentId,
            jobDescription,
            agreedPriceUsdc,
            agentName: agentMeta.name ?? agentId,
            callbackUrl: `${c.env.API_BASE_URL}/api/marketplace/hire/${jobId}/complete`,
            completionSecret,  // plaintext — agent presents this to authenticate /complete
          }),
        });
        if (res.ok) {
          dispatchStatus = 'sent';
          console.info('[marketplace/hire] dispatched to agent', { jobId, agentId, webhookUrl });
        } else {
          dispatchStatus = 'rejected';
          dispatchError = `HTTP ${res.status}`;
          console.error('[marketplace/hire] agent webhook rejected', { jobId, status: res.status });
        }
      }
    } catch (e) {
      dispatchStatus = 'failed';
      dispatchError = e instanceof Error ? e.message : String(e);
      console.error('[marketplace/hire] dispatch error', dispatchError);
    }

    // Write dispatch result back to the job record
    const updateSql = createDb(c.env);
    try {
      await updateSql.unsafe(
        `UPDATE payment_intents
         SET metadata = metadata || $1::jsonb
         WHERE id = $2`,
        [JSON.stringify({ dispatchStatus, dispatchError, dispatchedAt: new Date().toISOString() }), jobId],
      );
    } catch { /* best-effort */ } finally {
      await updateSql.end().catch(() => {});
      await dispatchSql.end().catch(() => {});
    }
  })());

  return c.json({
    success: true,
    jobId,
    hirerId,
    agentId,
    agreedPriceUsdc,
    completionSecret,   // caller uses this to authenticate /complete — stronger than hirerId alone
    breakdown: {
      platformFee,
      platformFeePct: `${(takeRateBps / 100).toFixed(1)}%`,
      agentPayout,
    },
    status: 'escrow_pending',
    expiresAt,
    nextStep: `POST /api/marketplace/hire/${jobId}/complete once the agent delivers`,
    _schema: 'MarketplaceHire/1.0',
  }, 201);
});

// ---------------------------------------------------------------------------
// POST /api/marketplace/hire/:jobId/complete  — mark job done, trigger payout
//
// Transitions escrow → completed. The 5% fee stays with platform.
// Agent gets 95% via the agentPayout amount recorded at hire time.
// ---------------------------------------------------------------------------
router.post('/hire/:jobId/complete', async (c) => {
  const { jobId } = c.req.param();
  let body: any = {};
  try { body = await c.req.json(); } catch {}

  const { hirerId, agentKey, completionSecret, completionProof } = body;
  // Three auth paths — at least one required:
  //   1. completionSecret: per-job HMAC token sent to agent at dispatch time (preferred)
  //   2. agentKey:         agent's long-lived API key (self-report delivery)
  //   3. hirerId:          hirer confirms receipt (weaker — hirerId is in hire response)
  if (!hirerId && !agentKey && !completionSecret) {
    return c.json({ error: 'completionSecret, agentKey, or hirerId required' }, 400);
  }

  const sql = createDb(c.env);
  try {
    const rows = await sql<any[]>`
      SELECT id, status, amount, metadata FROM payment_intents
      WHERE id = ${jobId} AND metadata->>'protocol' = 'marketplace_hire'
      LIMIT 1
    `.catch(() => []);

    if (!rows.length) return c.json({ error: 'Job not found', jobId }, 404);

    const job = rows[0];

    // Verify caller — three auth paths
    const callerIsHirer = hirerId && job.metadata?.hirerId === hirerId;

    let callerHasSecret = false;
    if (completionSecret && job.metadata?.completionSecretHash) {
      const provided = await sha256Hex(completionSecret);
      callerHasSecret = provided === job.metadata.completionSecretHash;
    }

    let callerIsAgent = false;
    if (agentKey && job.metadata?.agentId) {
      const agentRows = await sql<any[]>`
        SELECT agent_key_hash FROM agent_identities
        WHERE agent_id = ${job.metadata.agentId} LIMIT 1
      `.catch(() => []);
      if (agentRows.length) {
        callerIsAgent = (await sha256Hex(agentKey)) === agentRows[0].agent_key_hash;
      }
    }

    if (!callerIsHirer && !callerHasSecret && !callerIsAgent) {
      return c.json({ error: 'Unauthorized: valid completionSecret, agentKey, or hirerId required' }, 403);
    }
    // hirerId alone is the weakest auth path — require confirmed payment before completion.
    // completionSecret / agentKey paths are trusted internal callers (can complete without Stripe).
    if (callerIsHirer && !callerHasSecret && !callerIsAgent && !isPaymentConfirmed(job.metadata ?? null)) {
      return c.json({ error: 'Payment not confirmed. Provide completionSecret or complete payment first.' }, 402);
    }
    if (job.status !== 'escrow_pending') {
      return c.json({ error: `Job is already in status: ${job.status}` }, 409);
    }

    const completedAt = new Date().toISOString();
    await sql`
      UPDATE payment_intents
      SET status = 'completed',
          metadata = metadata || ${JSON.stringify({ completionProof: completionProof ?? null, completedAt })}::jsonb
      WHERE id = ${jobId}
    `.catch(() => {});

    // Trust write — increment AgentRank on successful delivery
    // Drives the trust flywheel: every completed job improves reputation.
    const trustSql = createDb(c.env);
    try {
      await trustSql.unsafe(
        `UPDATE agentrank_scores
         SET transaction_volume    = transaction_volume + 1,
             score                 = LEAST(score + 5, 1000),
             service_delivery      = COALESCE(
               (transaction_volume::float + 1) / NULLIF(transaction_volume + 1, 0),
               1.0
             ),
             updated_at            = NOW()
         WHERE agent_id = $1`,
        [job.metadata?.agentId ?? ''],
      );
      console.info('[marketplace/complete] agentrank updated', { agentId: job.metadata?.agentId });
    } catch { /* best-effort — never block completion */ } finally {
      await trustSql.end().catch(() => {});
    }

    // Settle float yield accrual
    const sql2 = createDb(c.env);
    try {
      await recordFloatAccrual(sql2, {
        intentId:      jobId,
        principalUsdc: Number(job.amount),
        holdStartedAt: new Date(job.metadata?.hiredAt ?? job.created_at ?? Date.now()),
        holdEndedAt:   new Date(),
        source:        'marketplace_escrow',
      });
    } finally {
      await sql2.end().catch(() => {});
    }

    return c.json({
      success: true,
      jobId,
      status: 'completed',
      completedAt,
      payout: {
        agentId:      job.metadata?.agentId,
        agentPayout:  job.metadata?.agentPayout,
        platformFee:  job.metadata?.platformFee,
        currency:     'USDC',
      },
      message: 'Job complete. Agent payout queued. Platform fee collected.',
    });
  } finally {
    await sql.end().catch(() => {});
  }
});

// ---------------------------------------------------------------------------
// POST /api/marketplace/checkout-session
//
// Creates a Stripe Checkout Session (hosted payment page — no native SDK).
// The app opens session.url in the device browser via Linking.openURL.
// On completion, the Stripe webhook marks the job stripePaymentConfirmed=true.
// ---------------------------------------------------------------------------
router.post('/checkout-session', async (c) => {
  if (!c.env.STRIPE_SECRET_KEY) {
    return c.json({ error: 'Stripe not configured on this deployment' }, 503);
  }

  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }

  const { jobId, journeyId, amountFiat, currencyCode, description } = body;
  if (!jobId || typeof amountFiat !== 'number' || amountFiat <= 0) {
    return c.json({ error: 'jobId and amountFiat required' }, 400);
  }

  const currency    = (currencyCode ?? 'GBP').toLowerCase();
  // Stripe amounts are in smallest currency unit. INR and GBP both use 1/100.
  const amountSmall = Math.max(Math.round(amountFiat * 100), currency === 'inr' ? 5000 : 30);
  const desc        = description ?? `Bro booking`;

  const successUrl = `${c.env.STRIPE_SUCCESS_URL ?? 'https://agentpay.so/payment/success'}?jobId=${encodeURIComponent(jobId)}`;
  const cancelUrl  = `${c.env.STRIPE_CANCEL_URL ?? 'https://agentpay.so/payment/cancel'}?jobId=${encodeURIComponent(jobId)}`;

  const checkoutBody = new URLSearchParams({
    mode:                                          'payment',
    'line_items[0][price_data][currency]':         currency,
    'line_items[0][price_data][product_data][name]': desc,
    'line_items[0][price_data][unit_amount]':      String(amountSmall),
    'line_items[0][quantity]':                     '1',
    success_url:                                   successUrl,
    cancel_url:                                    cancelUrl,
    'metadata[jobId]':                             jobId,
    ...(journeyId ? { 'metadata[journeyId]': journeyId } : {}),
    'metadata[source]':                            'bro_app',
  });

  const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${c.env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: checkoutBody.toString(),
  });

  if (!stripeRes.ok) {
    const err = await stripeRes.json<any>().catch(() => ({}));
    console.error('[marketplace/checkout-session] stripe error', err);
    return c.json({ error: 'Stripe error', details: err?.error?.message }, 502);
  }

  const session = await stripeRes.json<any>();

  // Store checkout session ID in job metadata so webhook can confirm payment
  const sql = createDb(c.env);
  try {
    await sql`
      UPDATE payment_intents
      SET metadata = metadata || ${JSON.stringify({
        paymentProvider: 'stripe',
        stripeCheckoutSessionId: session.id,
        journeyId: journeyId ?? null,
      })}::jsonb
      WHERE (
        id = ${jobId}
        OR (${journeyId ?? null} IS NOT NULL AND metadata->>'journeyId' = ${journeyId ?? ''})
      )
        AND metadata->>'protocol' = 'marketplace_hire'
    `;
  } catch {
    // Non-fatal — webhook falls back to session.metadata.jobId
  } finally {
    await sql.end().catch(() => {});
  }

  return c.json({
    success:   true,
    url:       session.url,
    sessionId: session.id,
  }, 201);
});

router.post('/upi-payment-link', async (c) => {
  if (!c.env.RAZORPAY_KEY_ID || !c.env.RAZORPAY_KEY_SECRET) {
    return c.json({ error: 'Razorpay not configured on this deployment' }, 503);
  }

  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }

  const { jobId, journeyId, amountInr, description, customerName, customerPhone, customerEmail } = body;
  if (!jobId || typeof amountInr !== 'number' || amountInr <= 0) {
    return c.json({ error: 'jobId and amountInr required' }, 400);
  }

  const successUrl = `${c.env.STRIPE_SUCCESS_URL ?? 'https://agentpay.so/payment/success'}?jobId=${encodeURIComponent(jobId)}`;

  try {
    const result = await createUpiPaymentLink(c.env, {
      amountInr,
      description: description ?? 'Bro booking',
      receipt: jobId,
      referenceId: jobId,
      notes: { jobId, journeyId, source: 'bro_app' },
      callbackUrl: successUrl,
      customerName: typeof customerName === 'string' ? customerName : undefined,
      customerPhone: typeof customerPhone === 'string' ? customerPhone : undefined,
      customerEmail: typeof customerEmail === 'string' ? customerEmail : undefined,
    });

    const sql = createDb(c.env);
    try {
      await sql`
        UPDATE payment_intents
        SET metadata = metadata || ${JSON.stringify({
          paymentProvider: 'razorpay',
          razorpayPaymentLinkId: result.paymentLinkId,
          razorpayReferenceId: jobId,
          journeyId: journeyId ?? null,
        })}::jsonb
        WHERE (
          id = ${jobId}
          OR (${journeyId ?? null} IS NOT NULL AND metadata->>'journeyId' = ${journeyId ?? ''})
        )
          AND metadata->>'protocol' = 'marketplace_hire'
      `;
    } finally {
      await sql.end().catch(() => {});
    }

    return c.json({ success: true, ...result, amountInr }, 201);
  } catch (err: unknown) {
    console.error('[marketplace/upi-payment-link] razorpay error', err);
    return c.json({ error: 'Razorpay error' }, 502);
  }
});

export { router as marketplaceRouter };
