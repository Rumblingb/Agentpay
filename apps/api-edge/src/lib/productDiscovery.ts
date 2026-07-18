export type NeedSignal = {
  need: string;
  score: number;
};

export type DiscoveryProduct = {
  id: string;
  merchantId: string;
  merchantName: string;
  title: string;
  priceMinor: number;
  currency: string;
  availability: 'in_stock' | 'out_of_stock' | 'preorder' | 'backorder';
  checkoutUrl: string;
  imageUrl: string;
  deliveryDays: number;
  returnWindowDays: number;
  catalogUpdatedAt: string;
  truthScore: number;
  qualityScore: number;
  needSignals: NeedSignal[];
  sponsored: boolean;
};

export type DiscoveryMatch = {
  product: DiscoveryProduct;
  fitScore: number;
  rank: number;
  reasons: Array<{
    code: 'NEED_FIT' | 'CATALOG_TRUTH' | 'QUALITY' | 'BUDGET_FIT' | 'RETURNS';
    score: number;
  }>;
  disclosure: 'organic' | 'sponsored';
  attributionDraft: {
    schema: 'agentpay.attribution-draft/1.0';
    productId: string;
    merchantId: string;
    successFeeBps: 800;
    feeBase: 'net_merchandise_excluding_tax_shipping';
    settlement: 'after_return_window';
    returnWindowDays: number;
    expiresAt: string;
  };
};

export type DiscoveryReport = {
  schema: 'agentpay.product-discovery/1.0';
  need: string;
  evaluatedAt: string;
  rankingPolicy: {
    paidPlacementChangesOrganicRank: false;
    hardFilters: string[];
    weights: Record<string, number>;
  };
  matches: DiscoveryMatch[];
  rejected: Array<{ productId: string; reasonCodes: string[] }>;
  retention: 'not-stored';
};

export class ProductDiscoveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProductDiscoveryError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requiredString(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    throw new ProductDiscoveryError(`${field} must be a non-empty string of at most ${maxLength} characters`);
  }
  return value.trim();
}

function integer(value: unknown, field: string, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) {
    throw new ProductDiscoveryError(`${field} must be an integer between ${min} and ${max}`);
  }
  return value as number;
}

function httpsUrl(value: unknown, field: string): string {
  const raw = requiredString(value, field, 2048);
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new ProductDiscoveryError(`${field} must be a valid HTTPS URL`);
  }
  if (parsed.protocol !== 'https:') throw new ProductDiscoveryError(`${field} must use HTTPS`);
  return parsed.toString();
}

function normalizeNeed(value: unknown, field: string): string {
  const need = requiredString(value, field, 80).toLowerCase().replace(/\s+/g, '-');
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(need)) {
    throw new ProductDiscoveryError(`${field} must contain words, numbers, or hyphens`);
  }
  return need;
}

