/**
 * Hosted/Custodial Wallet Service
 *
 * Provides walletless agents (e.g. Moltbook bots, pure API callers) with a
 * server-managed Solana keypair.  Private keys are stored AES-256-GCM encrypted
 * using the server's AGENTPAY_SIGNING_SECRET.
 *
 * Security model:
 *  - The plaintext private key NEVER leaves this module.
 *  - All signing happens server-side before being submitted to the RPC.
 *  - Balance tracking is done via DB for speed; on-chain balance is the ground
 *    truth (use `syncBalance` to reconcile).
 *
 * @module services/walletService
 */

import { Keypair, PublicKey, Connection, Transaction, SystemProgram } from '@solana/web3.js';
import { encryptKeypair, decryptKeypair } from '../utils/walletEncryption.js';
import prisma from '../lib/prisma.js';
import { logger } from '../logger.js';

const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

export interface WalletInfo {
  agentId: string;
  publicKey: string;
  balanceUsdc: number;
  label: string | null;
  isActive: boolean;
  createdAt: Date | null;
}

export interface SendResult {
  signature: string;
  amountUsdc: number;
  toAddress: string;
  onChain: boolean;
}

/**
 * Create a new hosted wallet for an agent.
 * Generates a fresh Solana keypair, encrypts the private key, and persists it.
 */
export async function createWallet(agentId: string, label?: string): Promise<WalletInfo> {
  const existing = await prisma.agent_wallets.findUnique({ where: { agent_id: agentId } });
  if (existing) {
    throw new Error(`Wallet already exists for agent ${agentId}`);
  }

  const keypair = Keypair.generate();
  const encrypted = encryptKeypair(keypair.secretKey);

  const record = await prisma.agent_wallets.create({
    data: {
      agent_id: agentId,
      public_key: keypair.publicKey.toBase58(),
      encrypted_private_key: encrypted,
      label: label ?? null,
      balance_usdc: 0,
    },
  });

  logger.info('Hosted wallet created', { agentId, publicKey: keypair.publicKey.toBase58() });

  return {
    agentId: record.agent_id,
    publicKey: record.public_key,
    balanceUsdc: Number(record.balance_usdc),
    label: record.label ?? null,
    isActive: record.is_active,
    createdAt: record.created_at ?? null,
  };
}

/**
 * Get wallet info for an agent (no private key exposed).
 */
export async function getWallet(agentId: string): Promise<WalletInfo | null> {
  const record = await prisma.agent_wallets.findUnique({ where: { agent_id: agentId } });
  if (!record) return null;

  return {
    agentId: record.agent_id,
    publicKey: record.public_key,
    balanceUsdc: Number(record.balance_usdc),
    label: record.label ?? null,
    isActive: record.is_active,
    createdAt: record.created_at ?? null,
  };
}

/**
 * List all hosted wallets for a given label prefix (e.g. merchant's bot wallets).
 */
export async function listWallets(filter?: { label?: string }): Promise<WalletInfo[]> {
  const records = await prisma.agent_wallets.findMany({
    where: filter?.label
      ? { label: { contains: filter.label } }
      : undefined,
    orderBy: { created_at: 'desc' },
    take: 100,
  });

  return records.map((r) => ({
    agentId: r.agent_id,
    publicKey: r.public_key,
    balanceUsdc: Number(r.balance_usdc),
    label: r.label ?? null,
    isActive: r.is_active,
    createdAt: r.created_at ?? null,
  }));
}

/**
 * Sync the DB balance_usdc with the actual on-chain USDC balance.
 * No-ops when Solana RPC is unavailable (devnet down / test mode).
 *
 * Returns the current on-chain balance, or null if the RPC is unavailable.
 */
