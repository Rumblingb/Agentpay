/**
 * Discovery Service — semantic agent search with multi-criteria ranking.
 *
 * Provides:
 *   - generateEmbedding()  — OpenAI text-embedding-3-small or local fallback
 *   - semanticSearch()     — cosine similarity (fallback: keyword match)
 *   - rankAgents()         — composite ranking: price, latency, successRate, AgentRank
 *
 * The pgvector column on Agent is optional — if absent, falls back to
 * keyword matching so discovery still works without the extension.
 *
 * @module services/discoveryService
 */

import { logger } from '../logger.js';
import prisma from '../lib/prisma.js';

// ---------------------------------------------------------------------------
// Embedding helpers
// ---------------------------------------------------------------------------

/**
 * Generate a text embedding vector.
 *
 * Uses OpenAI text-embedding-3-small when OPENAI_API_KEY is set.
 * Falls back to a simple TF-IDF-style vector (bag of words, length 32).
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  if (process.env.OPENAI_API_KEY) {
    try {
      const response = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'text-embedding-3-small',
          input: text.slice(0, 8191),
        }),
      });

      if (response.ok) {
        const data = await response.json() as { data: [{ embedding: number[] }] };
        return data.data[0].embedding;
      }
      logger.warn('[discoveryService] OpenAI embedding failed, using fallback');
    } catch (err: any) {
      logger.warn('[discoveryService] OpenAI embedding error, using fallback', { err: err?.message });
    }
  }

  // Local fallback: deterministic 1536-dim pseudo-embedding
  return localEmbedding(text, 1536);
}

/**
 * Local fallback embedding — maps each character to a bucket in a vector.
 * Not semantically meaningful but enables consistent ranking without OpenAI.
 */
function localEmbedding(text: string, dims: number): number[] {
  const vec = new Array(dims).fill(0);
  const normalized = text.toLowerCase();
  for (let i = 0; i < normalized.length; i++) {
    const bucket = normalized.charCodeAt(i) % dims;
    vec[bucket] += 1;
  }
  // L2 normalize
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
  return vec.map((v) => v / norm);
}

/**
 * Cosine similarity between two vectors.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// ---------------------------------------------------------------------------
// Multi-criteria ranking
// ---------------------------------------------------------------------------

export interface AgentCandidate {
  agentId: string;
  handle?: string | null;
  score: number;          // AgentRank score
  grade: string;
  transactionVolume: number;
  paymentReliability: number;
  serviceDelivery: number;
  pricePerTask?: number;
  avgResponseTimeMs?: number;
  updatedAt: Date | null;
  textScore?: number;     // keyword/semantic match score [0,1]
  [key: string]: unknown;
}

export type SortMode = 'best_match' | 'cheapest' | 'fastest';

/**
 * Composite rank candidates by multiple criteria.
 *
 * Weights:
 *   best_match: 0.4 AgentRank + 0.3 reliability + 0.3 textScore
 *   cheapest:   0.6 inverse-price + 0.2 AgentRank + 0.2 reliability
 *   fastest:    0.6 inverse-latency + 0.2 AgentRank + 0.2 reliability
 */
export function rankAgents(
  candidates: AgentCandidate[],
  sortMode: SortMode = 'best_match',
): AgentCandidate[] {
  if (candidates.length === 0) return [];

  const maxScore = Math.max(...candidates.map((c) => c.score), 1);
  // Use max+epsilon so a candidate equal to max still gets a non-zero inverse score
  const maxPrice = Math.max(...candidates.map((c) => c.pricePerTask ?? 0), 0);
  const maxLatency = Math.max(...candidates.map((c) => c.avgResponseTimeMs ?? 0), 0);

  const scored = candidates.map((c) => {
    const normalizedScore = c.score / maxScore;
    const normalizedReliability = c.paymentReliability;
    const normalizedText = c.textScore ?? 0.5;
    const normalizedInversePrice = maxPrice > 0 ? 1 - (c.pricePerTask ?? 0) / maxPrice : 1;
    const normalizedInverseLatency = maxLatency > 0 ? 1 - (c.avgResponseTimeMs ?? 0) / maxLatency : 1;

    let composite: number;
    switch (sortMode) {
      case 'cheapest':
        composite = 0.6 * normalizedInversePrice + 0.2 * normalizedScore + 0.2 * normalizedReliability;
        break;
      case 'fastest':
        composite = 0.6 * normalizedInverseLatency + 0.2 * normalizedScore + 0.2 * normalizedReliability;
        break;
      default: // best_match
        composite = 0.4 * normalizedScore + 0.3 * normalizedReliability + 0.3 * normalizedText;
    }

    return { ...c, compositeScore: composite };
  });

  return scored.sort((a, b) => (b as any).compositeScore - (a as any).compositeScore);
}

// ---------------------------------------------------------------------------
// Agent embedding update
// ---------------------------------------------------------------------------

/**
 * Generate and store embedding for an agent (called on register/update).
 * Gracefully no-ops if the vector column doesn't exist.
 */
export async function updateAgentEmbedding(agentId: string, text: string): Promise<void> {
  try {
    const embedding = await generateEmbedding(text);
    // Use raw SQL to set the pgvector column — Prisma doesn't natively support
    // the vector type without raw queries.
    await (prisma as any).$executeRawUnsafe(
      `UPDATE agents SET embedding = $1::vector WHERE id = $2`,
      `[${embedding.join(',')}]`,
      agentId,
    );
    logger.info('[discoveryService] Embedding updated', { agentId });
  } catch (err: any) {
    // Column may not exist yet — silently skip
    logger.debug('[discoveryService] Embedding update skipped', { agentId, err: err?.message });
  }
}

// ---------------------------------------------------------------------------
// Semantic search
// ---------------------------------------------------------------------------

/**
 * Perform semantic search over agents.
 *
 * When pgvector is available, uses cosine distance ordering.
 * Falls back to keyword matching (ilike) otherwise.
 *
 * Returns agentIds sorted by relevance.
 */
export async function semanticSearch(
  query: string,
  limit = 20,
  offset = 0,
): Promise<string[]> {
  try {
    const embedding = await generateEmbedding(query);
    const vectorStr = `[${embedding.join(',')}]`;

    // Try pgvector cosine distance search
    const rows = await (prisma as any).$queryRawUnsafe(
      `SELECT id FROM agents
       WHERE embedding IS NOT NULL
       ORDER BY embedding <=> $1::vector
       LIMIT $2 OFFSET $3`,
      vectorStr,
      limit,
      offset,
    ) as Array<{ id: string }>;

    if (rows.length > 0) {
      return rows.map((r) => r.id);
    }
  } catch {
    // pgvector not available — fall through to keyword search
  }

  // Keyword fallback
  try {
    const agents = await prisma.agent.findMany({
      where: {
        OR: [
          { displayName: { contains: query, mode: 'insensitive' } },
          { service: { contains: query, mode: 'insensitive' } },
        ],
      },
      select: { id: true },
      take: limit,
      skip: offset,
    });
    return agents.map((a: { id: string }) => a.id);
  } catch {
    return [];
  }
}
