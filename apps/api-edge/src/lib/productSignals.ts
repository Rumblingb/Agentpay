import { createDb } from './db';
import type { Env } from '../types';

export type ProductSignalAudience = 'openai' | 'anthropic' | 'generic';
export type ProductSignalAuthType = 'api_key' | 'mcp_token' | 'none';
export type ProductSignalSurface = 'mcp' | 'capabilities' | 'payments' | 'billing' | 'webhooks' | 'admin';

export interface ProductSignalEventInput {
  merchantId: string;
  audience?: ProductSignalAudience;
  authType?: ProductSignalAuthType;
  surface: ProductSignalSurface;
  signalType: string;
  status?: string | null;
  requestId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  estimatedRevenueMicros?: number;
  realizedRevenueMicros?: number;
  estimatedCostMicros?: number;
  metadata?: Record<string, unknown>;
}

export interface AgentPayGrowthSummary {
  windowHours: number;
  hostedMcp: {
    tokenMints: number;
    toolsListed: number;
    toolCalls: number;
    nextActions: number;
    invoiceViews: number;
    checkoutCreates: number;
    invoicesPaid: number;
    realizedRevenueUsd: number;
  };
  capabilityBilling: {
    invoiceViews: number;
    checkoutCreates: number;
    invoicesPaid: number;
    realizedRevenueUsd: number;
    estimatedProviderCostUsd: number;
  };
  nextActions: Array<{
    type: string;
    count: number;
  }>;
  hosts: Array<{
    audience: ProductSignalAudience;
    tokenMints: number;
    toolCalls: number;
    nextActions: number;
    realizedRevenueUsd: number;
  }>;
  topCapabilityCosts: Array<{
    capabilityKey: string;
    provider: string;
    calls: number;
    estimatedCostUsd: number;
  }>;
}

export interface ProductSignalChangeCandidate {
  key: string;
  title: string;
  category: 'pricing' | 'conversion' | 'funding' | 'capability_margin' | 'distribution';
  severity: 'high' | 'medium';
  evidenceWindowHours: number;
  hypothesis: string;
  recommendation: string;
  metrics: Record<string, number | string>;
}

type CountRow = {
  audience: ProductSignalAudience;
  signal_type: string;
  count: string | number;
  realized_revenue_micros: string | number | null;
};

type NextActionRow = {
  next_action_type: string | null;
  count: string | number;
};

type CapabilityCostRow = {
  capability_key: string | null;
  provider: string | null;
  calls: string | number;
  estimated_cost_micros: string | number;
};

type InvoiceSettlementSignal = {
  merchantId: string;
  invoiceId: string;
  invoiceType: string;
  feeAmountUsd: number;
  pricingVersion?: string | null;
  audience?: ProductSignalAudience;
  authType?: ProductSignalAuthType;
};

function roundUsd(value: number): number {
  return Math.round(value * 100) / 100;
}

function toMicros(value?: number): number {
  return Math.max(Math.round((value ?? 0) * 1_000_000), 0);
}

function parseNumeric(value: string | number | null | undefined): number {
  return Number(value ?? 0) || 0;
}

function emptyGrowthSummary(windowHours: number): AgentPayGrowthSummary {
  return {
    windowHours,
    hostedMcp: {
      tokenMints: 0,
      toolsListed: 0,
      toolCalls: 0,
      nextActions: 0,
      invoiceViews: 0,
      checkoutCreates: 0,
      invoicesPaid: 0,
      realizedRevenueUsd: 0,
    },
    capabilityBilling: {
      invoiceViews: 0,
      checkoutCreates: 0,
      invoicesPaid: 0,
      realizedRevenueUsd: 0,
      estimatedProviderCostUsd: 0,
    },
    nextActions: [],
    hosts: [],
    topCapabilityCosts: [],
  };
}

