export type CatalogChannel =
  | 'landing_page'
  | 'schema_org'
  | 'google_merchant'
  | 'openai_feed'
  | 'ucp'
  | 'checkout';

export type CatalogSnapshot = {
  channel: CatalogChannel;
  title: string;
  description: string;
  priceMinor: number;
  currency: string;
  availability: 'in_stock' | 'out_of_stock' | 'preorder' | 'backorder';
  productUrl: string;
  imageUrl: string;
  updatedAt: string;
  brand?: string;
  gtin?: string;
  mpn?: string;
  shippingDays?: number;
  returnWindowDays?: number;
  aiGeneratedTitle?: boolean;
  aiGeneratedDescription?: boolean;
  aiContentDisclosed?: boolean;
};

export type CatalogTruthInput = {
  productId: string;
  maxAgeMinutes?: number;
  snapshots: CatalogSnapshot[];
};

export type CatalogTruthIssue = {
  severity: 'blocking' | 'warning';
  code: string;
  channel: CatalogChannel;
  field: string;
  message: string;
};

export type CatalogTruthReport = {
  schema: 'agentpay.catalog-truth/1.0';
  productId: string;
  canonicalChannel: CatalogChannel;
  auditedAt: string;
  score: number;
  issues: CatalogTruthIssue[];
  channelStatus: Array<{
    channel: CatalogChannel;
    present: boolean;
    blockingIssues: number;
    warnings: number;
  }>;
  readiness: {
    search: boolean;
    agents: boolean;
    checkout: boolean;
  };
  sources: Array<{ name: string; url: string }>;
};

const CHANNELS: CatalogChannel[] = [
  'landing_page',
  'schema_org',
  'google_merchant',
  'openai_feed',
  'ucp',
  'checkout',
];

export class CatalogTruthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CatalogTruthError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requiredString(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    throw new CatalogTruthError(`${field} must be a non-empty string of at most ${maxLength} characters`);
  }
  return value.trim();
}

function integer(value: unknown, field: string, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) {
    throw new CatalogTruthError(`${field} must be an integer between ${min} and ${max}`);
  }
  return value as number;
}

function httpsUrl(value: unknown, field: string): string {
  const raw = requiredString(value, field, 2048);
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new CatalogTruthError(`${field} must be a valid HTTPS URL`);
  }
  if (parsed.protocol !== 'https:') throw new CatalogTruthError(`${field} must use HTTPS`);
  return parsed.toString();
}

function optionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') throw new CatalogTruthError(`${field} must be a boolean`);
  return value;
}

function normalizeSnapshot(raw: unknown, index: number): CatalogSnapshot {
  if (!isRecord(raw)) throw new CatalogTruthError(`snapshots[${index}] must be an object`);
  const channel = requiredString(raw.channel, `snapshots[${index}].channel`, 40) as CatalogChannel;
  if (!CHANNELS.includes(channel)) throw new CatalogTruthError(`snapshots[${index}].channel is unsupported`);
  const currency = requiredString(raw.currency, `snapshots[${index}].currency`, 3).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new CatalogTruthError(`snapshots[${index}].currency must be a three-letter code`);
  const availability = requiredString(raw.availability, `snapshots[${index}].availability`, 20) as CatalogSnapshot['availability'];
  if (!['in_stock', 'out_of_stock', 'preorder', 'backorder'].includes(availability)) {
    throw new CatalogTruthError(`snapshots[${index}].availability is unsupported`);
  }
  const updatedAt = new Date(requiredString(raw.updatedAt, `snapshots[${index}].updatedAt`, 40));
  if (Number.isNaN(updatedAt.getTime())) throw new CatalogTruthError(`snapshots[${index}].updatedAt must be an ISO timestamp`);
  const optionalInteger = (field: 'shippingDays' | 'returnWindowDays') => raw[field] === undefined
    ? undefined
    : integer(raw[field], `snapshots[${index}].${field}`, 0, 3650);
  return {
    channel,
    title: requiredString(raw.title, `snapshots[${index}].title`, 500),
    description: requiredString(raw.description, `snapshots[${index}].description`, 5000),
    priceMinor: integer(raw.priceMinor, `snapshots[${index}].priceMinor`, 0, 100_000_000_000),
    currency,
    availability,
    productUrl: httpsUrl(raw.productUrl, `snapshots[${index}].productUrl`),
    imageUrl: httpsUrl(raw.imageUrl, `snapshots[${index}].imageUrl`),
    updatedAt: updatedAt.toISOString(),
    brand: raw.brand === undefined ? undefined : requiredString(raw.brand, `snapshots[${index}].brand`, 200),
    gtin: raw.gtin === undefined ? undefined : requiredString(raw.gtin, `snapshots[${index}].gtin`, 32),
    mpn: raw.mpn === undefined ? undefined : requiredString(raw.mpn, `snapshots[${index}].mpn`, 70),
    shippingDays: optionalInteger('shippingDays'),
    returnWindowDays: optionalInteger('returnWindowDays'),
    aiGeneratedTitle: optionalBoolean(raw.aiGeneratedTitle, `snapshots[${index}].aiGeneratedTitle`),
    aiGeneratedDescription: optionalBoolean(raw.aiGeneratedDescription, `snapshots[${index}].aiGeneratedDescription`),
    aiContentDisclosed: optionalBoolean(raw.aiContentDisclosed, `snapshots[${index}].aiContentDisclosed`),
  };
}

