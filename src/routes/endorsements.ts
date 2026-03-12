import express, { Request, Response } from 'express';
import { endorseAgent } from '../services/endorsementService.js';
import prisma from '../lib/prisma.js';

const router = express.Router();

// POST /api/endorse
router.post('/', async (req: Request, res: Response) => {
  const { from_agent, to_agent, weight } = req.body;
  if (!from_agent || !to_agent || typeof weight !== 'number') {
    res.status(400).json({ error: 'Missing required fields' });
    return;
  }

  try {
    // Step 1: Record endorsement
    const endorsement = await endorseAgent(from_agent, to_agent, weight);

    // Step 2: Calculate endorsement score for to_agent
    const endorsements = await prisma.endorsement.findMany({
      where: { toAgentId: to_agent },
    });
    const endorsementScore = endorsements.reduce((sum: number, e: { weight: number }) => sum + e.weight, 0);

    // Step 3: Update trustScore (interaction_score + endorsement_score)
    // Get interaction_score from Agent table
    const agent = await prisma.agent.findUnique({ where: { id: to_agent } });
    const interactionScore = agent?.trustScore || 0;
    const trustScore = interactionScore + endorsementScore;
    await prisma.agent.update({
      where: { id: to_agent },
      data: { trustScore },
    });

    res.status(201).json({ success: true, endorsement, trustScore });
  } catch (error) {
    res.status(500).json({ error: 'Failed to process endorsement', details: error });
  }
});

export default router;