export async function recordProductSignalEvent(
  env: Env,
  input: ProductSignalEventInput,
): Promise<void> {
  let sql;
  try {
    sql = createDb(env);
    await sql`
      INSERT INTO product_signal_events (
        id,
        merchant_id,
        audience,
        auth_type,
        surface,
        signal_type,
        status,
        request_id,
        entity_type,
        entity_id,
        estimated_revenue_micros,
        realized_revenue_micros,
        estimated_cost_micros,
        metadata
      ) VALUES (
        ${crypto.randomUUID()}::uuid,
        ${input.merchantId}::uuid,
        ${input.audience ?? 'generic'},
        ${input.authType ?? 'none'},
        ${input.surface},
        ${input.signalType},
        ${input.status ?? null},
        ${input.requestId ?? null},
        ${input.entityType ?? null},
        ${input.entityId ?? null},
        ${Math.max(input.estimatedRevenueMicros ?? 0, 0)},
        ${Math.max(input.realizedRevenueMicros ?? 0, 0)},
        ${Math.max(input.estimatedCostMicros ?? 0, 0)},
        ${JSON.stringify(input.metadata ?? {})}::jsonb
      )
    `;
  } catch {
    // Best-effort only. Never fail live runtime because the signal ledger is unavailable.
  } finally {
    await sql?.end().catch(() => {});
  }
}

export async function recordInvoicePaidSignal(
  env: Env,
  input: InvoiceSettlementSignal,
): Promise<void> {
  await recordProductSignalEvent(env, {
    merchantId: input.merchantId,
    audience: input.audience ?? 'generic',
    authType: input.authType ?? 'none',
    surface: 'webhooks',
    signalType: input.invoiceType === 'capability_usage'
      ? 'capability_invoice_paid'
      : 'hosted_mcp_invoice_paid',
    status: 'paid',
    entityType: 'merchant_invoice',
    entityId: input.invoiceId,
    realizedRevenueMicros: toMicros(input.feeAmountUsd),
    metadata: {
      invoiceType: input.invoiceType,
      pricingVersion: input.pricingVersion ?? null,
    },
  });
}

