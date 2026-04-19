import { createDb } from './db';
import type { Env, MerchantContext } from '../types';
import {
  getHostedMcpPlan,
  getHostedMcpPublicPricing,
  resolveHostedMcpPlanCode,
  type HostedMcpPlanCode,
} from './mcpBilling';
import { recordInvoicePaidSignal, type ProductSignalAudience, type ProductSignalAuthType } from './productSignals';

const CENTS_PER_USD = 100;

export function isCollectableOutstanding(outstandingUsd: number): boolean {
  return outstandingUsd >= getHostedMcpPublicPricing().collectionPolicy.minimumCollectableUsd;
}

export async function listMerchantInvoicesByType(
  env: Env,
  merchantId: string,
  invoiceType: string,
): Promise<Array<{ id: string; status: string; feeAmount: number; currency: string; createdAt: string }>> {
  const sql = createDb(env);
  try {
    const rows = await sql<Array<{
      id: string;
      status: string;
      fee_amount: string | number;
      currency: string;
      created_at: Date;
    }>>`
      SELECT id, status, fee_amount, currency, created_at
      FROM merchant_invoices
      WHERE merchant_id = ${merchantId}
        AND invoice_type = ${invoiceType}
      ORDER BY created_at DESC
      LIMIT 50
    `;
    return rows.map((r) => ({
      id: r.id,
      status: r.status,
      feeAmount: Number(r.fee_amount ?? 0),
      currency: r.currency,
      createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    }));
  } finally {
    await sql.end().catch(() => {});
  }
}

type MergedLineItem = {
  code: string;
  label: string;
  amountUsd: number;
  quantity?: number;
  unit?: string;
};

export interface HostedMcpInvoiceSummary {
  merchantId: string;
  periodStart: string;
  periodEndExclusive: string;
  planCode: HostedMcpPlanCode;
  planLabel: string;
  usage: {
    toolCalls: number;
    tokenMints: number;
  };
  included: {
    toolCalls: number | null;
    tokenMints: number | null;
  };
  lineItems: MergedLineItem[];
  subtotalUsd: number;
  alreadyInvoicedUsd: number;
  outstandingUsd: number;
  currency: 'USD';
}

export interface CapabilityUsageInvoiceSummary {
  merchantId: string;
  periodStart: string;
  periodEndExclusive: string;
  usage: {
    billableCalls: number;
  };
  lineItems: MergedLineItem[];
  subtotalUsd: number;
  alreadyInvoicedUsd: number;
  outstandingUsd: number;
  currency: 'USD';
}

function monthBounds(now = new Date()): { periodStart: Date; periodEndExclusive: Date } {
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
  const periodEndExclusive = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0));
  return { periodStart, periodEndExclusive };
}

function roundUsd(value: number): number {
  return Math.round(value * 100) / 100;
}

function toCents(valueUsd: number): number {
  return Math.max(Math.round(valueUsd * CENTS_PER_USD), 50);
}

function referenceKey(prefix: string, periodStart: string, invoiceId: string): string {
  return `${prefix}:${periodStart}:${invoiceId}`;
}

async function getCurrentUsageAndInvoiced(
  env: Env,
  merchantId: string,
  periodStart: Date,
  periodEndExclusive: Date,
): Promise<{
  toolCalls: number;
  tokenMints: number;
  alreadyInvoicedUsd: number;
}> {
  let sql;
  try {
    sql = createDb(env);
    const usageRows = await sql<Array<{
      tool_calls: number | null;
      token_mints: number | null;
    }>>`
      SELECT
        COALESCE(SUM(CASE WHEN event_type = 'tool_call' THEN usage_units ELSE 0 END), 0)::int AS tool_calls,
        COALESCE(SUM(CASE WHEN event_type = 'token_mint' THEN usage_units ELSE 0 END), 0)::int AS token_mints
      FROM mcp_usage_events
      WHERE merchant_id = ${merchantId}::uuid
        AND created_at >= ${periodStart.toISOString()}::timestamptz
        AND created_at < ${periodEndExclusive.toISOString()}::timestamptz
    `;

    const invoiceRows = await sql<Array<{
      already_invoiced_usd: string | number | null;
    }>>`
      SELECT COALESCE(SUM(fee_amount), 0) AS already_invoiced_usd
      FROM merchant_invoices
      WHERE merchant_id = ${merchantId}::uuid
        AND invoice_type = 'hosted_mcp'
        AND period_start = ${periodStart.toISOString()}::timestamptz
        AND period_end = ${periodEndExclusive.toISOString()}::timestamptz
        AND status IN ('pending', 'paid')
    `;

    return {
      toolCalls: usageRows[0]?.tool_calls ?? 0,
      tokenMints: usageRows[0]?.token_mints ?? 0,
      alreadyInvoicedUsd: roundUsd(Number(invoiceRows[0]?.already_invoiced_usd ?? 0)),
    };
  } finally {
    await sql?.end().catch(() => {});
  }
}