function normalizeProduct(raw: unknown, index: number): DiscoveryProduct {
  if (!isRecord(raw)) throw new ProductDiscoveryError(`products[${index}] must be an object`);
  const availability = requiredString(raw.availability, `products[${index}].availability`, 20) as DiscoveryProduct['availability'];
  if (!['in_stock', 'out_of_stock', 'preorder', 'backorder'].includes(availability)) {
    throw new ProductDiscoveryError(`products[${index}].availability is unsupported`);
  }
  if (!Array.isArray(raw.needSignals) || raw.needSignals.length < 1 || raw.needSignals.length > 30) {
    throw new ProductDiscoveryError(`products[${index}].needSignals must contain 1-30 entries`);
  }
  const needSignals = raw.needSignals.map((signal, signalIndex) => {
    if (!isRecord(signal)) throw new ProductDiscoveryError(`products[${index}].needSignals[${signalIndex}] must be an object`);
    return {
      need: normalizeNeed(signal.need, `products[${index}].needSignals[${signalIndex}].need`),
      score: integer(signal.score, `products[${index}].needSignals[${signalIndex}].score`, 0, 100),
    };
  });
  if (new Set(needSignals.map((signal) => signal.need)).size !== needSignals.length) {
    throw new ProductDiscoveryError(`products[${index}].needSignals contains duplicate needs`);
  }
  const catalogUpdatedAt = new Date(requiredString(raw.catalogUpdatedAt, `products[${index}].catalogUpdatedAt`, 40));
  if (Number.isNaN(catalogUpdatedAt.getTime())) {
    throw new ProductDiscoveryError(`products[${index}].catalogUpdatedAt must be an ISO timestamp`);
  }
  const currency = requiredString(raw.currency, `products[${index}].currency`, 3).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new ProductDiscoveryError(`products[${index}].currency must be a three-letter code`);
  }
  if (raw.sponsored !== undefined && typeof raw.sponsored !== 'boolean') {
    throw new ProductDiscoveryError(`products[${index}].sponsored must be a boolean`);
  }
  return {
    id: requiredString(raw.id, `products[${index}].id`, 200),
    merchantId: requiredString(raw.merchantId, `products[${index}].merchantId`, 200),
    merchantName: requiredString(raw.merchantName, `products[${index}].merchantName`, 300),
    title: requiredString(raw.title, `products[${index}].title`, 500),
    priceMinor: integer(raw.priceMinor, `products[${index}].priceMinor`, 0, 100_000_000_000),
    currency,
    availability,
    checkoutUrl: httpsUrl(raw.checkoutUrl, `products[${index}].checkoutUrl`),
    imageUrl: httpsUrl(raw.imageUrl, `products[${index}].imageUrl`),
    deliveryDays: integer(raw.deliveryDays, `products[${index}].deliveryDays`, 0, 3650),
    returnWindowDays: integer(raw.returnWindowDays, `products[${index}].returnWindowDays`, 0, 3650),
    catalogUpdatedAt: catalogUpdatedAt.toISOString(),
    truthScore: integer(raw.truthScore, `products[${index}].truthScore`, 0, 100),
    qualityScore: integer(raw.qualityScore, `products[${index}].qualityScore`, 0, 100),
    needSignals,
    sponsored: raw.sponsored === true,
  };
}

function roundScore(value: number): number {
  return Math.round(Math.max(0, Math.min(100, value)));
}