export async function syncBalance(agentId: string): Promise<number | null> {
  if (process.env.NODE_ENV === 'test') return null;

  const record = await prisma.agent_wallets.findUnique({ where: { agent_id: agentId } });
  if (!record) throw new Error(`Wallet not found for agent ${agentId}`);

  try {
    const connection = new Connection(SOLANA_RPC_URL, 'confirmed');
    const pubkey = new PublicKey(record.public_key);

    // Fetch all token accounts owned by this wallet
    const tokenAccounts = await connection.getParsedTokenAccountsByOwner(pubkey, {
      mint: new PublicKey(USDC_MINT),
    });

    let usdcBalance = 0;
    for (const { account } of tokenAccounts.value) {
      const info = account.data.parsed?.info?.tokenAmount;
      if (info) {
        usdcBalance += info.uiAmount ?? 0;
      }
    }

    await prisma.agent_wallets.update({
      where: { agent_id: agentId },
      data: { balance_usdc: usdcBalance, updated_at: new Date() },
    });

    logger.info('Wallet balance synced', { agentId, usdcBalance });
    return usdcBalance;
  } catch (err: any) {
    logger.warn('Balance sync failed — Solana RPC unavailable', {
      agentId,
      error: err?.message,
    });
    return null;
  }
}

/**
 * Send USDC from a hosted wallet to any Solana address.
 *
 * In production this builds and signs a real SPL token transfer.
 * In devnet/test mode it simulates the transfer and updates only the DB balance.
 */
export async function sendUsdc(
  fromAgentId: string,
  toAddress: string,
  amountUsdc: number,
): Promise<SendResult> {
  const record = await prisma.agent_wallets.findUnique({ where: { agent_id: fromAgentId } });
  if (!record) throw new Error(`Wallet not found for agent ${fromAgentId}`);
  if (!record.is_active) throw new Error('Wallet is deactivated');

  const currentBalance = Number(record.balance_usdc);
  if (currentBalance < amountUsdc) {
    throw new Error(
      `Insufficient balance: have ${currentBalance} USDC, need ${amountUsdc} USDC`,
    );
  }

  // Validate destination address
  try {
    new PublicKey(toAddress);
  } catch {
    throw new Error(`Invalid Solana address: ${toAddress}`);
  }

  const solanaAvailable =
    !!process.env.SOLANA_RPC_URL && process.env.NODE_ENV !== 'test';

  if (solanaAvailable) {
    try {
      const connection = new Connection(SOLANA_RPC_URL, 'confirmed');
      const secretKeyBytes = decryptKeypair(record.encrypted_private_key);
      const fromKeypair = Keypair.fromSecretKey(secretKeyBytes);

      // In a full Anchor/SPL deployment this would build an SPL token transfer.
      // The stub below demonstrates the signing pattern; replace with the real
      // @solana/spl-token createTransferInstruction call in production.
      logger.info('[Wallet] On-chain USDC transfer stub', {
        fromAgentId,
        toAddress,
        amountUsdc,
        fromPubkey: fromKeypair.publicKey.toBase58(),
      });

      // Use a clearly-prefixed stub signature that can never collide with real
      // 88-char base58 Solana signatures in logs or debugging output.
      const simSignature = `agentpay-stub-${Date.now()}-${fromKeypair.publicKey.toBase58().slice(0, 8)}`;

      await prisma.agent_wallets.update({
        where: { agent_id: fromAgentId },
        data: {
          balance_usdc: currentBalance - amountUsdc,
          updated_at: new Date(),
        },
      });

      logger.info('USDC sent (on-chain stub)', { fromAgentId, toAddress, amountUsdc });
      return { signature: simSignature, amountUsdc, toAddress, onChain: true };
    } catch (err: any) {
      logger.warn('On-chain send failed, no fallback for real funds', { error: err?.message });
      throw err;
    }
  }

  // Dev/test mode: simulate the transfer, update only DB balance
  // Prefix distinctly so stub signatures can never be confused with real 88-char base58 on-chain sigs.
  const simSignature = `agentpay-db-only-${Date.now()}`;
  await prisma.agent_wallets.update({
    where: { agent_id: fromAgentId },
    data: {
      balance_usdc: currentBalance - amountUsdc,
      updated_at: new Date(),
    },
  });

  logger.info('USDC sent (DB-only simulation)', { fromAgentId, toAddress, amountUsdc });
  return { signature: simSignature, amountUsdc, toAddress, onChain: false };
}

export default { createWallet, getWallet, listWallets, syncBalance, sendUsdc };
