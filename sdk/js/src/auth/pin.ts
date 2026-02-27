import crypto from 'crypto';

/** Generate a random PIN of given length (default 6 digits). */
export function generatePin(length = 6): string {
  const digits = Array.from({ length }, () => crypto.randomInt(0, 10));
  return digits.join('');
}

/**
 * Hash a PIN using SHA-256.
 * NOTE: This is a client-side convenience helper for scenarios where you want
 * to avoid sending the raw PIN over the network (defense-in-depth). The server
 * always re-hashes with bcrypt; this does not replace server-side hashing.
 */
export function hashPin(pin: string): string {
  return crypto.createHash('sha256').update(pin).digest('hex');
}

/** Timing-safe comparison of a PIN against its SHA-256 hash. */
export function verifyPin(pin: string, hash: string): boolean {
  const computed = hashPin(pin);
  try {
    return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(hash));
  } catch {
    return false;
  }
}
