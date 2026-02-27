import crypto from 'crypto';

/** Generate a random PIN of given length (default 6 digits). */
export function generatePin(length = 6): string {
  const digits = Array.from({ length }, () => crypto.randomInt(0, 10));
  return digits.join('');
}

/** Hash a PIN using SHA-256 (for client-side pre-hashing before sending over HTTPS). */
export function hashPin(pin: string): string {
  return crypto.createHash('sha256').update(pin).digest('hex');
}

/** Verify a PIN against its SHA-256 hash. */
export function verifyPin(pin: string, hash: string): boolean {
  return hashPin(pin) === hash;
}
