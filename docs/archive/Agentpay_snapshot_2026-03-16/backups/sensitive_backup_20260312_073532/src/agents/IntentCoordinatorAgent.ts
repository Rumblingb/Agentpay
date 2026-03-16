/**
 * IntentCoordinatorAgent - Constitutional Layer Agent #4
 *
 * Routes transaction intents across payment rails without touching principal.
 * Makes AgentPay the coordination layer rather than custody layer.
 *
 * Core Functions:
 * 1. Route intents to optimal payment rail (Stripe/Solana/x402/AP2)
 * 2. Coordinate multi-step transactions
 * 3. Handle protocol translation
 * 4. Provide transaction status tracking
 *
 * Revenue: $0.25-1.00 per transaction coordinated
 * Moat: Multi-protocol integration complexity
 */

import { prisma } from '../lib/prisma.js';
import crypto from 'crypto';

interface PaymentIntent {
  intentId: string;
  fromAgent: string;
  toAgent: string;
  amount: number;
  currency: 'USD' | 'USDC' | 'SOL';
  purpose: string;
  metadata?: any;
}

interface RouteDecision {
  protocol: 'stripe' | 'solana' | 'x402' | 'ap2' | 'bank';
  reasoning: string;
  estimatedCost: number;
  estimatedTime: string;
  confidence: number;
}

interface CoordinatedTransaction {
  intentId: string;
  status: 'pending' | 'routing' | 'executing' | 'completed' | 'failed';
  route: RouteDecision;
  externalTxId?: string;
  steps: TransactionStep[];
  /**
   * executionMode indicates whether protocol execution steps are live or simulated.
   *
   * "simulated" = no real API calls were made to Stripe, Solana, x402, AP2, or banks.
   * Steps are recorded and status is returned as "completed" but NO actual funds
   * moved. Do NOT use "simulated" responses to verify payment.
   *
   * "live" = real API calls were made; externalTxId reflects the real transaction.
   */
  executionMode: 'live' | 'simulated';
  createdAt: Date;
  completedAt?: Date;
}

interface TransactionStep {
  stepId: string;
  action: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  timestamp: Date;
  details?: any;
}

type ProtocolKey = 'stripe' | 'solana' | 'x402' | 'ap2' | 'bank';

interface ProtocolCapabilities {
  minAmount: number;
  maxAmount: number;
  currencies: string[];
  speed: string;
  cost: number;
}

class IntentCoordinatorAgent {
  private agentId = 'intent_coordinator_001';

  /**
   * executionMode: "simulated" means all protocol execution methods
   * (executeViaStripe, executeViaSolana, etc.) are stubs — no real API
   * calls are made and no funds actually move.
   *
   * Steps are created and status is returned as "completed" to allow
   * integration testing, but the externalTxId values are randomly generated
   * placeholders, not real transaction references.
   *
   * This must remain "simulated" until each executeVia* method is wired
   * to its real API client.
   */
  readonly executionMode: 'live' | 'simulated' = 'simulated';

  private COORDINATION_FEE = {
    instant: 1.00,
    fast: 0.50,
    standard: 0.25
  };

  private protocolCapabilities: Record<ProtocolKey, ProtocolCapabilities> = {
    stripe: {
      minAmount: 0.50,
      maxAmount: 999999,
      currencies: ['USD'],
      speed: 'instant',
      cost: 0.029
    },
    solana: {
      minAmount: 0.01,
      maxAmount: Infinity,
      currencies: ['USDC', 'SOL'],
      speed: 'instant',
      cost: 0.00001
    },
    x402: {
      minAmount: 0.01,
      maxAmount: 10000,
      currencies: ['USDC'],
      speed: 'fast',
      cost: 0.0001
    },
    ap2: {
      minAmount: 1.00,
      maxAmount: 999999,
      currencies: ['USD'],
      speed: 'instant',
      cost: 0.015
    },
    bank: {
      minAmount: 1.00,
      maxAmount: 999999,
      currencies: ['USD'],
      speed: 'standard',
      cost: 0.005
    }
  };

  /**
   * Create and coordinate a payment intent
   */
  async createIntent(intent: PaymentIntent): Promise<CoordinatedTransaction> {
    const feeKey = this.protocolCapabilities.stripe.speed === 'instant' ? 'instant' : 'standard';
    await this.chargeCoordinationFee(
      intent.fromAgent,
      this.COORDINATION_FEE[feeKey as keyof typeof this.COORDINATION_FEE]
    );

    const route = await this.determineRoute(intent);

    const transaction: CoordinatedTransaction = {
      intentId: intent.intentId,
      status: 'routing',
      route,
      steps: [],
      executionMode: this.executionMode,
      createdAt: new Date()
    };

    await this.storeIntent(intent, transaction);
    await this.executeIntent(transaction, intent);

    return transaction;
  }

