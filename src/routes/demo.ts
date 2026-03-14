import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { authenticateApiKey } from '../middleware/auth.js';
import prisma from '../lib/prisma.js';
import { logger } from '../logger.js';

const router = Router();

/**
 * POST /api/demo/run-agent-payment
 *
 * Simulates a full agent-initiated payment end-to-end without needing a real
 * Solana wallet. Creates a $0.10 USDC payment intent, immediately marks it
 * as confirmed, inserts a transactions record, and returns a success payload.
 *
 * This is intended for investor demos and development testing only.
 */
router.post('/run-agent-payment', authenticateApiKey, async (req: Request, res: Response) => {
  try {
    const merchant = (req as any).merchant;

    const intentId = uuidv4();
    const verificationToken = `APV_DEMO_${Date.now()}_${uuidv4().replace(/-/g, '').slice(0, 8)}`;
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
    const amount = 0.10;
    const currency = 'USDC';
    const sourceAgent = (req.body as any)?.sourceAgent ?? 'DemoAgent';
    const destinationService = (req.body as any)?.destinationService ?? 'WeatherDataAPI';

    // Create and immediately confirm the payment intent
    await prisma.paymentIntent.create({
      data: {
        id: intentId,
        merchantId: merchant.id,
        amount,
        currency,
        status: 'verified',
        verificationToken,
        expiresAt,
        metadata: {
          demo: true,
          source_agent: sourceAgent,
          destination_service: destinationService,
        },
      },
    });

    // Insert a confirmed transaction record
    const transactionId = uuidv4();
    const paymentId = uuidv4();
    await prisma.transactions.create({
      data: {
        id: transactionId,
        merchant_id: merchant.id,
        payment_id: paymentId,
        amount_usdc: amount,
        recipient_address: merchant.walletAddress ?? 'demo-recipient',
        status: 'confirmed',
        confirmation_depth: 3,
        required_depth: 2,
        expires_at: expiresAt,
        metadata: {
          demo: true,
          intent_id: intentId,
          source_agent: sourceAgent,
          destination_service: destinationService,
        },
      },
    });

    logger.info('Demo agent payment simulated', {
      merchantId: merchant.id,
      intentId,
      transactionId,
      sourceAgent,
      destinationService,
    });

    res.status(201).json({
      success: true,
      simulation: true,
      intentId,
      transactionId,
      amount,
      currency,
      sourceAgent,
      destinationService,
      status: 'confirmed',
      message: 'Demo agent payment completed successfully',
    });
  } catch (err: any) {
    logger.error('Demo payment error:', err);
    res.status(500).json({ error: 'Demo payment simulation failed' });
  }
});

/**
 * POST /api/demo/spawn-agent
 *
 * Minimal demo endpoint that "spawns" an agent and returns a canonical
 * payload the dashboard can consume directly. This intentionally keeps
 * changes small: it finds-or-creates a demo Agent, inserts a demo
 * transactions row, and returns the shaped JSON with a small receipt SVG.
 */
router.post('/spawn-agent', authenticateApiKey, async (req: Request, res: Response) => {
  try {
    const merchant = (req as any).merchant;
    const amount = 0.1;
    const finalState = 'U'; // terminal (settlement/updated)

    // find or create a demo agent
    let agent = await prisma.agent.findFirst({ where: { displayName: 'DemoAgent' } });
    if (!agent) {
      agent = await prisma.agent.create({
        data: {
          displayName: 'DemoAgent',
          service: 'DemoService',
          merchantId: merchant.id,
        },
      });
    }

    // create a simple transactions row to mirror run-agent-payment
    const transactionId = uuidv4();
    const paymentId = uuidv4();
    await prisma.transactions.create({
      data: {
        id: transactionId,
        merchant_id: merchant.id,
        payment_id: paymentId,
        amount_usdc: amount,
        recipient_address: merchant.walletAddress ?? 'demo-recipient',
        status: 'confirmed',
        metadata: {
          demo: true,
          spawn: true,
          agentId: agent.id,
        },
      },
    });

    // try to fetch reputation record for extra fields (best-effort)
    const rep = await prisma.agentReputation.findUnique({ where: { agentId: agent.id } }).catch(() => null);

    // For this demo endpoint we simulate the full happy-path internally
    // and return only the final terminal state 'U' and uiStatus 'Completed'.

    const receiptSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="120"><rect width="100%" height="100%" fill="#071017" rx="8"/><text x="20" y="36" fill="#9AA4AF" font-family="Inter, sans-serif" font-size="14">AgentPay Demo Receipt</text><text x="20" y="64" fill="#F5F7FA" font-family="Inter, sans-serif" font-size="18">Tx: ${transactionId.slice(0, 8)}</text><text x="20" y="92" fill="#38BDF8" font-family="Inter, sans-serif" font-size="16">Amount: $${amount.toFixed(2)}</text></svg>`;

    const payload = {
      transactionId,
      state: finalState,
      uiStatus: 'Completed',
      amount,
      receiptSvg,
      agent: {
        id: agent.id,
        name: agent.displayName ?? null,
        displayName: agent.displayName ?? null,
        role: agent.operatorId ?? 'agent',
        services: agent.service ? [agent.service] : [],
        trust_score: (agent as any).trustScore ?? (agent as any).trust ?? 50,
        txn_count: rep?.totalTx ?? 0,
        success_rate: rep?.successRate ?? 1.0,
        created_at: agent.createdAt,
      },
      feedEvent: {
        id: uuidv4(),
        source: agent.displayName ?? 'DemoAgent',
        target: merchant.name ?? 'DemoMerchant',
        status: finalState,
        timestamp: new Date().toISOString(),
        value: amount,
      },
      message: 'Demo agent spawned and settlement simulated',
    };

    logger.info('Demo spawn-agent ran', { merchantId: merchant.id, transactionId, agentId: agent.id });
    return res.status(201).json(payload);
  } catch (err: any) {
    logger.error('Demo spawn-agent error', err);
    return res.status(500).json({ error: 'Failed to spawn demo agent' });
  }
});

export default router;
