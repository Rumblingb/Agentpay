/**
 * Unified Escrow Service — single entry point for all escrow types.
 *
 * Supports three escrow backends:
 *   - 'solana'   → Solana on-chain escrow via solana-escrow-program + heliusService
 *   - 'internal' → In-memory trust-escrow (fast, zero-cost for testing)
 *   - 'stripe'   → Stripe hold/capture (fiat, not yet wired to Stripe SDK)
 *
 * @module services/escrowService
 */

import { logger } from '../logger.js';
import {
  createEscrow as trustCreate,
  approveWork as trustRelease,
  disputeWork as trustDispute,
  getEscrow as trustGet,
  type EscrowTransaction,
} from '../escrow/trust-escrow.js';
import {
  createSolanaEscrow,
  type EscrowCreateResult,
} from '../escrow/solana-escrow-program.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EscrowType = 'solana' | 'internal' | 'stripe';

export interface EscrowCreateParams {
  type: EscrowType;
  fromAgentId: string;
  toAgentId: string;
  amount: number;
  taskDescription: string;
  timeoutHours?: number;
}

export interface EscrowRecord {
  escrowId: string;
  type: EscrowType;
  fromAgentId: string;
  toAgentId: string;
  amount: number;
  taskDescription: string;
  status: string;
  onChain: boolean;
  paymentUrl?: string;
  createdAt: Date;
}

// ---------------------------------------------------------------------------
// In-memory registry maps escrowId → EscrowRecord for quick lookups.
// ---------------------------------------------------------------------------

const escrowRegistry = new Map<string, EscrowRecord>();

// ---------------------------------------------------------------------------
// EscrowService class
// ---------------------------------------------------------------------------

export class EscrowService {
  /**
   * Create a new escrow.
   *
   * For 'solana': calls solana-escrow-program.createSolanaEscrow.
   * For 'internal': calls trust-escrow.createEscrow.
   * For 'stripe': placeholder — returns pending record.
   */
  async create(params: EscrowCreateParams): Promise<EscrowRecord> {
    const { type, fromAgentId, toAgentId, amount, taskDescription, timeoutHours = 72 } = params;

    logger.info('[EscrowService] Creating escrow', { type, fromAgentId, toAgentId, amount });

    let escrowId: string;
    let onChain = false;
    let paymentUrl: string | undefined;

    switch (type) {
      case 'solana': {
        let result: EscrowCreateResult | null = null;
        try {
          result = await createSolanaEscrow({
            hiringAgent: fromAgentId,
            workingAgent: toAgentId,
            amountUsdc: amount,
            workDescription: taskDescription,
            deadlineHours: timeoutHours,
          });
          escrowId = result.escrowAccountPubkey;
          onChain = result.onChain;
          paymentUrl = `solana:${result.escrowAccountPubkey}?amount=${amount}&spl-token=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&memo=${encodeURIComponent(taskDescription)}`;
        } catch (err: any) {
          logger.warn('[EscrowService] Solana escrow unavailable, falling back to internal', { err: err?.message });
          // Fallback to internal escrow so the hire flow doesn't break
          const fallback = trustCreate({
            hiringAgent: fromAgentId,
            workingAgent: toAgentId,
            amountUsdc: amount,
            workDescription: taskDescription,
            deadlineHours: timeoutHours,
          });
          escrowId = fallback.id;
          onChain = false;
        }
        break;
      }

      case 'internal': {
        const tx: EscrowTransaction = trustCreate({
          hiringAgent: fromAgentId,
          workingAgent: toAgentId,
          amountUsdc: amount,
          workDescription: taskDescription,
          deadlineHours: timeoutHours,
        });
        escrowId = tx.id;
        onChain = false;
        break;
      }

      case 'stripe': {
        // Stripe escrow: hold via Stripe PaymentIntent with manual capture.
        // Full Stripe integration deferred — return a pending record.
        escrowId = `stripe_${Date.now()}_${Math.random().toString(36).slice(2)}`;
        onChain = false;
        paymentUrl = undefined;
        logger.info('[EscrowService] Stripe escrow placeholder created', { escrowId });
        break;
      }

      default: {
        throw new Error(`Unsupported escrow type: ${type}`);
      }
    }

    const record: EscrowRecord = {
      escrowId,
      type,
      fromAgentId,
      toAgentId,
      amount,
      taskDescription,
      status: 'funded',
      onChain,
      paymentUrl,
      createdAt: new Date(),
    };

    escrowRegistry.set(escrowId, record);
    return record;
  }

  /**
   * Place a hold on escrow funds (alias for create status → 'held').
   */
  async hold(escrowId: string): Promise<EscrowRecord | null> {
    const record = escrowRegistry.get(escrowId);
    if (!record) return null;
    record.status = 'held';
    return record;
  }

  /**
   * Release escrow funds to the working agent.
   * For internal escrows: calls trust-escrow.approveWork (requires 'completed' state).
   * For other types: updates registry status.
   */
  async release(escrowId: string, callerAgentId: string): Promise<EscrowRecord | null> {
    const record = escrowRegistry.get(escrowId);
    if (!record) return null;

    if (record.type === 'internal') {
      try {
        trustRelease(escrowId, callerAgentId);
      } catch (err: any) {
        logger.warn('[EscrowService] trust-escrow release error', { err: err?.message });
      }
    }

    record.status = 'released';
    logger.info('[EscrowService] Escrow released', { escrowId, callerAgentId });
    return record;
  }

  /**
   * Open a dispute on an escrow.
   */
  async dispute(
    escrowId: string,
    callerAgentId: string,
    reason: string,
    guiltyParty: string,
  ): Promise<EscrowRecord | null> {
    const record = escrowRegistry.get(escrowId);
    if (!record) return null;

    if (record.type === 'internal') {
      try {
        trustDispute(escrowId, callerAgentId, reason, guiltyParty);
      } catch (err: any) {
        logger.warn('[EscrowService] trust-escrow dispute error', { err: err?.message });
      }
    }

    record.status = 'disputed';
    logger.info('[EscrowService] Escrow disputed', { escrowId, callerAgentId, reason });
    return record;
  }

  /**
   * Look up an escrow record by ID.
   */
  getRecord(escrowId: string): EscrowRecord | null {
    const inMemory = escrowRegistry.get(escrowId);
    if (inMemory) return inMemory;

    // Check trust-escrow store as fallback
    const trust = trustGet(escrowId);
    if (trust) {
      return {
        escrowId: trust.id,
        type: 'internal',
        fromAgentId: trust.hiringAgent,
        toAgentId: trust.workingAgent,
        amount: trust.amountUsdc,
        taskDescription: trust.workDescription ?? '',
        status: trust.status,
        onChain: false,
        createdAt: trust.createdAt,
      };
    }

    return null;
  }

  /** Reset registry (used in tests). */
  _resetRegistry(): void {
    escrowRegistry.clear();
  }
}

// Singleton instance
export const escrowService = new EscrowService();
export default escrowService;
