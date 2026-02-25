/**
 * Unit tests for certificateService — no DB, no external dependencies.
 */

// Set VERIFICATION_SECRET before importing the module under test
const TEST_SECRET = 'test-secret-for-unit-tests-32ch!!';
process.env.VERIFICATION_SECRET = TEST_SECRET;

import { signCertificate, validateCertificate } from '../../src/services/certificateService';

describe('certificateService', () => {
  const samplePayload = { intentId: 'abc-123', amount: 1.5, currency: 'USDC', ts: 1700000000000 };

  describe('signCertificate', () => {
    it('returns a base64 string', () => {
      const encoded = signCertificate(samplePayload);
      expect(typeof encoded).toBe('string');
      // Should be valid base64
      expect(() => Buffer.from(encoded, 'base64')).not.toThrow();
    });

    it('encodes payload and signature', () => {
      const encoded = signCertificate(samplePayload);
      const decoded = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
      expect(decoded).toHaveProperty('payload');
      expect(decoded).toHaveProperty('signature');
      expect(decoded.payload).toMatchObject(samplePayload);
    });

    it('produces deterministic output for same payload', () => {
      const a = signCertificate(samplePayload);
      const b = signCertificate(samplePayload);
      expect(a).toBe(b);
    });

    it('throws if VERIFICATION_SECRET is not set', () => {
      const original = process.env.VERIFICATION_SECRET;
      delete process.env.VERIFICATION_SECRET;
      expect(() => signCertificate(samplePayload)).toThrow('VERIFICATION_SECRET');
      process.env.VERIFICATION_SECRET = original;
    });
  });

  describe('validateCertificate', () => {
    it('returns payload for a valid certificate', () => {
      const encoded = signCertificate(samplePayload);
      const result = validateCertificate(encoded);
      expect(result).not.toBeNull();
      expect(result).toMatchObject(samplePayload);
    });

    it('returns null for a tampered payload', () => {
      const encoded = signCertificate(samplePayload);
      const decoded = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
      decoded.payload.amount = 9999; // tamper
      const tampered = Buffer.from(JSON.stringify(decoded)).toString('base64');
      expect(validateCertificate(tampered)).toBeNull();
    });

    it('returns null for a tampered signature', () => {
      const encoded = signCertificate(samplePayload);
      const decoded = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
      decoded.signature = 'aabbccdd'.repeat(8); // wrong 64-char hex
      const tampered = Buffer.from(JSON.stringify(decoded)).toString('base64');
      expect(validateCertificate(tampered)).toBeNull();
    });

    it('returns null for invalid base64', () => {
      expect(validateCertificate('!!!not-base64!!!')).toBeNull();
    });

    it('returns null for missing signature field', () => {
      const badCert = Buffer.from(JSON.stringify({ payload: samplePayload })).toString('base64');
      expect(validateCertificate(badCert)).toBeNull();
    });

    it('throws if VERIFICATION_SECRET is not set', () => {
      const encoded = signCertificate(samplePayload);
      const original = process.env.VERIFICATION_SECRET;
      delete process.env.VERIFICATION_SECRET;
      expect(() => validateCertificate(encoded)).toThrow('VERIFICATION_SECRET');
      process.env.VERIFICATION_SECRET = original;
    });
  });
});
