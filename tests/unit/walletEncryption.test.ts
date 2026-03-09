/**
 * Unit tests for AES-256-GCM wallet keypair encryption.
 *
 * Tests cover: round-trip correctness, tamper detection, missing secret,
 * wrong secret, format validation, and multiple unique IVs.
 */

const SIGNING_SECRET = 'test-signing-secret-that-is-long-enough-32ch';
process.env.AGENTPAY_SIGNING_SECRET = SIGNING_SECRET;

import {
  encryptKeypair,
  decryptKeypair,
  isEncrypted,
} from '../../src/utils/walletEncryption';

// Generate a realistic-looking 64-byte Solana secret key
function makeFakeSecretKey(): Uint8Array {
  const bytes = new Uint8Array(64);
  for (let i = 0; i < 64; i++) bytes[i] = (i * 7 + 13) % 256;
  return bytes;
}

describe('walletEncryption', () => {
  describe('encryptKeypair', () => {
    it('returns a colon-delimited iv:authTag:ciphertext string', () => {
      const key = makeFakeSecretKey();
      const encoded = encryptKeypair(key);
      const parts = encoded.split(':');
      expect(parts).toHaveLength(3);
      expect(parts[0].length).toBeGreaterThan(0); // iv hex
      expect(parts[1].length).toBeGreaterThan(0); // authTag hex
      expect(parts[2].length).toBeGreaterThan(0); // ciphertext hex
    });

    it('produces a different IV on each call (non-deterministic)', () => {
      const key = makeFakeSecretKey();
      const a = encryptKeypair(key);
      const b = encryptKeypair(key);
      // IVs (first segment) should differ
      expect(a.split(':')[0]).not.toBe(b.split(':')[0]);
    });

    it('ciphertext length grows with plaintext length', () => {
      const short = new Uint8Array(32);
      const long = new Uint8Array(64);
      const encShort = encryptKeypair(short);
      const encLong = encryptKeypair(long);
      const shortCipherLen = encShort.split(':')[2].length;
      const longCipherLen = encLong.split(':')[2].length;
      expect(longCipherLen).toBeGreaterThan(shortCipherLen);
    });

    it('throws when AGENTPAY_SIGNING_SECRET is not set', () => {
      const saved = process.env.AGENTPAY_SIGNING_SECRET;
      delete process.env.AGENTPAY_SIGNING_SECRET;
      expect(() => encryptKeypair(makeFakeSecretKey())).toThrow('AGENTPAY_SIGNING_SECRET');
      process.env.AGENTPAY_SIGNING_SECRET = saved;
    });
  });

  describe('decryptKeypair', () => {
    it('round-trips a 64-byte Solana secret key exactly', () => {
      const original = makeFakeSecretKey();
      const encoded = encryptKeypair(original);
      const recovered = decryptKeypair(encoded);
      expect(recovered).toEqual(original);
    });

    it('throws on invalid format (missing segments)', () => {
      expect(() => decryptKeypair('onlyone')).toThrow('Invalid encrypted keypair format');
      expect(() => decryptKeypair('two:parts')).toThrow('Invalid encrypted keypair format');
    });

    it('throws on tampered ciphertext (GCM auth tag mismatch)', () => {
      const encoded = encryptKeypair(makeFakeSecretKey());
      const parts = encoded.split(':');
      // Flip one hex character in ciphertext
      const tampered = parts[2].slice(0, -1) + (parts[2].endsWith('a') ? 'b' : 'a');
      const forged = `${parts[0]}:${parts[1]}:${tampered}`;
      expect(() => decryptKeypair(forged)).toThrow();
    });

    it('throws on tampered auth tag', () => {
      const encoded = encryptKeypair(makeFakeSecretKey());
      const [iv, tag, ct] = encoded.split(':');
      const badTag = tag.slice(0, -1) + (tag.endsWith('f') ? '0' : 'f');
      expect(() => decryptKeypair(`${iv}:${badTag}:${ct}`)).toThrow();
    });

    it('throws when secret changes between encrypt and decrypt', () => {
      const original = makeFakeSecretKey();
      const encoded = encryptKeypair(original);
      // Change secret, decryption must fail
      process.env.AGENTPAY_SIGNING_SECRET = 'a-completely-different-secret-here-32x';
      expect(() => decryptKeypair(encoded)).toThrow();
      // Restore
      process.env.AGENTPAY_SIGNING_SECRET = SIGNING_SECRET;
    });

    it('throws when AGENTPAY_SIGNING_SECRET is not set', () => {
      const encoded = encryptKeypair(makeFakeSecretKey());
      const saved = process.env.AGENTPAY_SIGNING_SECRET;
      delete process.env.AGENTPAY_SIGNING_SECRET;
      expect(() => decryptKeypair(encoded)).toThrow('AGENTPAY_SIGNING_SECRET');
      process.env.AGENTPAY_SIGNING_SECRET = saved;
    });
  });

  describe('isEncrypted', () => {
    it('returns true for a properly formatted encoded string', () => {
      const encoded = encryptKeypair(makeFakeSecretKey());
      expect(isEncrypted(encoded)).toBe(true);
    });

    it('returns false for a plain string', () => {
      expect(isEncrypted('notencrypted')).toBe(false);
    });

    it('returns false for two-part string', () => {
      expect(isEncrypted('iv:ciphertext')).toBe(false);
    });

    it('returns true for any three-colon-separated string', () => {
      expect(isEncrypted('a:b:c')).toBe(true);
    });
  });
});
