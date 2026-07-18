import { describe, expect, it } from 'vitest';

import { auditCatalogTruth, CatalogTruthError } from '../src/lib/catalogTruth';

const now = new Date('2026-07-18T12:00:00.000Z');
const snapshot = (channel: string, overrides: Record<string, unknown> = {}) => ({
  channel,
  title: 'Everyday Merino Crew',
  description: 'Traceable merino everyday layer in sea green.',
  priceMinor: 7_200,
  currency: 'GBP',
  availability: 'in_stock',
  productUrl: 'https://merchant.example/products/merino-crew',
  imageUrl: 'https://merchant.example/images/merino-crew.png',
  updatedAt: '2026-07-18T11:50:00.000Z',
  brand: 'Field and Form',
  gtin: '0123456789012',
  shippingDays: 4,
  returnWindowDays: 45,
  ...overrides,
});

describe('catalog truth audit', () => {
  it('marks consistent search, agent, and checkout surfaces ready', () => {
    const report = auditCatalogTruth({
      productId: 'merino-crew',
      snapshots: [
        snapshot('landing_page'),
        snapshot('schema_org'),
        snapshot('google_merchant'),
        snapshot('openai_feed'),
        snapshot('ucp'),
        snapshot('checkout'),
      ],
    }, now);
    expect(report.score).toBe(100);
    expect(report.readiness).toEqual({ search: true, agents: true, checkout: true });
    expect(report.issues).toEqual([]);
  });

  it('finds cross-channel drift, stale data, and missing AI disclosure', () => {
    const report = auditCatalogTruth({
      productId: 'merino-crew',
      maxAgeMinutes: 60,
      snapshots: [
        snapshot('landing_page'),
        snapshot('google_merchant', {
          priceMinor: 7_500,
          availability: 'out_of_stock',
          updatedAt: '2026-07-18T08:00:00.000Z',
          aiGeneratedDescription: true,
          aiContentDisclosed: false,
        }),
        snapshot('checkout'),
      ],
    }, now);
    expect(report.readiness.search).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'PRICE_DRIFT',
      'AVAILABILITY_DRIFT',
      'STALE_SNAPSHOT',
      'AI_DISCLOSURE_MISSING',
    ]));
  });

  it('rejects malformed or duplicate channel snapshots', () => {
    expect(() => auditCatalogTruth({
      productId: 'bad',
      snapshots: [snapshot('landing_page'), snapshot('landing_page')],
    }, now)).toThrow(CatalogTruthError);
  });
});
