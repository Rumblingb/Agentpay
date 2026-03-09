/**
 * Unit tests for discoveryService — ranking logic and embedding fallback.
 * Tests the pure functions without live DB or OpenAI connections.
 */

jest.mock('../../src/lib/prisma', () => ({
  __esModule: true,
  default: {
    agent: { findMany: jest.fn() },
    $queryRawUnsafe: jest.fn(),
  },
}));

import { rankAgents, generateEmbedding } from '../../src/services/discoveryService';

// Minimal AgentCandidate shape required by rankAgents
interface Candidate {
  id: string;
  score: number;
  paymentReliability: number;
  pricePerTask?: number;
  avgResponseTimeMs?: number;
  textScore?: number;
  compositeScore?: number;
}

const makeCandidate = (overrides: Partial<Candidate> = {}): Candidate => ({
  id: 'agent-' + Math.random().toString(36).slice(2),
  score: 500,
  paymentReliability: 0.9,
  pricePerTask: 1.0,
  avgResponseTimeMs: 200,
  textScore: 0.8,
  ...overrides,
});

describe('discoveryService', () => {
  describe('rankAgents', () => {
    it('returns empty array for empty candidates', () => {
      expect(rankAgents([])).toEqual([]);
    });

    it('returns candidates with compositeScore attached', () => {
      const agents = [makeCandidate({ score: 700 }), makeCandidate({ score: 300 })];
      const result = rankAgents(agents);
      expect(result[0]).toHaveProperty('compositeScore');
      expect(result[1]).toHaveProperty('compositeScore');
    });

    it('best_match mode ranks higher score + reliability first', () => {
      const high = makeCandidate({ score: 900, paymentReliability: 0.95, textScore: 0.9 });
      const low = makeCandidate({ score: 200, paymentReliability: 0.5, textScore: 0.3 });
      const [first, second] = rankAgents([low, high], 'best_match');
      expect(first.compositeScore!).toBeGreaterThan(second.compositeScore!);
    });

    it('cheapest mode ranks cheaper agent first', () => {
      const cheap = makeCandidate({ score: 500, paymentReliability: 0.8, pricePerTask: 0.1 });
      const expensive = makeCandidate({ score: 500, paymentReliability: 0.8, pricePerTask: 9.9 });
      const [first] = rankAgents([expensive, cheap], 'cheapest');
      expect(first.id).toBe(cheap.id);
    });

    it('fastest mode ranks lower latency agent first', () => {
      const fast = makeCandidate({ score: 500, paymentReliability: 0.8, avgResponseTimeMs: 50 });
      const slow = makeCandidate({ score: 500, paymentReliability: 0.8, avgResponseTimeMs: 2000 });
      const [first] = rankAgents([slow, fast], 'fastest');
      expect(first.id).toBe(fast.id);
    });

    it('compositeScore is in [0, 1] range', () => {
      const agents = [
        makeCandidate({ score: 1000, paymentReliability: 1, pricePerTask: 0, avgResponseTimeMs: 0 }),
        makeCandidate({ score: 0, paymentReliability: 0, pricePerTask: 100, avgResponseTimeMs: 5000 }),
      ];
      const result = rankAgents(agents, 'best_match');
      for (const r of result) {
        expect(r.compositeScore).toBeGreaterThanOrEqual(0);
        expect(r.compositeScore).toBeLessThanOrEqual(1);
      }
    });

    it('handles missing optional fields gracefully', () => {
      const a = makeCandidate({ pricePerTask: undefined, avgResponseTimeMs: undefined, textScore: undefined });
      expect(() => rankAgents([a], 'best_match')).not.toThrow();
    });

    it('single candidate always has compositeScore > 0', () => {
      const a = makeCandidate({ score: 100, paymentReliability: 0.5 });
      const [result] = rankAgents([a], 'best_match');
      expect(result.compositeScore).toBeGreaterThan(0);
    });
  });

  describe('generateEmbedding (local fallback)', () => {
    beforeEach(() => {
      // Ensure OPENAI_API_KEY is not set so fallback is used
      delete process.env.OPENAI_API_KEY;
    });

    it('returns an array of numbers', async () => {
      const embedding = await generateEmbedding('test query');
      expect(Array.isArray(embedding)).toBe(true);
      expect(embedding.length).toBeGreaterThan(0);
      embedding.forEach((v) => expect(typeof v).toBe('number'));
    });

    it('returns a 1536-dimensional vector', async () => {
      const embedding = await generateEmbedding('hello world');
      expect(embedding.length).toBe(1536);
    });

    it('returns different vectors for different texts', async () => {
      const a = await generateEmbedding('data analysis agent');
      const b = await generateEmbedding('creative writing bot');
      expect(a).not.toEqual(b);
    });

    it('returns consistent vector for same text', async () => {
      const a = await generateEmbedding('consistent text');
      const b = await generateEmbedding('consistent text');
      expect(a).toEqual(b);
    });

    it('handles empty string without throwing', async () => {
      await expect(generateEmbedding('')).resolves.toBeDefined();
    });
  });
});
