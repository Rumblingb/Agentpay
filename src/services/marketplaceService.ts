/**
 * Marketplace Service
 *
 * Provides the business logic for the AgentPay Marketplace:
 * service listings CRUD, search with AgentRank scoring,
 * purchase recording, and quality score computation.
 */

import prisma from '../lib/prisma';
import { logger } from '../logger';

// ── Types ──────────────────────────────────────────────────────────────────

export interface CreateListingData {
  title: string;
  description: string;
  priceCents: number;
  category: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateListingData {
  title?: string;
  description?: string;
  priceCents?: number;
  category?: string;
  metadata?: Record<string, unknown>;
}

// ── Search ─────────────────────────────────────────────────────────────────

/**
 * Full-text search on title/description, sorted by AgentRank score.
 */
export async function searchServices(
  query?: string,
  category?: string,
  limit = 20,
) {
  const where: Record<string, unknown> = {};

  if (query) {
    where.OR = [
      { title: { contains: query, mode: 'insensitive' } },
      { description: { contains: query, mode: 'insensitive' } },
    ];
  }
  if (category) {
    where.category = category;
  }

  const listings = await prisma.serviceListing.findMany({
    where,
    take: Math.min(limit, 100),
    orderBy: { createdAt: 'desc' },
  });

  // Enrich with AgentRank scores and sort
  const enriched = await Promise.all(
    listings.map(async (listing) => {
      const score = await prisma.agentServiceQualityScore.findUnique({
        where: { botHandle: listing.botHandle },
      });
      return {
        ...listing,
        agentRankScore: score?.score ?? 0,
      };
    }),
  );

  // Sort by AgentRank score descending
  enriched.sort((a, b) => b.agentRankScore - a.agentRankScore);

  return enriched;
}

// ── CRUD ───────────────────────────────────────────────────────────────────

export async function getServiceListing(id: string) {
  return prisma.serviceListing.findUnique({ where: { id } });
}

export async function createServiceListing(
  botHandle: string,
  data: CreateListingData,
) {
  return prisma.serviceListing.create({
    data: {
      botHandle,
      title: data.title,
      description: data.description,
      priceCents: data.priceCents,
      category: data.category,
      metadata: (data.metadata ?? {}) as object,
    },
  });
}

export async function updateServiceListing(
  id: string,
  data: UpdateListingData,
) {
  const existing = await prisma.serviceListing.findUnique({ where: { id } });
  if (!existing) return null;

  return prisma.serviceListing.update({
    where: { id },
    data: {
      ...(data.title !== undefined && { title: data.title }),
      ...(data.description !== undefined && { description: data.description }),
      ...(data.priceCents !== undefined && { priceCents: data.priceCents }),
      ...(data.category !== undefined && { category: data.category }),
      ...(data.metadata !== undefined && { metadata: data.metadata as object }),
    },
  });
}

export async function deleteServiceListing(id: string) {
  const existing = await prisma.serviceListing.findUnique({ where: { id } });
  if (!existing) return false;

  await prisma.serviceListing.delete({ where: { id } });
  return true;
}

// ── Transactions ───────────────────────────────────────────────────────────

/**
 * Record a service purchase after an AgentPay Intent finalises.
 */
export async function recordServicePurchase(
  intentId: string,
  listingId: string,
  buyerBot: string,
  sellerBot: string,
  amountCents: number,
) {
  return prisma.serviceTransaction.create({
    data: {
      listingId,
      buyerBotHandle: buyerBot,
      sellerBotHandle: sellerBot,
      amountCents,
      intentId,
      status: 'pending',
    },
  });
}

export async function markServiceCompleted(transactionId: string) {
  const tx = await prisma.serviceTransaction.findUnique({
    where: { id: transactionId },
  });
  if (!tx) return null;

  return prisma.serviceTransaction.update({
    where: { id: transactionId },
    data: { status: 'completed' },
  });
}

export async function markServiceFailed(transactionId: string) {
  const tx = await prisma.serviceTransaction.findUnique({
    where: { id: transactionId },
  });
  if (!tx) return null;

  return prisma.serviceTransaction.update({
    where: { id: transactionId },
    data: { status: 'failed' },
  });
}

// ── AgentRank ──────────────────────────────────────────────────────────────

/**
 * Compute the AgentRank quality score for a bot handle.
 *
 * Formula:
 *   score = (avg_rating * 10)
 *         + (fulfillment_rate * 20)
 *         + ((1 - refund_rate) * 20)
 *         + log(total_transactions + 1) * 8
 */
export async function computeAgentRank(botHandle: string) {
  // Gather all transactions where this bot is the seller
  const allTx = await prisma.serviceTransaction.findMany({
    where: { sellerBotHandle: botHandle },
  });

  const totalTransactions = allTx.length;
  const completedCount = allTx.filter((t) => t.status === 'completed').length;
  const failedCount = allTx.filter((t) => t.status === 'failed').length;

  const fulfillmentRate =
    totalTransactions > 0 ? completedCount / totalTransactions : 0;
  const refundRate =
    totalTransactions > 0 ? failedCount / totalTransactions : 0;

  // Average rating from reviews on this bot's listings
  const listings = await prisma.serviceListing.findMany({
    where: { botHandle },
    select: { id: true },
  });
  const listingIds = listings.map((l) => l.id);

  let avgRating = 0;
  if (listingIds.length > 0) {
    const agg = await prisma.serviceReview.aggregate({
      where: { listingId: { in: listingIds } },
      _avg: { rating: true },
    });
    avgRating = agg._avg.rating ?? 0;
  }

  // Compute score
  const score =
    avgRating * 10 +
    fulfillmentRate * 20 +
    (1 - refundRate) * 20 +
    Math.log(totalTransactions + 1) * 8;

  // Upsert the quality score row
  const result = await prisma.agentServiceQualityScore.upsert({
    where: { botHandle },
    create: {
      botHandle,
      fulfillmentRate,
      avgRating,
      refundRate,
      totalTransactions,
      score,
    },
    update: {
      fulfillmentRate,
      avgRating,
      refundRate,
      totalTransactions,
      score,
    },
  });

  logger.info('AgentRank computed', { botHandle, score });
  return result;
}

export default {
  searchServices,
  getServiceListing,
  createServiceListing,
  updateServiceListing,
  deleteServiceListing,
  recordServicePurchase,
  markServiceCompleted,
  markServiceFailed,
  computeAgentRank,
};