export async function buildHostedMcpInvoiceSummary(
  env: Env,
  merchant: MerchantContext,
  now = new Date(),
): Promise<HostedMcpInvoiceSummary> {
  const { periodStart, periodEndExclusive } = monthBounds(now);
  const planCode = await resolveHostedMcpPlanCode(env, merchant.id);
  const plan = getHostedMcpPlan(planCode);
  const usage = await getCurrentUsageAndInvoiced(env, merchant.id, periodStart, periodEndExclusive);
  const lineItems: MergedLineItem[] = [];

  if ((plan.monthlyUsd ?? 0) > 0) {
    lineItems.push({
      code: 'hosted_mcp_base',
      label: `${plan.label} hosted MCP base fee`,
      amountUsd: roundUsd(plan.monthlyUsd ?? 0),
    });
  }

  if (
    plan.includedToolCalls !== null
    && plan.overagePerThousandToolCallsUsd !== null
    && usage.toolCalls > plan.includedToolCalls
  ) {
    const overageCalls = usage.toolCalls - plan.includedToolCalls;
    const overageUsd = roundUsd((overageCalls / 1000) * plan.overagePerThousandToolCallsUsd);
    if (overageUsd > 0) {
      lineItems.push({
        code: 'hosted_mcp_tool_overage',
        label: 'Hosted MCP tool-call overage',
        amountUsd: overageUsd,
        quantity: overageCalls,
        unit: 'tool_call',
      });
    }
  }

  const subtotalUsd = roundUsd(lineItems.reduce((sum, item) => sum + item.amountUsd, 0));
  const outstandingUsd = roundUsd(Math.max(subtotalUsd - usage.alreadyInvoicedUsd, 0));

  return {
    merchantId: merchant.id,
    periodStart: periodStart.toISOString(),
    periodEndExclusive: periodEndExclusive.toISOString(),
    planCode,
    planLabel: plan.label,
    usage: {
      toolCalls: usage.toolCalls,
      tokenMints: usage.tokenMints,
    },
    included: {
      toolCalls: plan.includedToolCalls,
      tokenMints: plan.includedTokenMints,
    },
    lineItems,
    subtotalUsd,
    alreadyInvoicedUsd: usage.alreadyInvoicedUsd,
    outstandingUsd,
    currency: 'USD',
  };
}

async function ensureStripeBillingCustomer(
  env: Env,
  merchant: MerchantContext,
): Promise<string> {
  let sql;
  try {
    sql = createDb(env);
    const existing = await sql<Array<{ stripe_billing_customer_id: string | null }>>`
      SELECT stripe_billing_customer_id
      FROM merchants
      WHERE id = ${merchant.id}::uuid
      LIMIT 1
    `;

    if (existing[0]?.stripe_billing_customer_id) {
      return existing[0].stripe_billing_customer_id;
    }
  } finally {
    await sql?.end().catch(() => {});
  }

  if (!env.STRIPE_SECRET_KEY) {
    throw new Error('STRIPE_NOT_CONFIGURED');
  }

  const body = new URLSearchParams({
    email: merchant.email,
    name: merchant.name,
    'metadata[agentpay_merchant_id]': merchant.id,
  });
  const response = await fetch('https://api.stripe.com/v1/customers', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });
  if (!response.ok) {
    throw new Error(`STRIPE_CUSTOMER_CREATE_FAILED:${await response.text()}`);
  }
  const customer = await response.json() as { id: string };

  let updateSql;
  try {
    updateSql = createDb(env);
    await updateSql`
      UPDATE merchants
      SET stripe_billing_customer_id = ${customer.id},
          updated_at = NOW()
      WHERE id = ${merchant.id}::uuid
    `;
  } finally {
    await updateSql?.end().catch(() => {});
  }

  return customer.id;
}

