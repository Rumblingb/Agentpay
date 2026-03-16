import prisma from '../lib/prisma.js';

/**
 * Create or update a peer endorsement between agents.
 * If an endorsement already exists, update the weight.
 */
export async function endorseAgent(fromAgentId: string, toAgentId: string, weight: number) {
  let endorsement = await prisma.endorsement.findUnique({
    where: { fromAgentId_toAgentId: { fromAgentId, toAgentId } },
  });

  if (!endorsement) {
    endorsement = await prisma.endorsement.create({
      data: {
        fromAgentId,
        toAgentId,
        weight,
      },
    });
    return endorsement;
  }

  return await prisma.endorsement.update({
    where: { id: endorsement.id },
    data: { weight },
  });
}

/**
 * Get all endorsements for an agent.
 */
export async function getEndorsements(toAgentId: string) {
  return await prisma.endorsement.findMany({
    where: { toAgentId },
  });
}
