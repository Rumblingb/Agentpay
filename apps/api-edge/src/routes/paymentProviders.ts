import { Hono } from 'hono';

import type { Env, Variables } from '../types';
import { createDb, parseJsonb, type Sql } from '../lib/db';
import {
  PaymentProviderError,
  assertPaymentModeAllowed,
  createProviderPayment,
  decryptSensitivePaymentResponse,
  defaultPaymentPolicy,
  encryptSensitivePaymentResponse,
  enforcePaymentPolicy,
  fingerprintPaymentRequest,
  getPaymentProviderStatuses,
  paymentReservationLockKeys,
  type PaymentRequest,
  type PaymentResult,
} from '../lib/paymentProviders';
import { authenticateApiKey } from '../middleware/auth';

const router = new Hono<{ Bindings: Env; Variables: Variables }>();
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;

type StoredPayment = {
  id: string;
  idempotencyKey: string;
  provider: string;
  providerReference: string | null;
  amountMinor: string;
  currency: string;
  state: string;
  requestHash: string;
  responsePayload: unknown;
  sensitiveResponseCiphertext: string | null;
  createdAt: string;
  updatedAt: string;
};

async function paymentResponse(row: StoredPayment, replayed: boolean, env: Env) {
  const payload = parseJsonb<Record<string, unknown>>(row.responsePayload, {});
  const sensitive = row.sensitiveResponseCiphertext
    ? await decryptSensitivePaymentResponse(env, row.sensitiveResponseCiphertext)
    : {};
  return {
    ...payload,
    ...sensitive,
    id: row.id,
    correlationId: row.idempotencyKey,
    provider: row.provider,
    providerReference: row.providerReference,
    amountMinor: Number(row.amountMinor),
    currency: row.currency,
    state: row.state,
    replayed,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function errorStatus(error: PaymentProviderError): 400 | 403 | 502 | 503 {
  if (error.code === 'INVALID_REQUEST') return 400;
  if (error.code === 'POLICY_DENIED' || error.code === 'LIVE_MODE_DISABLED') return 403;
  if (error.code === 'PROVIDER_NOT_CONFIGURED') return 503;
  return 502;
}

router.get('/providers', (c) => c.json({
  paymentMode: c.env.AGENTPAY_PAYMENT_MODE === 'live' ? 'live' : 'sandbox',
  livePaymentsEnabled: c.env.AGENTPAY_PAYMENT_MODE === 'live'
    && c.env.AGENTPAY_LIVE_PAYMENTS_ENABLED === 'true',
  providers: getPaymentProviderStatuses(c.env),
}));

router.use('/provider-intents/*', authenticateApiKey);
router.use('/provider-intents', authenticateApiKey);

router.get('/provider-intents/:idempotencyKey', async (c) => {
  const merchant = c.get('merchant');
  const idempotencyKey = c.req.param('idempotencyKey');
  if (!IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
    return c.json({ error: 'INVALID_REQUEST', message: 'Invalid idempotency key' }, 400);
  }

  const sql = createDb(c.env);
  try {
    const rows = await sql<StoredPayment[]>`
      SELECT
        id,
        idempotency_key AS "idempotencyKey",
        provider,
        provider_reference AS "providerReference",
        amount_minor::text AS "amountMinor",
        currency,
        state,
        request_hash AS "requestHash",
        response_payload AS "responsePayload",
        sensitive_response_ciphertext AS "sensitiveResponseCiphertext",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM provider_payment_requests
      WHERE merchant_id = ${merchant.id}
        AND idempotency_key = ${idempotencyKey}
      LIMIT 1
    `;
    if (!rows.length) return c.json({ error: 'PAYMENT_NOT_FOUND' }, 404);
    const status = rows[0].state === 'processing' ? 202 : 200;
    return c.json(await paymentResponse(rows[0], true, c.env), status);
  } finally {
    sql.end().catch(() => {});
  }
});

router.post('/provider-intents', async (c) => {
  let body: Omit<PaymentRequest, 'merchantId'>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'INVALID_REQUEST', message: 'A JSON body is required' }, 400);
  }

  const merchant = c.get('merchant');
  const request: PaymentRequest = { ...body, merchantId: merchant.id };
  const policy = defaultPaymentPolicy(c.env);

  let requestHash: string;
  try {
    assertPaymentModeAllowed(c.env);
    enforcePaymentPolicy(request, policy, { dailyAmountMinor: 0 });
    const providerStatus = getPaymentProviderStatuses(c.env)
      .find((status) => status.provider === request.provider);
    if (!providerStatus?.configured) {
      throw new PaymentProviderError(
        'PROVIDER_NOT_CONFIGURED',
        providerStatus?.reason ?? 'Payment provider is not configured',
      );
    }
    requestHash = await fingerprintPaymentRequest(request);
  } catch (error: unknown) {
    if (error instanceof PaymentProviderError) {
      return c.json({ error: error.code, message: error.message }, errorStatus(error));
    }
    return c.json({ error: 'INVALID_REQUEST', message: 'Invalid payment request' }, 400);
  }

  const sql = createDb(c.env);
  try {
    const reservation = await sql.begin(async (transaction) => {
      const tx = transaction as unknown as Sql;
      // Acquire in a fixed order. The merchant-wide idempotency lock makes a
      // same-key retry replay safely even if a malformed concurrent retry changes currency;
      // the currency lock protects the daily-limit observation and reservation.
      const locks = paymentReservationLockKeys(merchant.id, request.idempotencyKey, request.currency);
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${locks.idempotency}, 0))`;
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${locks.dailyLimit}, 0))`;

      const existing = await tx<StoredPayment[]>`
        SELECT
          id,
          idempotency_key AS "idempotencyKey",
          provider,
          provider_reference AS "providerReference",
          amount_minor::text AS "amountMinor",
          currency,
          state,
          request_hash AS "requestHash",
          response_payload AS "responsePayload",
          sensitive_response_ciphertext AS "sensitiveResponseCiphertext",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM provider_payment_requests
        WHERE merchant_id = ${merchant.id}
          AND idempotency_key = ${request.idempotencyKey}
        FOR UPDATE
      `;

      if (existing.length) {
        return { kind: 'existing' as const, row: existing[0] };
      }

      const dailyRows = await tx<Array<{ amountMinor: string }>>`
        SELECT COALESCE(SUM(amount_minor), 0)::text AS "amountMinor"
        FROM provider_payment_requests
        WHERE merchant_id = ${merchant.id}
          AND currency = ${request.currency}
          AND created_at >= date_trunc('day', now() AT TIME ZONE 'UTC')
          AND state NOT IN ('failed', 'cancelled')
      `;
      const dailyAmountMinor = Number(dailyRows[0]?.amountMinor ?? '0');
      enforcePaymentPolicy(request, policy, { dailyAmountMinor });

      const requestId = crypto.randomUUID();
      await tx`
        INSERT INTO provider_payment_requests (
          id,
          merchant_id,
          agent_id,
          provider,
          idempotency_key,
          amount_minor,
          currency,
          state,
          request_hash
        ) VALUES (
          ${requestId},
          ${merchant.id},
          ${request.agentId},
          ${request.provider},
          ${request.idempotencyKey},
          ${request.amountMinor},
          ${request.currency},
          ${'processing'},
          ${requestHash}
        )
      `;
      await tx`
        INSERT INTO provider_payment_events (
          payment_request_id,
          merchant_id,
          provider,
          event_type,
          correlation_id,
          state,
          amount_minor,
          currency
        ) VALUES (
          ${requestId},
          ${merchant.id},
          ${request.provider},
          ${'payment.reserved'},
          ${request.idempotencyKey},
          ${'processing'},
          ${request.amountMinor},
          ${request.currency}
        )
      `;
      return { kind: 'created' as const, requestId, dailyAmountMinor };
    });

    if (reservation.kind === 'existing') {
      if (reservation.row.requestHash !== requestHash) {
        return c.json({
          error: 'IDEMPOTENCY_CONFLICT',
          message: 'This idempotency key is already bound to a different request',
        }, 409);
      }
      const status = reservation.row.state === 'processing' ? 202 : 200;
      return c.json(await paymentResponse(reservation.row, true, c.env), status);
    }

    let result: PaymentResult;
    try {
      result = await createProviderPayment(
        c.env,
        request,
        policy,
        { dailyAmountMinor: reservation.dailyAmountMinor },
      );
    } catch (error: unknown) {
      const code = error instanceof PaymentProviderError ? error.code : 'PROVIDER_FAILURE';
      await sql.begin(async (transaction) => {
        const tx = transaction as unknown as Sql;
        await tx`
          UPDATE provider_payment_requests
          SET
            state = 'failed',
            response_payload = ${JSON.stringify({ error: code })}::jsonb,
            updated_at = now()
          WHERE id = ${reservation.requestId} AND state = 'processing'
        `;
        await tx`
          INSERT INTO provider_payment_events (
            payment_request_id,
            merchant_id,
            provider,
            event_type,
            correlation_id,
            state,
            amount_minor,
            currency,
            details
          ) VALUES (
            ${reservation.requestId},
            ${merchant.id},
            ${request.provider},
            ${'payment.failed'},
            ${request.idempotencyKey},
            ${'failed'},
            ${request.amountMinor},
            ${request.currency},
            ${JSON.stringify({ code })}::jsonb
          )
        `;
      });
      throw error;
    }

    const sensitiveResponse = {
      ...(result.actionUrl ? { actionUrl: result.actionUrl } : {}),
      ...(result.clientSecret ? { clientSecret: result.clientSecret } : {}),
    };
    const sensitiveResponseCiphertext = Object.keys(sensitiveResponse).length
      ? await encryptSensitivePaymentResponse(c.env, sensitiveResponse)
      : null;
    const persistedResult = {
      ...result,
      actionUrl: undefined,
      clientSecret: undefined,
    };
    const responsePayload = {
      correlationId: request.idempotencyKey,
      ...persistedResult,
    };
    await sql.begin(async (transaction) => {
      const tx = transaction as unknown as Sql;
      await tx`
        UPDATE provider_payment_requests
        SET
          state = ${result.state},
          provider_reference = ${result.providerReference},
          response_payload = ${JSON.stringify(responsePayload)}::jsonb,
          sensitive_response_ciphertext = ${sensitiveResponseCiphertext},
          updated_at = now()
        WHERE id = ${reservation.requestId} AND state = 'processing'
      `;
      await tx`
        INSERT INTO provider_payment_events (
          payment_request_id,
          merchant_id,
          provider,
          event_type,
          correlation_id,
          state,
          amount_minor,
          currency,
          details
        ) VALUES (
          ${reservation.requestId},
          ${merchant.id},
          ${request.provider},
          ${'payment.created'},
          ${request.idempotencyKey},
          ${result.state},
          ${request.amountMinor},
          ${request.currency},
          ${JSON.stringify({ agentId: request.agentId })}::jsonb
        )
      `;
    });

    return c.json({ id: reservation.requestId, replayed: false, ...responsePayload, ...sensitiveResponse }, 201);
  } catch (error: unknown) {
    if (error instanceof PaymentProviderError) {
      return c.json({ error: error.code, message: error.message }, errorStatus(error));
    }
    console.error('[payment-providers] create failed', {
      merchantId: merchant.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return c.json({ error: 'INTERNAL_ERROR', message: 'Failed to create payment' }, 500);
  } finally {
    sql.end().catch(() => {});
  }
});

export { router as paymentProvidersRouter };
