/**
 * Helius Integration — On-chain AgentRank signal enrichment.
 *
 * Helius (https://helius.dev) is a Solana RPC + analytics provider.  This
 * service fetches on-chain transaction history for a wallet address and
 * computes additional AgentRank signals:
 *
 *   - `txVolume`      Total number of confirmed transactions
 *   - `usdcVolume`    Total USDC value received (USD-denominated)
 *   - `walletAgeDays` Age of the wallet in calendar days
 *   - `uniquePayers`  Number of unique sender addresses
 *
 * The signals are fed into `agentrankService.adjustScore()` to produce a
 * richer score that reflects real on-chain behaviour.
 *
 * When HELIUS_API_KEY is not set the service returns a stub result so the
 * rest of the system still works without a Helius subscription.
 *
 * @module services/heliusService
 */

import axios from 'axios';
import { logger } from '../logger.js';

const HELIUS_API_KEY = process.env.HELIUS_API_KEY ?? '';
const HELIUS_BASE_URL = 'https://api.helius.xyz/v0';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const USDC_DECIMALS = 6;

export interface OnChainSignals {
  walletAddress: string;
  txVolume: number;
  usdcVolumeReceived: number;
  walletAgeDays: number;
  uniquePayers: number;
  dataSource: 'helius' | 'stub';
}

interface HeliusTransaction {
  signature: string;
  timestamp: number;
  type: string;
  tokenTransfers?: Array<{
    mint: string;
    fromUserAccount: string;
    toUserAccount: string;
    tokenAmount: number;
  }>;
  nativeTransfers?: Array<{
    fromUserAccount: string;
    toUserAccount: string;
    amount: number;
  }>;
}

/**
 * Fetch enhanced transaction history for a Solana wallet from Helius.
 * Returns at most 100 recent transactions.
 */
async function fetchTransactionHistory(
  walletAddress: string,
): Promise<HeliusTransaction[]> {
  const url = `${HELIUS_BASE_URL}/addresses/${walletAddress}/transactions`;
  const params = {
    'api-key': HELIUS_API_KEY,
    limit: 100,
  };

  const response = await axios.get<HeliusTransaction[]>(url, { params, timeout: 10_000 });
  return response.data;
}

/**
 * Compute on-chain AgentRank signals for a wallet address.
 *
 * Falls back to a zero-value stub when:
 *  - HELIUS_API_KEY is not configured
 *  - Helius API is unreachable
 *  - The wallet has no transaction history
 */
export async function getOnChainSignals(walletAddress: string): Promise<OnChainSignals> {
  if (!HELIUS_API_KEY) {
    logger.debug('[Helius] HELIUS_API_KEY not set — returning stub signals', { walletAddress });
    return {
      walletAddress,
      txVolume: 0,
      usdcVolumeReceived: 0,
      walletAgeDays: 0,
      uniquePayers: 0,
      dataSource: 'stub',
    };
  }

  try {
    const txs = await fetchTransactionHistory(walletAddress);

    if (txs.length === 0) {
      return {
        walletAddress,
        txVolume: 0,
        usdcVolumeReceived: 0,
        walletAgeDays: 0,
        uniquePayers: 0,
        dataSource: 'helius',
      };
    }

    // Sort ascending to find the oldest tx (wallet creation)
    const sorted = [...txs].sort((a, b) => a.timestamp - b.timestamp);
    const oldestTs = sorted[0].timestamp * 1000; // convert s → ms
    const walletAgeDays = Math.floor((Date.now() - oldestTs) / (1000 * 60 * 60 * 24));

    // Aggregate USDC received + unique payers
    let usdcVolumeReceived = 0;
    const uniquePayerSet = new Set<string>();

    for (const tx of txs) {
      for (const transfer of tx.tokenTransfers ?? []) {
        if (
          transfer.mint === USDC_MINT &&
          transfer.toUserAccount === walletAddress
        ) {
          usdcVolumeReceived += transfer.tokenAmount / 10 ** USDC_DECIMALS;
          if (transfer.fromUserAccount) {
            uniquePayerSet.add(transfer.fromUserAccount);
          }
        }
      }
    }

    const signals: OnChainSignals = {
      walletAddress,
      txVolume: txs.length,
      usdcVolumeReceived,
      walletAgeDays,
      uniquePayers: uniquePayerSet.size,
      dataSource: 'helius',
    };

    logger.info('[Helius] On-chain signals computed', signals);
    return signals;
  } catch (err: any) {
    logger.warn('[Helius] Failed to fetch on-chain signals', {
      walletAddress,
      error: err?.message,
    });
    return {
      walletAddress,
      txVolume: 0,
      usdcVolumeReceived: 0,
      walletAgeDays: 0,
      uniquePayers: 0,
      dataSource: 'stub',
    };
  }
}

/**
 * Convert raw on-chain signals to an AgentRank score delta.
 *
 * Scoring weights (tune as needed):
 *   - Each unique payer:    +2  (max 100 pts)
 *   - Wallet age per 30d:   +5  (max 100 pts)
 *   - USDC volume tiers:    +1 per $100 received (max 100 pts)
 *   - Tx volume per 10:     +1  (max 50 pts)
 */
export function signalsToDelta(signals: OnChainSignals): number {
  const payerScore    = Math.min(signals.uniquePayers * 2, 100);
  const ageScore      = Math.min(Math.floor(signals.walletAgeDays / 30) * 5, 100);
  const volumeScore   = Math.min(Math.floor(signals.usdcVolumeReceived / 100), 100);
  const txScore       = Math.min(Math.floor(signals.txVolume / 10), 50);

  return payerScore + ageScore + volumeScore + txScore;
}

export default { getOnChainSignals, signalsToDelta };
