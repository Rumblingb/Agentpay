import crypto from 'crypto';

/** Generate a random PIN of given length (default 6 digits). */
export function generatePin(length = 6): string {
  const digits = Array.from({ length }, () => crypto.randomInt(0, 10));
  return digits.join('');
}

/**
 * Derive a transit hash from a PIN using PBKDF2 (100,000 iterations, SHA-256).
 *
 * This is a client-side helper to avoid sending the raw PIN over the network
 * (defense-in-depth). The server ALWAYS re-hashes with bcrypt; this does NOT
 * replace server-side hashing and confers no meaningful offline security on its own.
 *
 * @param pin  The raw PIN string.
 * @param salt A per-session or per-user salt (e.g. agentId). Must NOT be empty.
 */
export function hashPinForTransit(pin: string, salt: string): string {
  return crypto.pbkdf2Sync(pin, salt, 100_000, 32, 'sha256').toString('hex');
}
