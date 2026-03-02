/**
 * Unit tests for llmGateway service — cost calculation and request building.
 * External HTTP calls and DB queries are mocked.
 */

// ---- Mock dependencies BEFORE imports ----
const mockQuery = jest.fn();
const mockGetClient = jest.fn();

jest.mock('../../src/db/index', () => ({
  query: mockQuery,
  getClient: mockGetClient,
  closePool: jest.fn().mockResolvedValue(undefined),
}));

const mockFindUniqueOrThrow = jest.fn();
const mockCreate = jest.fn();
const mockFindFirst = jest.fn();

jest.mock('../../src/lib/prisma', () => ({
  __esModule: true,
  default: {
    merchant: { findUniqueOrThrow: mockFindUniqueOrThrow },
    paymentIntent: {
      create: mockCreate,
      findFirst: mockFindFirst,
    },
  },
}));

jest.mock('../../src/services/webhookQueue', () => ({
  enqueueWebhook: jest.fn().mockResolvedValue('job-123'),
}));

import {
  calculateCost,
  getSupportedModels,
  processMicropayment,
  LLMTokenUsage,
} from '../../src/services/llmGateway';

describe('llmGateway', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── Cost Calculation ──────────────────────────────────────────────────

  describe('calculateCost', () => {
    it('calculates cost for gpt-4 based on token pricing', () => {
      const usage: LLMTokenUsage = {
        promptTokens: 1000,
        completionTokens: 500,
        totalTokens: 1500,
      };
      // gpt-4: prompt=$0.03/1K, completion=$0.06/1K
      // Cost = (1000/1000)*0.03 + (500/1000)*0.06 = 0.03 + 0.03 = 0.06
      const cost = calculateCost('gpt-4', usage);
      expect(cost).toBe(0.06);
    });

    it('calculates cost for gpt-4o-mini (very cheap model)', () => {
      const usage: LLMTokenUsage = {
        promptTokens: 10000,
        completionTokens: 2000,
        totalTokens: 12000,
      };
      // gpt-4o-mini: prompt=$0.00015/1K, completion=$0.0006/1K
      // Cost = (10000/1000)*0.00015 + (2000/1000)*0.0006 = 0.0015 + 0.0012 = 0.0027
      const cost = calculateCost('gpt-4o-mini', usage);
      expect(cost).toBe(0.0027);
    });

    it('uses default pricing for unknown models', () => {
      const usage: LLMTokenUsage = {
        promptTokens: 1000,
        completionTokens: 1000,
        totalTokens: 2000,
      };
      // Default: prompt=$0.01/1K, completion=$0.03/1K
      // Cost = 0.01 + 0.03 = 0.04
      const cost = calculateCost('unknown-model', usage);
      expect(cost).toBe(0.04);
    });

    it('returns 0 for zero tokens', () => {
      const usage: LLMTokenUsage = {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      };
      const cost = calculateCost('gpt-4', usage);
      expect(cost).toBe(0);
    });

    it('handles Anthropic claude-3-haiku pricing', () => {
      const usage: LLMTokenUsage = {
        promptTokens: 5000,
        completionTokens: 1000,
        totalTokens: 6000,
      };
      // claude-3-haiku: prompt=$0.00025/1K, completion=$0.00125/1K
      // Cost = (5000/1000)*0.00025 + (1000/1000)*0.00125 = 0.00125 + 0.00125 = 0.0025
      const cost = calculateCost('claude-3-haiku', usage);
      expect(cost).toBe(0.0025);
    });
  });

  // ── Supported Models ──────────────────────────────────────────────────

  describe('getSupportedModels', () => {
    it('returns an array of supported models with pricing', () => {
      const models = getSupportedModels();

      expect(Array.isArray(models)).toBe(true);
      expect(models.length).toBeGreaterThan(0);

      const gpt4 = models.find((m) => m.model === 'gpt-4');
      expect(gpt4).toBeDefined();
      expect(gpt4!.provider).toBe('openai');
      expect(gpt4!.promptPricePer1k).toBe(0.03);
      expect(gpt4!.completionPricePer1k).toBe(0.06);
    });

    it('includes Anthropic models', () => {
      const models = getSupportedModels();
      const claude = models.find((m) => m.model === 'claude-3-sonnet');
      expect(claude).toBeDefined();
      expect(claude!.provider).toBe('anthropic');
    });

    it('includes Groq models', () => {
      const models = getSupportedModels();
      const llama = models.find((m) => m.model === 'llama-3-70b');
      expect(llama).toBeDefined();
      expect(llama!.provider).toBe('groq');
    });
  });

  // ── Micropayment ──────────────────────────────────────────────────────

  describe('processMicropayment', () => {
    const merchantId = 'merchant-uuid-1234';
    const agentId = 'test-agent-001';

    it('rejects when merchant not found', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] }); // merchant lookup

      const result = await processMicropayment({
        merchantId,
        agentId,
        amount: 0.01,
        description: 'Boost post',
      });

      expect(result.approved).toBe(false);
      expect(result.reason).toMatch(/Merchant not found/i);
    });

    it('approves a valid micropayment within spending limits', async () => {
      // Merchant lookup
      mockQuery.mockResolvedValueOnce({ rows: [{ id: merchantId }] });
      // Spending policy check (no policy = allow)
      mockQuery.mockResolvedValueOnce({ rows: [] });
      // Prisma intent creation
      mockFindUniqueOrThrow.mockResolvedValue({ walletAddress: 'test-wallet' });
      mockCreate.mockResolvedValue({});

      const result = await processMicropayment({
        merchantId,
        agentId,
        amount: 0.01,
        description: 'Boost post',
      });

      expect(result.approved).toBe(true);
      expect(result.amount).toBe(0.01);
      expect(result.intentId).toBeDefined();
    });
  });
});
