/**
 * Resolve a real USDC/Solana recipient for payment intents.
 *
 * Never emit `solana:null` or a null recipientAddress. If no wallet is
 * configured on the merchant and no platform treasury is set, fail closed.
 */

export const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

export type CryptoRecipientSource = 'merchant_wallet' | 'platform_treasury';

export type CryptoRecipient =
  | { ok: true; address: string; source: CryptoRecipientSource }
  | {
      ok: false;
      code: 'RECIPIENT_NOT_CONFIGURED';
      message: string;
      requiredEnv: string[];
    };

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function isSolanaAddress(value: unknown): value is string {
  return typeof value === 'string' && BASE58_RE.test(value.trim());
}

export function resolveCryptoRecipient(input: {
  merchantWallet?: string | null;
  platformTreasuryWallet?: string | null;
}): CryptoRecipient {
  if (isSolanaAddress(input.merchantWallet)) {
    return { ok: true, address: input.merchantWallet.trim(), source: 'merchant_wallet' };
  }
  if (isSolanaAddress(input.platformTreasuryWallet)) {
    return {
      ok: true,
      address: input.platformTreasuryWallet.trim(),
      source: 'platform_treasury',
    };
  }
  return {
    ok: false,
    code: 'RECIPIENT_NOT_CONFIGURED',
    message:
      'No USDC recipient is configured. Set a merchant Solana wallet or PLATFORM_TREASURY_WALLET. Refusing to emit a null recipient.',
    requiredEnv: ['PLATFORM_TREASURY_WALLET'],
  };
}

export function buildSolanaPayUri(address: string, amount: number, memo: string): string {
  if (!isSolanaAddress(address)) {
    throw new Error('REFUSING_NULL_SOLANA_RECIPIENT');
  }
  return `solana:${address}?amount=${amount}&spl-token=${USDC_MINT}&memo=${encodeURIComponent(memo)}`;
}
