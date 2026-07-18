import {
  NEED_SLUG,
  PRODUCTS,
  SCOPE_CATEGORIES,
  type Need,
  type ScopeMode,
} from '../../../commerce/commerceCatalog';

export type CommerceBrief = {
  need: Need;
  scopeMode: ScopeMode;
  budgetMinor: number;
  maxDeliveryDays: number;
  easyReturns: boolean;
};

export function buildCommerceCompilePayload(brief: CommerceBrief, catalogUpdatedAt: string) {
  return {
    need: NEED_SLUG[brief.need],
    constitution: {
      currency: 'GBP',
      maxTotalMinor: brief.budgetMinor,
      allowedCategories: [...SCOPE_CATEGORIES[brief.scopeMode]],
      blockedMerchants: [] as string[],
      requiresRefundable: brief.easyReturns,
      minimumReturnWindowDays: brief.easyReturns ? 30 : 0,
      maximumDeliveryDays: brief.maxDeliveryDays,
      maxEvidenceAgeMinutes: 60,
      requireHumanApproval: true,
    },
    limit: 6,
    products: PRODUCTS.map((product) => ({
      id: product.id,
      merchantId: product.merchant.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
      merchantName: product.merchant,
      title: product.name,
      category: product.category,
      priceMinor: product.priceMinor,
      currency: 'GBP',
      availability: 'in_stock' as const,
      checkoutUrl: `https://merchant.example/checkout/${product.id}`,
      imageUrl: `https://app.agentpay.so${product.image}`,
      deliveryDays: product.deliveryDays,
      returnWindowDays: product.returnDays,
      refundable: product.returnDays > 0,
      catalogUpdatedAt,
      truthScore: product.truthScore,
      qualityScore: product.qualityScore,
      needSignals: Object.entries(product.needScores).map(([productNeed, score]) => ({
        need: NEED_SLUG[productNeed as Need],
        score,
      })),
      sponsored: false,
    })),
  };
}
