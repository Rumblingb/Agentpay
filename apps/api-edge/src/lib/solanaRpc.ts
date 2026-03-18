/**
 * Edge-compatible Solana RPC client.
 *
 * Uses raw JSON-RPC via fetch() — no @solana/web3.js (Node.js only).
 *
 * Endpoints used:
 *   getParsedTransaction  — fetch parsed tx to verify SPL-token transfer
 *   getBlockHeight        — compute confirmation depth
 *
 * SPL-token transfer check mirrors the Render listener logic exactly:
 *   - Find an instruction with program="spl-token", type="transfer"
 *   - Check that `info.destination === expectedRecipient`
 *   - Confirmation depth = currentBlockHeight - tx.slot
 */

export interface VerifyTxResult {
  /** TX exists on-chain and has no error */
  valid: boolean;
  /** valid AND confirmation depth >= confirmationRequired */
  verified: boolean;
  /** Sender (authority) from the SPL transfer instruction */
  payer: string | null;
  confirmationDepth: number;
  error?: string;
}

interface RpcResponse<T> {
  result: T | null;
  error?: { code: number; message: string };
}

async function rpcCall<T>(
  rpcUrl: string,
  method: string,
  params: unknown[],
): Promise<T | null> {
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Solana RPC HTTP ${res.status}`);
  const data = (await res.json()) as RpcResponse<T>;
  if (data.error) throw new Error(`Solana RPC error: ${data.error.message}`);
  return data.result;
}

/**
 * Verify a Solana transaction pays a specific recipient.
 * Checks for an SPL-token transfer instruction where destination === expectedRecipient.
 */
export async function verifySolanaPayment(
  txHash: string,
  expectedRecipient: string,
  rpcUrl: string,
  confirmationRequired = 2,
): Promise<VerifyTxResult> {
  // ── 1. Fetch parsed transaction ──────────────────────────────────────────
  let tx: any;
  try {
    tx = await rpcCall<any>(rpcUrl, 'getParsedTransaction', [
      txHash,
      { commitment: 'confirmed', maxSupportedTransactionVersion: 0 },
    ]);
  } catch (err) {
    return { valid: false, verified: false, payer: null, confirmationDepth: 0, error: String(err) };
  }

  if (!tx) return { valid: false, verified: false, payer: null, confirmationDepth: 0, error: 'Transaction not found' };
  if (tx.meta?.err) return { valid: false, verified: false, payer: null, confirmationDepth: 0, error: 'Transaction failed on-chain' };

  // ── 2. Find SPL-token transfer to expected recipient ─────────────────────
  const instructions: any[] = tx.transaction?.message?.instructions ?? [];
  let payer: string | null = null;

  for (const ix of instructions) {
    if (!ix.parsed) continue;
    if (ix.program === 'spl-token' && ix.parsed?.type === 'transfer') {
      const { destination, authority } = ix.parsed.info ?? {};
      if (destination === expectedRecipient) {
        payer = authority ?? null;
        break;
      }
    }
    // Also handle transferChecked (newer SPL instruction)
    if (ix.program === 'spl-token' && ix.parsed?.type === 'transferChecked') {
      const { destination, authority } = ix.parsed.info ?? {};
      if (destination === expectedRecipient) {
        payer = authority ?? null;
        break;
      }
    }
  }

  if (!payer && payer !== '') {
    // If no SPL transfer found, check for native SOL system transfer
    for (const ix of instructions) {
      if (!ix.parsed) continue;
      if (ix.program === 'system' && ix.parsed?.type === 'transfer') {
        const { destination, source } = ix.parsed.info ?? {};
        if (destination === expectedRecipient) {
          payer = source ?? null;
          break;
        }
      }
    }
  }

  if (payer === null) {
    return {
      valid: false, verified: false, payer: null, confirmationDepth: 0,
      error: `No payment to ${expectedRecipient} found in transaction`,
    };
  }

  // ── 3. Compute confirmation depth ────────────────────────────────────────
  let confirmationDepth = 0;
  try {
    const blockHeight = await rpcCall<number>(rpcUrl, 'getBlockHeight', [{ commitment: 'confirmed' }]);
    confirmationDepth = blockHeight !== null ? blockHeight - (tx.slot ?? 0) : 0;
  } catch {
    confirmationDepth = 0; // non-fatal — treat as 0
  }

  return {
    valid: true,
    verified: confirmationDepth >= confirmationRequired,
    payer,
    confirmationDepth,
  };
}