export async function summarizeAgentPayGrowth(
  env: Env,
  windowHours: number,
): Promise<AgentPayGrowthSummary> {
  const safeWindowHours = Math.min(Math.max(Math.floor(windowHours || 24), 1), 24 * 30);
  const summary = emptyGrowthSummary(safeWindowHours);
  let sql;
  try {
    sql = createDb(env);

    const countRows = await sql<CountRow[]>`
      SELECT
        audience,
        signal_type,
        COUNT(*) AS count,
        COALESCE(SUM(realized_revenue_micros), 0) AS realized_revenue_micros
      FROM product_signal_events
      WHERE created_at >= NOW() - (${safeWindowHours} * INTERVAL '1 hour')
      GROUP BY audience, signal_type
    `;

    const nextActionRows = await sql<NextActionRow[]>`
      SELECT
        metadata->>'nextActionType' AS next_action_type,
        COUNT(*) AS count
      FROM product_signal_events
      WHERE signal_type IN ('mcp_next_action_returned', 'capability_next_action_returned', 'funding_request_created')
        AND created_at >= NOW() - (${safeWindowHours} * INTERVAL '1 hour')
      GROUP BY metadata->>'nextActionType'
      ORDER BY COUNT(*) DESC, metadata->>'nextActionType' ASC
    `;

    const capabilityCostRows = await sql<CapabilityCostRow[]>`
      SELECT
        capability_key,
        COALESCE(MAX(metadata->>'provider'), '') AS provider,
        COALESCE(SUM(usage_units), 0) AS calls,
        COALESCE(SUM(estimated_amount_micros), 0) AS estimated_cost_micros
      FROM capability_usage_events
      WHERE created_at >= NOW() - (${safeWindowHours} * INTERVAL '1 hour')
        AND estimated_amount_micros > 0
        AND status_code >= 200
        AND status_code < 400
      GROUP BY capability_key
      ORDER BY estimated_cost_micros DESC, capability_key ASC
      LIMIT 10
    `;

    const hostMap = new Map<ProductSignalAudience, AgentPayGrowthSummary['hosts'][number]>();
    for (const row of countRows) {
      const audience = row.audience ?? 'generic';
      const count = parseNumeric(row.count);
      const realizedRevenueUsd = roundUsd(parseNumeric(row.realized_revenue_micros) / 1_000_000);

      if (!hostMap.has(audience)) {
        hostMap.set(audience, {
          audience,
          tokenMints: 0,
          toolCalls: 0,
          nextActions: 0,
          realizedRevenueUsd: 0,
        });
      }
      const host = hostMap.get(audience)!;
      if (row.signal_type === 'mcp_token_minted') {
        summary.hostedMcp.tokenMints += count;
        host.tokenMints += count;
      } else if (row.signal_type === 'mcp_tools_list_completed') {
        summary.hostedMcp.toolsListed += count;
      } else if (row.signal_type === 'mcp_tool_call_completed') {
        summary.hostedMcp.toolCalls += count;
        host.toolCalls += count;
      } else if (row.signal_type === 'mcp_next_action_returned') {
        summary.hostedMcp.nextActions += count;
        host.nextActions += count;
      } else if (row.signal_type === 'hosted_mcp_invoice_viewed') {
        summary.hostedMcp.invoiceViews += count;
      } else if (row.signal_type === 'hosted_mcp_checkout_created') {
        summary.hostedMcp.checkoutCreates += count;
      } else if (row.signal_type === 'hosted_mcp_invoice_paid') {
        summary.hostedMcp.invoicesPaid += count;
        summary.hostedMcp.realizedRevenueUsd = roundUsd(summary.hostedMcp.realizedRevenueUsd + realizedRevenueUsd);
        host.realizedRevenueUsd = roundUsd(host.realizedRevenueUsd + realizedRevenueUsd);
      } else if (row.signal_type === 'capability_invoice_viewed') {
        summary.capabilityBilling.invoiceViews += count;
      } else if (row.signal_type === 'capability_checkout_created') {
        summary.capabilityBilling.checkoutCreates += count;
      } else if (row.signal_type === 'capability_invoice_paid') {
        summary.capabilityBilling.invoicesPaid += count;
        summary.capabilityBilling.realizedRevenueUsd = roundUsd(summary.capabilityBilling.realizedRevenueUsd + realizedRevenueUsd);
        host.realizedRevenueUsd = roundUsd(host.realizedRevenueUsd + realizedRevenueUsd);
      }
    }

    summary.hosts = Array.from(hostMap.values()).sort((a, b) => b.realizedRevenueUsd - a.realizedRevenueUsd || b.toolCalls - a.toolCalls);
    summary.nextActions = nextActionRows
      .map((row) => ({
        type: row.next_action_type?.trim() || 'unknown',
        count: parseNumeric(row.count),
      }))
      .filter((row) => row.count > 0);
    summary.topCapabilityCosts = capabilityCostRows.map((row) => ({
      capabilityKey: row.capability_key?.trim() || 'unknown',
      provider: row.provider?.trim() || 'external_api',
      calls: parseNumeric(row.calls),
      estimatedCostUsd: roundUsd(parseNumeric(row.estimated_cost_micros) / 1_000_000),
    }));
    summary.capabilityBilling.estimatedProviderCostUsd = roundUsd(
      summary.topCapabilityCosts.reduce((sum, item) => sum + item.estimatedCostUsd, 0),
    );

    return summary;
  } finally {
    await sql?.end().catch(() => {});
  }
}

