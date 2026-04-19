import {
  buildChangeCandidatesFromGrowthSummary,
  type AgentPayGrowthSummary,
} from '../../apps/api-edge/src/lib/productSignals';

function baseSummary(): AgentPayGrowthSummary {
  return {
    windowHours: 24,
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

describe('product signal change candidates', () => {
  it('ranks the major friction and margin candidates from a seeded summary', () => {
    const summary = baseSummary();
    summary.hostedMcp.tokenMints = 8;
    summary.hostedMcp.checkoutCreates = 4;
    summary.nextActions = [
      { type: 'auth_required', count: 6 },
      { type: 'funding_required', count: 5 },
    ];
    summary.topCapabilityCosts = [
      {
        capabilityKey: 'firecrawl_primary',
        provider: 'firecrawl',
        calls: 17,
        estimatedCostUsd: 29,
      },
    ];

    const candidates = buildChangeCandidatesFromGrowthSummary(summary);

    expect(candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'mcp-paid-conversion', severity: 'high' }),
      expect.objectContaining({ key: 'hosted-mcp-checkout-dropoff', severity: 'high' }),
      expect.objectContaining({ key: 'auth-step-friction', category: 'distribution' }),
      expect.objectContaining({ key: 'funding-step-friction', category: 'funding' }),
      expect.objectContaining({ key: 'capability-margin-pressure', category: 'capability_margin' }),
    ]));
  });

  it('surfaces the strongest host when real revenue is already appearing', () => {
    const summary = baseSummary();
    summary.hosts = [
      {
        audience: 'anthropic',
        tokenMints: 4,
        toolCalls: 12,
        nextActions: 2,
        realizedRevenueUsd: 61,
      },
      {
        audience: 'openai',
        tokenMints: 3,
        toolCalls: 10,
        nextActions: 1,
        realizedRevenueUsd: 12,
      },
    ];

    const candidates = buildChangeCandidatesFromGrowthSummary(summary);

    expect(candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        key: 'double-down-anthropic',
        category: 'distribution',
        metrics: expect.objectContaining({
          audience: 'anthropic',
          realizedRevenueUsd: 61,
        }),
      }),
    ]));
  });
});