  /**
   * Get transaction status
   */
  async getTransactionStatus(intentId: string): Promise<CoordinatedTransaction> {
    const transaction = await prisma.coordinatedTransaction.findUnique({
      where: { intentId }
    });

    if (!transaction) {
      throw new Error('Transaction not found');
    }

    return {
      intentId: transaction.intentId,
      status: transaction.status as any,
      route: transaction.route as any,
      externalTxId: transaction.externalTxId ?? undefined,
      steps: transaction.steps as any,
      // Conservatively mark fetched transactions as simulated since we cannot
      // know what mode was active when they were created.
      executionMode: this.executionMode,
      createdAt: transaction.createdAt,
      completedAt: transaction.completedAt ?? undefined
    };
  }

  /**
   * Route recommendation without executing
   */
  async recommendRoute(intent: Omit<PaymentIntent, 'intentId'>): Promise<RouteDecision[]> {
    const routes: RouteDecision[] = [];

    for (const [protocol, caps] of Object.entries(this.protocolCapabilities)) {
      if (intent.amount < caps.minAmount || intent.amount > caps.maxAmount) continue;
      if (!caps.currencies.includes(intent.currency)) continue;

      const score = this.scoreRoute(protocol as ProtocolKey, intent, caps);

      routes.push({
        protocol: protocol as ProtocolKey,
        reasoning: this.explainRoute(protocol, caps, score),
        estimatedCost: intent.amount * caps.cost,
        estimatedTime: caps.speed,
        confidence: score
      });
    }

    routes.sort((a, b) => b.confidence - a.confidence);

    return routes;
  }

  // Private routing logic

  private async determineRoute(intent: PaymentIntent): Promise<RouteDecision> {
    const routes = await this.recommendRoute(intent);

    if (routes.length === 0) {
      throw new Error('No suitable payment rail found for this transaction');
    }

    return routes[0];
  }

  private scoreRoute(protocol: ProtocolKey, intent: any, capabilities: ProtocolCapabilities): number {
    let score = 0.5;

    if (capabilities.speed === 'instant') score += 0.3;
    else if (capabilities.speed === 'fast') score += 0.2;

    const estimatedCost = intent.amount * capabilities.cost;
    if (estimatedCost < 0.10) score += 0.2;
    else if (estimatedCost < 1.00) score += 0.1;

    if (capabilities.currencies.includes(intent.currency)) score += 0.1;

    const reliability: Record<ProtocolKey, number> = {
      stripe: 0.99,
      solana: 0.98,
      x402: 0.95,
      ap2: 0.97,
      bank: 0.92
    };
    score += (reliability[protocol] - 0.9) * 0.5;

    return Math.min(score, 1.0);
  }

  private explainRoute(protocol: string, capabilities: ProtocolCapabilities, score: number): string {
    const reasons: string[] = [];

    if (capabilities.speed === 'instant') reasons.push('instant settlement');
    if (capabilities.cost < 0.001) reasons.push('low cost');
    if (score > 0.8) reasons.push('high reliability');

    return `${protocol}: ${reasons.join(', ')}`;
  }

  // Protocol execution methods (SIMULATED STUBS — wire actual clients in production)

  private async executeIntent(
    transaction: CoordinatedTransaction,
    intent: PaymentIntent
  ): Promise<void> {
    transaction.status = 'executing';

    if (this.executionMode === 'simulated') {
      console.warn(
        `[IntentCoordinatorAgent] BETA: executionMode is "simulated" — ` +
        `intent "${transaction.intentId}" via ${transaction.route.protocol} ` +
        `will NOT make real API calls. No funds will move.`
      );
    }

    try {
      switch (transaction.route.protocol) {
        case 'stripe':
          await this.executeViaStripe(transaction, intent);
          break;
        case 'solana':
          await this.executeViaSolana(transaction, intent);
          break;
        case 'x402':
          await this.executeViaX402(transaction, intent);
          break;
        case 'ap2':
          await this.executeViaAP2(transaction, intent);
          break;
        case 'bank':
          await this.executeViaBank(transaction, intent);
          break;
      }

      transaction.status = 'completed';
      transaction.completedAt = new Date();
    } catch (error: any) {
      transaction.status = 'failed';
      this.addStep(transaction, 'execution_failed', 'failed', { error: error.message });
    }

    await this.updateTransaction(transaction);
  }

  /**
   * SIMULATED STUB — no real Stripe API call is made.
   * Production: replace with await stripe.paymentIntents.create({...})
   * and set transaction.externalTxId to the real PaymentIntent ID.
   */
  private async executeViaStripe(transaction: CoordinatedTransaction, _intent: PaymentIntent): Promise<void> {
    this.addStep(transaction, 'stripe_init', 'in_progress');
    // Production: await stripe.paymentIntents.create({...})
    this.addStep(transaction, 'stripe_completed', 'completed', {
      externalId: `pi_${crypto.randomBytes(12).toString('hex')}`,  // placeholder — not a real Stripe ID
      simulated: true,
    });
  }

