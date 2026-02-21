import { Connection, PublicKey } from '@solana/web3.js';

// Configuration from environment variables
const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
const CONFIRMATION_DEPTH = parseInt(process.env.CONFIRMATION_DEPTH || '2', 10);

// ============ CIRCUIT BREAKER ============
// Prevents cascading failures when the Solana RPC node is down.
//
// Implementation uses module-level state (single-threaded Node.js event loop
// guarantees no concurrent mutation within a single process). In multi-worker
// / cluster deployments, move this state to Redis for shared circuit status.
const CB_FAILURE_THRESHOLD = 3;         // open after 3 consecutive failures
const CB_RESET_TIMEOUT_MS = 30_000;     // try again after 30 s (half-open)

let cbFailureCount = 0;
let cbLastFailureAt = 0;

function circuitIsOpen(): boolean {
  if (cbFailureCount >= CB_FAILURE_THRESHOLD) {
    const elapsed = Date.now() - cbLastFailureAt;
    if (elapsed < CB_RESET_TIMEOUT_MS) {
      return true; // still open
    }
    // Half-open: allow one probe through and reset counter
    cbFailureCount = 0;
  }
  return false;
}

function recordRpcSuccess(): void {
  cbFailureCount = 0;
}

function recordRpcFailure(): void {
  cbFailureCount += 1;
  cbLastFailureAt = Date.now();
}
// =========================================

export interface PaymentVerification {
  valid: boolean;
  recipient?: string;
  payer?: string;
  amount?: string;
  decimals?: number;
  confirmationDepth?: number;
  transaction?: string;
  verified?: boolean;
  error?: string;
}

export interface ConfirmationCheck {
  confirmed: boolean;
  depth: number;
  required: number;
  error?: string;
}

// Layer 3: Settlement & Verification - Establishing Connection [cite: 63, 64]
const connection = new Connection(SOLANA_RPC_URL, 'confirmed');

function isParsedInstruction(ix: any): ix is any {
  return ix && ix.parsed !== undefined;
}

/**
 * Layer 3: Settlement & Verification 
 * Verifies on-chain payment against the expected recipient.
 * Protected by a circuit breaker: if the Solana RPC fails repeatedly,
 * returns "System congested" instead of making the caller wait.
 */
export async function verifyPaymentRecipient(
  txHash: string,
  expectedRecipient: string
): Promise<PaymentVerification> {
  // Circuit breaker check — fast-fail when RPC is consistently unreachable
  if (circuitIsOpen()) {
    return {
      valid: false,
      error: 'System congested — Solana RPC unavailable, please retry shortly',
    };
  }

  try {
    // Fetch transaction with support for versioned transactions (Protocol Agnosticism)
    const tx = await connection.getParsedTransaction(txHash, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0
    });

    if (!tx) {
      recordRpcSuccess(); // RPC responded (even if tx not found)
      return { valid: false, error: 'Transaction not found' };
    }

    if (tx.meta?.err) {
      recordRpcSuccess();
      return { valid: false, error: 'Transaction failed on-chain' };
    }

    const instructions = tx.transaction.message.instructions;
    let foundValidTransfer = false;
    let transferDetails: any = null;

    // Layer 1: Protocol Translation - Normalizing SPL-Token instructions
    for (const ix of instructions) {
      if (!isParsedInstruction(ix)) continue;

      const ixAny = ix as any;
      if (ixAny.program === 'spl-token' && ixAny.parsed.type === 'transfer') {
        const { destination, tokenAmount, authority } = ixAny.parsed.info;

        // CRITICAL SECURITY: verify destination matches expected recipient
        if (destination !== expectedRecipient) {
          continue;
        }

        transferDetails = {
          from: authority,
          to: destination,
          amount: tokenAmount.amount,
          decimals: tokenAmount.decimals,
        };

        foundValidTransfer = true;
        break;
      }
    }

    if (!foundValidTransfer) {
      recordRpcSuccess();
      return {
        valid: false,
        error: `No payment to ${expectedRecipient} found in transaction`,
      };
    }

    const blockHeight = await connection.getBlockHeight('confirmed');
    const confirmationDepth = blockHeight - tx.slot;

    recordRpcSuccess();
    return {
      valid: true,
      recipient: transferDetails.to,
      payer: transferDetails.from,
      amount: transferDetails.amount,
      decimals: transferDetails.decimals,
      confirmationDepth,
      transaction: txHash,
      verified: confirmationDepth >= CONFIRMATION_DEPTH,
    };
  } catch (error) {
    recordRpcFailure();
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { valid: false, error: errorMessage };
  }
}

/**
 * Checks the current confirmation depth of a transaction for settlement optimization[cite: 61, 63].
 */
export async function checkConfirmationDepth(txHash: string): Promise<ConfirmationCheck> {
  try {
    const tx = await connection.getParsedTransaction(txHash, 'confirmed');

    if (!tx) {
      return {
        confirmed: false,
        depth: 0,
        required: CONFIRMATION_DEPTH,
        error: 'Transaction not found',
      };
    }

    const blockHeight = await connection.getBlockHeight('confirmed');
    const confirmationDepth = blockHeight - tx.slot;

    return {
      confirmed: confirmationDepth >= CONFIRMATION_DEPTH,
      depth: confirmationDepth,
      required: CONFIRMATION_DEPTH,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      confirmed: false,
      depth: 0,
      required: CONFIRMATION_DEPTH,
      error: errorMessage,
    };
  }
}

/**
 * Validates if a string is a valid Solana address format.
 * * Essential for "Protocol Translation" (Layer 1)[cite: 59]. 
 * This version uses the native PublicKey constructor to ensure it accepts both 
 * on-curve wallets and off-curve system addresses (PDAs/Sysvars).
 */
export function isValidSolanaAddress(address: string): boolean {
  if (!address || typeof address !== 'string') {
    return false;
  }

  // Length check: Base58 encoded 32-byte public keys are typically 32-44 characters
  if (address.length < 32 || address.length > 44) {
    return false;
  }

  try {
    // We use the PublicKey constructor to handle the Base58 decoding.
    const pubkey = new PublicKey(address);
    
    // The constructor validates that the input is a valid Base58 string 
    // that decodes to exactly 32 bytes. By returning true here, we allow 
    // off-curve addresses required by your security test suite.
    return pubkey.toBytes().length === 32;
  } catch (error) {
    // If the string is not valid Base58 or not 32 bytes, it fails.
    return false;
  }
}

export default {
  verifyPaymentRecipient,
  checkConfirmationDepth,
  isValidSolanaAddress,
};