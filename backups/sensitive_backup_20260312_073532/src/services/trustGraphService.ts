import prisma from '../lib/prisma.js';

/**
 * Update or create a TrustEdge between two agents.
 * Increments interaction_count and updates trust_weight.
 * trust_weight = successful_interactions / total_interactions (simple beta logic)
 */
export async function updateTrustEdge(fromAgentId: string, toAgentId: string, success: boolean) {
  // Find or create the edge
  let edge = await prisma.trustEdge.findUnique({
    where: { fromAgentId_toAgentId: { fromAgentId, toAgentId } },
  });

  if (!edge) {
    edge = await prisma.trustEdge.create({
      data: {
        fromAgentId,
        toAgentId,
        trustWeight: success ? 1 : 0,
        interactionCount: 1,
      },
    });
    return edge;
  }

  // Update edge
  const newCount = edge.interactionCount + 1;
  const newSuccessCount = (edge.trustWeight * edge.interactionCount) + (success ? 1 : 0);
  const newWeight = newSuccessCount / newCount;

  return await prisma.trustEdge.update({
    where: { id: edge.id },
    data: {
      trustWeight: newWeight,
      interactionCount: newCount,
    },
  });
}

/**
 * Get all trust edges for graph visualization.
 */
export async function getTrustEdges() {
  return await prisma.trustEdge.findMany();
}
