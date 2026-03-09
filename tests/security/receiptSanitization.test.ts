/**
 * Unit tests for the sanitizeIntent receipt redaction utility.
 */

import { sanitizeIntent } from '../../src/utils/sanitizeIntent';

describe('sanitizeIntent', () => {
  it('removes verificationToken from the intent', () => {
    const intent = {
      id: 'intent-123',
      amount: 10,
      verificationToken: 'APV_secret_token',
    };

    const result = sanitizeIntent(intent);

    expect(result.verificationToken).toBeUndefined();
    expect(result.id).toBe('intent-123');
    expect(result.amount).toBe(10);
  });

  it('removes metadata.internal but preserves other metadata fields', () => {
    const intent = {
      id: 'intent-456',
      metadata: {
        internal: { secretKey: 'hidden' },
        public: 'visible',
      },
    };

    const result = sanitizeIntent(intent);

    expect(result.metadata?.internal).toBeUndefined();
    expect(result.metadata?.public).toBe('visible');
  });

  it('removes merchant.walletAddress and merchant.apiKeyHash but preserves other merchant fields', () => {
    const intent = {
      id: 'intent-789',
      merchant: {
        id: 'merchant-abc',
        name: 'Test Merchant',
        walletAddress: '9B5X2Fwc4PQHqbXkhmr8vgYKHjgP7V8HBzMgMTf8H',
        apiKeyHash: 'pbkdf2_hash_value',
      },
    };

    const result = sanitizeIntent(intent);

    expect(result.merchant?.walletAddress).toBeUndefined();
    expect(result.merchant?.apiKeyHash).toBeUndefined();
    expect(result.merchant?.id).toBe('merchant-abc');
    expect(result.merchant?.name).toBe('Test Merchant');
  });

  it('does not mutate the original intent object', () => {
    const intent = {
      id: 'intent-999',
      verificationToken: 'secret',
      merchant: { walletAddress: '0xdeadbeef' },
    };

    sanitizeIntent(intent);

    expect(intent.verificationToken).toBe('secret');
    expect(intent.merchant.walletAddress).toBe('0xdeadbeef');
  });

  it('handles intents with no metadata or merchant gracefully', () => {
    const intent = { id: 'intent-minimal', amount: 5 };

    const result = sanitizeIntent(intent);

    expect(result.id).toBe('intent-minimal');
    expect(result.metadata).toBeUndefined();
    expect(result.merchant).toBeUndefined();
  });
});
