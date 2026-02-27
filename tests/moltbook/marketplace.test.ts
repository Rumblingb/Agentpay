/**
 * Unit tests for moltbookService — marketplace search.
 * db.query is mocked so no live database is required.
 */

jest.mock('../../src/db/index', () => ({
  query: jest.fn(),
  closePool: jest.fn().mockResolvedValue(undefined),
}));

import * as db from '../../src/db/index';
import { listServices, getService, searchServices } from '../../src/services/moltbookService';

const mockQuery = db.query as jest.Mock;

const SAMPLE_SERVICE = {
  id: 'srv-uuid-001',
  name: 'Web Scraper',
  description: 'Scrapes web pages and returns structured data',
  category: 'data',
  price: '0.10',
  pricing_model: 'per_use',
  avg_response_time_ms: 800,
  success_rate: '0.97',
  total_uses: 500,
  total_revenue: '50.00',
  rating: '4.8',
  review_count: 42,
  tags: ['scraping', 'data', 'web'],
  created_at: new Date().toISOString(),
  provider_handle: 'scraper-bot',
  provider_reputation: 78,
};

describe('moltbookService — marketplace', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── listServices ──────────────────────────────────────────────────────

  describe('listServices', () => {
    it('returns services and total count', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [SAMPLE_SERVICE, { ...SAMPLE_SERVICE, id: 'srv-uuid-002' }] })
        .mockResolvedValueOnce({ rows: [{ count: '2' }] });

      const result = await listServices(20, 0);

      expect(result.services).toHaveLength(2);
      expect(result.total).toBe(2);
    });

    it('filters by category', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [SAMPLE_SERVICE] })
        .mockResolvedValueOnce({ rows: [{ count: '1' }] });

      const result = await listServices(20, 0, 'data');

      expect(result.services).toHaveLength(1);
      // Verify the category filter was passed to the query
      const selectCall = mockQuery.mock.calls[0];
      expect(selectCall[1]).toContain('data');
    });

    it('returns empty list when no services exist', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ count: '0' }] });

      const result = await listServices();

      expect(result.services).toHaveLength(0);
      expect(result.total).toBe(0);
    });

    it('sorts by rating when sortBy=rating', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [SAMPLE_SERVICE] })
        .mockResolvedValueOnce({ rows: [{ count: '1' }] });

      await listServices(20, 0, undefined, 'rating');

      const selectCall = mockQuery.mock.calls[0];
      expect(selectCall[0]).toContain('s.rating');
    });

    it('sorts by revenue when sortBy=revenue', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [SAMPLE_SERVICE] })
        .mockResolvedValueOnce({ rows: [{ count: '1' }] });

      await listServices(20, 0, undefined, 'revenue');

      const selectCall = mockQuery.mock.calls[0];
      expect(selectCall[0]).toContain('s.total_revenue');
    });
  });

  // ── getService ────────────────────────────────────────────────────────

  describe('getService', () => {
    it('returns a service by ID', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [SAMPLE_SERVICE] });

      const service = await getService('srv-uuid-001');
      expect(service).not.toBeNull();
      expect((service as any).name).toBe('Web Scraper');
    });

    it('returns null when service not found', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const service = await getService('nonexistent-id');
      expect(service).toBeNull();
    });
  });

  // ── searchServices ────────────────────────────────────────────────────

  describe('searchServices', () => {
    it('returns matching services with full-text search', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [SAMPLE_SERVICE] })
        .mockResolvedValueOnce({ rows: [{ count: '1' }] });

      const result = await searchServices({ q: 'scraper' });

      expect(result.services).toHaveLength(1);
      expect(result.total).toBe(1);

      // Verify ILIKE query was included
      const selectCall = mockQuery.mock.calls[0];
      expect(selectCall[1]).toContain('%scraper%');
    });

    it('filters by category in search', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [SAMPLE_SERVICE] })
        .mockResolvedValueOnce({ rows: [{ count: '1' }] });

      await searchServices({ category: 'data' });

      const selectCall = mockQuery.mock.calls[0];
      expect(selectCall[1]).toContain('data');
    });

    it('filters by tag array', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [SAMPLE_SERVICE] })
        .mockResolvedValueOnce({ rows: [{ count: '1' }] });

      await searchServices({ tags: ['scraping', 'web'] });

      const selectCall = mockQuery.mock.calls[0];
      expect(selectCall[0]).toContain('&&');
    });

    it('filters by price range', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [SAMPLE_SERVICE] })
        .mockResolvedValueOnce({ rows: [{ count: '1' }] });

      await searchServices({ minPrice: 0.05, maxPrice: 0.50 });

      const selectCall = mockQuery.mock.calls[0];
      expect(selectCall[1]).toContain(0.05);
      expect(selectCall[1]).toContain(0.50);
    });

    it('filters by minimum reputation', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [SAMPLE_SERVICE] })
        .mockResolvedValueOnce({ rows: [{ count: '1' }] });

      await searchServices({ minReputation: 70 });

      const selectCall = mockQuery.mock.calls[0];
      expect(selectCall[1]).toContain(70);
    });

    it('sorts by reputation when sortBy=reputation', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [SAMPLE_SERVICE] })
        .mockResolvedValueOnce({ rows: [{ count: '1' }] });

      await searchServices({ sortBy: 'reputation' });

      const selectCall = mockQuery.mock.calls[0];
      expect(selectCall[0]).toContain('b.reputation_score');
    });

    it('returns empty result for no matches', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ count: '0' }] });

      const result = await searchServices({ q: 'nonexistent-service-xyz' });
      expect(result.services).toHaveLength(0);
      expect(result.total).toBe(0);
    });
  });
});
