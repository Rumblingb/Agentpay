import { isValidSolanaAddress } from '../src/security/payment-verification';

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
    });
  });
});