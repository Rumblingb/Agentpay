import prisma from '../lib/prisma.js';

/**
 * Asserts that the given agent belongs to the specified merchant.
 * Throws an error if the agent does not exist or is owned by a different merchant.
 *
 * @param agentId    - UUID of the agent to validate
 * @param merchantId - UUID of the merchant who must own the agent
 */
export async function assertAgentOwnership(agentId: string, merchantId: string): Promise<void> {
  const agent = await prisma.agent.findFirst({
    where: {
      id: agentId,
      merchantId,
    },
    select: { id: true },
  });

  if (!agent) {
    throw new Error('Agent not found or access denied');
  }
}