async function createMerchantInvoiceCheckout(
  env: Env,
  merchant: MerchantContext,
  input: {
    invoiceType: 'hosted_mcp' | 'capability_usage';
    amountUsd: number;
    currency: 'USD';
    periodStart: string;
    periodEndExclusive: string;
    title: string;
    lineItemsJson: Record<string, unknown>;
    metadata?: Record<string, string>;
    attribution?: {
      audience?: ProductSignalAudience;
      authType?: ProductSignalAuthType;
    };
  },
): Promise<HostedMcpInvoiceCheckout | null> {
  if (!env.STRIPE_SECRET_KEY || input.amountUsd <= 0) return null;

  const customerId = await ensureStripeBillingCustomer(env, merchant);
  const invoiceId = crypto.randomUUID();
  const refKey = referenceKey(input.invoiceType, input.periodStart, invoiceId);

  let sql;
  try {
    sql = createDb(env);
    await sql`
      INSERT INTO merchant_invoices (
        id,
        merchant_id,
        intent_id,
        transaction_id,
        fee_amount,
        fee_percent,
        currency,
        status,
        invoice_type,
        reference_key,
        period_start,
        period_end,
        line_items_json
      ) VALUES (
        ${invoiceId}::uuid,
        ${merchant.id}::uuid,
        NULL,
        NULL,
        ${input.amountUsd},
        ${0},
        ${input.currency},
        'pending',
        ${input.invoiceType},
        ${refKey},
        ${input.periodStart}::timestamptz,
        ${input.periodEndExclusive}::timestamptz,
        ${JSON.stringify({
          ...input.lineItemsJson,
          attribution: {
            audience: input.attribution?.audience ?? 'generic',
            authType: input.attribution?.authType ?? 'none',
          },
        })}::jsonb
      )
    `;
  } finally {
    await sql?.end().catch(() => {});
  }

  const successUrl = `${env.FRONTEND_URL}/payment/success?invoiceId=${encodeURIComponent(invoiceId)}`;
  const cancelUrl = `${env.FRONTEND_URL}/payment/cancel?invoiceId=${encodeURIComponent(invoiceId)}`;
  const checkoutBody = new URLSearchParams({
    mode: 'payment',
    customer: customerId,
    'line_items[0][price_data][currency]': 'usd',
    'line_items[0][price_data][product_data][name]': input.title,
    'line_items[0][price_data][unit_amount]': String(toCents(input.amountUsd)),
    'line_items[0][quantity]': '1',
    success_url: successUrl,
    cancel_url: cancelUrl,
    'metadata[invoiceId]': invoiceId,
    'metadata[merchantId]': merchant.id,
    'metadata[invoiceType]': input.invoiceType,
  });
  for (const [key, value] of Object.entries(input.metadata ?? {})) {
    checkoutBody.append(`metadata[${key}]`, value);
  }

  const stripeResponse = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: checkoutBody.toString(),
  });
  if (!stripeResponse.ok) {
    throw new Error(`STRIPE_CHECKOUT_CREATE_FAILED:${await stripeResponse.text()}`);
  }
  const checkout = await stripeResponse.json() as { id: string; url: string };

  let updateSql;
  try {
    updateSql = createDb(env);
    await updateSql`
      UPDATE merchant_invoices
      SET external_checkout_session_id = ${checkout.id},
          external_checkout_url = ${checkout.url},
          updated_at = NOW()
      WHERE id = ${invoiceId}::uuid
    `;
  } finally {
    await updateSql?.end().catch(() => {});
  }

  return {
    invoiceId,
    checkoutUrl: checkout.url,
    checkoutSessionId: checkout.id,
  };
}

export interface HostedMcpInvoiceCheckout {
  invoiceId: string;
  checkoutUrl: string;
  checkoutSessionId: string;
}

export interface SettledMerchantInvoice {
  invoiceId: string;
  merchantId: string;
  invoiceType: string;
  status: string;
  feeAmount: number;
  currency: string;
  paidAt: string | null;
}

export async function createHostedMcpInvoiceCheckout(
  env: Env,
  merchant: MerchantContext,
  summary: HostedMcpInvoiceSummary,
  attribution?: {
    audience?: ProductSignalAudience;
    authType?: ProductSignalAuthType;
  },
): Promise<HostedMcpInvoiceCheckout | null> {
  return createMerchantInvoiceCheckout(env, merchant, {
    invoiceType: 'hosted_mcp',
    amountUsd: summary.outstandingUsd,
    currency: summary.currency,
    periodStart: summary.periodStart,
    periodEndExclusive: summary.periodEndExclusive,
    title: `AgentPay hosted MCP invoice (${summary.planLabel})`,
    lineItemsJson: {
      planCode: summary.planCode,
      lineItems: summary.lineItems,
      subtotalUsd: summary.subtotalUsd,
      alreadyInvoicedUsd: summary.alreadyInvoicedUsd,
      outstandingUsd: summary.outstandingUsd,
      pricingVersion: getHostedMcpPublicPricing().pricingVersion,
    },
    metadata: {
      pricingVersion: getHostedMcpPublicPricing().pricingVersion,
    },
    attribution,
  });
}

