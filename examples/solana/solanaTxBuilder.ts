import { PublicKey, Transaction } from '@solana/web3.js';
import { createTransferInstruction, getAssociatedTokenAddress } from '@solana/spl-token';

export type SplitTransferParams = {
  payer: PublicKey; // fee payer / transaction signer
  mint: PublicKey; // SPL token mint (e.g., USDC mint)
  amountUnits: bigint; // amount in smallest token units (e.g., USDC: 1 USDC = 1_000_000 units)
  recipientTokenAccount?: PublicKey; // optional: recipient ATA for the mint
  treasuryTokenAccount?: PublicKey; // optional: treasury ATA for the mint
  recipientOwner: PublicKey; // owner of recipient token account (to derive ATA if not provided)
  treasuryOwner: PublicKey; // owner of treasury token account (to derive ATA if not provided)
  networkFeeBps?: number; // basis points (e.g., 25 for 0.25%) - defaults to env NEXT_PUBLIC_NETWORK_FEE_BPS
};

/**
 * Build a Transaction with two SPL-Token Transfer instructions:
 *  1) principal -> recipient
 *  2) fee -> treasury
 *
 * Notes:
 * - Caller is responsible for signing/sending the returned Transaction.
 * - `amountUnits` and `fee` are computed in integer token units.
 * - This utility uses `@solana/spl-token` helpers to derive ATAs when needed.
 */
export async function buildSplitTokenTransfer(params: SplitTransferParams): Promise<{ tx: Transaction; principalAmount: bigint; feeAmount: bigint }> {
  const {
    payer,
    mint,
    amountUnits,
    recipientTokenAccount,
    treasuryTokenAccount,
    recipientOwner,
    treasuryOwner,
    networkFeeBps,
  } = params;

  const bps = typeof networkFeeBps === 'number' ? networkFeeBps : Number(process.env.NEXT_PUBLIC_NETWORK_FEE_BPS ?? process.env.NETWORK_FEE_BPS ?? 25);
  if (!Number.isFinite(bps) || bps < 0) throw new Error('Invalid networkFeeBps');

  // fee = floor(amount * bps / 10000)
  const feeAmount = (amountUnits * BigInt(Math.floor(bps))) / BigInt(10000);
  const principalAmount = amountUnits - feeAmount;

  if (principalAmount <= BigInt(0)) throw new Error('Principal amount is zero or negative after fee');

  // Resolve token accounts (derive associated token addresses when missing)
  const recipientAta = recipientTokenAccount ?? (await getAssociatedTokenAddress(mint, recipientOwner));
  const treasuryAta = treasuryTokenAccount ?? (await getAssociatedTokenAddress(mint, treasuryOwner));

  const tx = new Transaction();

  // Transfer principal to recipient
  tx.add(createTransferInstruction(
    /* source */ await getAssociatedTokenAddress(mint, payer, false),
    /* destination */ recipientAta,
    /* owner */ payer,
    principalAmount,
  ));

  // Transfer fee to treasury
  tx.add(createTransferInstruction(
    /* source */ await getAssociatedTokenAddress(mint, payer, false),
    /* destination */ treasuryAta,
    /* owner */ payer,
    feeAmount,
  ));

  return { tx, principalAmount, feeAmount };
}
