/**
 * Trust-Escrow-SDK — A2A escrow for agent-to-agent hiring.
 *
 * Provides createEscrow, markComplete, approveWork, disputeWork.
 *
 * On release:  both agents receive +10 reputation delta.
 * On dispute:  guilty party receives −20 reputation delta.
 *
 * Solana escrow program (Rust-like pseudocode for later deployment):
 *
 *   // --- Anchor / native Solana program pseudocode ---
 *   // pub fn create_escrow(ctx, amount, deadline, work_description) {
 *   //     transfer amount from hiring_agent to escrow PDA;
 *   //     escrow_account.status = "funded";
 *   // }
 *   // pub fn mark_complete(ctx) {
 *   //     require!(signer == working_agent);
 *   //     escrow_account.status = "completed";
 *   //     escrow_account.completed_at = clock::now();
 *   // }
 *   // pub fn approve_work(ctx) {
 *   //     require!(signer == hiring_agent);
 *   //     require!(escrow_account.status == "completed");
 *   //     transfer escrow amount to working_agent;
 *   //     escrow_account.status = "released";
 *   // }
 *   // pub fn dispute_work(ctx, reason) {
 *   //     require!(signer == hiring_agent || signer == working_agent);
 *   //     escrow_account.status = "disputed";
 *   // }
 *   // pub fn auto_release(ctx) {
 *   //     require!(clock::now() > escrow_account.completed_at + 24h);
 *   //     require!(escrow_account.status == "completed");
 *   //     transfer to working_agent;
 *   //     escrow_account.status = "released";
 *   // }
 *
 * Prisma migration comment — run the SQL below to create the table:
 *
 *   CREATE TABLE IF NOT EXISTS escrow_transactions (
 *     id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 *     hiring_agent    TEXT NOT NULL,
 *     working_agent   TEXT NOT NULL,
 *     amount_usdc     NUMERIC(20,6) NOT NULL,
 *     status          TEXT NOT NULL DEFAULT 'funded'
 *                     CHECK (status IN ('funded','completed','released','disputed','cancelled')),
 *     work_description TEXT,
 *     deadline        TIMESTAMPTZ,
 *     completed_at    TIMESTAMPTZ,
 *     reputation_delta_hiring  INT DEFAULT 0,
 *     reputation_delta_working INT DEFAULT 0,
 *     dispute_reason  TEXT,
 *     guilty_party    TEXT,
 *     created_at      TIMESTAMPTZ DEFAULT NOW(),
 *     updated_at      TIMESTAMPTZ DEFAULT NOW()
 *   );
 *
 * @module trust-escrow
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EscrowStatus = 'funded' | 'completed' | 'released' | 'disputed' | 'cancelled';

export interface EscrowTransaction {
  id: string;
  hiringAgent: string;
  workingAgent: string;
  amountUsdc: number;
  status: EscrowStatus;
  workDescription: string | null;
  deadline: Date | null;
  completedAt: Date | null;
  reputationDeltaHiring: number;
  reputationDeltaWorking: number;
  disputeReason: string | null;
  guiltyParty: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateEscrowParams {
  hiringAgent: string;
  workingAgent: string;
  amountUsdc: number;
  workDescription?: string;
  deadlineHours?: number; // hours from now
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const REPUTATION_RELEASE_DELTA = 10;
const REPUTATION_DISPUTE_PENALTY = -20;
const DEFAULT_DEADLINE_HOURS = 72;
const AUTO_RELEASE_HOURS = 24;

// ---------------------------------------------------------------------------
// In-memory store (replace with DB queries when Prisma tables are migrated)
// ---------------------------------------------------------------------------

let escrowStore: EscrowTransaction[] = [];
let idCounter = 1;

function generateId(): string {
  return `escrow-${Date.now()}-${idCounter++}`;
}

/** Reset store — useful for tests */
export function _resetStore(): void {
  escrowStore = [];
  idCounter = 1;
}

// ---------------------------------------------------------------------------
// SDK Functions
// ---------------------------------------------------------------------------

/**
 * Create a new escrow — locks funds from hiring agent.
 */