export function buildChangeCandidatesFromGrowthSummary(
  summary: AgentPayGrowthSummary,
): ProductSignalChangeCandidate[] {
  const candidates: ProductSignalChangeCandidate[] = [];

  if (summary.hostedMcp.tokenMints >= 5 && summary.hostedMcp.invoicesPaid === 0) {
    candidates.push({
      key: 'mcp-paid-conversion',
      title: 'Hosted MCP token mints are not converting into paid accounts',
      category: 'conversion',
      severity: 'high',
      evidenceWindowHours: summary.windowHours,
      hypothesis: 'Merchants can connect AgentPay, but the pricing or value transition from evaluation to paid use is not landing.',
      recommendation: 'Tighten the connect-to-value path: show plan limits earlier, add an in-host "why you were charged" summary, and compress time-to-first-paid action.',
      metrics: {
        tokenMints: summary.hostedMcp.tokenMints,
        invoicesPaid: summary.hostedMcp.invoicesPaid,
      },
    });
  }

  if (summary.hostedMcp.checkoutCreates >= 3 && summary.hostedMcp.invoicesPaid < summary.hostedMcp.checkoutCreates) {
    candidates.push({
      key: 'hosted-mcp-checkout-dropoff',
      title: 'Hosted MCP billing checkout is losing merchants before payment',
      category: 'pricing',
      severity: 'high',
      evidenceWindowHours: summary.windowHours,
      hypothesis: 'Merchants accept usage value but the checkout handoff or pricing explanation is causing drop-off.',
      recommendation: 'Add a cleaner in-host invoice preview, clearer pricing copy, and payment-proof messaging before redirecting to Stripe Checkout.',
      metrics: {
        checkoutCreates: summary.hostedMcp.checkoutCreates,
        invoicesPaid: summary.hostedMcp.invoicesPaid,
      },
    });
  }

  const authRequired = summary.nextActions.find((item) => item.type === 'auth_required')?.count ?? 0;
  const fundingRequired = summary.nextActions.find((item) => item.type === 'funding_required')?.count ?? 0;
  if (authRequired >= 5) {
    candidates.push({
      key: 'auth-step-friction',
      title: 'Auth-required steps are a major source of runtime friction',
      category: 'distribution',
      severity: 'medium',
      evidenceWindowHours: summary.windowHours,
      hypothesis: 'Agents are reaching capability connect or credential steps too often, which slows conversion inside hosts.',
      recommendation: 'Promote reusable capability connections, reduce repeated auth prompts, and improve host-native messaging around secure connection steps.',
      metrics: {
        authRequired,
      },
    });
  }
  if (fundingRequired >= 5) {
    candidates.push({
      key: 'funding-step-friction',
      title: 'Funding-required steps are blocking host-native completion',
      category: 'funding',
      severity: 'medium',
      evidenceWindowHours: summary.windowHours,
      hypothesis: 'Users are getting to real paid actions, but the funding handoff is still too heavy or too surprising.',
      recommendation: 'Make saved funding methods the default path, tighten the funding request copy, and surface the least-friction rail earlier.',
      metrics: {
        fundingRequired,
      },
    });
  }

  const topCapability = summary.topCapabilityCosts[0];
  if (topCapability && topCapability.estimatedCostUsd >= 25 && summary.capabilityBilling.invoicesPaid === 0) {
    candidates.push({
      key: 'capability-margin-pressure',
      title: `Capability spend is accumulating on ${topCapability.capabilityKey} without matching paid recovery`,
      category: 'capability_margin',
      severity: 'high',
      evidenceWindowHours: summary.windowHours,
      hypothesis: 'Provider costs are landing before AgentPay is successfully collecting or explaining the corresponding merchant bill.',
      recommendation: 'Add clearer capability cost previewing, invoice accrual thresholds, and provider-specific markup review before scaling this capability.',
      metrics: {
        capabilityKey: topCapability.capabilityKey,
        estimatedCostUsd: topCapability.estimatedCostUsd,
        capabilityInvoicesPaid: summary.capabilityBilling.invoicesPaid,
      },
    });
  }

  const topHost = summary.hosts[0];
  if (topHost && topHost.tokenMints >= 3 && topHost.realizedRevenueUsd > 0) {
    candidates.push({
      key: `double-down-${topHost.audience}`,
      title: `${topHost.audience} is producing the strongest current commercial signal`,
      category: 'distribution',
      severity: 'medium',
      evidenceWindowHours: summary.windowHours,
      hypothesis: 'One host surface is already converting better, so product and GTM should bias toward making that host feel first-class.',
      recommendation: `Prioritize connector polish, docs, and demo assets for ${topHost.audience} before broadening equal effort across every host.`,
      metrics: {
        audience: topHost.audience,
        tokenMints: topHost.tokenMints,
        realizedRevenueUsd: topHost.realizedRevenueUsd,
      },
    });
  }

  return candidates;
}

export async function buildAgentPayChangeCandidates(
  env: Env,
  windowHours: number,
): Promise<ProductSignalChangeCandidate[]> {
  const summary = await summarizeAgentPayGrowth(env, windowHours);
  return buildChangeCandidatesFromGrowthSummary(summary);
}