export function discoverProducts(raw: unknown, now = new Date()): DiscoveryReport {
  if (!isRecord(raw)) throw new ProductDiscoveryError('Request body must be an object');
  const need = normalizeNeed(raw.need, 'need');
  const currency = requiredString(raw.currency, 'currency', 3).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new ProductDiscoveryError('currency must be a three-letter code');
  const budgetMinor = integer(raw.budgetMinor, 'budgetMinor', 1, 100_000_000_000);
  const maxDeliveryDays = raw.maxDeliveryDays === undefined ? 30 : integer(raw.maxDeliveryDays, 'maxDeliveryDays', 0, 3650);
  const minReturnDays = raw.minReturnDays === undefined ? 0 : integer(raw.minReturnDays, 'minReturnDays', 0, 3650);
  const maxEvidenceAgeMinutes = raw.maxEvidenceAgeMinutes === undefined
    ? 24 * 60
    : integer(raw.maxEvidenceAgeMinutes, 'maxEvidenceAgeMinutes', 1, 525_600);
  const limit = raw.limit === undefined ? 5 : integer(raw.limit, 'limit', 1, 20);
  if (!Array.isArray(raw.products) || raw.products.length < 1 || raw.products.length > 200) {
    throw new ProductDiscoveryError('products must contain 1-200 candidates');
  }
  const products = raw.products.map(normalizeProduct);
  const rejected: DiscoveryReport['rejected'] = [];
  const eligible: Array<Omit<DiscoveryMatch, 'rank'>> = [];

  for (const product of products) {
    const reasonCodes: string[] = [];
    if (product.availability !== 'in_stock') reasonCodes.push('NOT_IN_STOCK');
    if (product.currency !== currency) reasonCodes.push('CURRENCY_MISMATCH');
    if (product.priceMinor > budgetMinor) reasonCodes.push('OVER_BUDGET');
    if (product.deliveryDays > maxDeliveryDays) reasonCodes.push('DELIVERY_TOO_SLOW');
    if (product.returnWindowDays < minReturnDays) reasonCodes.push('RETURN_WINDOW_TOO_SHORT');
    const ageMs = now.getTime() - Date.parse(product.catalogUpdatedAt);
    if (ageMs < -5 * 60_000 || ageMs > maxEvidenceAgeMinutes * 60_000) reasonCodes.push('CATALOG_STALE');
    const needScore = product.needSignals.find((signal) => signal.need === need)?.score;
    if (needScore === undefined || needScore < 50) reasonCodes.push('NEED_FIT_TOO_LOW');
    if (reasonCodes.length) {
      rejected.push({ productId: product.id, reasonCodes });
      continue;
    }

    const resolvedNeedScore = needScore ?? 0;
    const budgetScore = Math.max(0, 100 - Math.abs(product.priceMinor - budgetMinor * 0.75) / budgetMinor * 160);
    const returnsScore = Math.min(100, product.returnWindowDays / Math.max(minReturnDays || 30, 30) * 100);
    const reasons: DiscoveryMatch['reasons'] = [
      { code: 'NEED_FIT', score: resolvedNeedScore },
      { code: 'CATALOG_TRUTH', score: product.truthScore },
      { code: 'QUALITY', score: product.qualityScore },
      { code: 'BUDGET_FIT', score: roundScore(budgetScore) },
      { code: 'RETURNS', score: roundScore(returnsScore) },
    ];
    const fitScore = roundScore(
      resolvedNeedScore * 0.5
      + product.truthScore * 0.2
      + product.qualityScore * 0.15
      + budgetScore * 0.1
      + returnsScore * 0.05,
    );
    eligible.push({
      product,
      fitScore,
      reasons,
      disclosure: product.sponsored ? 'sponsored' : 'organic',
      attributionDraft: {
        schema: 'agentpay.attribution-draft/1.0',
        productId: product.id,
        merchantId: product.merchantId,
        successFeeBps: 800,
        feeBase: 'net_merchandise_excluding_tax_shipping',
        settlement: 'after_return_window',
        returnWindowDays: product.returnWindowDays,
        expiresAt: new Date(now.getTime() + 30 * 60_000).toISOString(),
      },
    });
  }

  const matches = eligible
    .sort((a, b) => b.fitScore - a.fitScore || b.product.truthScore - a.product.truthScore || a.product.id.localeCompare(b.product.id))
    .slice(0, limit)
    .map((match, index) => ({ ...match, rank: index + 1 }));

  return {
    schema: 'agentpay.product-discovery/1.0',
    need,
    evaluatedAt: now.toISOString(),
    rankingPolicy: {
      paidPlacementChangesOrganicRank: false,
      hardFilters: ['availability', 'currency', 'budget', 'delivery', 'returns', 'catalog freshness', 'minimum need fit'],
      weights: { needFit: 50, catalogTruth: 20, quality: 15, budgetFit: 10, returns: 5 },
    },
    matches,
    rejected,
    retention: 'not-stored',
  };
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (isRecord(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function signDiscoveryReport(report: DiscoveryReport, secret: string | undefined): Promise<string> {
  if (!secret || secret.length < 24) throw new ProductDiscoveryError('Discovery signing is not configured');
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return bytesToHex(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(stableJson(report)))));
}

export async function verifyDiscoveryReport(report: DiscoveryReport, signature: string, secret: string | undefined): Promise<boolean> {
  const expected = await signDiscoveryReport(report, secret);
  if (!/^[a-f0-9]{64}$/.test(signature) || signature.length !== expected.length) return false;
  let mismatch = 0;
  for (let index = 0; index < expected.length; index += 1) mismatch |= expected.charCodeAt(index) ^ signature.charCodeAt(index);
  return mismatch === 0;
}
