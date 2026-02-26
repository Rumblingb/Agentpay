import { isValidSolanaAddress, verifyPaymentRecipient } from '../src/security/payment-verification';
import { validateWebhookUrl } from '../src/utils/webhook-validation';

// Mock the Solana Connection so tests never touch the real RPC network
jest.mock('@solana/web3.js', () => {
  const actual = jest.requireActual('@solana/web3.js');
  return {
    ...actual,
    Connection: jest.fn().mockImplementation(() => ({
      getParsedTransaction: jest.fn().mockResolvedValue(null),
      getBlockHeight: jest.fn().mockResolvedValue(1000),
    })),
  };
});

describe('Payment Verification Security', () => {
  describe('Recipient Address Validation', () => {
    it('should accept valid Solana addresses', () => {
      const validAddresses = [
        '9B5X2FWc4PQHqbXkhmr8vgYKHjgP7V8HBzMgMTf8Hkqo', // Standard Wallet
        'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',   // Token Program (Real System Address)
        'SysvarC1ock11111111111111111111111111111111',   // Sysvar Clock
      ];

      validAddresses.forEach((address) => {
        expect(isValidSolanaAddress(address)).toBe(true);
      });
    });

    it('should reject invalid Solana addresses', () => {
      const invalidAddresses = [
        'invalid-address',
        '12345',
        'not-a-solana-address',
        '5YNmS1R9n7VBjnMjhkKLhUXZhiANpvK', // Too short
        '5YNmS1R9n7VBjnMjhkKLhUXZhiANpvKaQYV8j8PqDTooLong', // Too long
        'l1llllllllllllllllllllllllllllll', // Invalid Base58 (has 'l')
      ];

      invalidAddresses.forEach((address) => {
        expect(isValidSolanaAddress(address)).toBe(false);
      });
    });

    it('should validate address length constraints', () => {
      expect(isValidSolanaAddress('short')).toBe(false);
      expect(isValidSolanaAddress('a'.repeat(50))).toBe(false);
    });

    it('should handle null and undefined inputs', () => {
      expect(isValidSolanaAddress(null as any)).toBe(false);
      expect(isValidSolanaAddress(undefined as any)).toBe(false);
      expect(isValidSolanaAddress('')).toBe(false);
    });
  });

  describe('Payment Verification', () => {
    it('should have valid security functions exported', () => {
      expect(typeof isValidSolanaAddress).toBe('function');
      expect(typeof verifyPaymentRecipient).toBe('function');
    });

    it('should return invalid when the transaction is not found', async () => {
      // The mocked Connection returns null for getParsedTransaction
      const result = await verifyPaymentRecipient(
        'fakeTxHash00000000000000000000000000000000000000000000000000000000',
        '9B5X2FWc4PQHqbXkhmr8vgYKHjgP7V8HBzMgMTf8Hkqo'
      );
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Transaction not found');
    });
  });

  describe('Circuit Breaker', () => {
    it('returns a valid PaymentVerification shape regardless of circuit state', async () => {
      for (let i = 0; i < 2; i++) {
        const result = await verifyPaymentRecipient(
          'badHash' + i,
          'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
        );
        expect(typeof result.valid).toBe('boolean');
        if (!result.valid) {
          expect(typeof result.error).toBe('string');
        }
      }
    });
  });
});

describe('Webhook URL Validation', () => {
  // Uses the shared validateWebhookUrl utility from src/utils/webhook-validation.ts

  it('should allow valid public HTTPS URLs', () => {
    expect(validateWebhookUrl('https://example.com/webhook')).toBeNull();
    expect(validateWebhookUrl('https://api.mysite.io/hooks/payment')).toBeNull();
    expect(validateWebhookUrl('http://mysite.com/hook')).toBeNull();
  });

  it('should block localhost addresses', () => {
    expect(validateWebhookUrl('http://localhost/hook')).not.toBeNull();
    expect(validateWebhookUrl('http://127.0.0.1/hook')).not.toBeNull();
    expect(validateWebhookUrl('http://[::1]/hook')).not.toBeNull();
  });

  it('should block private IP ranges', () => {
    expect(validateWebhookUrl('http://10.0.0.1/hook')).not.toBeNull();
    expect(validateWebhookUrl('http://192.168.1.100/hook')).not.toBeNull();
    expect(validateWebhookUrl('http://172.16.0.1/hook')).not.toBeNull();
    expect(validateWebhookUrl('http://172.31.255.255/hook')).not.toBeNull();
  });

  it('should block cloud metadata service addresses', () => {
    expect(validateWebhookUrl('http://169.254.169.254/latest/meta-data')).not.toBeNull();
    expect(validateWebhookUrl('http://metadata.google.internal/computeMetadata/v1')).not.toBeNull();
  });

  it('should block non-http protocols', () => {
    expect(validateWebhookUrl('ftp://example.com/hook')).not.toBeNull();
    expect(validateWebhookUrl('file:///etc/passwd')).not.toBeNull();
    expect(validateWebhookUrl('javascript:alert(1)')).not.toBeNull();
  });

  it('should return an error for malformed URLs', () => {
    expect(validateWebhookUrl('not-a-url')).not.toBeNull();
    expect(validateWebhookUrl('')).not.toBeNull();
  });
});