/**
 * Unit tests for marketplaceService.
 * Prisma client is mocked — no live database required.
 */

// ── Mock Prisma before imports ─────────────────────────────────────────────

const mockServiceListingFindMany = jest.fn();
const mockServiceListingFindUnique = jest.fn();
const mockServiceListingCreate = jest.fn();
const mockServiceListingUpdate = jest.fn();
const mockServiceListingDelete = jest.fn();

const mockServiceReviewAggregate = jest.fn();

const mockServiceTransactionFindUnique = jest.fn();
const mockServiceTransactionFindMany = jest.fn();
const mockServiceTransactionCreate = jest.fn();
const mockServiceTransactionUpdate = jest.fn();

const mockQualityScoreFindUnique = jest.fn();
const mockQualityScoreUpsert = jest.fn();

jest.mock('../../src/lib/prisma', () => ({
  __esModule: true,
  default: {
    serviceListing: {
      findMany: mockServiceListingFindMany,
      findUnique: mockServiceListingFindUnique,
      create: mockServiceListingCreate,
      update: mockServiceListingUpdate,
      delete: mockServiceListingDelete,
    },
    serviceReview: {
      aggregate: mockServiceReviewAggregate,
    },
    serviceTransaction: {
      findUnique: mockServiceTransactionFindUnique,
      findMany: mockServiceTransactionFindMany,
      create: mockServiceTransactionCreate,
      update: mockServiceTransactionUpdate,
    },
    agentServiceQualityScore: {
      findUnique: mockQualityScoreFindUnique,
      upsert: mockQualityScoreUpsert,
    },
  },
}));

import {
  searchServices,
  getServiceListing,
  createServiceListing,
  updateServiceListing,
  deleteServiceListing,
  recordServicePurchase,
  markServiceCompleted,
  markServiceFailed,
  computeAgentRank,
} from '../../src/services/marketplaceService';

// ── Sample Data ────────────────────────────────────────────────────────────

const SAMPLE_LISTING = {
  id: 'cl-listing-001',
  botHandle: '@scraper-bot',
  title: 'Web Scraper Service',
  description: 'Scrapes web pages and returns structured data',
  priceCents: 1000,
  category: 'data',
  metadata: {},
  createdAt: new Date(),
  updatedAt: new Date(),
};

// ── Tests ──────────────────────────────────────────────────────────────────