async function getCurrentCapabilityUsageAndInvoiced(
  env: Env,
  merchantId: string,
  periodStart: Date,
  periodEndExclusive: Date,
): Promise<{
  billableCalls: number;
  lineItems: MergedLineItem[];
  subtotalUsd: number;
  alreadyInvoicedUsd: number;
}> {
  let sql;
  try {
    sql = createDb(env);
    const usageRows = await sql<Array<{
      capability_key: string | null;
      provider: string | null;
      calls: number | null;
      amount_usd: string | number | null;
    }>>`
      SELECT
        capability_key,
        COALESCE(MAX(metadata->>'provider'), '') AS provider,
        COALESCE(SUM(usage_units), 0)::int AS calls,
        COALESCE(SUM(estimated_amount_micros) / 1000000.0, 0) AS amount_usd
      FROM capability_usage_events
      WHERE merchant_id = ${merchantId}::uuid
        AND created_at >= ${periodStart.toISOString()}::timestamptz
        AND created_at < ${periodEndExclusive.toISOString()}::timestamptz
        AND estimated_amount_micros > 0
        AND status_code >= 200
        AND status_code < 400
      GROUP BY capability_key
      ORDER BY amount_usd DESC, capability_key ASC
    `;

    const invoiceRows = await sql<Array<{
      already_invoiced_usd: string | number | null;
    }>>`
      SELECT COALESCE(SUM(fee_amount), 0) AS already_invoiced_usd
      FROM merchant_invoices
      WHERE merchant_id = ${merchantId}::uuid
        AND invoice_type = 'capability_usage'
        AND period_start = ${periodStart.toISOString()}::timestamptz
        AND period_end = ${periodEndExclusive.toISOString()}::timestamptz
        AND status IN ('pending', 'paid')
    `;

    const lineItems: MergedLineItem[] = [];
    for (const row of usageRows) {
      const amountUsd = roundUsd(Number(row.amount_usd ?? 0));
      if (amountUsd <= 0) continue;
      const provider = row.provider?.trim() || 'external API';
      const key = row.capability_key?.trim() || 'capability';
      lineItems.push({
        code: `capability_usage_${key}`,
        label: `Paid ${provider} usage (${key})`,
        amountUsd,
        quantity: row.calls ?? 0,
        unit: 'call',
      });
    }

    const subtotalUsd = roundUsd(lineItems.reduce((sum, item) => sum + item.amountUsd, 0));
    const billableCalls = lineItems.reduce((sum, item) => sum + (item.quantity ?? 0), 0);

    return {
      billableCalls,
      lineItems,
      subtotalUsd,
      alreadyInvoicedUsd: roundUsd(Number(invoiceRows[0]?.already_invoiced_usd ?? 0)),
    };
  } finally {
    await sql?.end().catch(() => {});
  }
}

export async function buildCapabilityUsageInvoiceSummary(
  env: Env,
  merchant: MerchantContext,
  now = new Date(),
): Promise<CapabilityUsageInvoiceSummary> {
  const { periodStart, periodEndExclusive } = monthBounds(now);
  const usage = await getCurrentCapabilityUsageAndInvoiced(env, merchant.id, periodStart, periodEndExclusive);
  const outstandingUsd = roundUsd(Math.max(usage.subtotalUsd - usage.alreadyInvoicedUsd, 0));

  return {
    merchantId: merchant.id,
    periodStart: periodStart.toISOString(),
    periodEndExclusive: periodEndExclusive.toISOString(),
    usage: {
      billableCalls: usage.billableCalls,
    },
    lineItems: usage.lineItems,
    subtotalUsd: usage.subtotalUsd,
    alreadyInvoicedUsd: usage.alreadyInvoicedUsd,
    outstandingUsd,
    currency: 'USD',
  };
}

