import { createDb } from './db';
import type { Env, MerchantContext } from '../types';

export const HOSTED_MCP_PRICING_VERSION = '2026-04-16';
export const HOSTED_MCP_DEFAULT_PLAN = 'launch';
export const HOSTED_MCP_FUNDED_ACTION_FEE_BPS = 75;
export const HOSTED_MCP_FUNDED_ACTION_MINIMUM_USD = 0.25;
export const HOSTED_MCP_FUNDED_ACTION_MAXIMUM_USD = 15;

export type HostedMcpPlanCode = 'launch' | 'builder' | 'growth' | 'enterprise';
export type McpUsageEventType = 'token_mint' | 'tools_list' | 'tool_call' | 'transport_request';
export type McpAuthType = 'api_key' | 'mcp_token';
export type McpAudience = 'openai' | 'anthropic' | 'generic';

export type HostedMcpPlan = {
  code: HostedMcpPlanCode;
  label: string;
  monthlyUsd: number | null;
  includedToolCalls: number | null;
  includedTokenMints: number | null;
  overagePerThousandToolCallsUsd: number | null;
  notes: string;
};

export const HOSTED_MCP_PLANS: Record<HostedMcpPlanCode, HostedMcpPlan> = {
  launch: {
    code: 'launch',
    label: 'Launch',
    monthlyUsd: 0,
    includedToolCalls: 250,
    includedTokenMints: 25,
    overagePerThousandToolCallsUsd: null,
    notes: 'Developer and evaluation tier. Best for testing remote MCP and early pilots.',
  },
  builder: {
    code: 'builder',
    label: 'Builder',
    monthlyUsd: 39,
    includedToolCalls: 10_000,
    includedTokenMints: 500,
    overagePerThousandToolCallsUsd: 0.40,
    notes: 'Default paid tier for teams running hosted MCP in production.',
  },
  growth: {
    code: 'growth',
    label: 'Growth',
    monthlyUsd: 149,
    includedToolCalls: 100_000,
    includedTokenMints: 5_000,
    overagePerThousandToolCallsUsd: 0.25,
    notes: 'For higher-volume assistants and agent workflows with frequent approvals and funding actions.',
  },
  enterprise: {
    code: 'enterprise',
    label: 'Enterprise',
    monthlyUsd: null,
    includedToolCalls: null,
    includedTokenMints: null,
    overagePerThousandToolCallsUsd: null,
    notes: 'Custom pricing, invoicing, dedicated limits, and negotiated funded-action economics.',
  },
};

export function normalizeHostedMcpPlanCode(value: unknown): HostedMcpPlanCode {
  if (value === 'builder' || value === 'growth' || value === 'enterprise') return value;
  return HOSTED_MCP_DEFAULT_PLAN;
}

export async function resolveHostedMcpPlanCode(env: Env, merchantId: string): Promise<HostedMcpPlanCode> {
  if (env.AGENTPAY_TEST_MODE === 'true') return HOSTED_MCP_DEFAULT_PLAN;

  let sql;
  try {
    sql = createDb(env);
    const rows = await sql<Array<{ hosted_mcp_plan_code: string | null }>>`
      SELECT hosted_mcp_plan_code
      FROM merchants
      WHERE id = ${merchantId}
      LIMIT 1
    `;
    return normalizeHostedMcpPlanCode(rows[0]?.hosted_mcp_plan_code);
  } catch {
    return HOSTED_MCP_DEFAULT_PLAN;
  } finally {
    await sql?.end().catch(() => {});
  }
}

function unitPriceMicros(planCode: HostedMcpPlanCode, eventType: McpUsageEventType): number {
  if (eventType !== 'tool_call') return 0;
  const plan = HOSTED_MCP_PLANS[planCode];
  if (!plan.overagePerThousandToolCallsUsd) return 0;
  return Math.round((plan.overagePerThousandToolCallsUsd / 1000) * 1_000_000);
}

export function getHostedMcpPublicPricing() {
  return {
    model: 'monthly_plus_metered',
    pricingVersion: HOSTED_MCP_PRICING_VERSION,
    defaultPlan: HOSTED_MCP_DEFAULT_PLAN,
    meter: {
      primaryUnit: 'tool_call',
      secondaryUnit: 'token_mint',
      requestScopedAuthRequired: true,
    },
    plans: Object.values(HOSTED_MCP_PLANS),
    fundedActions: {
      feeBps: HOSTED_MCP_FUNDED_ACTION_FEE_BPS,
      minimumUsd: HOSTED_MCP_FUNDED_ACTION_MINIMUM_USD,
      maximumUsd: HOSTED_MCP_FUNDED_ACTION_MAXIMUM_USD,
      note: 'Applied when AgentPay brokers the human funding step or governed payment authority. Underlying processor fees are separate.',
    },
  };
}

export function getHostedMcpPlan(planCode: HostedMcpPlanCode): HostedMcpPlan {
  return HOSTED_MCP_PLANS[planCode];
}

export interface RecordMcpUsageEventInput {
  merchant: MerchantContext;
  audience: McpAudience;
  authType: McpAuthType;
  eventType: McpUsageEventType;
  requestId?: string | null;
  toolName?: string | null;
  statusCode?: number | null;
  metadata?: Record<string, unknown>;
}

export async function recordMcpUsageEvent(
  env: Env,
  input: RecordMcpUsageEventInput,
): Promise<void> {
  if (env.AGENTPAY_TEST_MODE === 'true') return;

  const planCode = await resolveHostedMcpPlanCode(env, input.merchant.id);
  const priceMicros = unitPriceMicros(planCode, input.eventType);
  let sql;

  try {
    sql = createDb(env);
    await sql`
      INSERT INTO mcp_usage_events (
        merchant_id,
        plan_code,
        auth_type,
        audience,
        event_type,
        request_id,
        tool_name,
        usage_units,
        unit_price_usd_micros,
        estimated_amount_usd_micros,
        status_code,
        metadata
      ) VALUES (
        ${input.merchant.id}::uuid,
        ${planCode},
        ${input.authType},
        ${input.audience},
        ${input.eventType},
        ${input.requestId ?? null},
        ${input.toolName ?? null},
        ${1},
        ${priceMicros},
        ${priceMicros},
        ${input.statusCode ?? null},
        ${JSON.stringify({
          pricingVersion: HOSTED_MCP_PRICING_VERSION,
          merchantEmail: input.merchant.email,
          ...(input.metadata ?? {}),
        })}::jsonb
      )
    `;
  } catch {
    // Best-effort metering only. Hosted MCP transport should never fail because
    // the usage ledger is unavailable.
  } finally {
    await sql?.end().catch(() => {});
  }
}
