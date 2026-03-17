import { Connection, PublicKey } from '@solana/web3.js';

// Configuration from environment variables
const CONFIRMATION_DEPTH = parseInt(process.env.CONFIRMATION_DEPTH || '2', 10);

// ── RPC endpoint list (primary + fallbacks) ──────────────────────────────
// SOLANA_RPC_URL          — primary endpoint (required, defaults to devnet)
// SOLANA_RPC_FALLBACKS    — comma-separated list tried in order on primary failure
//
// On each call, endpoints are tried left-to-right until one succeeds.
// A per-endpoint circuit breaker prevents hammering a downed node.
const PRIMARY_RPC = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
const FALLBACK_RPCS: string[] = (process.env.SOLANA_RPC_FALLBACKS || '')
  .split(',')
  .map((u) => u.trim())
  .filter(Boolean);
const ALL_RPC_URLS: string[] = [PRIMARY_RPC, ...FALLBACK_RPCS];

// ── Per-endpoint circuit breakers ────────────────────────────────────────
const CB_FAILURE_THRESHOLD = 3;   // open after 3 consecutive failures
const CB_RESET_TIMEOUT_MS = 30_000; // half-open after 30 s

interface CbState {
  failures: number;
  lastFailureAt: number;
}
const cbState = new Map<string, CbState>();

function getCb(url: string): CbState {
  let s = cbState.get(url);
  if (!s) { s = { failures: 0, lastFailureAt: 0 }; cbState.set(url, s); }
  return s;
}

function isOpen(url: string): boolean {
  const s = getCb(url);
  if (s.failures >= CB_FAILURE_THRESHOLD) {
    if (Date.now() - s.lastFailureAt < CB_RESET_TIMEOUT_MS) return true;
    s.failures = 0; // half-open: let one probe through
  }
  return false;
}

function recordSuccess(url: string): void { getCb(url).failures = 0; }
function recordFailure(url: string): void {
  const s = getCb(url);
  s.failures += 1;
  s.lastFailureAt = Date.now();
}

// Cache Connection objects so we don't re-construct on every call
const connectionCache = new Map<string, Connection>();
function getConnection(url: string): Connection {
  let conn = connectionCache.get(url);
  if (!conn) { conn = new Connection(url, 'confirmed'); connectionCache.set(url, conn); }
  return conn;
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

function isParsedInstruction(ix: any): ix is any {
  return ix && ix.parsed !== undefined;
}

/**
 * Layer 3: Settlement & Verification
 * Verifies on-chain payment against the expected recipient.
 *
 * Tries ALL_RPC_URLS (primary + fallbacks) in order, skipping endpoints
 * whose per-endpoint circuit breaker is open.  Falls back to the next
 * endpoint on any network/timeout error.  Only returns an error if every
 * endpoint is unavailable or all return a definitive negative result.
 */
export async function verifyPaymentRecipient(
  txHash: string,
  expectedRecipient: string
): Promise<PaymentVerification> {
  let lastError = 'All Solana RPC endpoints are unavailable — please retry shortly';

  for (const rpcUrl of ALL_RPC_URLS) {
    if (isOpen(rpcUrl)) {
      lastError = `RPC circuit open: ${rpcUrl}`;
      continue;
    }

    try {
      const conn = getConnection(rpcUrl);

      // Fetch transaction with support for versioned transactions
      const tx = await conn.getParsedTransaction(txHash, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0,
      });

      // RPC responded — mark success regardless of tx content
      recordSuccess(rpcUrl);

      if (!tx) return { valid: false, error: 'Transaction not found' };
      if (tx.meta?.err) return { valid: false, error: 'Transaction failed on-chain' };

      const instructions = tx.transaction.message.instructions;
      let foundValidTransfer = false;
      let transferDetails: any = null;

      for (const ix of instructions) {
        if (!isParsedInstruction(ix)) continue;
        const ixAny = ix as any;
        if (ixAny.program === 'spl-token' && ixAny.parsed.type === 'transfer') {
          const { destination, tokenAmount, authority } = ixAny.parsed.info;
          if (destination !== expectedRecipient) continue;
          transferDetails = { from: authority, to: destination, amount: tokenAmount.amount, decimals: tokenAmount.decimals };
          foundValidTransfer = true;
          break;
        }
      }

      if (!foundValidTransfer) {
        return { valid: false, error: `No payment to ${expectedRecipient} found in transaction` };
      }

      const blockHeight = await conn.getBlockHeight('confirmed');
      const confirmationDepth = blockHeight - tx.slot;

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
      recordFailure(rpcUrl);
      lastError = error instanceof Error ? error.message : String(error);
      // Try next endpoint
    }
  }

  return { valid: false, error: lastError };
}

/**
 * Checks the current confirmation depth of a transaction for settlement optimization[cite: 61, 63].
 */
export async function checkConfirmationDepth(txHash: string): Promise<ConfirmationCheck> {
  try {
    const conn = getConnection(PRIMARY_RPC);
    const tx = await conn.getParsedTransaction(txHash, 'confirmed');

    if (!tx) {
      return {
        confirmed: false,
        depth: 0,
        required: CONFIRMATION_DEPTH,
        error: 'Transaction not found',
      };
    }

    const blockHeight = await conn.getBlockHeight('confirmed');
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