export function createEscrow(params: CreateEscrowParams): EscrowTransaction {
  if (!params.hiringAgent || !params.workingAgent) {
    throw new Error('Both hiringAgent and workingAgent are required');
  }
  if (params.hiringAgent === params.workingAgent) {
    throw new Error('Hiring agent and working agent must be different');
  }
  if (params.amountUsdc <= 0) {
    throw new Error('Amount must be greater than zero');
  }

  const now = new Date();
  const deadlineHours = params.deadlineHours ?? DEFAULT_DEADLINE_HOURS;
  const deadline = new Date(now.getTime() + deadlineHours * 60 * 60 * 1000);

  const escrow: EscrowTransaction = {
    id: generateId(),
    hiringAgent: params.hiringAgent,
    workingAgent: params.workingAgent,
    amountUsdc: params.amountUsdc,
    status: 'funded',
    workDescription: params.workDescription ?? null,
    deadline,
    completedAt: null,
    reputationDeltaHiring: 0,
    reputationDeltaWorking: 0,
    disputeReason: null,
    guiltyParty: null,
    createdAt: now,
    updatedAt: now,
  };

  escrowStore.push(escrow);
  return escrow;
}

/**
 * Mark work as complete — called by the working agent.
 */
export function markComplete(escrowId: string, callerAgent: string): EscrowTransaction {
  const escrow = escrowStore.find((e) => e.id === escrowId);
  if (!escrow) throw new Error('Escrow not found');
  if (escrow.status !== 'funded') throw new Error('Escrow is not in funded state');
  if (callerAgent !== escrow.workingAgent) throw new Error('Only the working agent can mark complete');

  escrow.status = 'completed';
  escrow.completedAt = new Date();
  escrow.updatedAt = new Date();
  return escrow;
}

/**
 * Approve work and release funds — called by the hiring agent.
 * Both agents receive +10 reputation delta.
 */
export function approveWork(escrowId: string, callerAgent: string): EscrowTransaction {
  const escrow = escrowStore.find((e) => e.id === escrowId);
  if (!escrow) throw new Error('Escrow not found');
  if (escrow.status !== 'completed') throw new Error('Work has not been marked as complete');
  if (callerAgent !== escrow.hiringAgent) throw new Error('Only the hiring agent can approve');

  escrow.status = 'released';
  escrow.reputationDeltaHiring = REPUTATION_RELEASE_DELTA;
  escrow.reputationDeltaWorking = REPUTATION_RELEASE_DELTA;
  escrow.updatedAt = new Date();
  return escrow;
}

/**
 * Dispute work — can be called by either party.
 * The guilty party receives −20 reputation delta.
 */
export function disputeWork(
  escrowId: string,
  callerAgent: string,
  reason: string,
  guiltyParty: string,
): EscrowTransaction {
  const escrow = escrowStore.find((e) => e.id === escrowId);
  if (!escrow) throw new Error('Escrow not found');
  if (escrow.status !== 'funded' && escrow.status !== 'completed') {
    throw new Error('Escrow cannot be disputed in its current state');
  }
  if (callerAgent !== escrow.hiringAgent && callerAgent !== escrow.workingAgent) {
    throw new Error('Only escrow participants can dispute');
  }
  if (guiltyParty !== escrow.hiringAgent && guiltyParty !== escrow.workingAgent) {
    throw new Error('Guilty party must be a participant in the escrow');
  }

  escrow.status = 'disputed';
  escrow.disputeReason = reason;
  escrow.guiltyParty = guiltyParty;

  if (guiltyParty === escrow.hiringAgent) {
    escrow.reputationDeltaHiring = REPUTATION_DISPUTE_PENALTY;
  } else {
    escrow.reputationDeltaWorking = REPUTATION_DISPUTE_PENALTY;
  }

  escrow.updatedAt = new Date();
  return escrow;
}

/**
 * Check whether an escrow is eligible for auto-release (24h after completion).
 */
export function isAutoReleaseEligible(escrow: EscrowTransaction): boolean {
  if (escrow.status !== 'completed' || !escrow.completedAt) return false;
  const elapsed = Date.now() - escrow.completedAt.getTime();
  return elapsed >= AUTO_RELEASE_HOURS * 60 * 60 * 1000;
}

/**
 * Retrieve an escrow by ID.
 */
export function getEscrow(escrowId: string): EscrowTransaction | null {
  return escrowStore.find((e) => e.id === escrowId) ?? null;
}

/**
 * List escrows for a given agent (as hiring or working).
 */
export function listEscrowsForAgent(agentId: string): EscrowTransaction[] {
  return escrowStore.filter((e) => e.hiringAgent === agentId || e.workingAgent === agentId);
}
