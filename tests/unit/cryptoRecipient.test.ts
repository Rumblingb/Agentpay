import { describe, expect, it } from '@jest/globals';
import {
  buildSolanaPayUri,
  isSolanaAddress,
  resolveCryptoRecipient,
} from '../../apps/api-edge/src/lib/cryptoRecipient';

const TREASURY = '3gnAvryBAuZXCoY95mjwQYud4ep3J8f4KH6ZUPuQnajd';
const MERCHANT = '5YNmS1R9n7VBjnMjhkKLhUXZhiANpvKaQYV8j8PqDxx';

describe('resolveCryptoRecipient', () => {
  it('prefers a merchant Solana wallet', () => {
    const result = resolveCryptoRecipient({
      merchantWallet: MERCHANT,
      platformTreasuryWallet: TREASURY,
    });
    expect(result).toEqual({ ok: true, address: MERCHANT, source: 'merchant_wallet' });
  });

  it('falls back to PLATFORM_TREASURY_WALLET', () => {
    const result = resolveCryptoRecipient({
      merchantWallet: null,
      platformTreasuryWallet: TREASURY,
    });
    expect(result).toEqual({ ok: true, address: TREASURY, source: 'platform_treasury' });
  });

  it('fails closed instead of returning solana:null', () => {
    const result = resolveCryptoRecipient({
      merchantWallet: null,
      platformTreasuryWallet: undefined,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('RECIPIENT_NOT_CONFIGURED');
    expect(result.requiredEnv).toEqual(['PLATFORM_TREASURY_WALLET']);
  });

  it('rejects the literal string null', () => {
    expect(isSolanaAddress('null')).toBe(false);
    const result = resolveCryptoRecipient({ merchantWallet: 'null' });
    expect(result.ok).toBe(false);
  });
});

describe('buildSolanaPayUri', () => {
  it('never interpolates a null recipient', () => {
    expect(() => buildSolanaPayUri('null', 1, 'memo')).toThrow(/REFUSING_NULL_SOLANA_RECIPIENT/);
    const uri = buildSolanaPayUri(TREASURY, 1.5, 'APV_1');
    expect(uri).toContain(`solana:${TREASURY}`);
    expect(uri).not.toContain('solana:null');
  });
});