function issue(
  issues: CatalogTruthIssue[],
  severity: CatalogTruthIssue['severity'],
  code: string,
  channel: CatalogChannel,
  field: string,
  message: string,
) {
  issues.push({ severity, code, channel, field, message });
}

export function auditCatalogTruth(raw: unknown, now = new Date()): CatalogTruthReport {
  if (!isRecord(raw)) throw new CatalogTruthError('Request body must be an object');
  const productId = requiredString(raw.productId, 'productId', 200);
  if (!Array.isArray(raw.snapshots) || raw.snapshots.length < 2 || raw.snapshots.length > CHANNELS.length) {
    throw new CatalogTruthError(`snapshots must contain 2-${CHANNELS.length} channel snapshots`);
  }
  const maxAgeMinutes = raw.maxAgeMinutes === undefined
    ? 24 * 60
    : integer(raw.maxAgeMinutes, 'maxAgeMinutes', 1, 525_600);
  const snapshots = raw.snapshots.map(normalizeSnapshot);
  if (new Set(snapshots.map((snapshot) => snapshot.channel)).size !== snapshots.length) {
    throw new CatalogTruthError('Each channel may appear only once');
  }
  const canonical = snapshots.find((snapshot) => snapshot.channel === 'landing_page') ?? snapshots[0];
  const issues: CatalogTruthIssue[] = [];

  for (const snapshot of snapshots) {
    if (snapshot.priceMinor !== canonical.priceMinor) issue(issues, 'blocking', 'PRICE_DRIFT', snapshot.channel, 'priceMinor', `Price differs from ${canonical.channel}`);
    if (snapshot.currency !== canonical.currency) issue(issues, 'blocking', 'CURRENCY_DRIFT', snapshot.channel, 'currency', `Currency differs from ${canonical.channel}`);
    if (snapshot.availability !== canonical.availability) issue(issues, 'blocking', 'AVAILABILITY_DRIFT', snapshot.channel, 'availability', `Availability differs from ${canonical.channel}`);
    if (snapshot.title !== canonical.title) issue(issues, 'warning', 'TITLE_DRIFT', snapshot.channel, 'title', `Title differs from ${canonical.channel}`);
    if (!snapshot.brand) issue(issues, 'warning', 'BRAND_MISSING', snapshot.channel, 'brand', 'Brand is missing');
    if (!snapshot.gtin && !snapshot.mpn) issue(issues, 'warning', 'IDENTIFIER_MISSING', snapshot.channel, 'gtin', 'Provide GTIN or MPN when one exists');
    if (snapshot.shippingDays === undefined) issue(issues, 'warning', 'SHIPPING_MISSING', snapshot.channel, 'shippingDays', 'Shipping estimate is missing');
    if (snapshot.returnWindowDays === undefined) issue(issues, 'warning', 'RETURNS_MISSING', snapshot.channel, 'returnWindowDays', 'Return window is missing');
    const ageMs = now.getTime() - Date.parse(snapshot.updatedAt);
    if (ageMs < -5 * 60_000 || ageMs > maxAgeMinutes * 60_000) {
      issue(issues, 'blocking', 'STALE_SNAPSHOT', snapshot.channel, 'updatedAt', `Snapshot is older than ${maxAgeMinutes} minutes`);
    }
    if (
      snapshot.channel === 'google_merchant'
      && (snapshot.aiGeneratedTitle || snapshot.aiGeneratedDescription)
      && !snapshot.aiContentDisclosed
    ) {
      issue(issues, 'blocking', 'AI_DISCLOSURE_MISSING', snapshot.channel, 'aiContentDisclosed', 'AI-generated title or description is not disclosed');
    }
  }

  const status = CHANNELS.map((channel) => {
    const channelIssues = issues.filter((item) => item.channel === channel);
    return {
      channel,
      present: snapshots.some((snapshot) => snapshot.channel === channel),
      blockingIssues: channelIssues.filter((item) => item.severity === 'blocking').length,
      warnings: channelIssues.filter((item) => item.severity === 'warning').length,
    };
  });
  const hasClean = (channel: CatalogChannel) => status.some((item) => item.channel === channel && item.present && item.blockingIssues === 0);
  const blockingCount = issues.filter((item) => item.severity === 'blocking').length;
  const warningCount = issues.length - blockingCount;

  return {
    schema: 'agentpay.catalog-truth/1.0',
    productId,
    canonicalChannel: canonical.channel,
    auditedAt: now.toISOString(),
    score: Math.max(0, 100 - blockingCount * 20 - warningCount * 3),
    issues,
    channelStatus: status,
    readiness: {
      search: hasClean('landing_page') && (hasClean('schema_org') || hasClean('google_merchant')),
      agents: hasClean('openai_feed') || hasClean('ucp'),
      checkout: hasClean('checkout'),
    },
    sources: [
      { name: 'Google Product structured data', url: 'https://developers.google.com/search/docs/appearance/structured-data/product' },
      { name: 'Google Merchant listing structured data', url: 'https://developers.google.com/search/docs/appearance/structured-data/merchant-listing' },
      { name: 'OpenAI shopping product selection', url: 'https://help.openai.com/en/articles/11128490-shopping-with-chatgpt-search' },
      { name: 'Universal Commerce Protocol', url: 'https://ucp.dev/' },
    ],
  };
}