describe('marketplaceService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── searchServices ─────────────────────────────────────────────────────

  describe('searchServices', () => {
    it('returns listings sorted by AgentRank score', async () => {
      const listingA = { ...SAMPLE_LISTING, id: 'a', botHandle: '@botA' };
      const listingB = { ...SAMPLE_LISTING, id: 'b', botHandle: '@botB' };
      mockServiceListingFindMany.mockResolvedValue([listingA, listingB]);
      mockQualityScoreFindUnique
        .mockResolvedValueOnce({ score: 30 })
        .mockResolvedValueOnce({ score: 80 });

      const results = await searchServices('Scraper');
      expect(results).toHaveLength(2);
      expect(results[0].agentRankScore).toBe(80);
      expect(results[1].agentRankScore).toBe(30);
    });

    it('returns empty array when no listings match', async () => {
      mockServiceListingFindMany.mockResolvedValue([]);
      const results = await searchServices('nonexistent');
      expect(results).toHaveLength(0);
    });

    it('filters by category', async () => {
      mockServiceListingFindMany.mockResolvedValue([SAMPLE_LISTING]);
      mockQualityScoreFindUnique.mockResolvedValue(null);

      await searchServices(undefined, 'data');
      const call = mockServiceListingFindMany.mock.calls[0][0];
      expect(call.where.category).toBe('data');
    });

    it('respects limit parameter', async () => {
      mockServiceListingFindMany.mockResolvedValue([]);
      await searchServices(undefined, undefined, 5);
      const call = mockServiceListingFindMany.mock.calls[0][0];
      expect(call.take).toBe(5);
    });

    it('caps limit at 100', async () => {
      mockServiceListingFindMany.mockResolvedValue([]);
      await searchServices(undefined, undefined, 999);
      const call = mockServiceListingFindMany.mock.calls[0][0];
      expect(call.take).toBe(100);
    });
  });

  // ── CRUD ───────────────────────────────────────────────────────────────

  describe('getServiceListing', () => {
    it('returns a listing by ID', async () => {
      mockServiceListingFindUnique.mockResolvedValue(SAMPLE_LISTING);
      const listing = await getServiceListing('cl-listing-001');
      expect(listing).toEqual(SAMPLE_LISTING);
    });

    it('returns null when not found', async () => {
      mockServiceListingFindUnique.mockResolvedValue(null);
      const listing = await getServiceListing('nonexistent');
      expect(listing).toBeNull();
    });
  });

  describe('createServiceListing', () => {
    it('creates a listing with valid data', async () => {
      mockServiceListingCreate.mockResolvedValue(SAMPLE_LISTING);
      const result = await createServiceListing('@scraper-bot', {
        title: 'Web Scraper Service',
        description: 'Scrapes web pages',
        priceCents: 1000,
        category: 'data',
      });
      expect(result).toEqual(SAMPLE_LISTING);
      expect(mockServiceListingCreate).toHaveBeenCalledTimes(1);
    });
  });

  describe('updateServiceListing', () => {
    it('updates an existing listing', async () => {
      mockServiceListingFindUnique.mockResolvedValue(SAMPLE_LISTING);
      const updated = { ...SAMPLE_LISTING, title: 'Updated Title' };
      mockServiceListingUpdate.mockResolvedValue(updated);

      const result = await updateServiceListing('cl-listing-001', {
        title: 'Updated Title',
      });
      expect(result).toEqual(updated);
    });

    it('returns null when listing not found', async () => {
      mockServiceListingFindUnique.mockResolvedValue(null);
      const result = await updateServiceListing('nonexistent', {
        title: 'Updated',
      });
      expect(result).toBeNull();
    });
  });

  describe('deleteServiceListing', () => {
    it('deletes an existing listing', async () => {
      mockServiceListingFindUnique.mockResolvedValue(SAMPLE_LISTING);
      mockServiceListingDelete.mockResolvedValue(SAMPLE_LISTING);

      const result = await deleteServiceListing('cl-listing-001');
      expect(result).toBe(true);
    });

    it('returns false when listing not found', async () => {
      mockServiceListingFindUnique.mockResolvedValue(null);
      const result = await deleteServiceListing('nonexistent');
      expect(result).toBe(false);
    });
  });

  // ── Transactions ───────────────────────────────────────────────────────

  describe('recordServicePurchase', () => {
    it('creates a pending service transaction', async () => {
      const txData = {
        id: 'tx-001',
        listingId: 'cl-listing-001',
        buyerBotHandle: '@buyer',
        sellerBotHandle: '@seller',
        amountCents: 1000,
        intentId: 'intent-uuid-1',
        status: 'pending',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockServiceTransactionCreate.mockResolvedValue(txData);

      const result = await recordServicePurchase(
        'intent-uuid-1',
        'cl-listing-001',
        '@buyer',
        '@seller',
        1000,
      );
      expect(result.status).toBe('pending');
      expect(result.intentId).toBe('intent-uuid-1');
    });
  });

  describe('markServiceCompleted', () => {
    it('marks a transaction as completed', async () => {
      const tx = { id: 'tx-001', status: 'pending' };
      mockServiceTransactionFindUnique.mockResolvedValue(tx);
      mockServiceTransactionUpdate.mockResolvedValue({
        ...tx,
        status: 'completed',
      });

      const result = await markServiceCompleted('tx-001');
      expect(result!.status).toBe('completed');
    });

    it('returns null when transaction not found', async () => {
      mockServiceTransactionFindUnique.mockResolvedValue(null);
      const result = await markServiceCompleted('nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('markServiceFailed', () => {
    it('marks a transaction as failed', async () => {
      const tx = { id: 'tx-001', status: 'pending' };
      mockServiceTransactionFindUnique.mockResolvedValue(tx);
      mockServiceTransactionUpdate.mockResolvedValue({
        ...tx,
        status: 'failed',
      });

      const result = await markServiceFailed('tx-001');
      expect(result!.status).toBe('failed');
    });

    it('returns null when transaction not found', async () => {
      mockServiceTransactionFindUnique.mockResolvedValue(null);
      const result = await markServiceFailed('nonexistent');
      expect(result).toBeNull();
    });
  });

  // ── AgentRank ──────────────────────────────────────────────────────────

  describe('computeAgentRank', () => {
    it('computes correct score from transactions and reviews', async () => {
      // 4 transactions: 3 completed, 1 failed
      mockServiceTransactionFindMany.mockResolvedValue([
        { status: 'completed' },
        { status: 'completed' },
        { status: 'completed' },
        { status: 'failed' },
      ]);

      // 1 listing with reviews
      mockServiceListingFindMany.mockResolvedValue([{ id: 'listing-1' }]);

      // Average rating = 4.5
      mockServiceReviewAggregate.mockResolvedValue({
        _avg: { rating: 4.5 },
      });

      const expectedFulfillmentRate = 3 / 4; // 0.75
      const expectedRefundRate = 1 / 4; // 0.25
      const expectedScore =
        4.5 * 10 +
        expectedFulfillmentRate * 20 +
        (1 - expectedRefundRate) * 20 +
        Math.log(4 + 1) * 8;

      mockQualityScoreUpsert.mockResolvedValue({
        botHandle: '@seller',
        score: expectedScore,
        fulfillmentRate: expectedFulfillmentRate,
        avgRating: 4.5,
        refundRate: expectedRefundRate,
        totalTransactions: 4,
      });

      const result = await computeAgentRank('@seller');
      expect(result.score).toBeCloseTo(expectedScore, 2);
      expect(result.fulfillmentRate).toBe(expectedFulfillmentRate);
      expect(result.avgRating).toBe(4.5);
    });

    it('handles bot with no transactions', async () => {
      mockServiceTransactionFindMany.mockResolvedValue([]);
      mockServiceListingFindMany.mockResolvedValue([]);

      // score = 0*10 + 0*20 + (1-0)*20 + log(1)*8 = 20
      const expectedScore = 0 * 10 + 0 * 20 + (1 - 0) * 20 + Math.log(1) * 8;

      mockQualityScoreUpsert.mockResolvedValue({
        botHandle: '@newbot',
        score: expectedScore,
        fulfillmentRate: 0,
        avgRating: 0,
        refundRate: 0,
        totalTransactions: 0,
      });

      const result = await computeAgentRank('@newbot');
      expect(result.score).toBeCloseTo(expectedScore, 2);
    });
  });
});