  /**
   * SIMULATED STUB — no real Solana transaction is submitted.
   * Production: replace with await connection.sendTransaction({...})
   * and set transaction.externalTxId to the real transaction signature.
   */
  private async executeViaSolana(transaction: CoordinatedTransaction, _intent: PaymentIntent): Promise<void> {
    this.addStep(transaction, 'solana_init', 'in_progress');
    // Production: await sendTransaction({...})
    this.addStep(transaction, 'solana_confirmed', 'completed', {
      signature: crypto.randomBytes(32).toString('hex'),  // placeholder — not a real Solana signature
      simulated: true,
    });
  }

  /**
   * SIMULATED STUB — no real x402 payment is made.
   * Production: implement x402 payment channel call.
   */
  private async executeViaX402(transaction: CoordinatedTransaction, _intent: PaymentIntent): Promise<void> {
    this.addStep(transaction, 'x402_init', 'in_progress');
    this.addStep(transaction, 'x402_settled', 'completed', { simulated: true });
  }

  /**
   * SIMULATED STUB — no real AP2 transaction is executed.
   * Production: implement AP2 protocol call via src/protocols/ap2.ts.
   */
  private async executeViaAP2(transaction: CoordinatedTransaction, _intent: PaymentIntent): Promise<void> {
    this.addStep(transaction, 'ap2_init', 'in_progress');
    this.addStep(transaction, 'ap2_completed', 'completed', { simulated: true });
  }

  /**
   * SIMULATED STUB — no real bank/ACH transfer is initiated.
   * Production: implement ACH/wire transfer via your banking partner API.
   */
  private async executeViaBank(transaction: CoordinatedTransaction, _intent: PaymentIntent): Promise<void> {
    this.addStep(transaction, 'bank_init', 'in_progress');
    this.addStep(transaction, 'bank_submitted', 'completed', { simulated: true });
  }

  // Helper methods

  private addStep(
    transaction: CoordinatedTransaction,
    action: string,
    status: 'pending' | 'in_progress' | 'completed' | 'failed',
    details?: any
  ): void {
    transaction.steps.push({
      stepId: `step_${transaction.steps.length + 1}`,
      action,
      status,
      timestamp: new Date(),
      details
    });
  }

  private async storeIntent(intent: PaymentIntent, transaction: CoordinatedTransaction): Promise<void> {
    await prisma.coordinatedTransaction.create({
      data: {
        intentId: intent.intentId,
        fromAgent: intent.fromAgent,
        toAgent: intent.toAgent,
        amount: intent.amount,
        currency: intent.currency,
        purpose: intent.purpose,
        status: transaction.status,
        route: transaction.route as any,
        steps: transaction.steps as any,
        metadata: intent.metadata ?? {},
        createdAt: transaction.createdAt
      }
    });
  }

  private async updateTransaction(transaction: CoordinatedTransaction): Promise<void> {
    await prisma.coordinatedTransaction.update({
      where: { intentId: transaction.intentId },
      data: {
        status: transaction.status,
        steps: transaction.steps as any,
        externalTxId: transaction.externalTxId,
        completedAt: transaction.completedAt
      }
    });
  }

  private async chargeCoordinationFee(agentId: string, fee: number): Promise<void> {
    await prisma.agentFeeTransaction.create({
      data: {
        fromAgent: agentId,
        toAgent: this.agentId,
        amount: fee,
        status: 'completed',
        description: 'Transaction coordination fee',
        metadata: { service: 'IntentCoordinator' }
      }
    });
  }
}

export const intentCoordinatorAgent = new IntentCoordinatorAgent();

export async function handleIntentCoordination(req: any, res: any) {
  const { action, ...params } = req.body;

  // The authenticated merchant ID is the billing entity for create_intent.
  // Always use req.merchant.id — never trust caller-supplied fromAgent for billing.
  const merchantId: string = req.merchant?.id;

  try {
    switch (action) {
      case 'create_intent': {
        const intent: PaymentIntent = {
          intentId: `intent_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`,
          ...params,
          fromAgent: merchantId,   // always use authenticated merchant, not caller-supplied
        };
        const transaction = await intentCoordinatorAgent.createIntent(intent);
        return res.json(transaction);
      }
      case 'get_status': {
        const status = await intentCoordinatorAgent.getTransactionStatus(params.intentId);
        return res.json(status);
      }
      case 'recommend_route': {
        const routes = await intentCoordinatorAgent.recommendRoute(params);
        return res.json({ routes });
      }
      default:
        return res.status(400).json({ error: 'Invalid action' });
    }
  } catch (error: any) {
    console.error('Intent coordinator error:', error);
    return res.status(500).json({ error: error.message });
  }
}