export async function createCapabilityUsageInvoiceCheckout(
  env: Env,
  merchant: MerchantContext,
  summary: CapabilityUsageInvoiceSummary,
  attribution?: {
    audience?: ProductSignalAudience;
    authType?: ProductSignalAuthType;
  },
): Promise<HostedMcpInvoiceCheckout | null> {
  return createMerchantInvoiceCheckout(env, merchant, {
    invoiceType: 'capability_usage',
    amountUsd: summary.outstandingUsd,
    currency: summary.currency,
    periodStart: summary.periodStart,
    periodEndExclusive: summary.periodEndExclusive,
    title: 'AgentPay governed external capability usage',
    lineItemsJson: {
      lineItems: summary.lineItems,
      subtotalUsd: summary.subtotalUsd,
      alreadyInvoicedUsd: summary.alreadyInvoicedUsd,
      outstandingUsd: summary.outstandingUsd,
    },
    metadata: {
      usageFamily: 'capability_usage',
    },
    attribution,
  });
}

function normalizeSettledInvoiceRow(
  row: {
    id: string;
    merchant_id: string;
    invoice_type: string;
    status: string;
    fee_amount: string | number;
    currency: string;
    paid_at: string | Date | null;
  } | undefined,
): SettledMerchantInvoice | null {
  if (!row) return null;
  return {
    invoiceId: row.id,
    merchantId: row.merchant_id,
    invoiceType: row.invoice_type,
    status: row.status,
    feeAmount: roundUsd(Number(row.fee_amount ?? 0)),
    currency: row.currency,
    paidAt: row.paid_at
      ? (row.paid_at instanceof Date ? row.paid_at.toISOString() : new Date(row.paid_at).toISOString())
      : null,
  };
}

export async function markMerchantInvoicePaidByCheckoutSession(
  env: Env,
  checkoutSessionId: string,
  paidAt = new Date(),
): Promise<SettledMerchantInvoice | null> {
  let sql;
  try {
    sql = createDb(env);
    const updatedRows = await sql<Array<{
      id: string;
      merchant_id: string;
      invoice_type: string;
      status: string;
      fee_amount: string | number;
      currency: string;
      paid_at: string | Date | null;
      line_items_json: Record<string, unknown> | null;
    }>>`
      UPDATE merchant_invoices
      SET status = 'paid',
          paid_at = COALESCE(paid_at, ${paidAt.toISOString()}::timestamptz),
          updated_at = NOW()
      WHERE external_checkout_session_id = ${checkoutSessionId}
        AND invoice_type IN ('hosted_mcp', 'capability_usage')
        AND status <> 'paid'
      RETURNING
        id,
        merchant_id,
        invoice_type,
        status,
        fee_amount,
        currency,
        paid_at,
        line_items_json
    `;

    const updated = normalizeSettledInvoiceRow(updatedRows[0]);
    if (updated) {
      const attribution = updatedRows[0]?.line_items_json && typeof updatedRows[0].line_items_json === 'object'
        ? (updatedRows[0].line_items_json['attribution'] as Record<string, unknown> | undefined)
        : undefined;
      await recordInvoicePaidSignal(env, {
        merchantId: updated.merchantId,
        invoiceId: updated.invoiceId,
        invoiceType: updated.invoiceType,
        feeAmountUsd: updated.feeAmount,
        pricingVersion: typeof updatedRows[0]?.line_items_json?.['pricingVersion'] === 'string'
          ? updatedRows[0].line_items_json['pricingVersion'] as string
          : null,
        audience: attribution?.audience === 'openai' || attribution?.audience === 'anthropic'
          ? attribution.audience
          : 'generic',
        authType: attribution?.authType === 'api_key' || attribution?.authType === 'mcp_token'
          ? attribution.authType
          : 'none',
      });
      return updated;
    }

    const existingRows = await sql<Array<{
      id: string;
      merchant_id: string;
      invoice_type: string;
      status: string;
      fee_amount: string | number;
      currency: string;
      paid_at: string | Date | null;
      line_items_json: Record<string, unknown> | null;
    }>>`
      SELECT
        id,
        merchant_id,
        invoice_type,
        status,
        fee_amount,
        currency,
        paid_at,
        line_items_json
      FROM merchant_invoices
      WHERE external_checkout_session_id = ${checkoutSessionId}
        AND invoice_type IN ('hosted_mcp', 'capability_usage')
      LIMIT 1
    `;

    return normalizeSettledInvoiceRow(existingRows[0]);
  } finally {
    await sql?.end().catch(() => {});
  }
}
