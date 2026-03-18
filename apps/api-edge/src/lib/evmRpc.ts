/**
 * Edge-compatible EVM JSON-RPC client.
 *
 * Verifies USDC (ERC-20) transfers on Base and Ethereum mainnet using raw
 * fetch() calls — no ethers.js, no viem, no Node.js built-ins.
 *
 * Supported chains:
 *   base     — Base mainnet (Coinbase L2, USDC: 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913)
 *   ethereum — Ethereum mainnet (USDC: 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48)
 *
 * Verification flow:
 *   1. eth_getTransactionReceipt — fetch tx receipt + logs
 *   2. Scan logs for ERC-20 Transfer events from USDC contract
 *   3. Decode `to` (recipient) from topics[2] and value from data
 *   4. Compare recipient + amount against expected values
 *   5. Check block confirmations via eth_blockNumber
 */

export type EvmChain = 'base' | 'ethereum';

export interface EvmVerifyResult {
  valid: boolean;
  verified: boolean;
  payer: string | null;
  amountUsdc: number | null;
  confirmationDepth: number;
  txHash: string;
  chain: EvmChain;
  error?: string;
}

// ── USDC contract addresses ───────────────────────────────────────────────────

const USDC_CONTRACTS: Record<EvmChain, string> = {
  base: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
  ethereum: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
};

// ERC-20 Transfer(address,address,uint256) event topic
const ERC20_TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

// USDC has 6 decimals
const USDC_DECIMALS = 1_000_000;

// Default public RPC fallbacks (rate-limited — set dedicated URLs in env)
const DEFAULT_RPC: Record<EvmChain, string> = {
  base: 'https://mainnet.base.org',
  ethereum: 'https://ethereum.publicnode.com',
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Verify that a tx hash represents a USDC transfer to `expectedRecipient`
 * on the specified EVM chain.
 *
 * @param txHash           0x-prefixed transaction hash (64 hex chars)
 * @param expectedRecipient EVM address (0x-prefixed, case-insensitive)
 * @param chain            'base' | 'ethereum'
 * @param rpcUrl           Optional RPC override (env var preferred)
 * @param confirmationRequired Minimum block depth (default: 2)
 */
export async function verifyEvmPayment(
  txHash: string,
  expectedRecipient: string,
  chain: EvmChain,
  rpcUrl?: string,
  confirmationRequired = 2,
): Promise<EvmVerifyResult> {
  const base: EvmVerifyResult = {
    valid: false,
    verified: false,
    payer: null,
    amountUsdc: null,
    confirmationDepth: 0,
    txHash,
    chain,
  };

  const rpc = rpcUrl ?? DEFAULT_RPC[chain];
  const usdcAddress = USDC_CONTRACTS[chain];
  const recipient = expectedRecipient.toLowerCase();

  try {
    // 1. Fetch transaction receipt
    const receipt = await rpcCall<EvmReceipt | null>(rpc, 'eth_getTransactionReceipt', [txHash]);
    if (!receipt) {
      return { ...base, error: 'Transaction not found or not yet mined' };
    }
    if (receipt.status !== '0x1') {
      return { ...base, error: 'Transaction reverted (status 0x0)' };
    }

    // 2. Find USDC Transfer log to expectedRecipient
    const transferLog = receipt.logs.find(
      (log) =>
        log.address.toLowerCase() === usdcAddress &&
        log.topics[0]?.toLowerCase() === ERC20_TRANSFER_TOPIC &&
        log.topics.length >= 3 &&
        decodeAddress(log.topics[2]).toLowerCase() === recipient,
    );

    if (!transferLog) {
      return { ...base, error: `No USDC Transfer to ${expectedRecipient} found in tx` };
    }

    // 3. Decode sender and amount
    const payer = decodeAddress(transferLog.topics[1] ?? '0x');
    const amountRaw = BigInt(transferLog.data);
    const amountUsdc = Number(amountRaw) / USDC_DECIMALS;

    // 4. Check block confirmations
    const currentBlockHex = await rpcCall<string>(rpc, 'eth_blockNumber', []);
    const txBlock = parseInt(receipt.blockNumber, 16);
    const currentBlock = parseInt(currentBlockHex, 16);
    const confirmationDepth = Math.max(0, currentBlock - txBlock);

    const verified = confirmationDepth >= confirmationRequired;

    return {
      valid: true,
      verified,
      payer,
      amountUsdc,
      confirmationDepth,
      txHash,
      chain,
    };
  } catch (err: unknown) {
    return {
      ...base,
      error: err instanceof Error ? err.message : 'EVM RPC error',
    };
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface EvmLog {
  address: string;
  topics: string[];
  data: string;
}

interface EvmReceipt {
  status: string;
  blockNumber: string;
  from: string;
  logs: EvmLog[];
}

async function rpcCall<T>(rpcUrl: string, method: string, params: unknown[]): Promise<T> {
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`EVM RPC HTTP ${res.status}`);
  const json = await res.json() as { result?: T; error?: { message: string } };
  if (json.error) throw new Error(`EVM RPC error: ${json.error.message}`);
  return json.result as T;
}

/** Decode a 32-byte ABI-encoded address from a topic or data field. */
function decodeAddress(hex: string): string {
  // topics are 32 bytes — take the last 20 bytes (40 hex chars)
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  return '0x' + clean.slice(-40);
}
